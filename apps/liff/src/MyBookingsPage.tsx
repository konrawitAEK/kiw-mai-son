import { useEffect, useMemo, useState } from "react";
import type { Slot } from "@kms/core";
import { ApiError, GENERIC_ERROR, type BookingApi, type MyBooking } from "./api.js";
import { dayLabel, timeLabel, upcomingDays } from "./format.js";

type Props = {
  api: BookingApi;
  onClose?: () => void;
  /** T22: open the reschedule picker for this booking straight away (reminder "ขอเลื่อน" link). */
  initialRescheduleId?: string;
  now?: () => number;
};

const DAYS_AHEAD = 14;

const STATUS_TEXT: Record<MyBooking["status"], string> = {
  pending: "รอยืนยัน",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิกแล้ว",
  completed: "เสร็จสิ้น",
  no_show: "ไม่มาตามนัด",
};

/** "นัดของฉัน": the signed-in customer's upcoming bookings (rich-menu target `?page=my-bookings`). */
export function MyBookingsPage({ api, onClose, initialRescheduleId, now = Date.now }: Props) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // T22: reschedule picker state (booking being moved, chosen day, that day's free slots).
  const [moving, setMoving] = useState<string | null>(initialRescheduleId ?? null);
  const [day, setDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const days = useMemo(() => upcomingDays(now(), DAYS_AHEAD), [now]);
  const movingBooking = bookings?.find((b) => b.id === moving) ?? null;

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

  async function loadSlots(b: MyBooking, d: string) {
    setDay(d);
    setSlots(null);
    try {
      setSlots(await api.listSlots(b.serviceId, d, null));
    } catch (e) {
      setSlots([]);
      setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
    }
  }

  function closeMove() {
    setMoving(null);
    setDay(null);
    setSlots(null);
  }

  async function moveTo(b: MyBooking, slot: Slot) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.rescheduleBooking(b.id, { start: slot.start });
      closeMove();
      setNotice("เลื่อนนัดเรียบร้อยแล้ว");
      setBookings(await api.listMyBookings());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone took the slot first: keep the picker open with fresh slots.
        setNotice(e.message);
        if (day) await loadSlots(b, day);
      } else {
        setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
      }
    } finally {
      setBusy(false);
    }
  }

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
        <div role="status" className={notice.includes("เรียบร้อย") ? "alert ok" : "alert warn"}>
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}

      {bookings === null && !error && <p className="muted">กำลังโหลด...</p>}
      {moving && bookings && !movingBooking && (
        <div role="alert" className="alert error">
          ไม่พบนัดที่ต้องการเลื่อน (อาจถูกยกเลิกหรือผ่านไปแล้ว)
        </div>
      )}
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
            {moving === b.id && (
              <section aria-label="เลือกเวลาใหม่">
                <span className="sub">เลือกวันและเวลาใหม่</span>
                <span className="actions">
                  {days.map((d) => (
                    <button
                      key={d.date}
                      type="button"
                      className="secondary"
                      aria-pressed={day === d.date}
                      disabled={busy}
                      onClick={() => void loadSlots(b, d.date)}
                    >
                      {d.weekday} {d.dayOfMonth} {d.month}
                    </button>
                  ))}
                </span>
                {day && slots === null && <p className="muted">กำลังโหลด...</p>}
                {slots?.length === 0 && (
                  <p className="muted">วันนี้ไม่มีเวลาว่าง กรุณาเลือกวันอื่น</p>
                )}
                <span className="actions">
                  {slots?.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void moveTo(b, s)}
                    >
                      {timeLabel(s.start)}
                    </button>
                  ))}
                </span>
                <button type="button" className="secondary" disabled={busy} onClick={closeMove}>
                  ไม่เลื่อนแล้ว
                </button>
              </section>
            )}
            {moving !== b.id && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setNotice(null);
                  setError(null);
                  setConfirming(null);
                  setMoving(b.id);
                }}
              >
                ขอเลื่อน
              </button>
            )}
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
