-- T7: schedule the reminder job. NOT a migration: needs the project URL + a secret, so a human
-- runs it once in the Supabase SQL editor (after enabling pg_cron and pg_net in Dashboard > Database > Extensions).
-- 1) Store secrets in Vault (replace the placeholders; never commit real values):
--      select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--      select vault.create_secret('<same value as the REMINDER_CRON_SECRET function secret>', 'reminder_cron_secret');
-- 2) Schedule every 15 minutes (the function sends for bookings starting in the next 23h..24h):
select cron.schedule(
  'kms-send-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
-- Remove: select cron.unschedule('kms-send-reminders');
