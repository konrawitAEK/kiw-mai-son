// Supabase implementation of the `Db` interface (packages/api/src/types.ts).
// Not unit-tested (needs a real database); the conflict mapping relies on the
// bookings_no_overlap exclusion constraint (SQLSTATE 23P01) from T3.
import type { Booking, Service, Staff, TimeOff, WorkingHours } from "@kms/core";
import type { BookingRecord, Db } from "../../../packages/api/src/types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Postgres range text `["2026-12-07 03:00:00+00","2026-12-07 03:30:00+00")` -> ISO start/end. */
function parseRange(range: string): { start: string; end: string } {
  const m = /^[[(]"?([^",]+)"?,"?([^",)\]]+)"?[)\]]$/.exec(range);
  if (!m || !m[1] || !m[2]) throw new Error(`bad range: ${range}`);
  const iso = (s: string) => new Date(s.replace(" ", "T").replace(/\+00$/, "Z")).toISOString();
  return { start: iso(m[1]), end: iso(m[2]) };
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function toBooking(r: Row): BookingRecord {
  const { start, end } = parseRange(r.during);
  return {
    id: r.id,
    shopId: r.shop_id,
    staffId: r.staff_id,
    serviceId: r.service_id,
    customerLineUserId: r.customers?.line_user_id ?? null,
    start,
    end,
    status: r.status,
  };
}

const BOOKING_COLS = "id, shop_id, staff_id, service_id, during, status, customers(line_user_id)";

export function createSupabaseDb(sb: Client): Db {
  return {
    async listServices(shopId) {
      const rows: Row[] = check(
        await sb
          .from("services")
          .select("id, shop_id, name, duration_min, price, deposit")
          .eq("shop_id", shopId)
          .eq("active", true)
          .order("name"),
      );
      return rows.map(
        (r): Service => ({
          id: r.id,
          shopId: r.shop_id,
          name: r.name,
          durationMin: r.duration_min,
          price: r.price,
          deposit: r.deposit,
        }),
      );
    },
    async listStaff(shopId) {
      const rows: Row[] = check(
        await sb
          .from("staff")
          .select("id, shop_id, name")
          .eq("shop_id", shopId)
          .eq("active", true)
          .order("name"),
      );
      return rows.map((r): Staff => ({ id: r.id, shopId: r.shop_id, name: r.name }));
    },
    async getService(shopId, serviceId) {
      const r: Row | null = check(
        await sb
          .from("services")
          .select("id, shop_id, name, duration_min, price, deposit")
          .eq("shop_id", shopId)
          .eq("id", serviceId)
          .eq("active", true)
          .maybeSingle(),
      );
      return r
        ? {
            id: r.id,
            shopId: r.shop_id,
            name: r.name,
            durationMin: r.duration_min,
            price: r.price,
            deposit: r.deposit,
          }
        : null;
    },
    async getDayData(shopId, staffIds, fromIso, toIso) {
      const window = `[${fromIso},${toIso})`;
      const wh: Row[] = check(
        await sb
          .from("working_hours")
          .select("staff_id, weekday, start_time, end_time")
          .in("staff_id", staffIds),
      );
      const off: Row[] = check(
        await sb
          .from("time_off")
          .select("staff_id, during")
          .eq("shop_id", shopId)
          .overlaps("during", window),
      );
      const bk: Row[] = check(
        await sb
          .from("bookings")
          .select("id, staff_id, service_id, during, status")
          .eq("shop_id", shopId)
          .in("staff_id", staffIds)
          .neq("status", "cancelled")
          .overlaps("during", window),
      );
      return {
        workingHours: wh.map(
          (r): WorkingHours => ({
            staffId: r.staff_id,
            weekday: r.weekday,
            start: String(r.start_time).slice(0, 5),
            end: String(r.end_time).slice(0, 5),
          }),
        ),
        timeOff: off.map((r): TimeOff => ({ staffId: r.staff_id, ...parseRange(r.during) })),
        bookings: bk.map(
          (r): Booking => ({
            id: r.id,
            staffId: r.staff_id,
            serviceId: r.service_id,
            status: r.status,
            ...parseRange(r.during),
          }),
        ),
      };
    },
    async upsertCustomer(shopId, lineUserId, displayName) {
      const r: Row = check(
        await sb
          .from("customers")
          .upsert(
            { shop_id: shopId, line_user_id: lineUserId, display_name: displayName },
            { onConflict: "shop_id,line_user_id" },
          )
          .select("id")
          .single(),
      );
      return r.id;
    },
    async insertBooking(i) {
      const res = await sb
        .from("bookings")
        .insert({
          shop_id: i.shopId,
          staff_id: i.staffId,
          service_id: i.serviceId,
          customer_id: i.customerId,
          during: `[${i.start},${i.end})`,
          status: "confirmed",
          channel: "line",
        })
        .select(BOOKING_COLS)
        .single();
      if (res.error?.code === "23P01") return { ok: false, reason: "conflict" };
      return { ok: true, booking: toBooking(check(res)) };
    },
    async getBooking(bookingId) {
      const r: Row | null = check(
        await sb.from("bookings").select(BOOKING_COLS).eq("id", bookingId).maybeSingle(),
      );
      return r ? toBooking(r) : null;
    },
    async cancelBooking(bookingId) {
      check(await sb.from("bookings").update({ status: "cancelled" }).eq("id", bookingId));
    },
  };
}
