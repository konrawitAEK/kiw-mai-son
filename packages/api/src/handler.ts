import { availableSlots, bangkokDayStart, toBangkokIso } from "@kms/core";
import type { Deps } from "./types.js";

const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * MIN_MS;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MSG = {
  conflict: "ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่",
  unauthorized: "กรุณาเข้าสู่ระบบผ่าน LINE ใหม่อีกครั้ง",
  notFound: "ไม่พบข้อมูลที่ต้องการ",
  badRequest: "ข้อมูลไม่ถูกต้อง กรุณาลองใหม่",
  notOpen: "ช่วงเวลานี้ไม่เปิดให้จอง กรุณาเลือกใหม่",
  past: "ไม่สามารถจองเวลาที่ผ่านไปแล้วได้",
  server: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
} as const;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}
const err = (status: number, message: string) => json(status, { error: message });

/**
 * Request handler for the `api` Edge Function. Routes (relative to the function root):
 *   GET  /shops/:shopId/services
 *   GET  /shops/:shopId/staff
 *   GET  /shops/:shopId/slots?serviceId=&date=YYYY-MM-DD[&staffId=]
 *   POST /shops/:shopId/bookings   { serviceId, start, staffId? }   (LIFF ID token)
 *   POST /bookings/:id/cancel                                        (LIFF ID token, own booking only)
 */
export function createHandler(deps: Deps): (req: Request) => Promise<Response> {
  const step = deps.stepMinutes ?? 30;

  async function authenticate(req: Request) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    if (!m || !m[1]) return null;
    return deps.verifyIdToken(m[1]);
  }

  /** Slots (ignoring existing bookings when `ignoreBookings`) for a service on a Bangkok day. */
  async function slotsFor(
    shopId: string,
    serviceId: string,
    day: string,
    staffId: string | null,
    ignoreBookings: boolean,
  ) {
    const service = await deps.db.getService(shopId, serviceId);
    if (!service) return null;
    const allStaff = await deps.db.listStaff(shopId);
    const staff = staffId ? allStaff.filter((s) => s.id === staffId) : allStaff;
    if (staff.length === 0) return null;
    const dayStart = bangkokDayStart(day);
    if (dayStart === null) return null;
    const data = await deps.db.getDayData(
      shopId,
      staff.map((s) => s.id),
      toBangkokIso(dayStart),
      toBangkokIso(dayStart + DAY_MS),
    );
    return {
      service,
      slots: availableSlots(
        day,
        service,
        staff,
        data.workingHours,
        data.timeOff,
        ignoreBookings ? [] : data.bookings,
        step,
      ),
    };
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Tolerate the Supabase "/functions/v1/api" or "/api" prefix.
    const path = url.pathname.replace(/^\/(functions\/v1\/)?api(?=\/|$)/, "").replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (parts[0] === "shops" && parts[1] && UUID.test(parts[1])) {
      const shopId = parts[1];

      if (method === "GET" && parts[2] === "services" && parts.length === 3) {
        return json(200, { services: await deps.db.listServices(shopId) });
      }
      if (method === "GET" && parts[2] === "staff" && parts.length === 3) {
        return json(200, { staff: await deps.db.listStaff(shopId) });
      }
      if (method === "GET" && parts[2] === "slots" && parts.length === 3) {
        const serviceId = url.searchParams.get("serviceId") ?? "";
        const date = url.searchParams.get("date") ?? "";
        const staffId = url.searchParams.get("staffId");
        if (
          !UUID.test(serviceId) ||
          bangkokDayStart(date) === null ||
          (staffId && !UUID.test(staffId))
        ) {
          return err(400, MSG.badRequest);
        }
        const r = await slotsFor(shopId, serviceId, date, staffId, false);
        if (!r) return err(404, MSG.notFound);
        return json(200, { date, slots: r.slots });
      }
      if (method === "POST" && parts[2] === "bookings" && parts.length === 3) {
        return createBooking(req, shopId);
      }
    }

    if (
      method === "POST" &&
      parts[0] === "bookings" &&
      parts[1] &&
      parts[2] === "cancel" &&
      parts.length === 3
    ) {
      return cancelBooking(req, parts[1]);
    }
    return err(404, MSG.notFound);
  }

  async function createBooking(req: Request, shopId: string): Promise<Response> {
    const user = await authenticate(req);
    if (!user) return err(401, MSG.unauthorized);

    let body: { serviceId?: unknown; staffId?: unknown; start?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return err(400, MSG.badRequest);
    }
    const { serviceId, staffId, start } = body;
    if (
      typeof serviceId !== "string" ||
      !UUID.test(serviceId) ||
      typeof start !== "string" ||
      (staffId != null && (typeof staffId !== "string" || !UUID.test(staffId)))
    ) {
      return err(400, MSG.badRequest);
    }
    const startMs = Date.parse(start);
    if (Number.isNaN(startMs)) return err(400, MSG.badRequest);
    if (startMs <= deps.now()) return err(422, MSG.past);

    const startIso = toBangkokIso(startMs);
    const day = startIso.slice(0, 10);
    // Open-hours check ignores existing bookings: overlap is decided by the DB constraint (race-safe).
    const open = await slotsFor(shopId, serviceId, day, staffId ?? null, true);
    if (!open) return err(404, MSG.notFound);
    const slot = open.slots.find((s) => Date.parse(s.start) === startMs);
    if (!slot) return err(422, MSG.notOpen);

    const endIso = toBangkokIso(startMs + open.service.durationMin * MIN_MS);
    const customerId = await deps.db.upsertCustomer(shopId, user.userId, user.displayName);

    // "Any staff": try each free staff member in turn; the DB constraint is the arbiter.
    for (const candidate of slot.staffIds) {
      const result = await deps.db.insertBooking({
        shopId,
        staffId: candidate,
        serviceId,
        customerId,
        start: startIso,
        end: endIso,
      });
      if (result.ok) return json(201, { booking: result.booking });
    }
    return err(409, MSG.conflict);
  }

  async function cancelBooking(req: Request, bookingId: string): Promise<Response> {
    const user = await authenticate(req);
    if (!user) return err(401, MSG.unauthorized);
    if (!UUID.test(bookingId)) return err(404, MSG.notFound);
    const booking = await deps.db.getBooking(bookingId);
    // Someone else's booking looks the same as a missing one (no existence leak).
    if (!booking || booking.customerLineUserId !== user.userId) return err(404, MSG.notFound);
    if (booking.status !== "cancelled") await deps.db.cancelBooking(bookingId);
    return json(200, { booking: { ...booking, status: "cancelled" } });
  }

  return async (req) => {
    try {
      return await route(req);
    } catch {
      return err(500, MSG.server);
    }
  };
}
