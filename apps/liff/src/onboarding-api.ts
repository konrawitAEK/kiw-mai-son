import type { Service, Slot, Staff } from "@kms/core";
import { ApiError, GENERIC_ERROR } from "./api.js";

export interface SetupStatus {
  shop: { id: string; name: string };
  channel:
    | { connected: false }
    | { connected: true; channelId: string; destination: string | null };
  richMenuDone: boolean;
  /** Staff ids that have at least one working-hours window. */
  staffWithHours: string[];
}

export interface HoursWindow {
  weekday: number;
  start: string;
  end: string;
}

/** Calls for one shop; every one needs the owner's LIFF ID token (server enforces it). */
export interface ShopSetupApi {
  getSetup(): Promise<SetupStatus>;
  saveChannel(input: {
    channelId: string;
    channelSecret: string;
    accessToken: string;
  }): Promise<{ botName: string }>;
  listServices(): Promise<Service[]>;
  listStaff(): Promise<Staff[]>;
  addService(input: {
    name: string;
    durationMin: number;
    price: number;
    deposit: number;
  }): Promise<Service>;
  addStaff(name: string): Promise<Staff>;
  setHours(staffId: string, windows: HoursWindow[]): Promise<void>;
  uploadRichMenu(imageBase64: string): Promise<void>;
  listSlots(serviceId: string, date: string, staffId: string | null): Promise<Slot[]>;
  addTestBooking(input: { serviceId: string; staffId: string; start: string }): Promise<void>;
}

export interface OnboardingApi {
  /** Creates the signed-in user's shop, or returns the one they already own. */
  createShop(input: { name: string; inviteCode: string }): Promise<{ shopId: string }>;
  forShop(shopId: string): ShopSetupApi;
}

export function createOnboardingApi(opts: {
  baseUrl: string;
  getIdToken: () => string | null;
  fetchFn?: typeof fetch;
}): OnboardingApi {
  const f = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const root = opts.baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const token = opts.getIdToken();
    let res: Response;
    try {
      res = await f(`${root}${path}`, {
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
    createShop: (input) =>
      call<{ shopId: string }>("/onboarding/shops", "POST", {
        name: input.name,
        inviteCode: input.inviteCode || undefined,
      }),
    forShop(shopId) {
      const shop = `/shops/${encodeURIComponent(shopId)}`;
      const admin = `${shop}/admin`;
      return {
        getSetup: () => call<SetupStatus>(`${admin}/setup`),
        saveChannel: async (input) => {
          const r = await call<{ channel: { botName: string } }>(
            `${admin}/line-channel`,
            "PUT",
            input,
          );
          return { botName: r.channel.botName };
        },
        listServices: async () =>
          (await call<{ services: Service[] }>(`${shop}/services`)).services,
        listStaff: async () => (await call<{ staff: Staff[] }>(`${shop}/staff`)).staff,
        addService: async (input) =>
          (await call<{ service: Service }>(`${admin}/services`, "POST", input)).service,
        addStaff: async (name) =>
          (await call<{ staff: Staff }>(`${admin}/staff`, "POST", { name })).staff,
        setHours: async (staffId, windows) => {
          await call(`${admin}/staff/${encodeURIComponent(staffId)}/hours`, "PUT", { windows });
        },
        uploadRichMenu: async (imageBase64) => {
          await call(`${admin}/rich-menu`, "POST", { imageBase64 });
        },
        listSlots: async (serviceId, date, staffId) => {
          const q = new URLSearchParams({ serviceId, date });
          if (staffId) q.set("staffId", staffId);
          return (await call<{ slots: Slot[] }>(`${shop}/slots?${q.toString()}`)).slots;
        },
        addTestBooking: async (input) => {
          await call(`${admin}/bookings`, "POST", {
            ...input,
            customerName: "ทดสอบระบบ",
            phone: "",
          });
        },
      };
    },
  };
}
