# supabase/

Postgres migrations, Edge Functions (LINE webhook, API, reminders) and pg_cron.
Real schema + exclusion constraint land in **T3**. Keep `migrations/` ordered and idempotent-on-fresh-DB.
`tests/` holds raw SQL tests for things PGlite can't run (e.g. `btree_gist`), to run on Supabase (see TASKS.md T3).
