import { useEffect, useRef, useState } from "react";
import { ApiError, GENERIC_ERROR, type BookingApi, type DepositInfo } from "./api.js";
import { priceLabel } from "./format.js";
import { qrImageUrl } from "./qr.js";
import { prepareSlip, SLIP_ERROR } from "./slip.js";

interface Props {
  api: BookingApi;
  bookingId: string;
  initial: DepositInfo;
}

const STATUS_TEXT: Record<string, string> = {
  pending: "รอชำระมัดจำ",
  submitted: "ส่งสลิปแล้ว รอร้านตรวจสอบ",
  paid: "ร้านยืนยันมัดจำแล้ว คิวของคุณยืนยันเรียบร้อย",
  rejected: "ร้านตรวจสลิปแล้วไม่ผ่าน กรุณาตรวจสอบและส่งสลิปใหม่",
  refunded: "คืนมัดจำแล้ว",
};
export const CANCELLED_TEXT =
  "คิวนี้ถูกยกเลิกเพราะไม่ได้ชำระมัดจำภายในเวลาที่ร้านกำหนด กรุณาจองใหม่";

/** Deposit step after booking: amount, PromptPay QR, slip upload, and the owner's decision. */
export function DepositPanel({ api, bookingId, initial }: Props) {
  const [deposit, setDeposit] = useState(initial);
  const [cancelled, setCancelled] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const payload = deposit.promptPayPayload;
  useEffect(() => {
    let alive = true;
    if (!payload) return;
    qrImageUrl(payload)
      .then((u) => alive && setQr(u))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [payload]);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.getDeposit(bookingId);
      setDeposit(r.deposit);
      setCancelled(r.bookingStatus === "cancelled");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      const slip = await prepareSlip(file);
      setDeposit(await api.uploadSlip(bookingId, slip));
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : SLIP_ERROR);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const canUpload = !cancelled && ["pending", "submitted", "rejected"].includes(deposit.status);

  return (
    <section className="deposit" aria-label="ชำระมัดจำ">
      <p className="deposit-amount">
        ยอดมัดจำ <strong>{priceLabel(deposit.amount)}</strong>
      </p>
      <p className="deposit-status" role="status">
        {cancelled ? CANCELLED_TEXT : (STATUS_TEXT[deposit.status] ?? "")}
      </p>

      {canUpload && deposit.status !== "paid" && (
        <>
          {payload ? (
            <>
              {qr && (
                <img
                  className="qr"
                  src={qr}
                  width={240}
                  height={240}
                  alt={`QR พร้อมเพย์ ยอด ${deposit.amount} บาท`}
                />
              )}
              <p className="muted">
                สแกน QR ด้วยแอปธนาคาร (หรือกดค้างที่ QR เพื่อบันทึกรูป) ยอดเงินถูกใส่ให้แล้ว
                จากนั้นส่งรูปสลิปด้านล่าง
              </p>
            </>
          ) : (
            <p className="alert warn">
              ร้านยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อร้านเพื่อชำระมัดจำ แล้วส่งสลิปที่นี่
            </p>
          )}
          {deposit.timeoutHours !== null && deposit.status !== "submitted" && (
            <p className="muted">
              กรุณาชำระภายใน {deposit.timeoutHours} ชั่วโมงหลังจอง มิฉะนั้นคิวจะถูกยกเลิกอัตโนมัติ
            </p>
          )}
          <label className="primary file-btn">
            {busy
              ? "กำลังส่ง..."
              : deposit.status === "submitted"
                ? "ส่งสลิปใหม่"
                : "ส่งสลิปการโอน"}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              aria-label="เลือกรูปสลิป"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </label>
        </>
      )}

      {sent && (
        <div role="status" className="alert ok">
          ส่งสลิปเรียบร้อยแล้ว รอร้านตรวจสอบ
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}
      <button type="button" className="link" disabled={busy} onClick={() => void refresh()}>
        ตรวจสอบสถานะ
      </button>
    </section>
  );
}
