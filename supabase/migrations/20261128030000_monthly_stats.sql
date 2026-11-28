-- T16: monthly stats per shop + once-per-month log for the day-25 summary message.
-- Counting rules (document any change in the PR):
--   * a booking belongs to the month its start falls in (Bangkok window passed by the caller);
--   * "bookings" = non-cancelled bookings (pending, confirmed, completed, no_show);
--   * via_line / via_owner split bookings by bookings.channel;
--   * no_shows = status 'no_show'; cancelled is reported separately;
--   * deposits = non-cancelled bookings whose deposit_status is 'paid' (count and THB sum).
create or replace function monthly_stats(p_from timestamptz, p_to timestamptz)
returns table (
  shop_id uuid,
  shop_name text,
  bookings integer,
  via_line integer,
  via_owner integer,
  no_shows integer,
  cancelled integer,
  deposits_paid integer,
  deposits_paid_amount integer
)
language sql
stable
as $$
  select s.id, s.name,
         (count(b.id) filter (where b.status <> 'cancelled'))::int,
         (count(b.id) filter (where b.status <> 'cancelled' and b.channel = 'line'))::int,
         (count(b.id) filter (where b.status <> 'cancelled' and b.channel = 'owner'))::int,
         (count(b.id) filter (where b.status = 'no_show'))::int,
         (count(b.id) filter (where b.status = 'cancelled'))::int,
         (count(b.id) filter (where b.status <> 'cancelled' and b.deposit_status = 'paid'))::int,
         (coalesce(sum(b.deposit_amount) filter (where b.status <> 'cancelled' and b.deposit_status = 'paid'), 0))::int
  from shops s
  left join bookings b
    on b.shop_id = s.id and lower(b.during) >= p_from and lower(b.during) < p_to
  group by s.id, s.name
  order by s.name, s.id;
$$;

revoke all on function monthly_stats(timestamptz, timestamptz) from public;

-- One summary per shop per month (month = 'YYYY-MM', Bangkok). Never send twice.
create table monthly_summaries_log (
  shop_id uuid not null references shops (id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  sent_at timestamptz not null default now(),
  primary key (shop_id, month)
);
alter table monthly_summaries_log enable row level security;

-- Atomic claim: true only for the caller that inserted the row.
create or replace function claim_monthly_summary(p_shop_id uuid, p_month text)
returns boolean
language sql
as $$
  with ins as (
    insert into monthly_summaries_log (shop_id, month) values (p_shop_id, p_month)
    on conflict do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

revoke all on function claim_monthly_summary(uuid, text) from public;
