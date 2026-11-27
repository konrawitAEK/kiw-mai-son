import type { Service } from "@kms/core";
import { ApiError, GENERIC_ERROR } from "./api.js";

export interface AdminStaff {
  id: string;
  name: string;
}
export interface AdminBooking {
  id: string;
  staffId: string;
  serviceId: string;
  serviceName: string;
  customerName: string;
  customerPhone: string | null;
  /** ISO with +07:00 offset. */
  start: string;
  end: string;
  status: string;
  channel: "line" | "owner";
}
export interface AdminTimeOff {
  id: string;
  /** null = whole shop. */
  staffId: string | null;
  start: string;
  end: string;
  reason: string | null;
}
export interface AdminSchedule {
  staff: AdminStaff[];
  bookings: AdminBooking[];
  timeOff: AdminTimeOff[];
}

export interface AdminApi {
  listServices(): Promise<Service[]>;
  getSchedule(from: string, days: number): Promise<AdminSchedule>;
  addBooking(input: {
    serviceId: string;
    staffId: string;
    start: string;
    customerName: string;
    phone: string;
  }): Promise<void>;
  cancelBooking(bookingId: string): Promise<void>;
  blockTime(input: {
    staffId: string | null;
    start: string;
    end: string;
    reason: string;
  }): Promise<void>;
}

export function createAdminApi(opts: {
  baseUrl: string;
  shopId: string;
  getIdToken: () => string | null;
  fetchFn?: typeof fetch;
}): AdminApi {
  const f = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const shop = `${opts.baseUrl.replace(/\/+$/, "")}/shops/${encodeURIComponent(opts.shopId)}`;

  async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const token = opts.getIdToken();
    let res: Response;
    try {
      res = await f(`${shop}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, GENERIC_ERROR);
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = (data as { error?: unknown } | null)?.error;
      throw new ApiError(res.status, typeof msg === "string" ? msg : GENERIC_ERROR);
    }
    return data as T;
  }

  return {
    async listServices() {
      return (await call<{ services: Service[] }>("/services")).services;
    },
    getSchedule(from, days) {
      return call<AdminSchedule>(`/admin/schedule?from=${from}&days=${days}`);
    },
    async addBooking(input) {
      await call("/admin/bookings", "POST", input);
    },
    async cancelBooking(bookingId) {
      await call(`/admin/bookings/${encodeURIComponent(bookingId)}/cancel`, "POST");
    },
    async blockTime(input) {
      await call("/admin/time-off", "POST", input);
    },
  };
}
