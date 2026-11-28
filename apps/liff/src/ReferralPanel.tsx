import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, GENERIC_ERROR } from "./api.js";
import type { AdminApi, AdminReferral } from "./admin-api.js";

/** Owner's referral screen: own code to share, and a field to use another shop's code. Both shops get +1 free month. */
export function ReferralPanel({ api, onBack }: { api: AdminApi; onBack: () => void }) {
  const [info, setInfo] = useState<AdminReferral | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .getReferral()
      .then(setInfo)
      .catch((e: unknown) => setLoadError(e instanceof ApiError ? e.message : GENERIC_ERROR));
  }, [api]);

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.shareText);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard blocked: the text is visible to select by hand
    }
  }

  async function redeem(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await api.redeemReferral(code.trim());
      setInfo(r.referral);
      setNotice(r.message);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="form">
        <div role="alert" className="alert error">
          {loadError}
        </div>
        <button type="button" className="link" onClick={onBack}>
          ย้อนกลับ
        </button>
      </section>
    );
  }
  if (!info) return <p className="muted">กำลังโหลด...</p>;

  return (
    <section className="form" aria-label="แนะนำเพื่อน">
      <p>
        ชวนร้านอื่นมาใช้ ถ้าเขาใส่โค้ดของร้านคุณ{" "}
        <strong>ทั้งสองร้านได้ใช้ฟรีเพิ่ม {info.bonusMonths} เดือน</strong>
      </p>
      <p>
        โค้ดของร้านคุณ <strong aria-label="โค้ดแนะนำ">{info.code}</strong>
      </p>
      <p className="muted">ร้านที่ใช้โค้ดของคุณแล้ว {info.referredCount} ร้าน</p>
      <pre className="muted" style={{ whiteSpace: "pre-wrap" }}>
        {info.shareText}
      </pre>
      <button type="button" className="secondary" onClick={copy}>
        {copied ? "คัดลอกแล้ว" : "คัดลอกข้อความ"}
      </button>

      {notice && (
        <div role="status" className="alert ok">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}

      {info.redeemed ? (
        <p className="muted">ร้านนี้ใช้โค้ดแนะนำไปแล้ว</p>
      ) : (
        <form onSubmit={redeem}>
          <label>
            มีโค้ดจากร้านอื่น? (ใช้ได้ภายใน 30 วันแรกหลังสมัคร)
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={12}
              placeholder="เช่น ABCD2345"
            />
          </label>
          <button type="submit" className="primary" disabled={busy || code.trim() === ""}>
            {busy ? "กำลังใช้โค้ด..." : "ใช้โค้ด"}
          </button>
        </form>
      )}

      <button type="button" className="link" onClick={onBack}>
        ย้อนกลับ
      </button>
    </section>
  );
}
