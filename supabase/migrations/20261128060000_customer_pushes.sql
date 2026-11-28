-- T20: outbox of LINE pushes to customers about their deposit (owner confirmed / rejected the slip, or the
-- unpaid deposit auto-cancelled). Rows are enqueued in the same transaction as the change (auto-cancel) or by the
-- API right after the owner's decision; the Edge Function `customer-pushes` sends them and sets sent_at.
-- Only the booking id and the kind are stored; the text is built at send time. Edge Functions use the service role.
create table customer_pushes (
  id bigint generated always as identity primary key,
  booking_id uuid not null references bookings (id) on delete cascade,
  kind text not null check (kind in ('deposit_confirmed', 'deposit_rejected', 'deposit_cancelled')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index customer_pushes_unsent on customer_pushes (id) where sent_at is null;
alter table customer_pushes enable row level security;

create or replace function enqueue_customer_push(p_booking_id uuid, p_kind text)
returns void
language sql
as $$
  insert into customer_pushes (booking_id, kind) values (p_booking_id, p_kind);
$$;

-- Unsent pushes with everything the text needs. LINE-less (phone-only) customers are returned with a null user id
-- so the job can mark them done.
create or replace function pending_customer_pushes(p_limit integer default 50)
returns table (
  id bigint,
  kind text,
  booking_id uuid,
  shop_id uuid,
  shop_name text,
  starts_at timestamptz,
  customer_line_user_id text,
  service_name text,
  deposit_amount integer
)
language sql
stable
as $$
  select p.id, p.kind, b.id, b.shop_id, s.name, lower(b.during), c.line_user_id, sv.name, b.deposit_amount
  from customer_pushes p
  join bookings b on b.id = p.booking_id
  join shops s on s.id = b.shop_id
  join customers c on c.id = b.customer_id
  join services sv on sv.id = b.service_id
  where p.sent_at is null
  order by p.id
  limit greatest(p_limit, 1);
$$;

create or replace function mark_customer_push_sent(p_id bigint)
returns void
language sql
as $$
  update customer_pushes set sent_at = now() where id = p_id and sent_at is null;
$$;

-- Same rules as T12; additionally enqueues 'deposit_cancelled' for every booking it cancels.
create or replace function cancel_unpaid_deposits(p_now timestamptz default now())
returns setof uuid
language sql
as $$
  with cancelled as (
    update bookings b
       set status = 'cancelled'
      from shops s
     where s.id = b.shop_id
       and s.deposit_timeout_hours is not null
       and b.status = 'pending'
       and b.deposit_status in ('pending', 'rejected')
       and b.created_at + make_interval(hours => s.deposit_timeout_hours) <= p_now
    returning b.id
  ), queued as (
    insert into customer_pushes (booking_id, kind)
    select id, 'deposit_cancelled' from cancelled
  )
  select id from cancelled;
$$;

revoke all on table customer_pushes from public;
revoke all on function enqueue_customer_push(uuid, text) from public;
revoke all on function pending_customer_pushes(integer) from public;
revoke all on function mark_customer_push_sent(bigint) from public;
