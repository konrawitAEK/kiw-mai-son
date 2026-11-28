-- T18: shop referral. Every shop has a referral code; a NEW shop that enters another shop's code
-- gives BOTH shops +1 free month.
-- Rules (mirrored in packages/core/src/referral.ts):
--   * code: 8 chars from an unambiguous alphabet (no 0/O/1/I/L), unique, created by trigger when the shop is created;
--   * a shop can redeem once, only while the shop is at most 30 days old, never its own code,
--     and never a code of a shop with the same owner (LINE user) (no farming free months with own shops);
--   * the free month is added to the end of the access period: paid_until if the shop is currently paid,
--     else trial_ends_at (from now if the trial already ended), calendar months in Asia/Bangkok.
alter table shops add column referral_code text unique;

create or replace function gen_referral_code() returns text
language plpgsql
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from shops where referral_code = code);
  end loop;
  return code;
end;
$$;

update shops set referral_code = gen_referral_code() where referral_code is null;
alter table shops alter column referral_code set not null;
alter table shops alter column referral_code set default gen_referral_code();

-- One row per redeeming shop (a shop can be referred only once).
create table referrals (
  referred_shop_id uuid primary key references shops (id) on delete cascade,
  referrer_shop_id uuid not null references shops (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (referred_shop_id <> referrer_shop_id)
);
alter table referrals enable row level security;
create index referrals_referrer_idx on referrals (referrer_shop_id);

-- Adds one free month to a shop's access period.
create or replace function grant_free_month(p_shop_id uuid) returns void
language plpgsql
as $$
declare
  sub shop_subscriptions%rowtype;
begin
  select * into sub from shop_subscriptions where shop_id = p_shop_id for update;
  if not found then raise exception 'shop % not found', p_shop_id; end if;
  if sub.paid_until is not null and sub.paid_until > now() then
    update shop_subscriptions set paid_until = add_months_bkk(sub.paid_until, 1) where shop_id = p_shop_id;
  else
    update shop_subscriptions
      set trial_ends_at = add_months_bkk(greatest(sub.trial_ends_at, now()), 1)
      where shop_id = p_shop_id;
  end if;
end;
$$;

-- Redeems `p_code` for `p_shop_id` (the new shop). Returns: 'ok', 'invalid_code', 'own_code',
-- 'same_owner', 'already_redeemed' or 'too_old'. Both shops get a free month only on 'ok'.
create or replace function redeem_referral(p_shop_id uuid, p_code text) returns text
language plpgsql
as $$
declare
  me shops%rowtype;
  ref shops%rowtype;
begin
  select * into me from shops where id = p_shop_id for update;
  if not found then raise exception 'shop % not found', p_shop_id; end if;
  select * into ref from shops where referral_code = upper(trim(p_code));
  if not found then return 'invalid_code'; end if;
  if ref.id = me.id then return 'own_code'; end if;
  if ref.owner_line_user_id = me.owner_line_user_id then return 'same_owner'; end if;
  if exists (select 1 from referrals where referred_shop_id = me.id) then return 'already_redeemed'; end if;
  if me.created_at < now() - interval '30 days' then return 'too_old'; end if;

  insert into referrals (referred_shop_id, referrer_shop_id) values (me.id, ref.id);
  perform grant_free_month(me.id);
  perform grant_free_month(ref.id);
  return 'ok';
end;
$$;

revoke all on function grant_free_month(uuid) from public;
revoke all on function redeem_referral(uuid, text) from public;
