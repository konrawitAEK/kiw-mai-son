import { describe, expect, it } from "vitest";
import {
  PLANS,
  addMonths,
  billingPayload,
  dueTrialReminder,
  extendPaidUntil,
  statusLabel,
  subscriptionState,
  thaiDate,
  trialReminderText,
  verifyPayloadCrc,
  type Subscription,
} from "./index.js";

const NOW = new Date("2026-12-01T03:00:00Z");
const trial = (daysFromNow: number): Subscription => ({
  trialEndsAt: new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString(),
  paidUntil: null,
  plan: null,
});

describe("plans", () => {
  it("are 199 per month and 1,990 per year", () => {
    expect(PLANS.monthly.price).toBe(199);
    expect(PLANS.yearly.price).toBe(1990);
  });
});

describe("subscriptionState", () => {
  it("trial while the trial end is in the future", () => {
    expect(subscriptionState(trial(10), NOW)).toMatchObject({ status: "trial", daysLeft: 10 });
  });
  it("rounds partial days up", () => {
    const s = { ...trial(0), trialEndsAt: "2026-12-01T04:00:00Z" };
    expect(subscriptionState(s, NOW).daysLeft).toBe(1);
  });
  it("expired after trial end with no payment", () => {
    expect(subscriptionState(trial(-1), NOW)).toMatchObject({ status: "expired", daysLeft: 0 });
    expect(subscriptionState(trial(0), NOW).status).toBe("expired"); // end instant is exclusive
  });
  it("active while paidUntil is in the future, even after the trial", () => {
    const s: Subscription = {
      ...trial(-5),
      paidUntil: "2026-12-31T03:00:00Z",
      plan: "monthly",
    };
    expect(subscriptionState(s, NOW)).toMatchObject({ status: "active", daysLeft: 30 });
  });
  it("expired once the paid period ends", () => {
    const s: Subscription = { ...trial(-40), paidUntil: "2026-11-30T00:00:00Z", plan: "monthly" };
    expect(subscriptionState(s, NOW).status).toBe("expired");
  });
});

describe("addMonths (Bangkok)", () => {
  it("adds calendar months", () => {
    expect(addMonths("2026-12-01T03:00:00Z", 1)).toBe("2027-01-01T03:00:00.000Z");
    expect(addMonths("2026-12-01T03:00:00Z", 12)).toBe("2027-12-01T03:00:00.000Z");
  });
  it("clamps the day at month end", () => {
    expect(addMonths("2027-01-31T03:00:00Z", 1)).toBe("2027-02-28T03:00:00.000Z");
    expect(addMonths("2027-12-31T03:00:00Z", 2)).toBe("2028-02-29T03:00:00.000Z");
  });
  it("uses the Bangkok calendar day near midnight", () => {
    // 31 Jan 23:00 Bangkok = 31 Jan 16:00Z -> 28 Feb 23:00 Bangkok
    expect(addMonths("2027-01-31T16:00:00Z", 1)).toBe("2027-02-28T16:00:00.000Z");
  });
});

describe("extendPaidUntil", () => {
  it("starts from now when expired", () => {
    expect(extendPaidUntil(trial(-3), "monthly", NOW)).toBe("2027-01-01T03:00:00.000Z");
  });
  it("keeps the remaining trial days when paying early", () => {
    const s = trial(10);
    expect(extendPaidUntil(s, "monthly", NOW)).toBe(addMonths(s.trialEndsAt, 1));
  });
  it("stacks on an unexpired paid period", () => {
    const s: Subscription = { ...trial(-30), paidUntil: "2027-01-15T03:00:00Z", plan: "monthly" };
    expect(extendPaidUntil(s, "yearly", NOW)).toBe("2028-01-15T03:00:00.000Z");
  });
});

describe("billingPayload", () => {
  it("is a valid PromptPay payload with the plan price", () => {
    const m = billingPayload("0812345678", "monthly");
    const y = billingPayload("0812345678", "yearly");
    expect(verifyPayloadCrc(m)).toBe(true);
    expect(m).toContain("5406199.00");
    expect(y).toContain("54071990.00");
  });
  it("rejects a bad PromptPay ID", () => {
    expect(() => billingPayload("123", "monthly")).toThrow();
  });
});

describe("dueTrialReminder", () => {
  it("is null with more than 7 days left", () => {
    expect(dueTrialReminder(trial(8), NOW)).toBeNull();
  });
  it("picks the nearest crossed threshold", () => {
    expect(dueTrialReminder(trial(7), NOW)?.days).toBe(7);
    expect(dueTrialReminder(trial(5), NOW)?.days).toBe(7);
    expect(dueTrialReminder(trial(3), NOW)?.days).toBe(3);
    expect(dueTrialReminder(trial(2), NOW)?.days).toBe(3);
    expect(dueTrialReminder(trial(1), NOW)?.days).toBe(1);
    expect(dueTrialReminder(trial(0.5), NOW)?.days).toBe(1);
  });
  it("is null once expired or when paid", () => {
    expect(dueTrialReminder(trial(-1), NOW)).toBeNull();
    expect(
      dueTrialReminder({ ...trial(2), paidUntil: "2027-01-01T00:00:00Z", plan: "monthly" }, NOW),
    ).toBeNull();
  });
  it("kind includes the trial end date so a new trial end re-arms reminders", () => {
    const a = dueTrialReminder(trial(2), NOW)!;
    const b = dueTrialReminder(trial(2.9), NOW)!;
    expect(a.kind).toMatch(/^trial_3d@2026-12-0\d$/);
    expect(dueTrialReminder(trial(30), NOW)).toBeNull();
    expect(b.kind).toMatch(/^trial_3d@/);
    const later = dueTrialReminder(
      { ...trial(2), trialEndsAt: "2027-01-20T03:00:00Z" },
      new Date("2027-01-18T03:00:00Z"),
    )!;
    expect(later.kind).toBe("trial_3d@2027-01-20");
  });
});

describe("texts", () => {
  it("thaiDate is Bangkok date in Buddhist era", () => {
    expect(thaiDate("2026-12-31T17:00:00Z")).toBe("1 ม.ค. 2570");
  });
  it("trial reminder mentions prices, date and link", () => {
    const t = trialReminderText({
      shopName: "ร้านสวย",
      daysLeft: 3,
      trialEndsAt: "2026-12-04T03:00:00Z",
      paymentLink: "https://liff.line.me/x",
    });
    expect(t).toContain("อีก 3 วัน");
    expect(t).toContain("4 ธ.ค. 2569");
    expect(t).toContain("199");
    expect(t).toContain("1,990");
    expect(t).toContain("https://liff.line.me/x");
  });
  it("says tomorrow on the last day and omits a missing link", () => {
    const t = trialReminderText({
      shopName: "A",
      daysLeft: 1,
      trialEndsAt: "2026-12-02T03:00:00Z",
      paymentLink: null,
    });
    expect(t).toContain("พรุ่งนี้");
    expect(t).not.toContain("https://");
  });
  it("status labels", () => {
    expect(statusLabel(subscriptionState(trial(10), NOW))).toContain("ทดลองใช้ฟรี");
    expect(statusLabel(subscriptionState(trial(-1), NOW))).toContain("หมดอายุ");
  });
});
