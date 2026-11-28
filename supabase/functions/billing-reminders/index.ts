// Supabase Edge Function (Deno) for trial-ending reminders (7/3/1 days before), called daily by pg_cron/pg_net
// (supabase/cron/billing-reminders.sql). Thin wiring only: logic and tests live in packages/api (billing.ts). Deploy with:
//   supabase functions deploy billing-reminders --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// CHANNEL_TOKEN_ENC_KEY, BILLING_CRON_SECRET, LIFF_ID.
// NOT tested locally (needs a real database + LINE).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createBillingReminderHandler } from "../../../packages/api/src/billing.ts";
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

// Same AES-256-GCM layout as reminders/index.ts: iv(12) || ciphertext+tag, key CHANNEL_TOKEN_ENC_KEY.
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
    "billing-reminders",
    createBillingReminderHandler(
      {
        now: () => new Date(),
        async listSubscriptions() {
          const { data, error } = await supabase
            .from("shop_subscriptions")
            .select("shop_id, trial_ends_at, paid_until, plan, shops(name, owner_line_user_id)");
          if (error) throw new Error(error.message);
          return (data as Row[]).map((r) => ({
            shopId: r.shop_id,
            shopName: r.shops?.name ?? "",
            ownerLineUserId: r.shops?.owner_line_user_id ?? "",
            subscription: {
              trialEndsAt: new Date(r.trial_ends_at).toISOString(),
              paidUntil: r.paid_until ? new Date(r.paid_until).toISOString() : null,
              plan: r.plan,
            },
          }));
        },
        async claim(shopId, kind) {
          const { data, error } = await supabase.rpc("claim_billing_reminder", {
            p_shop_id: shopId,
            p_kind: kind,
          });
          if (error) throw new Error(error.message);
          return data === true;
        },
        async release(shopId, kind) {
          await supabase
            .from("billing_reminders_log")
            .delete()
            .eq("shop_id", shopId)
            .eq("kind", kind);
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
        paymentLink: (shopId) => {
          const liffId = Deno.env.get("LIFF_ID");
          return liffId
            ? `https://liff.line.me/${liffId}?page=admin&shop=${encodeURIComponent(shopId)}`
            : null;
        },
        push: createLinePush(),
      },
      Deno.env.get("BILLING_CRON_SECRET") ?? "",
      alert,
    ),
    alert,
  ),
);
