import { useEffect, useState } from "react";
import { ApiError, GENERIC_ERROR, type BookingApi, type MyBooking } from "./api.js";
import { dayLabel, timeLabel } from "./format.js";

type Props = { api: BookingApi; onClose?: () => void };

const STATUS_TEXT: Record<MyBooking["status"], string> = {
  pending: "รอยืนยัน",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิกแล้ว",
  completed: "เสร็จสิ้น",
  no_show: "ไม่มาตามนัด",
};

/** "นัดของฉัน": the signed-in customer's upcoming bookings (rich-menu target `?page=my-bookings`). */
export function MyBookingsPage({ api, onClose }: Props) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .listMyBookings()
      .then((b) => alive && setBookings(b))
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.cancelBooking(id);
      setBookings((list) => (list ?? []).filter((b) => b.id !== id));
      setNotice("ยกเลิกนัดเรียบร้อยแล้ว");
      setConfirming(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="top">
        <h1>คิวไม่ซ้อน</h1>
        <h2>นัดของฉัน</h2>
      </header>

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

      {bookings === null && !error && <p className="muted">กำลังโหลด...</p>}
      {bookings?.length === 0 && <p className="muted">ยังไม่มีนัดที่กำลังจะมาถึง</p>}
      <ul className="list">
        {bookings?.map((b) => (
          <li key={b.id} className="card" aria-label={`นัด ${b.serviceName}`}>
            <span className="title">{b.serviceName}</span>
            <span className="sub">
              {dayLabel(b.start.slice(0, 10))} · {timeLabel(b.start)} - {timeLabel(b.end)}
            </span>
            <span className="sub">
              ช่าง {b.staffName} · {STATUS_TEXT[b.status]}
            </span>
            {confirming === b.id ? (
              <span className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void cancel(b.id)}
                >
                  ยืนยันยกเลิกนัดนี้
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  ไม่ยกเลิก
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setNotice(null);
                  setConfirming(b.id);
                }}
              >
                ยกเลิกนัด
              </button>
            )}
          </li>
        ))}
      </ul>
      {onClose && (
        <button type="button" className="secondary" onClick={onClose}>
          ปิด
        </button>
      )}
    </main>
  );
}
