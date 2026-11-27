// @kms/core — pure logic, no I/O. Real slot/overlap/PromptPay logic lands in T2/T11.
// This file carries only a couple of tiny primitives so the package builds and
// has a test to run from T1 onward. Keep this package side-effect free.

export const BANGKOK_TZ = "Asia/Bangkok" as const;

/** Minutes past midnight for an "HH:mm" string, or null if malformed. */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True if half-open interval [aStart, aEnd) overlaps [bStart, bEnd). */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export * from "./types.js";
export { availableSlots, bangkokDayStart, toBangkokIso } from "./slots.js";
