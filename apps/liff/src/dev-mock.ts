import { promptPayPayload, type Service, type Slot, type Staff } from "@kms/core";
import { ApiError, type BookingApi, type DepositInfo } from "./api.js";
import type { AdminApi, AdminSchedule, AdminSettings } from "./admin-api.js";
import type { OnboardingApi, SetupStatus } from "./onboarding-api.js";

/** Fake API for `pnpm --filter @kms/liff dev` with `?mock=1` (dev only; never bundled in builds). */
export function createMockApi(): BookingApi {
  const shopId = "mock";
  // Sample PromptPay QR text (not a real account) so the QR renders in the dev mock.
  let deposit: DepositInfo = {
    amount: 300,
    status: "pending",
    promptPayPayload:
      "00020101021229370016A000000677010111011300668123456785303764540600300.005802TH63040000",
    timeoutHours: 24,
  };
  return {
    listServices: async () => [
      { id: "s1", shopId, name: "ตัดผมชาย", durationMin: 30, price: 250, deposit: 0 },
      { id: "s2", shopId, name: "ทำสีผม", durationMin: 120, price: 1800, deposit: 300 },
    ],
    listStaff: async () => [
      { id: "a", shopId, name: "พี่แอน" },
      { id: "b", shopId, name: "พี่บอย" },
    ],
    listSlots: async (_s, date): Promise<Slot[]> =>
      ["10:00", "10:30", "11:00", "14:00", "15:30"].map((t, i) => ({
        start: `${date}T${t}:00+07:00`,
        end: `${date}T${t}:00+07:00`,
        staffIds: ["a", "b"].slice(0, 1 + (i % 2)),
      })),
    createBooking: async (input) => {
      if (input.start.includes("T10:30")) {
        throw new ApiError(409, "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่");
      }
      return {
        id: "mock",
        start: input.start,
        end: input.start,
        staffId: input.staffId ?? "a",
        serviceId: input.serviceId,
        deposit: input.serviceId === "s2" ? deposit : null,
      };
    },
    getDeposit: async () => ({ bookingStatus: "pending", deposit }),
    uploadSlip: async () => {
      deposit = { ...deposit, status: "submitted" };
      return deposit;
    },
  };
}

/** Fake owner-admin API for `?mock=1&page=admin` (dev only). Keeps state in memory. */
export function createMockAdminApi(): AdminApi {
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const at = (t: string) => `${today}T${t}:00+07:00`;
  const schedule: AdminSchedule = {
    staff: [
      { id: "a", name: "พี่แอน" },
      { id: "b", name: "พี่บอย" },
    ],
    bookings: [
      {
        id: "1",
        staffId: "a",
        serviceId: "s1",
        serviceName: "ตัดผมชาย",
        customerName: "คุณเอ",
        customerPhone: null,
        start: at("10:00"),
        end: at("10:30"),
        status: "confirmed",
        channel: "line",
      },
      {
        id: "2",
        staffId: "a",
        serviceId: "s2",
        serviceName: "ทำสีผม",
        customerName: "คุณสมศรี",
        customerPhone: "081-234-5678",
        start: at("13:00"),
        end: at("15:00"),
        status: "confirmed",
        channel: "owner",
      },
      {
        id: "3",
        staffId: "b",
        serviceId: "s1",
        serviceName: "ตัดผมชาย",
        customerName: "คุณบี",
        customerPhone: null,
        start: at("11:00"),
        end: at("11:30"),
        status: "confirmed",
        channel: "line",
      },
    ],
    timeOff: [
      { id: "t1", staffId: "b", start: at("12:00"), end: at("13:00"), reason: "พักกลางวัน" },
    ],
  };
  let settings: AdminSettings = { promptPayId: null, depositTimeoutHours: null };
  return {
    listServices: async () => [
      { id: "s1", shopId: "mock", name: "ตัดผมชาย", durationMin: 30, price: 250, deposit: 0 },
      { id: "s2", shopId: "mock", name: "ทำสีผม", durationMin: 120, price: 1800, deposit: 300 },
    ],
    getSchedule: async () => structuredClone(schedule),
    addBooking: async (i) => {
      schedule.bookings.push({
        id: String(Date.now()),
        staffId: i.staffId,
        serviceId: i.serviceId,
        serviceName: "ตัดผมชาย",
        customerName: i.customerName,
        customerPhone: i.phone || null,
        start: i.start,
        end: i.start,
        status: "confirmed",
        channel: "owner",
      });
    },
    cancelBooking: async (id) => {
      schedule.bookings = schedule.bookings.filter((b) => b.id !== id);
    },
    getSlip: async () => null,
    decideDeposit: async (id, d) => {
      const b = schedule.bookings.find((x) => x.id === id);
      if (!b) return;
      if (d === "confirm") {
        b.status = "confirmed";
        b.depositStatus = "paid";
      } else b.depositStatus = "rejected";
    },
    getReferral: async () => ({
      code: "DEMO2345",
      referredCount: 0,
      redeemed: false,
      bonusMonths: 1,
      shareText: "ร้านเดโม ชวนใช้ คิวไม่ซ้อน ใส่โค้ด DEMO2345 ทั้งสองร้านได้ใช้ฟรีเพิ่ม 1 เดือน",
    }),
    redeemReferral: async () => ({
      message: "ใช้โค้ดแนะนำสำเร็จ ทั้งสองร้านได้ใช้ฟรีเพิ่ม 1 เดือน",
      referral: {
        code: "DEMO2345",
        referredCount: 0,
        redeemed: true,
        bonusMonths: 1,
        shareText: "",
      },
    }),
    getBilling: async () => ({
      status: "trial",
      label: "ทดลองใช้ฟรี ถึง 28 ธ.ค. 2569 (เหลือ 7 วัน)",
      accessUntil: "2026-12-28T03:00:00.000Z",
      daysLeft: 7,
      plan: null,
      plans: {
        monthly: {
          price: 199,
          label: "รายเดือน",
          promptPayPayload: promptPayPayload("0812345678", { amount: 199 }),
        },
        yearly: {
          price: 1990,
          label: "รายปี",
          promptPayPayload: promptPayPayload("0812345678", { amount: 1990 }),
        },
      },
    }),
    getSettings: async () => settings,
    saveSettings: async (v) => {
      settings = { ...v };
    },
    exportCsv: async (kind) =>
      kind === "customers" ? "\uFEFFชื่อ\r\nคุณเอ\r\n" : "\uFEFFรหัสการจอง\r\n1\r\n",
    deleteShop: async () => {},
    blockTime: async (i) => {
      schedule.timeOff.push({ id: String(Date.now()), ...i, reason: i.reason || null });
    },
  };
}

/** Fake onboarding API for `?mock=1&page=onboarding` (dev only). Keeps state in memory. */
export function createMockOnboardingApi(): OnboardingApi {
  const services: Service[] = [];
  const staff: Staff[] = [];
  const hours = new Set<string>();
  let connected = false;
  let menu = false;
  const status = (): SetupStatus => ({
    shop: { id: "mock", name: "ร้านเดโม" },
    channel: connected
      ? { connected: true, channelId: "1234567890", destination: "Umock" }
      : { connected: false },
    richMenuDone: menu,
    staffWithHours: [...hours],
  });
  return {
    createShop: async () => ({ shopId: "mock" }),
    forShop: () => ({
      getSetup: async () => status(),
      saveChannel: async () => {
        connected = true;
        return { botName: "ร้านเดโม OA" };
      },
      listServices: async () => [...services],
      listStaff: async () => [...staff],
      addService: async (i) => {
        const s: Service = { id: `s${services.length}`, shopId: "mock", ...i };
        services.push(s);
        return s;
      },
      addStaff: async (name) => {
        const s: Staff = { id: `st${staff.length}`, shopId: "mock", name };
        staff.push(s);
        return s;
      },
      setHours: async (id) => {
        hours.add(id);
      },
      uploadRichMenu: async () => {
        menu = true;
      },
      listSlots: async (_s, date): Promise<Slot[]> => [
        { start: `${date}T23:00:00+07:00`, end: `${date}T23:30:00+07:00`, staffIds: ["st0"] },
      ],
      addTestBooking: async () => {},
    }),
  };
}
