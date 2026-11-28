import type { Service } from "@kms/core";
import { ApiError, GENERIC_ERROR, type DepositStatus } from "./api.js";

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
  /** Optional so older fixtures/servers without deposits still type-check; missing = "none". */
  depositStatus?: DepositStatus;
  /** THB. */
  depositAmount?: number;
}
export interface AdminSettings {
  /** Raw PromptPay ID (the owner's own), or null if not set. */
  promptPayId: string | null;
  /** Hours until an unpaid deposit auto-cancels; null = off. */
  depositTimeoutHours: number | null;
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

export type PlanId = "monthly" | "yearly";
export interface AdminBilling {
  status: "trial" | "active" | "expired";
  /** Thai one-liner for the screen. */
  label: string;
  accessUntil: string;
  daysLeft: number;
  plan: PlanId | null;
  plans: Record<PlanId, { price: number; label: string; promptPayPayload: string | null }>;
}

export interface AdminReferral {
  code: string;
  referredCount: number;
  /** true if this shop already used another shop's code. */
  redeemed: boolean;
  bonusMonths: number;
  /** Thai text the owner can send to another shop. */
  shareText: string;
}

export type ExportKind = "customers" | "bookings";

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
  /** Slip image the customer uploaded; null if there is none. */
  getSlip(bookingId: string): Promise<{ contentType: string; dataBase64: string } | null>;
  decideDeposit(bookingId: string, decision: "confirm" | "reject"): Promise<void>;
  /** Subscription status and PromptPay QR payloads (199 / 1,990 THB). */
  getBilling(): Promise<AdminBilling>;
  /** This shop's referral code and how many shops used it. */
  getReferral(): Promise<AdminReferral>;
  /** Uses another shop's code (both shops get +1 free month). Throws ApiError with a Thai message on failure. */
  redeemReferral(code: string): Promise<{ message: string; referral: AdminReferral }>;
  getSettings(): Promise<AdminSettings>;
  saveSettings(settings: AdminSettings): Promise<void>;
  /** CSV text (UTF-8, BOM included) of the shop's customers or bookings. */
  exportCsv(kind: ExportKind): Promise<string>;
  /**
   * Asks the server for a short-lived signed download URL (T24) to open in the external browser.
   * Throws ApiError(404) when the server has the feature switched off.
   */
  exportLink(kind: ExportKind): Promise<string>;
  /** Permanently deletes the shop and all its data; `confirmName` must equal the shop name. */
  deleteShop(confirmName: string): Promise<void>;
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

  async function call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    as: "json" | "text" = "json",
  ): Promise<T> {
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
    if (as === "text" && res.ok) return (await res.text()) as T;
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
    async getSlip(bookingId) {
      try {
        return await call<{ contentType: string; dataBase64: string }>(
          `/admin/bookings/${encodeURIComponent(bookingId)}/slip`,
        );
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    async decideDeposit(bookingId, decision) {
      await call(`/admin/bookings/${encodeURIComponent(bookingId)}/deposit`, "POST", { decision });
    },
    async getBilling() {
      return (await call<{ billing: AdminBilling }>("/admin/billing")).billing;
    },
    async getReferral() {
      return (await call<{ referral: AdminReferral }>("/admin/referral")).referral;
    },
    redeemReferral(code) {
      return call("/admin/referral/redeem", "POST", { code });
    },
    getSettings() {
      return call<AdminSettings>("/admin/settings");
    },
    async saveSettings(settings) {
      await call("/admin/settings", "POST", settings);
    },
    exportCsv(kind) {
      return call<string>(`/admin/export?kind=${kind}`, "GET", undefined, "text");
    },
    async exportLink(kind) {
      return (await call<{ url: string }>("/admin/export-link", "POST", { kind })).url;
    },
    async deleteShop(confirmName) {
      await call("/admin/delete", "POST", { confirmName });
    },
    async blockTime(input) {
      await call("/admin/time-off", "POST", input);
    },
  };
}
