// Supabase implementation of the `Db` interface (packages/api/src/types.ts).
// Not unit-tested (needs a real database); the conflict mapping relies on the
// bookings_no_overlap exclusion constraint (SQLSTATE 23P01) from T3.
import { toBangkokIso } from "@kms/core";
import type { Booking, Service, Staff, TimeOff, WorkingHours } from "@kms/core";
import type {
  BookingRecord,
  Db,
  ExportBooking,
  ExportCustomer,
  ScheduleBooking,
  TimeOffRecord,
} from "../../../packages/api/src/types.ts";

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

/** Same as parseRange but as +07:00 ISO strings (the LIFF admin page slices HH:mm out of them). */
function parseBangkokRange(range: string): { start: string; end: string } {
  const { start, end } = parseRange(range);
  return { start: toBangkokIso(Date.parse(start)), end: toBangkokIso(Date.parse(end)) };
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
    depositStatus: r.deposit_status,
    depositAmount: r.deposit_amount,
  };
}

const BOOKING_COLS =
  "id, shop_id, staff_id, service_id, during, status, deposit_status, deposit_amount, customers(line_user_id)";

/** bytea over PostgREST is a "\\x<hex>" string in both directions. */
function toHex(d: Uint8Array): string {
  return "\\x" + Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(h: string): Uint8Array {
  const hex = h.startsWith("\\x") ? h.slice(2) : h;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

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
      const deposit = i.depositAmount ?? 0;
      const res = await sb
        .from("bookings")
        .insert({
          shop_id: i.shopId,
          staff_id: i.staffId,
          service_id: i.serviceId,
          customer_id: i.customerId,
          during: `[${i.start},${i.end})`,
          // A deposit holds the slot as "pending" until the owner confirms the slip.
          status: deposit > 0 ? "pending" : "confirmed",
          deposit_amount: deposit,
          deposit_status: deposit > 0 ? "pending" : "none",
          channel: i.channel ?? "line",
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
    async getShopOwner(shopId) {
      const r: Row | null = check(
        await sb.from("shops").select("owner_line_user_id").eq("id", shopId).maybeSingle(),
      );
      return r ? r.owner_line_user_id : null;
    },
    async createPhoneCustomer(shopId, name, phone) {
      const r: Row = check(
        await sb
          .from("customers")
          .insert({ shop_id: shopId, line_user_id: null, display_name: name, phone })
          .select("id")
          .single(),
      );
      return r.id;
    },
    async listSchedule(shopId, fromIso, toIso) {
      const window = `[${fromIso},${toIso})`;
      const staff = await this.listStaff(shopId);
      const bk: Row[] = check(
        await sb
          .from("bookings")
          .select(
            "id, staff_id, service_id, during, status, channel, deposit_status, deposit_amount, services(name), customers(display_name, phone)",
          )
          .eq("shop_id", shopId)
          .neq("status", "cancelled")
          .overlaps("during", window),
      );
      const off: Row[] = check(
        await sb
          .from("time_off")
          .select("id, staff_id, during, reason")
          .eq("shop_id", shopId)
          .overlaps("during", window),
      );
      const bookings = bk
        .map(
          (r): ScheduleBooking => ({
            id: r.id,
            staffId: r.staff_id,
            serviceId: r.service_id,
            serviceName: r.services?.name ?? "",
            customerName: r.customers?.display_name ?? "",
            customerPhone: r.customers?.phone ?? null,
            status: r.status,
            channel: r.channel,
            depositStatus: r.deposit_status,
            depositAmount: r.deposit_amount,
            ...parseBangkokRange(r.during),
          }),
        )
        .sort((a, b) => a.start.localeCompare(b.start));
      return {
        staff,
        bookings,
        timeOff: off.map(
          (r): TimeOffRecord => ({
            id: r.id,
            staffId: r.staff_id,
            reason: r.reason,
            ...parseBangkokRange(r.during),
          }),
        ),
      };
    },
    async insertTimeOff(i) {
      const r: Row = check(
        await sb
          .from("time_off")
          .insert({
            shop_id: i.shopId,
            staff_id: i.staffId,
            during: `[${i.start},${i.end})`,
            reason: i.reason,
          })
          .select("id")
          .single(),
      );
      return { id: r.id, staffId: i.staffId, start: i.start, end: i.end, reason: i.reason };
    },
    async getShopName(shopId) {
      const r: Row | null = check(
        await sb.from("shops").select("name").eq("id", shopId).maybeSingle(),
      );
      return r ? r.name : null;
    },
    async exportCustomers(shopId) {
      const rows: Row[] = check(
        await sb
          .from("customers")
          .select("display_name, line_user_id, phone, created_at")
          .eq("shop_id", shopId)
          .order("created_at"),
      );
      return rows.map(
        (r): ExportCustomer => ({
          displayName: r.display_name,
          lineUserId: r.line_user_id,
          phone: r.phone,
          createdAt: toBangkokIso(Date.parse(r.created_at)),
        }),
      );
    },
    async exportBookings(shopId) {
      const rows: Row[] = check(
        await sb
          .from("bookings")
          .select(
            "id, during, status, channel, deposit_status, deposit_amount, created_at, services(name), staff(name), customers(display_name, phone)",
          )
          .eq("shop_id", shopId),
      );
      return rows
        .map(
          (r): ExportBooking => ({
            id: r.id,
            ...parseBangkokRange(r.during),
            status: r.status,
            channel: r.channel,
            serviceName: r.services?.name ?? "",
            staffName: r.staff?.name ?? "",
            customerName: r.customers?.display_name ?? "",
            customerPhone: r.customers?.phone ?? null,
            depositStatus: r.deposit_status,
            depositAmount: r.deposit_amount,
            createdAt: toBangkokIso(Date.parse(r.created_at)),
          }),
        )
        .sort((a, b) => a.start.localeCompare(b.start));
    },
    async deleteShop(shopId) {
      // Every table references shops(id) ON DELETE CASCADE (see migrations), so this removes everything.
      check(await sb.from("shops").delete().eq("id", shopId));
    },
    async getShopPayment(shopId) {
      const r: Row | null = check(
        await sb
          .from("shops")
          .select("promptpay_id, deposit_timeout_hours")
          .eq("id", shopId)
          .maybeSingle(),
      );
      return r
        ? { promptPayId: r.promptpay_id, depositTimeoutHours: r.deposit_timeout_hours }
        : null;
    },
    async updateShopPayment(shopId, p) {
      check(
        await sb
          .from("shops")
          .update({ promptpay_id: p.promptPayId, deposit_timeout_hours: p.depositTimeoutHours })
          .eq("id", shopId),
      );
    },
    async saveSlip(bookingId, slip) {
      check(
        await sb.from("deposit_slips").upsert({
          booking_id: bookingId,
          content_type: slip.contentType,
          data: toHex(slip.data),
          uploaded_at: new Date().toISOString(),
        }),
      );
      check(
        await sb
          .from("bookings")
          .update({ deposit_status: "submitted" })
          .eq("id", bookingId)
          .eq("status", "pending")
          .in("deposit_status", ["pending", "submitted", "rejected"]),
      );
    },
    async getSlip(bookingId) {
      const r: Row | null = check(
        await sb
          .from("deposit_slips")
          .select("content_type, data")
          .eq("booking_id", bookingId)
          .maybeSingle(),
      );
      return r ? { contentType: r.content_type, data: fromHex(String(r.data)) } : null;
    },
    async decideDeposit(bookingId, decision) {
      const patch =
        decision === "paid"
          ? { status: "confirmed", deposit_status: "paid" }
          : { deposit_status: "rejected" };
      check(await sb.from("bookings").update(patch).eq("id", bookingId).eq("status", "pending"));
    },
    async enqueueCustomerPush(bookingId, kind) {
      check(await sb.rpc("enqueue_customer_push", { p_booking_id: bookingId, p_kind: kind }));
    },
    async cancelBooking(bookingId) {
      check(await sb.from("bookings").update({ status: "cancelled" }).eq("id", bookingId));
    },
  };
}
