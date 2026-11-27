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
}

export interface Deps {
  db: Db;
  /** Verifies a LIFF ID token; null if invalid/expired. */
  verifyIdToken(idToken: string): Promise<LiffUser | null>;
  now(): number;
  /** Slot grid in minutes (default 30). */
  stepMinutes?: number;
}
