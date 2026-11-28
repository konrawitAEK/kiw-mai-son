import { isSummaryDay, monthRange, monthlySummaryText } from "@kms/core";
import type { MonthlyStats } from "@kms/core";
import type { LineMessage } from "./reminders.js";

export interface ShopMonthlyStats {
  shopId: string;
  shopName: string;
  ownerLineUserId: string;
  stats: MonthlyStats;
}

export interface MonthlyStatsDeps {
  now(): Date;
  /** Stats for every shop with bookings starting in [fromIso, toIso) (SQL `monthly_stats`). */
  listStats(fromIso: string, toIso: string): Promise<ShopMonthlyStats[]>;
  /** Atomically records (shop, month) in monthly_summaries_log. false = already sent. */
  claim(shopId: string, month: string): Promise<boolean>;
  /** Undo a claim after a failed push so the next run retries. */
  release(shopId: string, month: string): Promise<void>;
  /** Decrypted channel access token, or null if the shop has no channel. */
  getAccessToken(shopId: string): Promise<string | null>;
  /** Subscription payment link for the shop (T17 will make it per shop), or null. */
  getPaymentLink(shopId: string): Promise<string | null>;
  push(accessToken: string, to: string, messages: LineMessage[] | TextMessage[]): Promise<void>;
}

export interface TextMessage {
  type: "text";
  text: string;
}

export interface MonthlyStatsResult {
  sent: number;
  skipped: number;
  failed: number;
}

/** Sends the day-25 summary to each shop owner once per month. Outside day 25 (Bangkok) it does nothing unless `force`. */
export async function runMonthlySummaries(
  deps: MonthlyStatsDeps,
  opts: { force?: boolean } = {},
): Promise<MonthlyStatsResult> {
  const result: MonthlyStatsResult = { sent: 0, skipped: 0, failed: 0 };
  const now = deps.now();
  if (!opts.force && !isSummaryDay(now)) return result;
  const range = monthRange(now);
  const rows = await deps.listStats(range.from, range.to);

  for (const r of rows) {
    try {
      const token = await deps.getAccessToken(r.shopId);
      if (!token || !r.ownerLineUserId) {
        result.skipped++;
        continue;
      }
      if (!(await deps.claim(r.shopId, range.key))) {
        result.skipped++;
        continue;
      }
      try {
        const text = monthlySummaryText({
          shopName: r.shopName,
          range,
          stats: r.stats,
          paymentLink: await deps.getPaymentLink(r.shopId),
        });
        await deps.push(token, r.ownerLineUserId, [{ type: "text", text }]);
        result.sent++;
      } catch {
        await deps.release(r.shopId, range.key);
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** HTTP entry for pg_cron (daily): POST with `Authorization: Bearer <cronSecret>`. */
export function createMonthlyStatsHandler(
  deps: MonthlyStatsDeps,
  cronSecret: string,
  alert?: (text: string) => Promise<void>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const auth = req.headers.get("authorization") ?? "";
    if (!cronSecret || auth !== `Bearer ${cronSecret}`)
      return new Response("unauthorized", { status: 401 });
    try {
      const result = await runMonthlySummaries(deps);
      if (result.failed > 0 && alert)
        await alert(`⚠️ ส่งสรุปรายเดือนไม่สำเร็จ ${result.failed} ร้าน (ส่งสำเร็จ ${result.sent})`);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("error", { status: 500 });
    }
  };
}
