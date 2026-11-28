import { useEffect, useState } from "react";
import { ApiError, GENERIC_ERROR } from "./api.js";
import type { AdminApi, AdminBilling, PlanId } from "./admin-api.js";
import { qrImageUrl } from "./qr.js";

const STATUS_CLASS: Record<AdminBilling["status"], string> = {
  trial: "alert ok",
  active: "alert ok",
  expired: "alert error",
};

const baht = (n: number) => n.toLocaleString("en-US");

/** Owner's billing screen: subscription status and the PromptPay QR for 199/month or 1,990/year. */
export function BillingPanel({ api, onBack }: { api: AdminApi; onBack: () => void }) {
  const [billing, setBilling] = useState<AdminBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanId>("monthly");
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getBilling()
      .then(setBilling)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : GENERIC_ERROR));
  }, [api]);

  const payload = billing?.plans[plan].promptPayPayload ?? null;
  useEffect(() => {
    let alive = true;
    setQr(null);
    if (!payload) return;
    qrImageUrl(payload)
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [payload]);

  if (error) {
    return (
      <section className="form">
        <div role="alert" className="alert error">
          {error}
        </div>
        <button type="button" className="link" onClick={onBack}>
          ย้อนกลับ
        </button>
      </section>
    );
  }
  if (!billing) return <p className="muted">กำลังโหลด...</p>;

  const price = billing.plans[plan].price;
  return (
    <section className="form" aria-label="ค่าบริการ">
      <div role="status" className={STATUS_CLASS[billing.status]}>
        {billing.label}
      </div>

      <div className="seg" role="group" aria-label="แพ็กเกจ">
        {(Object.keys(billing.plans) as PlanId[]).map((id) => (
          <button key={id} type="button" aria-pressed={plan === id} onClick={() => setPlan(id)}>
            {billing.plans[id].label} {baht(billing.plans[id].price)} บาท
          </button>
        ))}
      </div>

      {payload ? (
        <>
          <p>
            สแกนจ่ายพร้อมเพย์ <strong>{baht(price)} บาท</strong> ({billing.plans[plan].label})
          </p>
          {qr ? (
            <img className="qr" src={qr} alt={`QR พร้อมเพย์ ${baht(price)} บาท`} />
          ) : (
            <p className="muted">กำลังสร้าง QR...</p>
          )}
          <p className="muted">
            โอนแล้วส่งสลิปให้ทีมงานทาง LINE ระบบจะต่ออายุให้ (ชำระก่อนหมดอายุ วันที่เหลือจะไม่หาย)
          </p>
        </>
      ) : (
        <p className="muted">ยังไม่สามารถแสดง QR ได้ กรุณาติดต่อทีมงานเพื่อชำระค่าบริการ</p>
      )}

      <button type="button" className="link" onClick={onBack}>
        ย้อนกลับ
      </button>
    </section>
  );
}
