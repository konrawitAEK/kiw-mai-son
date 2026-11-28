import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import coreSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";
import billingSql from "../../../supabase/migrations/20261128040000_billing.sql?raw";
import { addMonths } from "./billing.js";

let db: PGlite;
let shop: string;
const DAY = 86_400_000;

async function sub(id: string) {
  const r = await db.query<{ trial_ends_at: Date; paid_until: Date | null; plan: string | null }>(
    `select trial_ends_at, paid_until, plan from shop_subscriptions where shop_id=$1`,
    [id],
  );
  return r.rows[0]!;
}
const newShop = async (name: string) =>
  (
    await db.query<{ id: string }>(
      `insert into shops (name, owner_line_user_id) values ($1,'U1') returning id`,
      [name],
    )
  ).rows[0]!.id;
const pay = async (id: string, plan: string) =>
  (
    await db.query<{ mark_subscription_paid: Date }>(
      `select mark_subscription_paid($1,$2,'founder','slip 1')`,
      [id, plan],
    )
  ).rows[0]!.mark_subscription_paid;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(coreSql);
  await db.exec(billingSql);
  shop = await newShop("A");
});

describe("shop_subscriptions (SQL)", () => {
  it("starts a 30-day trial for a new shop", async () => {
    const s = await sub(shop);
    const days = (s.trial_ends_at.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(s.paid_until).toBeNull();
    expect(s.plan).toBeNull();
  });

  it("monthly payment during the trial keeps the free days (starts at trial end)", async () => {
    const before = await sub(shop);
    const end = await pay(shop, "monthly");
    expect(end.toISOString()).toBe(addMonths(before.trial_ends_at.toISOString(), 1));
    const after = await sub(shop);
    expect(after.paid_until!.getTime()).toBe(end.getTime());
    expect(after.plan).toBe("monthly");
  });

  it("a second payment stacks on the paid period; yearly adds 12 months", async () => {
    const before = (await sub(shop)).paid_until!;
    const end = await pay(shop, "yearly");
    expect(end.toISOString()).toBe(addMonths(before.toISOString(), 12));
  });

  it("an expired shop pays from now", async () => {
    const s2 = await newShop("B");
    await db.query(
      `update shop_subscriptions set trial_ends_at = now() - interval '5 days' where shop_id=$1`,
      [s2],
    );
    const end = await pay(s2, "monthly");
    const days = (end.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
  });

  it("records payment history with the price at the time", async () => {
    const r = await db.query<{ plan: string; amount: number; marked_by: string }>(
      `select plan, amount, marked_by from subscription_payments where shop_id=$1 order by paid_at, plan desc`,
      [shop],
    );
    expect(r.rows.map((x) => [x.plan, x.amount]).sort()).toEqual([
      ["monthly", 199],
      ["yearly", 1990],
    ]);
    expect(r.rows[0]!.marked_by).toBe("founder");
  });

  it("rejects an unknown plan and an unknown shop", async () => {
    await expect(pay(shop, "weekly")).rejects.toThrow(/unknown plan/);
    await expect(pay("00000000-0000-0000-0000-000000000000", "monthly")).rejects.toThrow(
      /not found/,
    );
  });

  it("claim_billing_reminder is true once per (shop, kind)", async () => {
    const claim = async (k: string) =>
      (
        await db.query<{ claim_billing_reminder: boolean }>(
          `select claim_billing_reminder($1,$2)`,
          [shop, k],
        )
      ).rows[0]!.claim_billing_reminder;
    expect(await claim("trial_3d@2026-12-04")).toBe(true);
    expect(await claim("trial_3d@2026-12-04")).toBe(false);
    expect(await claim("trial_1d@2026-12-04")).toBe(true);
  });

  it("deleting a shop removes its billing rows", async () => {
    const s3 = await newShop("C");
    await pay(s3, "monthly");
    await db.query(`delete from shops where id=$1`, [s3]);
    const r = await db.query(`select 1 from shop_subscriptions where shop_id=$1`, [s3]);
    expect(r.rows).toHaveLength(0);
  });
});
