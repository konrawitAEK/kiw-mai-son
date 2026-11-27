import { reminderPostbackData, reminderText } from "@kms/core";

export const HOUR_MS = 3_600_000;
/** Reminder goes out when the booking starts within [now+23h, now+24h]; run the job every 15 min or so. */
export const REMINDER_LEAD_MIN_MS = 23 * HOUR_MS;
export const REMINDER_LEAD_MAX_MS = 24 * HOUR_MS;
export const REMINDER_KIND = "day_before";

/** One booking that has no reminder logged yet, joined with what the message needs. */
export interface ReminderCandidate {
  bookingId: string;
  shopId: string;
  shopName: string;
  /** shops.reminders_enabled */
  remindersEnabled: boolean;
  status: string;
  start: string;
  customerLineUserId: string | null;
  serviceName: string;
  staffName: string;
}

export interface LineMessage {
  type: "template";
  altText: string;
  template: {
    type: "buttons";
    text: string;
    actions: { type: "postback"; label: string; data: string; displayText: string }[];
  };
}

export interface ReminderDeps {
  now(): Date;
  /** Non-cancelled bookings starting in [fromIso, toIso] with no reminders_log row of `kind`. */
  listCandidates(fromIso: string, toIso: string, kind: string): Promise<ReminderCandidate[]>;
  /** Atomically records (booking, kind) in reminders_log. false = already there (someone else sent it). */
  claim(bookingId: string, kind: string): Promise<boolean>;
  /** Undo a claim after a failed push so the next run retries. */
  release(bookingId: string, kind: string): Promise<void>;
  /** Decrypted channel access token for the shop, or null if it has no channel. */
  getAccessToken(shopId: string): Promise<string | null>;
  push(accessToken: string, to: string, messages: LineMessage[]): Promise<void>;
}

export interface ReminderResult {
  sent: number;
  skipped: number;
  failed: number;
}

export function buildReminderMessage(c: ReminderCandidate): LineMessage {
  return {
    type: "template",
    altText: "นัดพรุ่งนี้ กรุณายืนยันการมา",
    template: {
      type: "buttons",
      text: reminderText({
        shopName: c.shopName,
        serviceName: c.serviceName,
        staffName: c.staffName,
        start: c.start,
      }),
      actions: [
        {
          type: "postback",
          label: "ยืนยันมา",
          data: reminderPostbackData("confirm", c.bookingId),
          displayText: "ยืนยันมา",
        },
        {
          type: "postback",
          label: "ขอเลื่อน",
          data: reminderPostbackData("reschedule", c.bookingId),
          displayText: "ขอเลื่อน",
        },
      ],
    },
  };
}

/** Sends due reminders. Never sends twice: claims (booking, kind) in reminders_log before pushing. */
export async function runReminders(deps: ReminderDeps): Promise<ReminderResult> {
  const now = deps.now().getTime();
  const from = new Date(now + REMINDER_LEAD_MIN_MS);
  const to = new Date(now + REMINDER_LEAD_MAX_MS);
  const candidates = await deps.listCandidates(from.toISOString(), to.toISOString(), REMINDER_KIND);
  const tokens = new Map<string, string | null>();
  const result: ReminderResult = { sent: 0, skipped: 0, failed: 0 };

  for (const c of candidates) {
    const startMs = Date.parse(c.start);
    // Re-check everything the query filtered on: cheap, and keeps the rules testable.
    if (
      !c.remindersEnabled ||
      c.status === "cancelled" ||
      c.status === "completed" ||
      c.status === "no_show" ||
      !c.customerLineUserId ||
      !(startMs >= from.getTime() && startMs <= to.getTime())
    ) {
      result.skipped++;
      continue;
    }
    try {
      if (!tokens.has(c.shopId)) tokens.set(c.shopId, await deps.getAccessToken(c.shopId));
      const token = tokens.get(c.shopId);
      if (!token) {
        result.skipped++;
        continue;
      }
      if (!(await deps.claim(c.bookingId, REMINDER_KIND))) {
        result.skipped++;
        continue;
      }
      try {
        await deps.push(token, c.customerLineUserId, [buildReminderMessage(c)]);
        result.sent++;
      } catch {
        await deps.release(c.bookingId, REMINDER_KIND);
        result.failed++;
      }
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** LINE push API. `fetchFn` injectable for tests. */
export function createLinePush(fetchFn: typeof fetch = fetch): ReminderDeps["push"] {
  return async (accessToken, to, messages) => {
    const r = await fetchFn("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to, messages }),
    });
    if (!r.ok) throw new Error(`LINE push failed: ${r.status}`);
  };
}

/** HTTP entry for pg_cron (via pg_net): POST with `Authorization: Bearer <cronSecret>`. */
export function createReminderHandler(
  deps: ReminderDeps,
  cronSecret: string,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const auth = req.headers.get("authorization") ?? "";
    if (!cronSecret || auth !== `Bearer ${cronSecret}`)
      return new Response("unauthorized", { status: 401 });
    try {
      const result = await runReminders(deps);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      return new Response("error", { status: 500 });
    }
  };
}
