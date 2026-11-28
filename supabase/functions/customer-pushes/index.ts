// Supabase Edge Function (Deno): sends queued deposit-decision pushes to customers (T20), called by pg_cron/pg_net
// (supabase/cron/customer-pushes.sql). Thin wiring only: logic and tests live in packages/api (customer-push.ts).
// Deploy with: supabase functions deploy customer-pushes --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHANNEL_TOKEN_ENC_KEY,
// CUSTOMER_PUSH_CRON_SECRET. NOT tested locally (needs a real database + LINE).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  createCustomerPushHandler,
  type PendingPush,
} from "../../../packages/api/src/customer-push.ts";
import { createLinePush } from "../../../packages/api/src/reminders.ts";
import { createFounderAlerter, withErrorAlert } from "../../../packages/api/src/monitoring.ts";

declare const Deno: {
  env: { get(k: string): string | undefined };
  serve(h: (req: Request) => Promise<Response>): void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Same AES-256-GCM layout as the reminders function: iv(12) || ciphertext+tag, key CHANNEL_TOKEN_ENC_KEY.
const keyPromise = crypto.subtle.importKey(
  "raw",
  Uint8Array.from(atob(Deno.env.get("CHANNEL_TOKEN_ENC_KEY")!), (c) => c.charCodeAt(0)),
  "AES-GCM",
  false,
  ["decrypt"],
);

async function decrypt(bytea: string): Promise<string> {
  const hex = bytea.startsWith("\\x") ? bytea.slice(2) : bytea;
  const buf = Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: buf.slice(0, 12) },
    await keyPromise,
    buf.slice(12),
  );
  return new TextDecoder().decode(plain);
}

const alert = createFounderAlerter({
  channelAccessToken: Deno.env.get("FOUNDER_LINE_CHANNEL_TOKEN"),
  founderUserId: Deno.env.get("FOUNDER_LINE_USER_ID"),
});

Deno.serve(
  withErrorAlert(
    "customer-pushes",
    createCustomerPushHandler(
      {
        async listPending(limit) {
          const { data, error } = await supabase.rpc("pending_customer_pushes", { p_limit: limit });
          if (error) throw new Error(error.message);
          return (data as Row[]).map(
            (r): PendingPush => ({
              id: Number(r.id),
              kind: r.kind,
              shopId: r.shop_id,
              shopName: r.shop_name,
              start: new Date(r.starts_at).toISOString(),
              serviceName: r.service_name,
              depositAmount: r.deposit_amount,
              customerLineUserId: r.customer_line_user_id,
            }),
          );
        },
        async markSent(id) {
          const { error } = await supabase.rpc("mark_customer_push_sent", { p_id: id });
          if (error) throw new Error(error.message);
        },
        async getAccessToken(shopId) {
          const { data, error } = await supabase
            .from("line_channels")
            .select("channel_access_token_encrypted")
            .eq("shop_id", shopId)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return data ? await decrypt(data.channel_access_token_encrypted) : null;
        },
        push: createLinePush<{ type: "text"; text: string }>(),
      },
      Deno.env.get("CUSTOMER_PUSH_CRON_SECRET") ?? "",
      alert,
    ),
    alert,
  ),
);
