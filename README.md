# คิวไม่ซ้อน (kiw-mai-son)

LINE OA booking for small Thai hair / nail / lash / barber shops: customers book inside the shop's own LINE (LIFF), no double booking, reminders, optional PromptPay deposit, owner can book for phone customers.

- Business plan: [`docs/PROJECT-REPORT.md`](docs/PROJECT-REPORT.md)
- Rules for contributors / AI runs: [`CLAUDE.md`](CLAUDE.md)
- Task queue: [`TASKS.md`](TASKS.md)

## Layout

```
packages/core   pure logic, no I/O (slots, overlap, PromptPay, message text) — most tests here
apps/liff       React + Vite + LINE LIFF (customer booking + owner admin)
supabase/       Postgres migrations, Edge Functions, pg_cron
```

## Develop

```bash
corepack enable          # once, to get pnpm
pnpm install
pnpm test                # vitest
pnpm lint                # eslint + prettier --check
pnpm typecheck           # tsc --noEmit across packages
pnpm --filter @kms/liff dev     # run the LIFF app
pnpm --filter @kms/liff build
```

Requires Node ≥ 20 (`.nvmrc` pins 22). Copy `.env.example` → `.env` for local values; never commit `.env`.
