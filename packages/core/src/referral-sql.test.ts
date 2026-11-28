import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { beforeAll, describe, expect, it } from "vitest";
import coreSql from "../../../supabase/migrations/20261128000000_core_tables.sql?raw";
import billingSql from "../../../supabase/migrations/20261128040000_billing.sql?raw";
import referralSql from "../../../supabase/migrations/20261128050000_referrals.sql?raw";
import { addMonths, REFERRAL_ALPHABET, REFERRAL_CODE_LENGTH } from "./index.js";

let db: PGlite;

const newShop = async (name: string, owner: string) =>
  (
    await db.query<{ id: string; referral_code: string }>(
      `insert into shops (name, owner_line_user_id) values ($1,$2) returning id, referral_code`,
      [name, owner],
    )
  ).rows[0]!;
const sub = async (id: string) =>
  (
    await db.query<{ trial_ends_at: Date; paid_until: Date | null }>(
      `select trial_ends_at, paid_until from shop_subscriptions where shop_id=$1`,
      [id],
    )
  ).rows[0]!;
const redeem = async (id: string, code: string) =>
  (await db.query<{ redeem_referral: string }>(`select redeem_referral($1,$2)`, [id, code]))
    .rows[0]!.redeem_referral;

beforeAll(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(coreSql);
  await db.exec(billingSql);
  await db.exec(referralSql);
});

describe("referral codes (SQL)", () => {
  it("every new shop gets a unique 8-char code from the safe alphabet", async () => {
    const a = await newShop("A", "U1");
    const b = await newShop("B", "U2");
    expect(a.referral_code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(a.referral_code).not.toBe(b.referral_code);
    for (const ch of a.referral_code) expect(REFERRAL_ALPHABET).toContain(ch);
  });
});

describe("redeem_referral (SQL)", () => {
  it("gives BOTH shops one free month (trial extended by a calendar month)", async () => {
    const ref = await newShop("Ref", "U10");
    const me = await newShop("Me", "U11");
    const refBefore = await sub(ref.id);
    const meBefore = await sub(me.id);
    expect(await redeem(me.id, ref.referral_code)).toBe("ok");
    expect((await sub(ref.id)).trial_ends_at.toISOString()).toBe(
      addMonths(refBefore.trial_ends_at.toISOString(), 1),
    );
    expect((await sub(me.id)).trial_ends_at.toISOString()).toBe(
      addMonths(meBefore.trial_ends_at.toISOString(), 1),
    );
  });

  it("accepts lower case / padded input", async () => {
    const ref = await newShop("Ref2", "U20");
    const me = await newShop("Me2", "U21");
    expect(await redeem(me.id, ` ${ref.referral_code.toLowerCase()} `)).toBe("ok");
  });

  it("extends paid_until instead when the referrer is a paying shop", async () => {
    const ref = await newShop("Paid", "U30");
    await db.query(`select mark_subscription_paid($1,'monthly')`, [ref.id]);
    const before = await sub(ref.id);
    const me = await newShop("Me3", "U31");
    expect(await redeem(me.id, ref.referral_code)).toBe("ok");
    const after = await sub(ref.id);
    expect(after.paid_until!.toISOString()).toBe(addMonths(before.paid_until!.toISOString(), 1));
    expect(after.trial_ends_at.getTime()).toBe(before.trial_ends_at.getTime());
  });

  it("a shop can redeem only once (and nobody gets a second month)", async () => {
    const ref = await newShop("R4", "U40");
    const other = await newShop("R4b", "U41");
    const me = await newShop("Me4", "U42");
    expect(await redeem(me.id, ref.referral_code)).toBe("ok");
    const before = await sub(other.id);
    expect(await redeem(me.id, other.referral_code)).toBe("already_redeemed");
    expect((await sub(other.id)).trial_ends_at.getTime()).toBe(before.trial_ends_at.getTime());
  });

  it("rejects unknown code, own code and a code of the same owner without changing anything", async () => {
    const me = await newShop("Me5", "U50");
    const mine2 = await newShop("Me5b", "U50");
    const before = await sub(me.id);
    expect(await redeem(me.id, "ZZZZZZZZ")).toBe("invalid_code");
    expect(await redeem(me.id, me.referral_code)).toBe("own_code");
    expect(await redeem(me.id, mine2.referral_code)).toBe("same_owner");
    expect((await sub(me.id)).trial_ends_at.getTime()).toBe(before.trial_ends_at.getTime());
    const r = await db.query(`select 1 from referrals where referred_shop_id=$1`, [me.id]);
    expect(r.rows).toHaveLength(0);
  });

  it("rejects shops older than 30 days", async () => {
    const ref = await newShop("R6", "U60");
    const old = await newShop("Old", "U61");
    await db.query(`update shops set created_at = now() - interval '31 days' where id=$1`, [
      old.id,
    ]);
    expect(await redeem(old.id, ref.referral_code)).toBe("too_old");
  });

  it("raises for an unknown shop", async () => {
    await expect(redeem("00000000-0000-0000-0000-000000000000", "ABCDEFGH")).rejects.toThrow(
      /not found/,
    );
  });

  it("deleting a shop removes its referral rows", async () => {
    const ref = await newShop("R7", "U70");
    const me = await newShop("Me7", "U71");
    await redeem(me.id, ref.referral_code);
    await db.query(`delete from shops where id=$1`, [ref.id]);
    const r = await db.query(`select 1 from referrals where referred_shop_id=$1`, [me.id]);
    expect(r.rows).toHaveLength(0);
  });
});
