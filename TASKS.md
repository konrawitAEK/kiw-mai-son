# TASKS — คิวไม่ซ้อน

Rules: see `CLAUDE.md`. The AI does one unchecked task per run, in order, skipping `[HUMAN]` tasks and tasks whose `needs:` are not done.
`[HUMAN]` = only the founder can do it (accounts, secrets, real phones, real shops, decisions).
Timeline reference: weekdays 21:00–23:00 review, weekends for HUMAN tasks. Target: demo by end of week 2–3.

---

## Week 1 — checks and foundations

- [ ] **H1 [HUMAN]** Talk to 5 real shops (questions in docs/PROJECT-REPORT.md §9). Write results in `docs/interviews.md`. Go/no-go: ≥3 of 5 have real double-booking/no-show pain.
- [ ] **H2 [HUMAN]** Check current LINE OA free message quota in Thailand, Messaging API + LIFF terms, Supabase free tier limits. Write findings in `docs/platform-checks.md`. If anything breaks the plan, edit the tasks below.
- [ ] **H3 [HUMAN]** Create: LINE Developers account, a demo LINE OA "ร้านเดโม คิวไม่ซ้อน" with Messaging API channel, a LIFF app; a Supabase project. Put names (not values) in `.env.example` and values in Supabase secrets / GitHub repo secrets.
- [ ] **H4 [HUMAN]** Check employment contract allows a side business.

- [x] **T1** Repo skeleton: pnpm workspace with `apps/liff`, `packages/core`, `supabase/`; TypeScript strict; vitest; ESLint + Prettier; `.env.example`; GitHub Actions running lint + tests on PRs.
  - Done when: `pnpm install && pnpm lint && pnpm test` pass on a clean clone; CI green on the PR.
- [x] **T2** `packages/core`: types for Shop, Staff, Service (duration min, price, deposit), WorkingHours, TimeOff, Booking. Function `availableSlots(day, service, staff, workingHours, timeOff, bookings, stepMinutes)` returning free start times in Asia/Bangkok.
  - needs: T1
  - Done when: ≥12 unit tests incl. overlapping bookings, time off, service longer than remaining time, "any staff", day boundaries, DST-free Bangkok time.
- [x] **T3** DB migration: tables shops, line_channels (token encrypted), staff, services, working_hours, time_off, customers, bookings (tstzrange `during`, status, channel `line|owner`, deposit_status), reminders_log, subscriptions. Exclusion constraint: no overlapping active bookings per staff (`btree_gist`).
  - needs: T1
  - Done when: migration applies on a fresh DB; a test inserts two overlapping bookings for the same staff and the second fails; cancelled bookings don't block. (Use PGlite if `btree_gist` works there; otherwise write the test as SQL in `supabase/tests/` and add a `[HUMAN]` note to run it on Supabase.)

## Week 2 — booking flow

- [x] **T4** Edge Function API: list services/staff for a shop, get available slots (uses core), create booking (relies on DB constraint; returns a clear Thai error on conflict), cancel booking. Auth: verify LIFF ID token for customers.
  - needs: T2, T3
  - Done when: handler unit tests with mocked DB pass; conflict returns 409 with Thai message.
- [x] **T5** LIFF customer page: choose service → staff (or any) → date → time → confirm. Mobile-first, Thai text, shows only free slots, handles conflict ("ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกใหม่").
  - needs: T4
  - Done when: component tests pass; `pnpm --filter liff build` passes; PR has screenshots from a mobile-sized browser.
- [ ] **H5 [HUMAN]** Deploy LIFF + functions to the demo OA; book on 2 real phones at the same time; confirm the second one fails cleanly.

## Week 3 — messages and owner admin

- [x] **T6** LINE webhook function: verify signature, route by destination (shop), reply with booking confirmation (reply API, not push).
  - needs: T4
  - Done when: signature verification tests (valid/invalid) and message text snapshot tests pass.
- [x] **T7** Reminder job (pg_cron → function): push "นัดพรุ่งนี้" message 24h before, with buttons ยืนยันมา / ขอเลื่อน; never send twice (reminders_log); shop can turn reminders off.
  - needs: T6
  - Done when: tests cover once-only sending, opt-out, and cancelled bookings.
- [x] **T8** LIFF owner admin: today/week schedule by staff; add booking for phone customer (name, phone, service, time) in one screen; block time; cancel. Only shop owners (by LINE user id) can open it.
  - needs: T4
  - Done when: component tests + access-control test pass; build passes; PR has screenshots.
- [ ] **T9** Rich menu setup script for a shop channel ("จองคิว", "นัดของฉัน", "ติดต่อร้าน").
  - needs: T6
  - Done when: script has a dry-run mode tested in CI.
- [ ] **H6 [HUMAN]** Full run on the demo OA with real phones: book → confirm message → reminder (set a booking 24h+5min ahead or temporary test window) → owner adds a phone booking → block time.

## Week 4 — DEMO DONE

- [x] **T10** Landing page (static, Thai): what it does, "ลองจองร้านเดโม" (QR + link to demo OA), "ใครทำ" section placeholder, sign-up via LINE OA link. Lighthouse mobile ≥90.
  - needs: T5
- [ ] **H7 [HUMAN]** Record the 60-second demo clip, add your real photo/name to "ใครทำ", publish the landing page. ✅ Demo milestone.

## Weeks 5–6 — deposit and multi-shop

- [ ] **T11** `packages/core`: PromptPay QR payload (EMVCo, phone or national/tax ID, amount, CRC16) with tests against known valid payloads.
  - Done when: ≥8 tests incl. CRC and amount formatting.
- [ ] **T12** Deposit flow: service has optional deposit; after booking show the shop's PromptPay QR + amount; customer uploads slip image; owner confirms/rejects in admin; unpaid deposit after N hours → booking auto-cancelled (configurable, default off).
  - needs: T11, T8
- [ ] **T13** Shop onboarding page: owner pastes channel id/secret/token (validated against LINE API, stored encrypted), sets services/staff/hours, runs rich menu setup, makes a test booking. Target: whole setup < 30 min on a video call.
  - needs: T9, T8
- [ ] **T14** Privacy notice + shop data-processing terms pages (Thai), linked from LIFF and landing page; data export (CSV) and delete-shop for owners.
  - needs: T8
- [ ] **T15** Monitoring: health-check endpoint + alert to the founder's LINE when functions error or reminders fail.
  - needs: T7
- [ ] **H8 [HUMAN]** Review T13/T14 for security (token handling, access control) before any real shop uses it.

## Weeks 7–12 — pilots and launch (mostly HUMAN; AI tasks get added from pilot feedback)

- [ ] **H9 [HUMAN]** Recruit 3–5 pilot shops (Facebook groups + demo clip), onboard on weekend calls.
- [ ] **T16** Monthly stats per shop (bookings, via LINE vs owner, no-shows, deposits) + day-25 summary message with payment link.
  - needs: T12
- [ ] **T17** Billing: subscription status, trial end, PromptPay payment link/QR for 199 or 1,990, mark paid, reminders before trial ends.
  - needs: T16
- [ ] **T18** Referral: shop referral code, both get 1 free month.
  - needs: T17
- [ ] **H10 [HUMAN]** Collect real results + permission for testimonials; rerun the simulated buyer panel on Haiku with real objections; open "30 ร้านแรก".

---

## Log
<!-- One line per finished task: YYYY-MM-DD · task · PR link · what the human must check -->
- 2026-11-27 · T1 · (scaffolded locally before GitHub repo existed) · `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @kms/liff build` all pass. Human: create the private GitHub repo, push this as the initial commit, confirm CI goes green, then let the cloud routine start at T2.
- 2026-11-28 · T2 · PR (see branch ai/t2-availability-slots) · `pnpm lint && pnpm typecheck && pnpm test` pass (26 tests). Human: review the `availableSlots` API shape (returns slots with `staffIds[]`; day as `YYYY-MM-DD`; weekday 0=Sun) before T4 builds on it.
- 2026-11-28 · T3 · PR (branch ai/t3-db-migration) · `pnpm lint && pnpm typecheck && pnpm test` pass (34 tests; PGlite + btree_gist works, so no SQL-only test needed). Human: apply `supabase/migrations/20261128000000_core_tables.sql` on the real Supabase project once (H3) and check the table list; confirm 'active booking' = any status except cancelled; RLS is enabled with no policies (Edge Functions use service role).
- 2026-11-28 · T4 · PR (branch ai/t4-booking-api) · `pnpm lint && pnpm typecheck && pnpm test` pass (51 tests, 17 new in packages/api). Human: Edge Function entry `supabase/functions/api` (Deno + supabase-js wiring) is NOT tested locally; at H5 deploy with `supabase functions deploy api --no-verify-jwt`, set secret LINE_LOGIN_CHANNEL_ID, and check the Deno import resolution + a real LIFF token.
- 2026-11-28 · T5 · PR (branch ai/t5-liff-booking-page) · `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @kms/liff build` pass (67 tests, 16 new in apps/liff). Human: LIFF init/ID-token flow and real API calls are NOT tested locally (screenshots use a dev mock `?mock=1`); check on a real phone at H5 with VITE_LIFF_ID, VITE_API_BASE_URL and `?shop=<shopId>` in the LIFF URL.
- 2026-11-28 · T6 · PR (branch ai/t6-line-webhook) · `pnpm lint && pnpm typecheck && pnpm test` pass (83 tests, 16 new). Human: Edge Function `supabase/functions/line-webhook` (Deno, channel decrypt) is NOT tested locally; ASSUMES AES-256-GCM `iv||ciphertext` in the `*_encrypted` columns keyed by CHANNEL_TOKEN_ENC_KEY (T13 must write that way); set `line_channels.destination` to each bot userId; LIFF must send text `ยืนยันการจอง <bookingId>` via liff.sendMessages after booking (not yet in T5 page). Check on a real phone at H5/H6.
- 2026-11-28 · T7 · PR (branch ai/t7-reminder-job) · `pnpm lint && pnpm typecheck && pnpm test` pass. Human: Edge Function `supabase/functions/reminders` (Deno, push API) and `supabase/cron/reminders.sql` (pg_cron/pg_net/Vault) are NOT tested locally; apply migration `20261128010000_due_reminders.sql`, set secret REMINDER_CRON_SECRET, deploy with `--no-verify-jwt`, run the cron SQL once, then check a real reminder (buttons render, tapping gets a reply, no duplicate on the next 15-min run) at H6. Postback buttons only reply; ขอเลื่อน does not touch the booking.
- 2026-11-28 · T8 · PR (branch ai/t8-owner-admin) · `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @kms/liff build` pass (135 tests; 26 new API incl. access control, 12 new LIFF). Human: owner check uses `shops.owner_line_user_id` vs LIFF ID token on the server; Supabase `listSchedule`/`createPhoneCustomer`/`insertTimeOff` in `supabase/functions/api/supabase-db.ts` NOT tested locally. Open `/?page=admin&shop=<id>` in LIFF on a real phone as owner and as a non-owner (expect refusal) at H6; screenshot only covers today view (add/block forms need a real phone check). Owner bookings may be outside working hours (only overlap is blocked).
- 2026-11-28 · T10 · PR (branch ai/t10-landing-page) · `pnpm lint && pnpm typecheck && pnpm test` pass (143 tests, 8 new in apps/landing); Lighthouse mobile (v12.2.1, default mobile throttling, localhost) = 100/100/100/100. Human: LINE URLs and QR are PLACEHOLDERS (`@REPLACE_DEMO_OA`, `@REPLACE_SIGNUP_OA`); put real URLs in `apps/landing/site.config.json` after H3, run `pnpm --filter @kms/landing qr`, scan the QR on a real phone. 'ใครทำ' is a placeholder for H7; price text is from PROJECT-REPORT (199/เดือน), confirm.
