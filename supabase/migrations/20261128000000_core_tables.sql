-- T3: core tables + exclusion constraint (no overlapping active bookings per staff).
-- Times are timestamptz (UTC internally); the app renders Asia/Bangkok.
-- Active booking = any status except 'cancelled' (matches packages/core availableSlots).

create extension if not exists btree_gist;

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'Asia/Bangkok' check (timezone = 'Asia/Bangkok'),
  owner_line_user_id text not null,
  reminders_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Secrets are encrypted by the app (key from Supabase secrets) before insert; never plaintext.
create table line_channels (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references shops (id) on delete cascade,
  channel_id text not null unique,
  destination text unique, -- LINE bot userId, used by the webhook to route to a shop
  channel_secret_encrypted bytea not null,
  channel_access_token_encrypted bytea not null,
  created_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, shop_id)
);

create table services (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  duration_min integer not null check (duration_min > 0),
  price integer not null default 0 check (price >= 0), -- THB
  deposit integer not null default 0 check (deposit >= 0 and deposit <= price), -- THB, 0 = none
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, shop_id)
);

-- weekday: 0 = Sunday ... 6 = Saturday (Bangkok wall clock). Several windows per day allowed.
create table working_hours (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

-- staff_id null = whole shop closed.
create table time_off (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  staff_id uuid references staff (id) on delete cascade,
  during tstzrange not null check (not isempty(during)),
  reason text
);

-- Only what is needed: LINE user id, display name, optional phone. Phone-only customers (owner bookings) have no LINE id.
create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  line_user_id text,
  display_name text not null,
  phone text,
  created_at timestamptz not null default now(),
  unique (id, shop_id),
  unique (shop_id, line_user_id)
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  staff_id uuid not null,
  service_id uuid not null,
  customer_id uuid not null,
  during tstzrange not null check (not isempty(during) and lower_inc(during) and not upper_inc(during)),
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  channel text not null check (channel in ('line', 'owner')),
  deposit_status text not null default 'none'
    check (deposit_status in ('none', 'pending', 'paid', 'rejected', 'refunded')),
  created_at timestamptz not null default now(),
  foreign key (staff_id, shop_id) references staff (id, shop_id),
  foreign key (service_id, shop_id) references services (id, shop_id),
  foreign key (customer_id, shop_id) references customers (id, shop_id),
  -- Double booking is impossible at the DB level: same staff, overlapping time, both not cancelled.
  constraint bookings_no_overlap exclude using gist (
    staff_id with =,
    during with &&
  ) where (status <> 'cancelled')
);

create index bookings_shop_during_idx on bookings using gist (shop_id, during);
create index bookings_customer_idx on bookings (customer_id);

create table reminders_log (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  kind text not null default 'day_before',
  sent_at timestamptz not null default now(),
  unique (booking_id, kind) -- never send the same reminder twice
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null unique references shops (id) on delete cascade,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  plan text not null default 'basic',
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

-- Supabase: deny direct client access by default; Edge Functions use the service role.
alter table shops enable row level security;
alter table line_channels enable row level security;
alter table staff enable row level security;
alter table services enable row level security;
alter table working_hours enable row level security;
alter table time_off enable row level security;
alter table customers enable row level security;
alter table bookings enable row level security;
alter table reminders_log enable row level security;
alter table subscriptions enable row level security;
