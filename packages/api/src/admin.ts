import { bangkokDayStart, toBangkokIso } from "@kms/core";
import { createDepositRoutes } from "./deposit.js";
import { DAY_MS, err, json, MIN_MS, MSG, UUID } from "./http.js";
import type { Deps } from "./types.js";

const MAX_DAYS = 7;
const NAME_MAX = 80;
const PHONE = /^[0-9+\-\s]{6,20}$/;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b: unknown = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Owner-only routes. Access control: the LIFF ID token must verify AND its LINE user id must equal
 * `shops.owner_line_user_id` of the shop in the URL. Everyone else gets 403 (token valid) / 401 (no token).
 * `rest` is the path after `/shops/:shopId/admin`.
 */
export function createAdminRoutes(deps: Deps) {
  const deposits = createDepositRoutes(deps);

  /** Booking of this shop, or null (a booking of another shop looks the same as a missing one). */
  async function shopBooking(shopId: string, id: string) {
    if (!UUID.test(id)) return null;
    const booking = await deps.db.getBooking(id);
    return booking && booking.shopId === shopId ? booking : null;
  }

  return async function admin(
    req: Request,
    shopId: string,
    rest: string[],
    url: URL,
  ): Promise<Response> {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
    const user = m?.[1] ? await deps.verifyIdToken(m[1]) : null;
    if (!user) return err(401, MSG.unauthorized);
    const owner = await deps.db.getShopOwner(shopId);
    if (owner === null || owner !== user.userId) return err(403, MSG.forbidden);

    const [a, b, c] = rest;

    if (req.method === "GET" && a === "schedule" && rest.length === 1) {
      const from = url.searchParams.get("from") ?? "";
      const days = Number(url.searchParams.get("days") ?? "1");
      const fromMs = bangkokDayStart(from);
      if (fromMs === null || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
        return err(400, MSG.badRequest);
      }
      const schedule = await deps.db.listSchedule(
        shopId,
        toBangkokIso(fromMs),
        toBangkokIso(fromMs + days * DAY_MS),
      );
      return json(200, schedule);
    }

    if (req.method === "POST" && a === "bookings" && rest.length === 1) {
      return addBooking(req, shopId);
    }
    if (req.method === "POST" && a === "bookings" && b && c === "cancel" && rest.length === 3) {
      if (!UUID.test(b)) return err(404, MSG.notFound);
      const booking = await deps.db.getBooking(b);
      // A booking of another shop looks the same as a missing one.
      if (!booking || booking.shopId !== shopId) return err(404, MSG.notFound);
      if (booking.status !== "cancelled") await deps.db.cancelBooking(b);
      return json(200, { booking: { ...booking, status: "cancelled" } });
    }
    if (req.method === "POST" && a === "time-off" && rest.length === 1) {
      return blockTime(req, shopId);
    }
    if (a === "bookings" && b && rest.length === 3 && (c === "slip" || c === "deposit")) {
      const booking = await shopBooking(shopId, b);
      if (!booking) return err(404, MSG.notFound);
      if (req.method === "GET" && c === "slip") return deposits.adminGetSlip(booking);
      if (req.method === "POST" && c === "deposit") return deposits.adminDecide(req, booking);
    }
    if (a === "settings" && rest.length === 1) {
      if (req.method === "GET") return deposits.adminGetSettings(shopId);
      if (req.method === "POST") return deposits.adminSaveSettings(req, shopId);
    }
    return err(404, MSG.notFound);
  };

  async function addBooking(req: Request, shopId: string): Promise<Response> {
    const body = await readJson(req);
    if (!body) return err(400, MSG.badRequest);
    const { serviceId, staffId, start, customerName, phone } = body;
    const name = typeof customerName === "string" ? customerName.trim() : "";
    const phoneStr = typeof phone === "string" ? phone.trim() : "";
    if (
      typeof serviceId !== "string" ||
      !UUID.test(serviceId) ||
      typeof staffId !== "string" ||
      !UUID.test(staffId) ||
      typeof start !== "string" ||
      name.length === 0 ||
      name.length > NAME_MAX ||
      (phoneStr !== "" && !PHONE.test(phoneStr))
    ) {
      return err(400, MSG.badRequest);
    }
    const startMs = Date.parse(start);
    if (Number.isNaN(startMs)) return err(400, MSG.badRequest);

    const service = await deps.db.getService(shopId, serviceId);
    const staff = (await deps.db.listStaff(shopId)).find((s) => s.id === staffId);
    if (!service || !staff) return err(404, MSG.notFound);

    // The owner may book any time (walk-ins, outside normal hours); only the DB constraint decides overlaps.
    const customerId = await deps.db.createPhoneCustomer(shopId, name, phoneStr || null);
    const result = await deps.db.insertBooking({
      shopId,
      staffId,
      serviceId,
      customerId,
      start: toBangkokIso(startMs),
      end: toBangkokIso(startMs + service.durationMin * MIN_MS),
      channel: "owner",
    });
    if (!result.ok) return err(409, MSG.conflict);
    return json(201, { booking: result.booking });
  }

  async function blockTime(req: Request, shopId: string): Promise<Response> {
    const body = await readJson(req);
    if (!body) return err(400, MSG.badRequest);
    const { staffId, start, end, reason } = body;
    if (
      typeof start !== "string" ||
      typeof end !== "string" ||
      (staffId != null && (typeof staffId !== "string" || !UUID.test(staffId))) ||
      (reason != null && (typeof reason !== "string" || reason.length > 200))
    ) {
      return err(400, MSG.badRequest);
    }
    const s = Date.parse(start);
    const e = Date.parse(end);
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return err(400, MSG.badRequest);
    if (staffId && !(await deps.db.listStaff(shopId)).some((x) => x.id === staffId)) {
      return err(404, MSG.notFound);
    }
    const timeOff = await deps.db.insertTimeOff({
      shopId,
      staffId: staffId ?? null,
      start: toBangkokIso(s),
      end: toBangkokIso(e),
      reason: reason?.trim() || null,
    });
    return json(201, { timeOff });
  }
}
