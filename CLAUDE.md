# คิวไม่ซ้อน (kiw-mai-son) — rules for Claude

LINE OA booking system for small Thai hair / nail / lash / barber shops: customers book in the shop's LINE (LIFF), no double booking, reminders, optional PromptPay deposit, owner can book on behalf of phone customers. Business plan: `docs/PROJECT-REPORT.md` (copy it in from the founder-ideas folder).

## How work happens here
- Work comes from `TASKS.md`. Do **one** task per run: the first unchecked task that is not marked `[HUMAN]` and whose `needs:` tasks are all checked.
- Work on a branch `ai/<task-id>-<short-name>`, open a PR to `main`, never push to `main`, never merge.
- A task is done only when everything under "Done when" passes. Run the tests; paste the command and result in the PR.
- When done: tick the task in `TASKS.md` on your branch and add one line under "Log" (date, task id, PR, anything the human must check).
- If blocked (missing secret, unclear spec, needs a human account): do not guess. Add a `BLOCKED:` line under the task explaining exactly what is needed, open a draft PR with what you have, and stop.
- If you run out of usage mid-task, the next run starts from git and `TASKS.md`; keep commits small and meaningful so work is never lost.

## Stack (may change after week-1 checks; follow what TASKS.md says)
- TypeScript everywhere, pnpm workspaces.
- `apps/liff`: React + Vite, LINE LIFF SDK (customer booking page + owner admin page).
- `supabase/`: Postgres migrations, Edge Functions (LINE webhook, API, reminders), pg_cron.
- `packages/core`: pure logic with no I/O (slot calculation, overlap rules, PromptPay payload, message text). Most tests live here.
- Tests: vitest. DB tests with PGlite where possible.

## Hard rules
- Never commit secrets. LINE channel tokens, Supabase keys and PromptPay IDs come from env vars / Supabase secrets only. Keep `.env.example` up to date with names, never values.
- Shop LINE channel tokens are stored encrypted at rest.
- Collect only what is needed from end customers: LINE user id, display name, phone (optional). Shops are the data controller (PDPA); add nothing that tracks customers beyond bookings.
- Double booking must be impossible at the database level (exclusion constraint), not only in app code.
- All user-facing text is Thai. Times are Asia/Bangkok.
- Do not add paid services or new vendors without a `[HUMAN]` task approving it.
- Keep dependencies few and pinned.
