-- T17: subscription billing. One row per shop: free trial end, paid-until, last plan.
-- Rules (mirrored in packages/core/src/billing.ts):
--   * every shop starts a 30-day free trial when it is created (trigger); existing shops get 30 days from this migration;
--   * status is derived, never stored: active if paid_until > now, else trial if trial_ends_at > now, else expired;
--   * a payment extends from max(now, trial_ends_at, paid_until), so early payers keep their free days;
--   * plans: monthly 199 THB = +1 month, yearly 1,990 THB = +12 months (calendar months, Asia/Bangkok).
-- The founder records payments with mark_subscription_paid(...) (SQL editor) or the founder-only API route.
create table shop_subscriptions (
  shop_id uuid primary key references shops (id) on delete cascade,
  trial_ends_at timestamptz not null,
  paid_until timestamptz,
  plan text check (plan in ('monthly', 'yearly')),
  created_at timestamptz not null default now()
);
alter table shop_subscriptions enable row level security;

-- Payment history (what was recorded, when, by whom). amount is THB at the time of payment.
create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  plan text not null check (plan in ('monthly', 'yearly')),
  amount integer not null check (amount > 0),
  period_end timestamptz not null,
  note text,
  marked_by text,
  paid_at timestamptz not null default now()
);
alter table subscription_payments enable row level security;
create index subscription_payments_shop_idx on subscription_payments (shop_id, paid_at desc);

-- One reminder per shop per `kind` (kind includes the trial end date, e.g. 'trial_3d@2026-12-04').
create table billing_reminders_log (
  shop_id uuid not null references shops (id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (shop_id, kind)
);
alter table billing_reminders_log enable row level security;

create or replace function start_shop_trial() returns trigger
language plpgsql
as $$
begin
  insert into shop_subscriptions (shop_id, trial_ends_at)
  values (new.id, now() + interval '30 days')
  on conflict do nothing;
  return new;
end;
$$;

create trigger shops_start_trial after insert on shops
  for each row execute function start_shop_trial();

insert into shop_subscriptions (shop_id, trial_ends_at)
select id, now() + interval '30 days' from shops
on conflict do nothing;

-- Calendar months in Asia/Bangkok with day clamping (31 Jan + 1 month = 28/29 Feb).
create or replace function add_months_bkk(p_ts timestamptz, p_months integer) returns timestamptz
language sql
immutable
as $$
  select ((p_ts at time zone 'Asia/Bangkok') + make_interval(months => p_months)) at time zone 'Asia/Bangkok';
$$;

-- Records a payment and extends paid_until. Returns the new paid_until. Raises if the shop does not exist.
create or replace function mark_subscription_paid(
  p_shop_id uuid,
  p_plan text,
  p_marked_by text default null,
  p_note text default null
) returns timestamptz
language plpgsql
as $$
declare
  sub shop_subscriptions%rowtype;
  v_months integer;
  v_amount integer;
  v_base timestamptz;
  v_end timestamptz;
begin
  if p_plan = 'monthly' then v_months := 1; v_amount := 199;
  elsif p_plan = 'yearly' then v_months := 12; v_amount := 1990;
  else raise exception 'unknown plan %', p_plan;
  end if;

  select * into sub from shop_subscriptions where shop_id = p_shop_id for update;
  if not found then raise exception 'shop % not found', p_shop_id; end if;

  v_base := greatest(now(), sub.trial_ends_at, coalesce(sub.paid_until, '-infinity'::timestamptz));
  v_end := add_months_bkk(v_base, v_months);

  update shop_subscriptions set paid_until = v_end, plan = p_plan where shop_id = p_shop_id;
  insert into subscription_payments (shop_id, plan, amount, period_end, note, marked_by)
  values (p_shop_id, p_plan, v_amount, v_end, p_note, p_marked_by);
  return v_end;
end;
$$;

-- Atomic claim: true only for the caller that inserted the row.
create or replace function claim_billing_reminder(p_shop_id uuid, p_kind text) returns boolean
language sql
as $$
  with ins as (
    insert into billing_reminders_log (shop_id, kind) values (p_shop_id, p_kind)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

revoke all on function mark_subscription_paid(uuid, text, text, text) from public;
revoke all on function claim_billing_reminder(uuid, text) from public;
