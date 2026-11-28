// Shop referral rules (T18). Pure functions, no I/O. The SQL (`redeem_referral`) mirrors these rules.
import { addMonths, subscriptionState } from "./billing.js";
import type { Subscription } from "./billing.js";

export const REFERRAL_BONUS_MONTHS = 1;
/** A shop can redeem a code only during its first N days. */
export const REFERRAL_REDEEM_WINDOW_DAYS = 30;
export const REFERRAL_CODE_LENGTH = 8;
/** No 0/O/1/I/L so codes survive being read out over the phone. */
export const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Result of redeeming a code (same strings as the SQL function returns). */
export type RedeemResult =
  | "ok"
  | "invalid_code"
  | "own_code"
  | "same_owner"
  | "already_redeemed"
  | "too_old";

const REDEEM_RESULTS: readonly string[] = [
  "ok",
  "invalid_code",
  "own_code",
  "same_owner",
  "already_redeemed",
  "too_old",
];
export const isRedeemResult = (v: unknown): v is RedeemResult =>
  typeof v === "string" && REDEEM_RESULTS.includes(v);

/** Normalises what an owner typed ("abcd-2345 " -> "ABCD2345"); null if it cannot be a code. */
export function normalizeReferralCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const ch of code) if (!REFERRAL_ALPHABET.includes(ch)) return null;
  return code;
}

/** Subscription after one referral bonus: +1 month on the paid period if paid now, else on the trial. */
export function applyReferralBonus(sub: Subscription, now: Date): Subscription {
  const state = subscriptionState(sub, now);
  if (state.status === "active") {
    return { ...sub, paidUntil: addMonths(sub.paidUntil!, REFERRAL_BONUS_MONTHS) };
  }
  const base = Math.max(Date.parse(sub.trialEndsAt), now.getTime());
  return { ...sub, trialEndsAt: addMonths(new Date(base).toISOString(), REFERRAL_BONUS_MONTHS) };
}

/** Thai message for each redeem outcome (ok = success text). */
export const REDEEM_MESSAGES: Record<RedeemResult, string> = {
  ok: "ใช้โค้ดแนะนำสำเร็จ ทั้งสองร้านได้ใช้ฟรีเพิ่ม 1 เดือน",
  invalid_code: "ไม่พบโค้ดแนะนำนี้ กรุณาตรวจสอบอีกครั้ง",
  own_code: "ใช้โค้ดของร้านตัวเองไม่ได้",
  same_owner: "ใช้โค้ดของร้านที่มีเจ้าของคนเดียวกันไม่ได้",
  already_redeemed: "ร้านนี้เคยใช้โค้ดแนะนำไปแล้ว",
  too_old: `ใช้โค้ดแนะนำได้ภายใน ${REFERRAL_REDEEM_WINDOW_DAYS} วันแรกหลังสมัครเท่านั้น`,
};

/** Text the owner can send to another shop owner. */
export function referralShareText(i: { shopName: string; code: string }): string {
  return [
    `ร้าน${i.shopName} ชวนใช้ "คิวไม่ซ้อน" ระบบจองคิวผ่าน LINE ไม่ให้คิวชนกัน`,
    `ใส่โค้ด ${i.code} ตอนสมัคร ทั้งสองร้านได้ใช้ฟรีเพิ่ม ${REFERRAL_BONUS_MONTHS} เดือน`,
  ].join("\n");
}
