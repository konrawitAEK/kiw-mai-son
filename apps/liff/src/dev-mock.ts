import type { Slot } from "@kms/core";
import { ApiError, type BookingApi } from "./api.js";

/** Fake API for `pnpm --filter @kms/liff dev` with `?mock=1` (dev only; never bundled in builds). */
export function createMockApi(): BookingApi {
  const shopId = "mock";
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
      };
    },
  };
}
