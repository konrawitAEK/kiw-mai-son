import { describe, expect, it } from "vitest";
import { addMonths, subscriptionState } from "./billing.js";
import {
  REDEEM_MESSAGES,
  REFERRAL_ALPHABET,
  applyReferralBonus,
  isRedeemResult,
  normalizeReferralCode,
  referralShareText,
} from "./referral.js";

const NOW = new Date("2026-12-01T03:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("normalizeReferralCode", () => {
  it("accepts any case, spaces and dashes", () => {
    expect(normalizeReferralCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(normalizeReferralCode("ABCD 2345")).toBe("ABCD2345");
  });
  it("rejects wrong length, ambiguous characters and non-strings", () => {
    expect(normalizeReferralCode("ABC")).toBeNull();
    expect(normalizeReferralCode("ABCD23450")).toBeNull();
    expect(normalizeReferralCode("ABCD234O")).toBeNull(); // letter O
    expect(normalizeReferralCode("ABCD2341")).toBeNull(); // digit 1
    expect(normalizeReferralCode(12345678)).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });
  it("alphabet has no ambiguous characters", () => {
    for (const ch of "01OIL") expect(REFERRAL_ALPHABET).not.toContain(ch);
  });
});

describe("applyReferralBonus", () => {
  it("adds a month to a running trial", () => {
    const sub = { trialEndsAt: day(10), paidUntil: null, plan: null };
    expect(applyReferralBonus(sub, NOW).trialEndsAt).toBe(addMonths(day(10), 1));
  });
  it("restarts an expired trial from now", () => {
    const sub = { trialEndsAt: day(-5), paidUntil: null, plan: null };
    const out = applyReferralBonus(sub, NOW);
    expect(out.trialEndsAt).toBe(addMonths(NOW.toISOString(), 1));
    expect(subscriptionState(out, NOW).status).toBe("trial");
  });
  it("adds a month to the paid period when the shop is paid", () => {
    const sub = { trialEndsAt: day(-40), paidUntil: day(20), plan: "monthly" as const };
    const out = applyReferralBonus(sub, NOW);
    expect(out.paidUntil).toBe(addMonths(day(20), 1));
    expect(out.trialEndsAt).toBe(sub.trialEndsAt);
  });
  it("an expired paid shop gets a month from now", () => {
    const sub = { trialEndsAt: day(-40), paidUntil: day(-3), plan: "monthly" as const };
    expect(subscriptionState(applyReferralBonus(sub, NOW), NOW).status).toBe("trial");
  });
});

describe("messages", () => {
  it("has a Thai message for every outcome", () => {
    for (const k of Object.keys(REDEEM_MESSAGES)) {
      expect(isRedeemResult(k)).toBe(true);
      expect(REDEEM_MESSAGES[k as keyof typeof REDEEM_MESSAGES]).toMatch(/[ก-๙]/);
    }
    expect(isRedeemResult("nope")).toBe(false);
  });
  it("share text contains the code and shop name", () => {
    const t = referralShareText({ shopName: "สวย", code: "ABCD2345" });
    expect(t).toContain("ABCD2345");
    expect(t).toContain("ร้านสวย");
  });
});
