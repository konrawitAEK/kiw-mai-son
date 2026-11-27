import { intervalsOverlap, minutesOfDay } from "./index.js";
import type { Booking, Service, Slot, Staff, TimeOff, WorkingHours } from "./types.js";

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
const BANGKOK_OFFSET_MS = 7 * 60 * MIN_MS; // Bangkok has no DST

/** Epoch ms of 00:00 Bangkok on "YYYY-MM-DD", or null if invalid. */
export function bangkokDayStart(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  return utc - BANGKOK_OFFSET_MS;
}

/** Format epoch ms as ISO string in Bangkok time (+07:00). */
export function toBangkokIso(ms: number): string {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().replace("Z", "+07:00");
}

function weekdayOf(dayStartMs: number): number {
  return new Date(dayStartMs + BANGKOK_OFFSET_MS).getUTCDay();
}

/**
 * Free start times (Asia/Bangkok) for `service` on `day` ("YYYY-MM-DD").
 * `staff` may be one member or a list ("any staff"). Slots are on a grid of
 * `stepMinutes` from midnight, must fit entirely inside a working window, and
 * must not overlap time off or non-cancelled bookings. Result is sorted by start.
 */
export function availableSlots(
  day: string,
  service: Service,
  staff: Staff | Staff[],
  workingHours: WorkingHours[],
  timeOff: TimeOff[],
  bookings: Booking[],
  stepMinutes: number,
): Slot[] {
  const dayStart = bangkokDayStart(day);
  if (dayStart === null) return [];
  if (!(service.durationMin > 0) || !(stepMinutes > 0)) return [];

  const staffList = (Array.isArray(staff) ? staff : [staff]).filter(
    (s) => s.shopId === service.shopId,
  );
  const weekday = weekdayOf(dayStart);
  const durMs = service.durationMin * MIN_MS;
  const bySlot = new Map<number, string[]>();

  for (const member of staffList) {
    const blocked: Array<[number, number]> = [];
    for (const t of timeOff) {
      if (t.staffId !== null && t.staffId !== member.id) continue;
      blocked.push([Date.parse(t.start), Date.parse(t.end)]);
    }
    for (const b of bookings) {
      if (b.staffId !== member.id || b.status === "cancelled") continue;
      blocked.push([Date.parse(b.start), Date.parse(b.end)]);
    }

    for (const w of workingHours) {
      if (w.staffId !== member.id || w.weekday !== weekday) continue;
      const ws = minutesOfDay(w.start);
      const we = minutesOfDay(w.end);
      if (ws === null || we === null || we <= ws) continue;
      const winStart = dayStart + ws * MIN_MS;
      const winEnd = dayStart + we * MIN_MS;
      // First grid point at or after window start.
      let first = Math.ceil(ws / stepMinutes) * stepMinutes;
      for (; dayStart + first * MIN_MS + durMs <= winEnd; first += stepMinutes) {
        const s = dayStart + first * MIN_MS;
        if (s < winStart || s >= dayStart + DAY_MS) continue;
        const e = s + durMs;
        if (blocked.some(([bs, be]) => intervalsOverlap(s, e, bs, be))) continue;
        const ids = bySlot.get(s) ?? [];
        if (!ids.includes(member.id)) ids.push(member.id);
        bySlot.set(s, ids);
      }
    }
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([s, staffIds]) => ({
      start: toBangkokIso(s),
      end: toBangkokIso(s + durMs),
      staffIds,
    }));
}
