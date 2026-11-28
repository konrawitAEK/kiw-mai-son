// Subscription billing rules for shops: plans, trial/active/expired state, payment extension, PromptPay QR,
// and trial-end reminders. Pure functions, no I/O. Times are instants (ISO strings); dates shown are Asia/Bangkok.
import { promptPayPayload } from "./promptpay.js";
import { bangkokParts } from "./stats.js";

export type PlanId = "monthly" | "yearly";

/** Prices in THB (docs/PROJECT-REPORT.md: 199 per month or 1,990 per year, 30 days free). */
export const PLANS: Record<PlanId, { price: number; months: number; label: string }> = {
  monthly: { price: 199, months: 1, label: "รายเดือน" },
  yearly: { price: 1990, months: 12, label: "รายปี" },
};

export const TRIAL_DAYS = 30;
/** Days before the trial ends on which a reminder goes out (each at most once per trial end date). */
export const TRIAL_REMINDER_DAYS = [7, 3, 1] as const;

const DAY_MS = 86_400_000;

export function isPlanId(v: unknown): v is PlanId {
  return v === "monthly" || v === "yearly";
}

export interface Subscription {
  /** Instant the free trial ends. */
  trialEndsAt: string;
  /** Instant the paid period ends; null if never paid. */
  paidUntil: string | null;
  /** Last plan paid for; null if never paid. */
  plan: PlanId | null;
}

/** trial = free period running; active = paid period running; expired = neither. */
export type SubscriptionStatus = "trial" | "active" | "expired";

export interface SubscriptionState {
  status: SubscriptionStatus;
  /** Instant access runs until (end of paid period, else end of trial). */
  accessUntil: string;
  /** Whole days left until `accessUntil` (rounded up); 0 when expired. */
  daysLeft: number;
}

export function subscriptionState(sub: Subscription, now: Date): SubscriptionState {
  const t = now.getTime();
  const trialEnd = Date.parse(sub.trialEndsAt);
  const paid = sub.paidUntil === null ? Number.NEGATIVE_INFINITY : Date.parse(sub.paidUntil);
  const status: SubscriptionStatus = paid > t ? "active" : trialEnd > t ? "trial" : "expired";
  const until = status === "active" ? paid : trialEnd;
  return {
    status,
    accessUntil: new Date(until).toISOString(),
    daysLeft: status === "expired" ? 0 : Math.ceil((until - t) / DAY_MS),
  };
}

/** Adds calendar months in Bangkok time, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const OFFSET = 7 * 3_600_000;
  const d = new Date(Date.parse(iso) + OFFSET);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  target.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return new Date(target.getTime() - OFFSET).toISOString();
}

/**
 * New `paidUntil` after a payment. The period starts at the latest of: now, the current paid end, and the trial end,
 * so paying early never throws away trial days or already-paid days.
 */
export function extendPaidUntil(sub: Subscription, plan: PlanId, now: Date): string {
  const base = Math.max(
    now.getTime(),
    Date.parse(sub.trialEndsAt),
    sub.paidUntil === null ? 0 : Date.parse(sub.paidUntil),
  );
  return addMonths(new Date(base).toISOString(), PLANS[plan].months);
}

/** PromptPay QR payload (to the founder's PromptPay ID) for a plan's price. */
export function billingPayload(founderPromptPayId: string, plan: PlanId): string {
  return promptPayPayload(founderPromptPayId, { amount: PLANS[plan].price });
}

/** "YYYY-MM-DD" of the Bangkok day containing the instant. */
function bangkokDate(iso: string): string {
  const p = bangkokParts(new Date(iso));
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export interface TrialReminder {
  /** 7, 3 or 1: the nearest threshold the trial has reached. */
  days: (typeof TRIAL_REMINDER_DAYS)[number];
  /** Log key, unique per threshold and trial end date, so a changed trial end re-arms reminders. */
  kind: string;
}

/**
 * Which reminder is due now, or null. Only for shops still on the free trial. If a run was missed, the
 * nearest threshold already crossed is returned (e.g. 2 days left gives the "3" reminder).
 */
export function dueTrialReminder(sub: Subscription, now: Date): TrialReminder | null {
  const s = subscriptionState(sub, now);
  if (s.status !== "trial") return null;
  const days = [...TRIAL_REMINDER_DAYS].reverse().find((d) => s.daysLeft <= d);
  if (days === undefined) return null;
  return { days, kind: `trial_${days}d@${bangkokDate(sub.trialEndsAt)}` };
}

const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

/** e.g. "28 ธ.ค. 2569" (Bangkok date, Buddhist-era year). */
export function thaiDate(iso: string): string {
  const p = bangkokParts(new Date(iso));
  return `${p.day} ${THAI_MONTHS_SHORT[p.month - 1]} ${p.year + 543}`;
}

const baht = (v: number) => v.toLocaleString("en-US");

export interface TrialReminderInput {
  shopName: string;
  daysLeft: number;
  trialEndsAt: string;
  /** Link to the billing page (LIFF); omitted when null. */
  paymentLink: string | null;
}

/** Thai owner-facing trial-ending reminder. */
export function trialReminderText(i: TrialReminderInput): string {
  const when = i.daysLeft <= 1 ? "พรุ่งนี้" : `อีก ${i.daysLeft} วัน`;
  const lines = [
    `ร้าน${i.shopName}: ช่วงทดลองใช้ฟรีจะหมด${when} (${thaiDate(i.trialEndsAt)})`,
    `ต่ออายุได้ ${baht(PLANS.monthly.price)} บาท/เดือน หรือ ${baht(PLANS.yearly.price)} บาท/ปี สแกนจ่ายพร้อมเพย์ได้ในหน้าเจ้าของร้าน`,
  ];
  if (i.paymentLink) lines.push("", "ชำระค่าบริการได้ที่", i.paymentLink);
  lines.push("", "ชำระแล้วแจ้งสลิปให้ทีมงาน ระบบจะต่ออายุให้");
  return lines.join("\n");
}

/** Thai label for the owner's billing screen. */
export function statusLabel(state: SubscriptionState): string {
  const until = thaiDate(state.accessUntil);
  if (state.status === "trial") return `ทดลองใช้ฟรี ถึง ${until} (เหลือ ${state.daysLeft} วัน)`;
  if (state.status === "active")
    return `ใช้งานอยู่ ชำระแล้วถึง ${until} (เหลือ ${state.daysLeft} วัน)`;
  return `หมดอายุแล้วเมื่อ ${until} กรุณาต่ออายุ`;
}
