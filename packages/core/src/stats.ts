// Monthly stats per shop and the day-25 summary text. Pure functions, no I/O. Times are Asia/Bangkok.

const BANGKOK_OFFSET_MS = 7 * 60 * 60_000;
const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

/** Day of the month on which the summary goes out. */
export const SUMMARY_DAY = 25;

export interface MonthlyStats {
  /** Non-cancelled bookings starting in the month. */
  bookings: number;
  viaLine: number;
  viaOwner: number;
  noShows: number;
  cancelled: number;
  /** Bookings whose deposit was paid, and the THB total. */
  depositsPaid: number;
  depositsPaidAmount: number;
}

export interface MonthRange {
  /** "YYYY-MM" (Gregorian, Bangkok). */
  key: string;
  /** Inclusive UTC instant of 00:00 Bangkok on the 1st. */
  from: string;
  /** Exclusive UTC instant of 00:00 Bangkok on the 1st of the next month. */
  to: string;
  /** 1-12 */
  month: number;
  /** Buddhist-era year. */
  yearBE: number;
}

/** Bangkok calendar parts of an instant. */
export function bangkokParts(now: Date): { year: number; month: number; day: number } {
  const d = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The Bangkok calendar month containing `now`. */
export function monthRange(now: Date): MonthRange {
  const { year, month } = bangkokParts(now);
  const from = new Date(Date.UTC(year, month - 1, 1) - BANGKOK_OFFSET_MS);
  const to = new Date(Date.UTC(year, month, 1) - BANGKOK_OFFSET_MS);
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    from: from.toISOString(),
    to: to.toISOString(),
    month,
    yearBE: year + 543,
  };
}

/** True on the 25th (Bangkok). */
export function isSummaryDay(now: Date): boolean {
  return bangkokParts(now).day === SUMMARY_DAY;
}

export interface MonthlySummaryInput {
  shopName: string;
  range: Pick<MonthRange, "month" | "yearBE">;
  stats: MonthlyStats;
  /** Subscription payment link; omitted from the text when null. */
  paymentLink: string | null;
}

const n = (v: number) => v.toLocaleString("en-US");

/** Thai owner-facing summary for the month so far. */
export function monthlySummaryText(i: MonthlySummaryInput): string {
  const { stats: s } = i;
  const lines = [
    `สรุปเดือน${THAI_MONTHS_FULL[i.range.month - 1]} ${i.range.yearBE} ร้าน${i.shopName}`,
    `• การจองทั้งหมด ${n(s.bookings)} คิว`,
    `  - จองผ่าน LINE ${n(s.viaLine)} คิว`,
    `  - เจ้าของร้านจองให้ ${n(s.viaOwner)} คิว`,
    `• ลูกค้าไม่มา ${n(s.noShows)} คิว`,
    `• ยกเลิก ${n(s.cancelled)} คิว`,
    `• มัดจำที่ได้รับ ${n(s.depositsPaid)} รายการ รวม ${n(s.depositsPaidAmount)} บาท`,
  ];
  if (i.paymentLink) lines.push("", "ชำระค่าบริการรายเดือนได้ที่", i.paymentLink);
  return lines.join("\n");
}
