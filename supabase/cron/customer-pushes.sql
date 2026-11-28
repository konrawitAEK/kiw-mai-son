-- T20: send queued deposit-decision pushes to customers every 5 minutes. NOT a migration: needs the project URL + a secret, so a human
-- runs it once in the Supabase SQL editor (pg_cron and pg_net enabled).
-- 1) Store the secret in Vault (replace the placeholder; never commit real values):
--      select vault.create_secret('<same value as the CUSTOMER_PUSH_CRON_SECRET function secret>', 'customer_push_cron_secret');
--    (the 'project_url' secret from supabase/cron/reminders.sql is reused)
-- 2) Every 5 minutes. Unsent rows (failed pushes) are retried on the next run; each push is marked sent once.
select cron.schedule(
  'kms-customer-pushes',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/customer-pushes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'customer_push_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
-- Remove: select cron.unschedule('kms-customer-pushes');
