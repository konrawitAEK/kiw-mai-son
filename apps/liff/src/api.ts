import type { Service, Slot, Staff } from "@kms/core";

export type DepositStatus = "none" | "pending" | "submitted" | "paid" | "rejected" | "refunded";

/** Deposit details from the API (see packages/api deposit.ts). */
export interface DepositInfo {
  /** THB. */
  amount: number;
  status: DepositStatus;
  /** PromptPay QR text; null when the shop has not set a PromptPay ID. */
  promptPayPayload: string | null;
  /** Hours until an unpaid deposit auto-cancels; null = never. */
  timeoutHours: number | null;
}

export interface BookingResult {
  id: string;
  start: string;
  end: string;
  staffId: string;
  serviceId: string;
  /** Present when the booked service has a deposit. */
  deposit?: DepositInfo | null;
}

/** One upcoming booking of the signed-in customer (GET /shops/:id/my-bookings). */
export interface MyBooking {
  id: string;
  serviceId: string;
  serviceName: string;
  staffName: string;
  /** +07:00 ISO. */
  start: string;
  end: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  depositStatus: DepositStatus;
  depositAmount: number;
}

export interface SlipUpload {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
}

/** Error carrying the Thai message from the API and the HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface BookingApi {
  listServices(): Promise<Service[]>;
  listStaff(): Promise<Staff[]>;
  listSlots(serviceId: string, date: string, staffId: string | null): Promise<Slot[]>;
  createBooking(input: {
    serviceId: string;
    start: string;
    staffId: string | null;
  }): Promise<BookingResult>;
  /** Current deposit state of the customer's own booking. */
  getDeposit(bookingId: string): Promise<{ bookingStatus: string; deposit: DepositInfo }>;
  uploadSlip(bookingId: string, slip: SlipUpload): Promise<DepositInfo>;
  /** T21: the customer's own upcoming bookings in this shop. */
  listMyBookings(): Promise<MyBooking[]>;
  /** T21: cancel the customer's own booking. */
  cancelBooking(bookingId: string): Promise<void>;
  /** T22: move the customer's own booking to another free slot (ApiError 409 + Thai message if just taken). */
  rescheduleBooking(bookingId: string, input: { start: string }): Promise<BookingResult>;
}

export const GENERIC_ERROR = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

export function createBookingApi(opts: {
  baseUrl: string;
  shopId: string;
  getIdToken: () => string | null;
  fetchFn?: typeof fetch;
}): BookingApi {
  const f = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = `${opts.baseUrl.replace(/\/+$/, "")}/shops/${encodeURIComponent(opts.shopId)}`;

  const root = opts.baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, init?: RequestInit, absolute = false): Promise<T> {
    let res: Response;
    try {
      res = await f(`${absolute ? root : base}${path}`, init);
    } catch {
      throw new ApiError(0, GENERIC_ERROR);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = (body as { error?: unknown } | null)?.error;
      throw new ApiError(res.status, typeof msg === "string" ? msg : GENERIC_ERROR);
    }
    return body as T;
  }

  return {
    async listServices() {
      return (await call<{ services: Service[] }>("/services")).services;
    },
    async listStaff() {
      return (await call<{ staff: Staff[] }>("/staff")).staff;
    },
    async listSlots(serviceId, date, staffId) {
      const q = new URLSearchParams({ serviceId, date });
      if (staffId) q.set("staffId", staffId);
      return (await call<{ slots: Slot[] }>(`/slots?${q.toString()}`)).slots;
    },
    async createBooking(input) {
      const token = opts.getIdToken();
      const body: Record<string, string> = { serviceId: input.serviceId, start: input.start };
      if (input.staffId) body.staffId = input.staffId;
      const r = await call<{ booking: BookingResult; deposit?: DepositInfo | null }>("/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      return { ...r.booking, deposit: r.deposit ?? null };
    },
    getDeposit(bookingId) {
      const token = opts.getIdToken();
      return call(
        `/bookings/${encodeURIComponent(bookingId)}/deposit`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        true,
      );
    },
    async listMyBookings() {
      const token = opts.getIdToken();
      const r = await call<{ bookings: MyBooking[] }>("/my-bookings", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return r.bookings;
    },
    async cancelBooking(bookingId) {
      const token = opts.getIdToken();
      await call(
        `/bookings/${encodeURIComponent(bookingId)}/cancel`,
        { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} },
        true,
      );
    },
    async rescheduleBooking(bookingId, input) {
      const token = opts.getIdToken();
      const r = await call<{ booking: BookingResult }>(
        `/bookings/${encodeURIComponent(bookingId)}/reschedule`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ start: input.start }),
        },
        true,
      );
      return r.booking;
    },
    async uploadSlip(bookingId, slip) {
      const token = opts.getIdToken();
      const r = await call<{ deposit: DepositInfo }>(
        `/bookings/${encodeURIComponent(bookingId)}/slip`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(slip),
        },
        true,
      );
      return r.deposit;
    },
  };
}
