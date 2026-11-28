import type { Slot } from "@kms/core";
import { ApiError, type BookingApi, type DepositInfo } from "./api.js";
import type { AdminApi, AdminSchedule, AdminSettings } from "./admin-api.js";

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
