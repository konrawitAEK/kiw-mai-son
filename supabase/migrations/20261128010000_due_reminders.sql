-- T7: candidates for the 24h-before reminder. Opt-out (shops.reminders_enabled), cancelled bookings
-- and bookings already in reminders_log are excluded here; the function also re-checks in code.
create or replace function due_reminders(p_from timestamptz, p_to timestamptz, p_kind text)
returns table (
  booking_id uuid,
  shop_id uuid,
  shop_name text,
  reminders_enabled boolean,
  status text,
  starts_at timestamptz,
  customer_line_user_id text,
  service_name text,
  staff_name text
)
language sql
stable
as $$
  select b.id, b.shop_id, s.name, s.reminders_enabled, b.status, lower(b.during),
         c.line_user_id, sv.name, st.name
  from bookings b
  join shops s on s.id = b.shop_id
  join customers c on c.id = b.customer_id
  join services sv on sv.id = b.service_id
  join staff st on st.id = b.staff_id
  where s.reminders_enabled
    and b.status in ('pending', 'confirmed')
    and c.line_user_id is not null
    and lower(b.during) between p_from and p_to
    and not exists (
      select 1 from reminders_log r where r.booking_id = b.id and r.kind = p_kind
    );
$$;

-- Atomic claim: true only for the caller that inserted the row (never send twice).
create or replace function claim_reminder(p_booking_id uuid, p_kind text)
returns boolean
language sql
as $$
  with ins as (
    insert into reminders_log (booking_id, kind) values (p_booking_id, p_kind)
    on conflict (booking_id, kind) do nothing
    returning 1
  )
  select exists (select 1 from ins);
$$;

-- Edge Functions use the service role only.
revoke all on function due_reminders(timestamptz, timestamptz, text) from public;
revoke all on function claim_reminder(uuid, text) from public;
