import { availableSlots, bangkokDayStart, toBangkokIso } from "@kms/core";
import { createAdminRoutes } from "./admin.js";
import { createBillingRoutes } from "./billing.js";
import { createShopRoute } from "./onboarding.js";
import { createDepositRoutes, depositInfo } from "./deposit.js";
import { CORS, DAY_MS, err, json, MIN_MS, MSG, UUID } from "./http.js";
import type { Deps } from "./types.js";

export { MSG };

/**
 * Request handler for the `api` Edge Function. Routes (relative to the function root):
 *   GET  /shops/:shopId/services
 *   GET  /shops/:shopId/staff
 *   GET  /shops/:shopId/slots?serviceId=&date=YYYY-MM-DD[&staffId=]
 *   POST /shops/:shopId/bookings   { serviceId, start, staffId? }   (LIFF ID token)
 *   POST /bookings/:id/cancel                                        (LIFF ID token, own booking only)
 *   GET  /bookings/:id/deposit                                       (LIFF ID token, own booking only)
 *   POST /bookings/:id/slip       { contentType, dataBase64 }        (LIFF ID token, own booking only)
 * Owner admin (LIFF ID token must belong to the shop owner; see admin.ts):
 *   GET  /shops/:shopId/admin/schedule?from=YYYY-MM-DD[&days=1..7]
 *   POST /shops/:shopId/admin/bookings        { serviceId, staffId, start, customerName, phone? }
 *   POST /shops/:shopId/admin/bookings/:id/cancel
 *   POST /shops/:shopId/admin/time-off        { staffId|null, start, end, reason? }
 * Onboarding (T13, only when deps.onboarding is set; see onboarding.ts):
 *   POST /onboarding/shops                    { name, inviteCode? }   (any signed-in LINE user; returns own shop if exists)
 *   GET  /shops/:shopId/admin/setup
 *   PUT  /shops/:shopId/admin/line-channel    { channelId, channelSecret, accessToken }
 *   POST /shops/:shopId/admin/services        { name, durationMin, price, deposit? }
 *   POST /shops/:shopId/admin/staff           { name }
 *   PUT  /shops/:shopId/admin/staff/:id/hours { windows: [{weekday,start,end}] }
 *   POST /shops/:shopId/admin/rich-menu       { imageBase64 }
 *   GET  /shops/:shopId/admin/bookings/:id/slip
 *   POST /shops/:shopId/admin/bookings/:id/deposit { decision: "confirm"|"reject" }
 *   GET|POST /shops/:shopId/admin/settings    { promptPayId|null, depositTimeoutHours|null }
 *   GET  /shops/:shopId/admin/billing         (T17, only when deps.billing is set: status, trial end, PromptPay QR payloads 199 / 1,990)
 *   POST /billing/mark-paid                   { shopId, plan: "monthly"|"yearly", note? }   (T17, founder LINE user only)
 *   GET  /shops/:shopId/admin/referral        (T18, only when deps.referral is set: own code, count, share text)
 *   POST /shops/:shopId/admin/referral/redeem { code }   (T18: both shops get +1 free month; Thai error on bad/own/used code)
 *   GET  /shops/:shopId/admin/export?kind=customers|bookings   (CSV download)
 *   POST /shops/:shopId/admin/delete          { confirmName }   (deletes the shop and all its data)
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

  const admin = createAdminRoutes(deps);
  const createShop = deps.onboarding ? createShopRoute(deps.onboarding, deps) : null;
  const deposits = createDepositRoutes(deps);
  const billing = deps.billing ? createBillingRoutes(deps.billing) : null;

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Tolerate the Supabase "/functions/v1/api" or "/api" prefix.
    const path = url.pathname.replace(/^\/(functions\/v1\/)?api(?=\/|$)/, "").replace(/\/+$/, "");
    const parts = path.split("/").filter(Boolean);
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (createShop && method === "POST" && path === "/onboarding/shops") return createShop(req);

    if (billing && method === "POST" && path === "/billing/mark-paid") {
      return billing.markPaid(req, await authenticate(req));
    }

    if (parts[0] === "shops" && parts[1] && UUID.test(parts[1]) && parts[2] === "admin") {
      return admin(req, parts[1], parts.slice(3), url);
    }

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

    if (parts[0] === "bookings" && parts[1] && parts.length === 3) {
      if (method === "POST" && parts[2] === "cancel") return cancelBooking(req, parts[1]);
      if (method === "GET" && parts[2] === "deposit") return ownBooking(req, parts[1], "deposit");
      if (method === "POST" && parts[2] === "slip") return ownBooking(req, parts[1], "slip");
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
        depositAmount: open.service.deposit,
      });
      if (result.ok) {
        return json(201, {
          booking: result.booking,
          deposit: await depositInfo(deps, result.booking),
        });
      }
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

  /** Deposit routes for the signed-in customer's own booking (someone else's looks like a missing one). */
  async function ownBooking(req: Request, bookingId: string, what: "deposit" | "slip") {
    const user = await authenticate(req);
    if (!user) return err(401, MSG.unauthorized);
    if (!UUID.test(bookingId)) return err(404, MSG.notFound);
    const booking = await deps.db.getBooking(bookingId);
    if (!booking || booking.customerLineUserId !== user.userId) return err(404, MSG.notFound);
    return what === "deposit"
      ? deposits.customerGet(booking)
      : deposits.customerUploadSlip(req, booking);
  }

  return async (req) => {
    try {
      return await route(req);
    } catch {
      return err(500, MSG.server);
    }
  };
}
