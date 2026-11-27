import type { Service, Slot, Staff } from "@kms/core";

export interface BookingResult {
  id: string;
  start: string;
  end: string;
  staffId: string;
  serviceId: string;
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

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, init);
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
      return (
        await call<{ booking: BookingResult }>("/bookings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        })
      ).booking;
    },
  };
}
