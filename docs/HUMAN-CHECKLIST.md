# เช็กลิสต์งานคน (คิวไม่ซ้อน)

สิ่งที่ **คุณต้องทำเอง** — AI ทำแทนไม่ได้ (บัญชี, secret, deploy, มือถือจริง, ตัดสินใจ). โค้ด T1–T18 เสร็จบน `main` แล้ว เรียงตามลำดับที่ควรทำ

## 1. ก่อนลงแรงต่อ (go / no-go)
- [ ] **H1** คุยร้านจริง 5 ร้าน (คำถามใน `docs/PROJECT-REPORT.md` §9) → บันทึก `docs/interviews.md` · ผ่านถ้า ≥3/5 เจอปัญหาคิวซ้อน/เบี้ยวนัดจริง
- [ ] **H2** เช็กโควตาข้อความ LINE OA ไทย + เงื่อนไข Messaging API/LIFF + ฟรีเทียร์ Supabase → `docs/platform-checks.md`
- [ ] **H4** เช็กสัญญางานประจำว่าทำธุรกิจเสริมได้

## 2. สมัครบัญชี + สร้างของจริง (H3)
- [ ] LINE Developers + OA "ร้านเดโม คิวไม่ซ้อน" (Messaging API channel + LIFF app)
- [ ] LINE **Login** channel (สำหรับ verify LIFF ID token)
- [ ] โปรเจกต์ Supabase
- [ ] โดเมน (~400 บาท/ปี) — ไม่บังคับช่วงแรก

## 3. ตั้ง Secrets (ใส่ใน Supabase secrets / GitHub repo secrets — อย่า commit ค่า)
| Secret | ใช้ทำอะไร | สร้างยังไง |
|---|---|---|
| `CHANNEL_TOKEN_ENC_KEY` | เข้ารหัส token ร้าน | `openssl rand -base64 32` |
| `LINE_LOGIN_CHANNEL_ID` | verify ID token ลูกค้า | จาก LINE Login channel |
| `VITE_LIFF_ID` / `LIFF_ID` | เปิดหน้าใน LINE | จาก LIFF app |
| `VITE_API_BASE_URL` | LIFF เรียก API | URL ของ Edge Function api |
| `ONBOARDING_INVITE_CODE` | **กันคนสร้างร้านมั่ว** (ถ้าไม่ตั้ง ใครก็สร้างได้) | ตั้งรหัสเอง |
| `REMINDER_CRON_SECRET` | ป้องกัน cron เตือนนัด | สุ่มเอง |
| `FOUNDER_LINE_CHANNEL_TOKEN` + `FOUNDER_LINE_USER_ID` | แจ้งเตือนเข้า LINE คุณ + สิทธิ์ mark paid | OA คุณ + LINE user id คุณ |
| `FOUNDER_PROMPTPAY_ID` + `BILLING_CRON_SECRET` | เก็บค่าสมาชิกเข้าบัญชีคุณ | พร้อมเพย์คุณ |

## 4. Deploy (Supabase)
- [ ] apply migrations ตามลำดับ: `core_tables` → `due_reminders` → `deposits` → `onboarding` → `referrals` (+ ของ monitoring/billing ถ้ามี) ในโฟลเดอร์ `supabase/migrations/`
- [ ] รัน cron SQL หนึ่งครั้ง: `supabase/cron/reminders.sql`, `deposits.sql`, billing/monthly-summary (ดูในโฟลเดอร์)
- [ ] `supabase functions deploy` : `api`, `line-webhook`, `reminders`, `health` (+ billing-reminders) — ใช้ `--no-verify-jwt` ตามที่ Log ระบุ
- [ ] ตั้ง **webhook URL** ของ OA ร้าน ชี้ไป function `line-webhook` ใน LINE Developers
- [ ] ตั้ง `line_channels.destination` = bot userId ของแต่ละร้าน (onboarding ทำให้อัตโนมัติ)

## 5. ทดสอบบนมือถือจริง
- [ ] **H5** จอง 2 เครื่องพร้อมกัน → เครื่องที่สอง fail สวย ๆ (กันคิวซ้อน)
- [ ] **H6** ครบลูป: จอง → ข้อความยืนยัน → เตือนนัด (ตั้งนัด +24ชม.5นาที) → กดปุ่มยืนยัน/ขอเลื่อน → เจ้าของลงคิวแทน → ปิดช่วงเวลา
- [ ] มัดจำ: สแกน QR ด้วยแอปธนาคารจริง ได้ยอดถูก + แนบสลิป + เจ้าของกดยืนยัน
- [ ] onboarding: จับเวลาตั้งร้านจริง < 30 นาที
- [ ] billing: สแกน QR 199/1,990 เงินเข้าบัญชีคุณ
- [ ] PDPA: ดาวน์โหลด CSV ใน LINE ได้ไหม (ถ้าไม่ได้ รอ T24 fallback) + ลองลบร้าน
- [ ] referral: โค้ดแนะนำเพื่อนใช้ได้ ได้ฟรี 1 เดือนทั้งคู่

## 6. กฎหมาย + เนื้อหา (H7/H8)
- [ ] กรอก `LEGAL_CONTACT` ใน `packages/core/src/legal.ts` แล้ว `pnpm --filter @kms/landing legal && pnpm format`
- [ ] ให้คนรีวิวข้อความ privacy/terms ภาษาไทย (H8) + รีวิวการจัดการ token/สิทธิ์ของ onboarding
- [ ] หน้า landing: ใส่ลิงก์ LINE OA + QR จริง (`apps/landing/site.config.json` → `pnpm --filter @kms/landing qr`), รูป+ชื่อ "ใครทำ", ถ่ายคลิป 60 วิ
- [ ] ยืนยันราคา 199/1,990 ตรงกับแผน

## 7. นำร่อง + เปิดขาย
- [ ] **H9** หาร้านนำร่อง 3–5 ร้าน (กลุ่ม FB + คลิป demo) ติดตั้งให้ช่วงสุดสัปดาห์
- [ ] **H10** เก็บผลจริง + ขออนุญาตรีวิว → รันลูกค้าจำลอง Haiku รอบใหม่ด้วยข้อคัดค้านจริง → เปิด "30 ร้านแรก"

---

## งานโค้ด — เสร็จหมดแล้ว ✅ (T1–T25 อยู่บน main)
T19 แก้บั๊กเวลา 10:00–10:30 · T20 push แจ้งลูกค้าตอนยืนยันมัดจำ · T21 หน้า "นัดของฉัน" · T22 ปุ่มขอเลื่อนย้ายคิวจริง · T23 บล็อกร้านเมื่อหมดอายุ · T24 fallback โหลด CSV ใน LINE · T25 ปิดลูปข้อความยืนยันการจอง — **ทั้งหมด merged แล้ว ไม่มีงานโค้ดค้าง**

> หมายเหตุ T24: ต้องตั้ง secret `EXPORT_TOKEN_KEY` ใน production ก่อน ไม่งั้นปุ่มโหลด CSV จะ fallback เป็นดาวน์โหลดในหน้าเว็บ ซึ่งใน LINE webview จะติด (เปิด/บันทึกไฟล์ไม่ได้) — ดูข้อ H5 "PDPA"
