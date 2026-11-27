// Domain types for @kms/core. Instants are ISO-8601 strings with an offset (or Z);
// working hours are wall-clock "HH:mm" in Asia/Bangkok.

export interface Shop {
  id: string;
  name: string;
  timezone: "Asia/Bangkok";
}

export interface Staff {
  id: string;
  shopId: string;
  name: string;
}

export interface Service {
  id: string;
  shopId: string;
  name: string;
  durationMin: number;
  /** Price in THB. */
  price: number;
  /** Deposit in THB; 0 = no deposit. */
  deposit: number;
}

/** One working window. weekday: 0 = Sunday ... 6 = Saturday (Bangkok). Several windows per day allowed (e.g. lunch break). */
export interface WorkingHours {
  staffId: string;
  weekday: number;
  start: string; // "HH:mm"
  end: string; // "HH:mm", exclusive
}

/** Blocked period for one staff member, or the whole shop when staffId is null. Half-open [start, end). */
export interface TimeOff {
  staffId: string | null;
  start: string;
  end: string;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface Booking {
  id: string;
  staffId: string;
  serviceId: string;
  start: string;
  end: string;
  status: BookingStatus;
}

export interface Slot {
  /** ISO start with +07:00 offset. */
  start: string;
  end: string;
  /** Staff who are free for this slot (one entry when a single staff was requested). */
  staffIds: string[];
}
