import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import coreSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";
import reminderSql from "../../../supabase/migrations/20261128010000_due_reminders.sql?raw";

let db: PGlite;
let shop: string;
let svc: string;
let staff: string;
let cust: string;
let phoneOnly: string;
let n = 0;

const FROM = "2026-12-07T09:00:00Z";
const TO = "2026-12-07T10:00:00Z";

/** Each booking gets its own staff so the exclusion constraint never interferes. */
async function book(start: string, status = "confirmed", customer = cust, shopId = shop) {
  const s = (
    await db.query<{ id: string }>(
      `insert into staff (shop_id, name) values ($1, 'ช่าง' || $2::text) returning id`,
      [shopId, ++n],
    )
  ).rows[0]!.id;
  const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
  return (
    await db.query<{ id: string }>(
      `insert into bookings (shop_id, staff_id, service_id, customer_id, during, status, channel)
       values ($1,$2,$3,$4,tstzrange($5,$6,'[)'),$7,'line') returning id`,
      [shopId, s, svc, customer, start, end, status],
    )
  ).rows[0]!.id;
}
const due = async () =>
  (
    await db.query<{ booking_id: string }>(
      `select booking_id from due_reminders($1,$2,'day_before')`,
      [FROM, TO],
    )
  ).rows.map((r) => r.booking_id);

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(coreSql);
  await db.exec(reminderSql);
  shop = (
    await db.query<{ id: string }>(
      `insert into shops (name, owner_line_user_id) values ('ร้านเดโม','Uo') returning id`,
    )
  ).rows[0]!.id;
  svc = (
    await db.query<{ id: string }>(
      `insert into services (shop_id, name, duration_min) values ($1,'ตัดผม',30) returning id`,
      [shop],
    )
  ).rows[0]!.id;
  staff = (
    await db.query<{ id: string }>(
      `insert into staff (shop_id, name) values ($1,'เอ') returning id`,
      [shop],
    )
  ).rows[0]!.id;
  cust = (
    await db.query<{ id: string }>(
      `insert into customers (shop_id, line_user_id, display_name) values ($1,'U1','ลูกค้า') returning id`,
      [shop],
    )
  ).rows[0]!.id;
  phoneOnly = (
    await db.query<{ id: string }>(
      `insert into customers (shop_id, display_name, phone) values ($1,'โทรมา','0800000000') returning id`,
      [shop],
    )
  ).rows[0]!.id;
  void staff;
});

describe("due_reminders / claim_reminder (SQL)", () => {
  it("returns active LINE bookings in the window; skips cancelled, phone-only and out of window", async () => {
    const ok = await book("2026-12-07T09:30:00Z");
    await book("2026-12-07T09:30:00Z", "cancelled");
    await book("2026-12-07T09:30:00Z", "confirmed", phoneOnly);
    await book("2026-12-07T12:00:00Z");
    await book("2026-12-06T09:30:00Z");
    expect(await due()).toEqual([ok]);
  });

  it("claim_reminder is true once per booking+kind, and a claimed booking is no longer due", async () => {
    const id = await book("2026-12-07T09:45:00Z");
    expect(await due()).toContain(id);
    const claim = async () =>
      (await db.query<{ claim_reminder: boolean }>(`select claim_reminder($1,'day_before')`, [id]))
        .rows[0]!.claim_reminder;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    expect(await due()).not.toContain(id);
  });

  it("excludes shops that turned reminders off", async () => {
    const off = (
      await db.query<{ id: string }>(
        `insert into shops (name, owner_line_user_id, reminders_enabled) values ('ปิดเตือน','Uo2', false) returning id`,
      )
    ).rows[0]!.id;
    const s2 = (
      await db.query<{ id: string }>(
        `insert into services (shop_id, name, duration_min) values ($1,'x',30) returning id`,
        [off],
      )
    ).rows[0]!.id;
    const c2 = (
      await db.query<{ id: string }>(
        `insert into customers (shop_id, line_user_id, display_name) values ($1,'U9','y') returning id`,
        [off],
      )
    ).rows[0]!.id;
    const st2 = (
      await db.query<{ id: string }>(
        `insert into staff (shop_id, name) values ($1,'z') returning id`,
        [off],
      )
    ).rows[0]!.id;
    const b = (
      await db.query<{ id: string }>(
        `insert into bookings (shop_id, staff_id, service_id, customer_id, during, channel)
         values ($1,$2,$3,$4,tstzrange('2026-12-07T09:30:00Z','2026-12-07T10:00:00Z','[)'),'line') returning id`,
        [off, st2, s2, c2],
      )
    ).rows[0]!.id;
    expect(await due()).not.toContain(b);
  });
});
