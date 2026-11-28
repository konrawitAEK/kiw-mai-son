import { describe, expect, it } from "vitest";
import { isSummaryDay, monthRange, monthlySummaryText } from "./stats.js";

describe("monthRange / isSummaryDay (Bangkok)", () => {
  it("uses Bangkok midnight boundaries", () => {
    const r = monthRange(new Date("2026-12-25T03:00:00Z"));
    expect(r).toMatchObject({ key: "2026-12", month: 12, yearBE: 2569 });
    expect(r.from).toBe("2026-11-30T17:00:00.000Z");
    expect(r.to).toBe("2026-12-31T17:00:00.000Z");
  });
  it("rolls to the next month when UTC is still the previous day", () => {
    // 2026-11-30 18:00Z = 2026-12-01 01:00 Bangkok
    expect(monthRange(new Date("2026-11-30T18:00:00Z")).key).toBe("2026-12");
  });
  it("handles year end and February", () => {
    expect(monthRange(new Date("2026-12-31T16:59:00Z")).to).toBe("2026-12-31T17:00:00.000Z");
    expect(monthRange(new Date("2027-02-10T00:00:00Z")).to).toBe("2027-02-28T17:00:00.000Z");
  });
  it("detects the 25th in Bangkok time", () => {
    expect(isSummaryDay(new Date("2026-12-25T03:00:00Z"))).toBe(true);
    expect(isSummaryDay(new Date("2026-12-24T17:00:00Z"))).toBe(true); // 00:00 on the 25th
    expect(isSummaryDay(new Date("2026-12-25T17:00:00Z"))).toBe(false); // 00:00 on the 26th
    expect(isSummaryDay(new Date("2026-12-24T16:59:00Z"))).toBe(false);
  });
});

describe("monthlySummaryText", () => {
  const base = {
    shopName: "เดโม",
    range: { month: 12, yearBE: 2569 },
    stats: {
      bookings: 1234,
      viaLine: 1000,
      viaOwner: 234,
      noShows: 5,
      cancelled: 20,
      depositsPaid: 40,
      depositsPaidAmount: 12000,
    },
  };
  it("includes the stats and the payment link", () => {
    expect(monthlySummaryText({ ...base, paymentLink: "https://pay.example/abc" }))
      .toMatchInlineSnapshot(`
        "สรุปเดือนธันวาคม 2569 ร้านเดโม
        • การจองทั้งหมด 1,234 คิว
          - จองผ่าน LINE 1,000 คิว
          - เจ้าของร้านจองให้ 234 คิว
        • ลูกค้าไม่มา 5 คิว
        • ยกเลิก 20 คิว
        • มัดจำที่ได้รับ 40 รายการ รวม 12,000 บาท

        ชำระค่าบริการรายเดือนได้ที่
        https://pay.example/abc"
      `);
  });
  it("omits the payment section without a link and handles zeros", () => {
    const t = monthlySummaryText({
      ...base,
      stats: {
        ...base.stats,
        bookings: 0,
        viaLine: 0,
        viaOwner: 0,
        depositsPaid: 0,
        depositsPaidAmount: 0,
      },
      paymentLink: null,
    });
    expect(t).not.toContain("ชำระ");
    expect(t).toContain("การจองทั้งหมด 0 คิว");
  });
});
