import type { Booking, Service, Staff, TimeOff, WorkingHours } from "@kms/core";

export interface LiffUser {
  /** LINE user id (the ID token `sub`). */
  userId: string;
  displayName: string;
}

/** Mirrors `bookings.deposit_status` (see supabase/migrations/20261128020000_deposits.sql). */
export type DepositStatus = "none" | "pending" | "submitted" | "paid" | "rejected" | "refunded";

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
  depositStatus: DepositStatus;
  /** THB; 0 = no deposit. */
  depositAmount: number;
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
  /** THB. > 0 creates the booking as status "pending" / deposit "pending"; 0 or omitted = confirmed, no deposit. */
  depositAmount?: number;
}

export interface ShopPayment {
  /** Raw PromptPay ID as the owner entered it (never exposed to customers; only the QR payload is). */
  promptPayId: string | null;
  /** Hours until an unpaid deposit auto-cancels; null = off. */
  depositTimeoutHours: number | null;
}

export interface SlipImage {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
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
  depositStatus: DepositStatus;
  depositAmount: number;
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
  /** Deposit settings of the shop, or null if the shop does not exist. */
  getShopPayment(shopId: string): Promise<ShopPayment | null>;
  updateShopPayment(shopId: string, payment: ShopPayment): Promise<void>;
  /** Stores (replaces) the slip and sets deposit_status "submitted". Only valid while pending/submitted/rejected. */
  saveSlip(bookingId: string, slip: SlipImage): Promise<void>;
  getSlip(bookingId: string): Promise<SlipImage | null>;
  /** "paid" -> status confirmed + deposit paid; "rejected" -> deposit rejected (booking stays pending). */
  decideDeposit(bookingId: string, decision: "paid" | "rejected"): Promise<void>;
  /** `shops.name`, or null if the shop does not exist. */
  getShopName(shopId: string): Promise<string | null>;
  /** Data export: all customers of the shop. */
  exportCustomers(shopId: string): Promise<ExportCustomer[]>;
  /** Data export: all bookings of the shop (any status), ordered by start. */
  exportBookings(shopId: string): Promise<ExportBooking[]>;
  /**
   * Permanently deletes the shop and everything under it (staff, services, customers, bookings, slips,
   * LINE channel secrets, ...) via ON DELETE CASCADE from `shops`.
   */
  deleteShop(shopId: string): Promise<void>;
}

/** One customer row of the owner's data export. */
export interface ExportCustomer {
  displayName: string;
  /** null for phone-only customers (owner bookings). */
  lineUserId: string | null;
  phone: string | null;
  /** ISO. */
  createdAt: string;
}

/** One booking row of the owner's data export (cancelled bookings included). */
export interface ExportBooking {
  id: string;
  /** ISO with +07:00 offset. */
  start: string;
  end: string;
  status: string;
  channel: "line" | "owner";
  serviceName: string;
  staffName: string;
  customerName: string;
  customerPhone: string | null;
  depositStatus: DepositStatus;
  depositAmount: number;
  createdAt: string;
}

export interface Deps {
  db: Db;
  /** Verifies a LIFF ID token; null if invalid/expired. */
  verifyIdToken(idToken: string): Promise<LiffUser | null>;
  now(): number;
  /** Slot grid in minutes (default 30). */
  stepMinutes?: number;
}
