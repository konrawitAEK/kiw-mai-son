import { describe, expect, it } from "vitest";
import { availableSlots, bangkokDayStart, toBangkokIso } from "./index.js";
import type { Booking, Service, Staff, TimeOff, WorkingHours } from "./index.js";

const A: Staff = { id: "a", shopId: "s", name: "A" };
const B: Staff = { id: "b", shopId: "s", name: "B" };
const svc = (durationMin: number): Service => ({
  id: "svc",
  shopId: "s",
  name: "ตัดผม",
  durationMin,
  price: 300,
  deposit: 0,
});
// 2026-12-07 is a Monday (weekday 1)
const DAY = "2026-12-07";
const wh = (staffId: string, start = "10:00", end = "12:00", weekday = 1): WorkingHours => ({
  staffId,
  weekday,
  start,
  end,
});
const booking = (
  staffId: string,
  start: string,
  end: string,
  status: Booking["status"] = "confirmed",
): Booking => ({
  id: `${staffId}${start}`,
  staffId,
  serviceId: "svc",
  start,
  end,
  status,
});
const starts = (r: ReturnType<typeof availableSlots>) => r.map((s) => s.start.slice(11, 16));

describe("availableSlots", () => {
  it("lists all grid slots in a free working window", () => {
    expect(starts(availableSlots(DAY, svc(30), A, [wh("a")], [], [], 30))).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });

  it("returns Bangkok-offset ISO strings", () => {
    const [s] = availableSlots(DAY, svc(60), A, [wh("a")], [], [], 60);
    expect(s?.start).toBe("2026-12-07T10:00:00.000+07:00");
    expect(s?.end).toBe("2026-12-07T11:00:00.000+07:00");
  });

  it("returns nothing on a day with no working hours", () => {
    expect(availableSlots("2026-12-08", svc(30), A, [wh("a")], [], [], 30)).toEqual([]);
  });

  it("removes slots overlapping an existing booking", () => {
    const b = [booking("a", "2026-12-07T10:30:00+07:00", "2026-12-07T11:00:00+07:00")];
    expect(starts(availableSlots(DAY, svc(30), A, [wh("a")], [], b, 30))).toEqual([
      "10:00",
      "11:00",
      "11:30",
    ]);
  });

  it("blocks starts that would run into a later booking (overlapping bookings)", () => {
    const b = [booking("a", "2026-12-07T10:30:00+07:00", "2026-12-07T11:30:00+07:00")];
    // 60 min service: 10:00 would end 11:00 > 10:30 start of booking -> blocked
    expect(starts(availableSlots(DAY, svc(60), A, [wh("a")], [], b, 30))).toEqual([]);
  });

  it("handles two overlapping bookings without gaps being offered", () => {
    const b = [
      booking("a", "2026-12-07T10:00:00+07:00", "2026-12-07T10:45:00+07:00"),
      booking("a", "2026-12-07T10:30:00+07:00", "2026-12-07T11:15:00+07:00"),
    ];
    expect(starts(availableSlots(DAY, svc(30), A, [wh("a")], [], b, 15))).toEqual([
      "11:15",
      "11:30",
    ]);
  });

  it("ignores cancelled bookings", () => {
    const b = [booking("a", "2026-12-07T10:00:00+07:00", "2026-12-07T12:00:00+07:00", "cancelled")];
    expect(availableSlots(DAY, svc(60), A, [wh("a")], [], b, 60)).toHaveLength(2);
  });

  it("ignores other staff's bookings for a single-staff query", () => {
    const b = [booking("b", "2026-12-07T10:00:00+07:00", "2026-12-07T12:00:00+07:00")];
    expect(availableSlots(DAY, svc(60), A, [wh("a")], [], b, 60)).toHaveLength(2);
  });

  it("respects staff time off", () => {
    const t: TimeOff[] = [
      { staffId: "a", start: "2026-12-07T11:00:00+07:00", end: "2026-12-07T12:00:00+07:00" },
    ];
    expect(starts(availableSlots(DAY, svc(30), A, [wh("a")], t, [], 30))).toEqual([
      "10:00",
      "10:30",
    ]);
  });

  it("respects shop-wide time off (staffId null) and ignores another staff's time off", () => {
    const shopWide: TimeOff[] = [
      { staffId: null, start: "2026-12-07T10:00:00+07:00", end: "2026-12-07T11:00:00+07:00" },
    ];
    expect(starts(availableSlots(DAY, svc(30), A, [wh("a")], shopWide, [], 30))).toEqual([
      "11:00",
      "11:30",
    ]);
    const other: TimeOff[] = [
      { staffId: "b", start: "2026-12-07T10:00:00+07:00", end: "2026-12-07T12:00:00+07:00" },
    ];
    expect(availableSlots(DAY, svc(30), A, [wh("a")], other, [], 30)).toHaveLength(4);
  });

  it("returns nothing when service is longer than the working window", () => {
    expect(availableSlots(DAY, svc(180), A, [wh("a")], [], [], 30)).toEqual([]);
  });

  it("does not offer a start when the service would exceed remaining time", () => {
    expect(starts(availableSlots(DAY, svc(90), A, [wh("a")], [], [], 30))).toEqual([
      "10:00",
      "10:30",
    ]);
  });

  it("any staff: merges free staff per slot and keeps slots where only one is free", () => {
    const b = [booking("a", "2026-12-07T10:00:00+07:00", "2026-12-07T11:00:00+07:00")];
    const r = availableSlots(DAY, svc(60), [A, B], [wh("a"), wh("b")], [], b, 60);
    expect(r.map((s) => [s.start.slice(11, 16), s.staffIds])).toEqual([
      ["10:00", ["b"]],
      ["11:00", ["a", "b"]],
    ]);
  });

  it("any staff: slot disappears only when every staff is busy", () => {
    const b = [
      booking("a", "2026-12-07T10:00:00+07:00", "2026-12-07T11:00:00+07:00"),
      booking("b", "2026-12-07T10:00:00+07:00", "2026-12-07T11:00:00+07:00"),
    ];
    expect(starts(availableSlots(DAY, svc(60), [A, B], [wh("a"), wh("b")], [], b, 60))).toEqual([
      "11:00",
    ]);
  });

  it("supports split shifts (lunch break)", () => {
    const hours = [wh("a", "09:00", "10:00"), wh("a", "13:00", "14:00")];
    expect(starts(availableSlots(DAY, svc(60), A, hours, [], [], 60))).toEqual(["09:00", "13:00"]);
  });

  it("snaps starts to the step grid when the window starts off-grid", () => {
    expect(
      starts(availableSlots(DAY, svc(30), A, [wh("a", "10:10", "11:30")], [], [], 30)),
    ).toEqual(["10:30", "11:00"]);
  });

  it("day boundaries: window ending at 23:59 stays within the day, and 00:00 start works", () => {
    const late = availableSlots(DAY, svc(60), A, [wh("a", "22:00", "23:59")], [], [], 60);
    expect(starts(late)).toEqual(["22:00"]);
    const early = availableSlots(DAY, svc(60), A, [wh("a", "00:00", "01:00")], [], [], 60);
    expect(early[0]?.start).toBe("2026-12-07T00:00:00.000+07:00");
  });

  it("a booking ending exactly at slot start does not block (half-open)", () => {
    const b = [booking("a", "2026-12-07T09:00:00+07:00", "2026-12-07T10:00:00+07:00")];
    expect(starts(availableSlots(DAY, svc(60), A, [wh("a")], [], b, 60))).toEqual([
      "10:00",
      "11:00",
    ]);
  });

  it("interprets UTC-offset bookings correctly in Bangkok time", () => {
    // 03:00Z == 10:00 Bangkok
    const b = [booking("a", "2026-12-07T03:00:00Z", "2026-12-07T04:00:00Z")];
    expect(starts(availableSlots(DAY, svc(60), A, [wh("a")], [], b, 60))).toEqual(["11:00"]);
  });

  it("uses fixed +07:00 with no DST shift on any date", () => {
    expect(bangkokDayStart("2026-07-01")).toBe(Date.parse("2026-07-01T00:00:00+07:00"));
    expect(bangkokDayStart("2026-12-31")).toBe(Date.parse("2026-12-31T00:00:00+07:00"));
    expect(toBangkokIso(Date.parse("2026-03-29T01:00:00Z"))).toBe("2026-03-29T08:00:00.000+07:00");
  });

  it("returns [] for invalid input", () => {
    expect(availableSlots("2026-13-40", svc(30), A, [wh("a")], [], [], 30)).toEqual([]);
    expect(availableSlots(DAY, svc(0), A, [wh("a")], [], [], 30)).toEqual([]);
    expect(availableSlots(DAY, svc(30), A, [wh("a")], [], [], 0)).toEqual([]);
  });

  it("ignores staff from another shop", () => {
    const other: Staff = { id: "x", shopId: "other", name: "X" };
    expect(availableSlots(DAY, svc(30), other, [wh("x")], [], [], 30)).toEqual([]);
  });
});
