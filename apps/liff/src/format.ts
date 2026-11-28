const DAY_MS = 24 * 60 * 60 * 1000;
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MONTHS = [
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

export interface DayOption {
  /** YYYY-MM-DD (Bangkok). */
  date: string;
  weekday: string;
  dayOfMonth: number;
  month: string;
}

function ymd(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next `count` Bangkok calendar days starting today. */
export function upcomingDays(nowMs: number, count: number): DayOption[] {
  const out: DayOption[] = [];
  for (let i = 0; i < count; i++) {
    const ms = nowMs + i * DAY_MS;
    const d = new Date(ms + BKK_OFFSET_MS);
    out.push({
      date: ymd(ms),
      weekday: WEEKDAYS[d.getUTCDay()] ?? "",
      dayOfMonth: d.getUTCDate(),
      month: MONTHS[d.getUTCMonth()] ?? "",
    });
  }
  return out;
}

/** "HH:mm" from an ISO string already in +07:00. */
export function timeLabel(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * "HH:mm - HH:mm" for a booking that starts at `startIso` (+07:00) and lasts
 * `durationMin` minutes. The end is always start + duration, never a stored value.
 */
export function timeRangeLabel(startIso: string, durationMin: number): string {
  const startMs = Date.parse(startIso);
  const endMs = startMs + durationMin * 60_000;
  return `${timeLabel(startIso)} - ${clockBangkok(endMs)}`;
}

function clockBangkok(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(11, 16);
}

/** e.g. "พฤ. 3 ธ.ค." for YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()] ?? ""} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()] ?? ""}`;
}

export function priceLabel(thb: number): string {
  return `${thb.toLocaleString("en-US")} บาท`;
}

/** Today's date (YYYY-MM-DD) in Bangkok. */
export function todayBangkok(nowMs: number): string {
  return ymd(nowMs);
}
