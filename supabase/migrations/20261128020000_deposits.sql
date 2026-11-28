-- T12: deposit flow. Optional per service (services.deposit > 0, from T3).
-- Lifecycle of a booking with a deposit:
--   created      -> status 'pending',   deposit_status 'pending'    (slot is held: pending counts as active)
--   slip upload  -> status 'pending',   deposit_status 'submitted'
--   owner OK     -> status 'confirmed', deposit_status 'paid'
--   owner reject -> status 'pending',   deposit_status 'rejected'   (customer may upload a new slip)
--   timeout      -> status 'cancelled'  (only if the shop set deposit_timeout_hours; NULL = off, the default)

-- The shop's own PromptPay receiving ID (phone / national ID / tax ID) is shop config, entered by the owner
-- in the admin page. It is never committed to the repo and never logged.
alter table shops
  add column promptpay_id text check (promptpay_id is null or promptpay_id ~ '^[0-9 -]{10,17}$'),
  add column deposit_timeout_hours integer
    check (deposit_timeout_hours is null or deposit_timeout_hours between 1 and 720);

-- Amount is copied from the service at booking time so a later price change does not alter it.
alter table bookings
  add column deposit_amount integer not null default 0 check (deposit_amount >= 0);

alter table bookings drop constraint bookings_deposit_status_check;
alter table bookings add constraint bookings_deposit_status_check
  check (deposit_status in ('none', 'pending', 'submitted', 'paid', 'rejected', 'refunded'));
alter table bookings add constraint bookings_deposit_consistent
  check ((deposit_amount = 0) = (deposit_status = 'none'));

-- Slip image (customer-uploaded proof of transfer). Small images only (the LIFF page downsizes them).
create table deposit_slips (
  booking_id uuid primary key references bookings (id) on delete cascade,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  data bytea not null check (octet_length(data) between 1 and 2097152),
  uploaded_at timestamptz not null default now()
);
alter table deposit_slips enable row level security;

-- Auto-cancel unpaid deposits. Shops with deposit_timeout_hours NULL are never touched.
-- A booking whose slip is waiting for the owner ('submitted') or already 'paid' is never cancelled.
-- Returns the cancelled booking ids.
create or replace function cancel_unpaid_deposits(p_now timestamptz default now())
returns setof uuid
language sql
as $$
  update bookings b
     set status = 'cancelled'
    from shops s
   where s.id = b.shop_id
     and s.deposit_timeout_hours is not null
     and b.status = 'pending'
     and b.deposit_status in ('pending', 'rejected')
     and b.created_at + make_interval(hours => s.deposit_timeout_hours) <= p_now
  returning b.id;
$$;

revoke all on function cancel_unpaid_deposits(timestamptz) from public;
