# supabase/

Postgres migrations, Edge Functions (LINE webhook, API, reminders) and pg_cron.
Real schema + exclusion constraint land in **T3**. Keep `migrations/` ordered and idempotent-on-fresh-DB.
`tests/` holds raw SQL tests for things PGlite can't run (e.g. `btree_gist`), to run on Supabase (see TASKS.md T3).

**T12 (deposits):** `migrations/20261128020000_deposits.sql` adds shop PromptPay ID / auto-cancel hours, booking deposit amount, slip storage and `cancel_unpaid_deposits()`.
After applying it, a human runs `cron/deposits.sql` once in the SQL editor to schedule the auto-cancel sweep (every 10 min; shops that leave the timeout off are never touched).

## Monitoring (T15)

- Health check: `supabase functions deploy health --no-verify-jwt`, then `GET <project-url>/functions/v1/health` returns 200 `{"status":"ok"}` or 503 `{"status":"degraded"}` (database check, 5 s timeout). Point a free uptime pinger (e.g. UptimeRobot free plan) at it; the pinger is what notices if Supabase itself is down.
- Founder alerts: set secrets `FOUNDER_LINE_CHANNEL_TOKEN` and `FOUNDER_LINE_USER_ID` (founder's own OA; add it as a friend first), redeploy `api`, `line-webhook`, `reminders`, `health`. `api`, `line-webhook` and `reminders` alert on a thrown error or any 5xx; `reminders` also alerts when any push failed. The same alert is sent at most once per 15 minutes per function instance. Alert text never contains customer data.
