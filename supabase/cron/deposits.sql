-- T12: schedule auto-cancel of unpaid deposits. NOT a migration: a human runs it once in the Supabase SQL
-- editor after enabling pg_cron (Dashboard > Database > Extensions). No secrets needed (pure SQL).
-- Does nothing for shops that have not set a deposit timeout (default off).
select cron.schedule(
  'kms-cancel-unpaid-deposits',
  '*/10 * * * *',
  $$ select cancel_unpaid_deposits(); $$
);
-- Remove: select cron.unschedule('kms-cancel-unpaid-deposits');
