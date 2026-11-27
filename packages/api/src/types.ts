import type { Booking, Service, Staff, TimeOff, WorkingHours } from "@kms/core";

export interface LiffUser {
  /** LINE user id (the ID token `sub`). */
  userId: string;
  displayName: string;
}

export interface BookingRecord {
  id: string;
  shopId: string;
  staffId: string;
  serviceId: string;
  /** LINE user id of the customer who made the booking (null for phone-only customers). */
  customerLineUserId: string | null;
  start: string;
  end: string;
  status: Booking["status"];
}

export interface DayData {
  workingHours: WorkingHours[];
  timeOff: TimeOff[];
  bookings: Booking[];
}

export interface InsertBookingInput {
  shopId: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  start: string;
  end: string;
  /** Default "line". Owner-created bookings for phone customers use "owner". */
  channel?: "line" | "owner";
}

/** One row of the owner's schedule view. */
export interface ScheduleBooking {
  id: string;
  staffId: string;
  serviceId: string;
  serviceName: string;
  customerName: string;
  customerPhone: string | null;
  start: string;
  end: string;
  status: Booking["status"];
  channel: "line" | "owner";
}

export interface TimeOffRecord {
  id: string;
  /** null = whole shop. */
  staffId: string | null;
  start: string;
  end: string;
  reason: string | null;
}

export interface Schedule {
  staff: Staff[];
  /** Non-cancelled bookings overlapping the window, ordered by start. */
  bookings: ScheduleBooking[];
  timeOff: TimeOffRecord[];
}

export interface InsertTimeOffInput {
  shopId: string;
  staffId: string | null;
  start: string;
  end: string;
  reason: string | null;
}

/** `conflict` = the DB exclusion constraint rejected an overlapping active booking. */
export type InsertResult = { ok: true; booking: BookingRecord } | { ok: false; reason: "conflict" };

/** Data access. The Supabase implementation maps SQLSTATE 23P01 to `conflict`. */
export interface Db {
  listServices(shopId: string): Promise<Service[]>;
  listStaff(shopId: string): Promise<Staff[]>;
  getService(shopId: string, serviceId: string): Promise<Service | null>;
  /** Working hours, time off and non-cancelled bookings for `staffIds` overlapping [fromIso, toIso). */
  getDayData(shopId: string, staffIds: string[], fromIso: string, toIso: string): Promise<DayData>;
  upsertCustomer(shopId: string, lineUserId: string, displayName: string): Promise<string>;
  insertBooking(input: InsertBookingInput): Promise<InsertResult>;
  getBooking(bookingId: string): Promise<BookingRecord | null>;
  cancelBooking(bookingId: string): Promise<void>;
  /** `shops.owner_line_user_id`, or null if the shop does not exist. */
  getShopOwner(shopId: string): Promise<string | null>;
  /** Owner admin: phone-only customer (no LINE id). */
  createPhoneCustomer(shopId: string, name: string, phone: string | null): Promise<string>;
  /** Owner admin: active staff, non-cancelled bookings and time off overlapping [fromIso, toIso). */
  listSchedule(shopId: string, fromIso: string, toIso: string): Promise<Schedule>;
  insertTimeOff(input: InsertTimeOffInput): Promise<TimeOffRecord>;
}

export interface Deps {
  db: Db;
  /** Verifies a LIFF ID token; null if invalid/expired. */
  verifyIdToken(idToken: string): Promise<LiffUser | null>;
  now(): number;
  /** Slot grid in minutes (default 30). */
  stepMinutes?: number;
}
