// Supabase Edge Function (Deno) for the reminder job, called by pg_cron/pg_net (supabase/cron/reminders.sql).
// Thin wiring only: logic and tests live in packages/api (reminders.ts). Deploy with:
//   supabase functions deploy reminders --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// CHANNEL_TOKEN_ENC_KEY, REMINDER_CRON_SECRET. NOT tested locally (needs a real database + LINE).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import {
  createLinePush,
  createReminderHandler,
  type ReminderCandidate,
} from "../../../packages/api/src/reminders.ts";

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

// Same AES-256-GCM layout as line-webhook/channels.ts: iv(12) || ciphertext+tag, key CHANNEL_TOKEN_ENC_KEY.
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

Deno.serve(
  createReminderHandler(
    {
      now: () => new Date(),
      async listCandidates(from, to, kind) {
        const { data, error } = await supabase.rpc("due_reminders", {
          p_from: from,
          p_to: to,
          p_kind: kind,
        });
        if (error) throw new Error(error.message);
        return (data as Row[]).map(
          (r): ReminderCandidate => ({
            bookingId: r.booking_id,
            shopId: r.shop_id,
            shopName: r.shop_name,
            remindersEnabled: r.reminders_enabled,
            status: r.status,
            start: new Date(r.starts_at).toISOString(),
            customerLineUserId: r.customer_line_user_id,
            serviceName: r.service_name,
            staffName: r.staff_name,
          }),
        );
      },
      async claim(bookingId, kind) {
        const { data, error } = await supabase.rpc("claim_reminder", {
          p_booking_id: bookingId,
          p_kind: kind,
        });
        if (error) throw new Error(error.message);
        return data === true;
      },
      async release(bookingId, kind) {
        await supabase.from("reminders_log").delete().eq("booking_id", bookingId).eq("kind", kind);
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
      push: createLinePush(),
    },
    Deno.env.get("REMINDER_CRON_SECRET") ?? "",
  ),
);
