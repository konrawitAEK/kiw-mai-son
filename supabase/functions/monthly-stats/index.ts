// Supabase Edge Function (Deno) for the day-25 monthly summary, called daily by pg_cron/pg_net (supabase/cron/monthly-stats.sql).
// Thin wiring only: logic and tests live in packages/api (monthly-stats.ts). Deploy with:
//   supabase functions deploy monthly-stats --no-verify-jwt
// Secrets (names only; see .env.example): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// CHANNEL_TOKEN_ENC_KEY, MONTHLY_STATS_CRON_SECRET, BILLING_PAYMENT_URL (optional until T17).
// NOT tested locally (needs a real database + LINE).
import { createClient } from "npm:@supabase/supabase-js@2.47.10";
import { createMonthlyStatsHandler } from "../../../packages/api/src/monthly-stats.ts";
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
    "monthly-stats",
    createMonthlyStatsHandler(
      {
        now: () => new Date(),
        async listStats(from, to) {
          const { data, error } = await supabase.rpc("monthly_stats", { p_from: from, p_to: to });
          if (error) throw new Error(error.message);
          const rows = data as Row[];
          const { data: shops, error: e2 } = await supabase
            .from("shops")
            .select("id, owner_line_user_id")
            .in(
              "id",
              rows.map((r) => r.shop_id),
            );
          if (e2) throw new Error(e2.message);
          const owners = new Map((shops as Row[]).map((s) => [s.id, s.owner_line_user_id]));
          return rows.map((r) => ({
            shopId: r.shop_id,
            shopName: r.shop_name,
            ownerLineUserId: owners.get(r.shop_id) ?? "",
            stats: {
              bookings: r.bookings,
              viaLine: r.via_line,
              viaOwner: r.via_owner,
              noShows: r.no_shows,
              cancelled: r.cancelled,
              depositsPaid: r.deposits_paid,
              depositsPaidAmount: r.deposits_paid_amount,
            },
          }));
        },
        async claim(shopId, month) {
          const { data, error } = await supabase.rpc("claim_monthly_summary", {
            p_shop_id: shopId,
            p_month: month,
          });
          if (error) throw new Error(error.message);
          return data === true;
        },
        async release(shopId, month) {
          await supabase
            .from("monthly_summaries_log")
            .delete()
            .eq("shop_id", shopId)
            .eq("month", month);
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
        // One shared link until T17 adds per-shop PromptPay billing links.
        getPaymentLink: async () => Deno.env.get("BILLING_PAYMENT_URL") || null,
        push: createLinePush(),
      },
      Deno.env.get("MONTHLY_STATS_CRON_SECRET") ?? "",
      alert,
    ),
    alert,
  ),
);
