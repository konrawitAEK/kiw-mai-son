# supabase/

Postgres migrations, Edge Functions (LINE webhook, API, reminders) and pg_cron.
Real schema + exclusion constraint land in **T3**. Keep `migrations/` ordered and idempotent-on-fresh-DB.
`tests/` holds raw SQL tests for things PGlite can't run (e.g. `btree_gist`), to run on Supabase (see TASKS.md T3).

**T12 (deposits):** `migrations/20261128020000_deposits.sql` adds shop PromptPay ID / auto-cancel hours, booking deposit amount, slip storage and `cancel_unpaid_deposits()`.
After applying it, a human runs `cron/deposits.sql` once in the SQL editor to schedule the auto-cancel sweep (every 10 min; shops that leave the timeout off are never touched).
