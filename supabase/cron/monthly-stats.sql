-- T16: schedule the day-25 monthly summary. NOT a migration: needs the project URL + a secret, so a human
-- runs it once in the Supabase SQL editor (pg_cron and pg_net enabled).
-- 1) Store the secret in Vault (replace the placeholder; never commit real values):
--      select vault.create_secret('<same value as the MONTHLY_STATS_CRON_SECRET function secret>', 'monthly_stats_cron_secret');
--    (the 'project_url' secret from supabase/cron/reminders.sql is reused)
-- 2) Run daily at 10:00 Bangkok (03:00 UTC). The function only sends on day 25 (Bangkok) and once per shop per month.
select cron.schedule(
  'kms-monthly-stats',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/monthly-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'monthly_stats_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
-- Remove: select cron.unschedule('kms-monthly-stats');
