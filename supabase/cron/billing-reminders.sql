-- T17: schedule the daily trial-ending reminders (7/3/1 days before). NOT a migration: needs the project URL + a secret, so a human
-- runs it once in the Supabase SQL editor (pg_cron and pg_net enabled).
-- 1) Store the secret in Vault (replace the placeholder; never commit real values):
--      select vault.create_secret('<same value as the BILLING_CRON_SECRET function secret>', 'billing_cron_secret');
--    (the 'project_url' secret from supabase/cron/reminders.sql is reused)
-- 2) Run daily at 10:00 Bangkok (03:00 UTC). The function sends each reminder (7, 3 or 1 day before trial end) once per shop.
select cron.schedule(
  'kms-billing-reminders',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/billing-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'billing_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
-- Remove: select cron.unschedule('kms-billing-reminders');
