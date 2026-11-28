import { useCallback, useEffect, useMemo, useState } from "react";
import type { Service, Slot, Staff } from "@kms/core";
import { ApiError, GENERIC_ERROR, type BookingApi, type BookingResult } from "./api.js";
import { DepositPanel } from "./DepositPanel.js";
import { dayLabel, priceLabel, timeLabel, upcomingDays } from "./format.js";

type Step = "service" | "staff" | "date" | "time" | "confirm" | "done";
const STEPS: Step[] = ["service", "staff", "date", "time", "confirm"];
const TITLES: Record<Step, string> = {
  service: "เลือกบริการ",
  staff: "เลือกช่างผู้ให้บริการ",
  date: "เลือกวันที่",
  time: "เลือกเวลา",
  confirm: "ตรวจสอบและยืนยัน",
  done: "จองสำเร็จ",
};
const DAYS_AHEAD = 14;
const ANY = "any";

interface Props {
  api: BookingApi;
  now?: () => number;
  onClose?: () => void;
}

export function BookingPage({ api, now = Date.now, onClose }: Props) {
  const [step, setStep] = useState<Step>("service");
  const [services, setServices] = useState<Service[] | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [staffChoice, setStaffChoice] = useState<string>(ANY);
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);

  const days = useMemo(() => upcomingDays(now(), DAYS_AHEAD), [now]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.listServices(), api.listStaff()])
      .then(([s, st]) => {
        if (!alive) return;
        setServices(s);
        setStaff(st);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const loadSlots = useCallback(
    async (svc: Service, d: string, staffId: string) => {
      setSlots(null);
      setError(null);
      try {
        setSlots(await api.listSlots(svc.id, d, staffId === ANY ? null : staffId));
      } catch (e) {
        setSlots([]);
        setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
      }
    },
    [api],
  );

  function go(next: Step) {
    setError(null);
    setNotice(null);
    setStep(next);
  }

  function back() {
    const i = STEPS.indexOf(step);
    if (i > 0) go(STEPS[i - 1] as Step);
  }

  function pickService(s: Service) {
    setService(s);
    setSlot(null);
    go(staff.length > 0 ? "staff" : "date");
  }
  function pickStaff(id: string) {
    setStaffChoice(id);
    setSlot(null);
    go("date");
  }
  function pickDate(d: string) {
    setDate(d);
    setSlot(null);
    go("time");
    if (service) void loadSlots(service, d, staffChoice);
  }
  function pickSlot(s: Slot) {
    setSlot(s);
    go("confirm");
  }

  async function confirm() {
    if (!service || !slot || busy) return;
    setBusy(true);
    setError(null);
    try {
      const booking = await api.createBooking({
        serviceId: service.id,
        start: slot.start,
        staffId: staffChoice === ANY ? null : staffChoice,
      });
      setResult(booking);
      setStep("done");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone else took the slot: go back to the time list with fresh slots.
        setSlot(null);
        setStep("time");
        setNotice(e.message);
        if (date) void loadSlots(service, date, staffChoice);
      } else {
        setError(e instanceof ApiError ? e.message : GENERIC_ERROR);
      }
    } finally {
      setBusy(false);
    }
  }

  const staffName =
    staffChoice === ANY
      ? "ช่างคนไหนก็ได้"
      : (staff.find((s) => s.id === staffChoice)?.name ?? "ช่าง");
  const bookedStaffName = result
    ? (staff.find((s) => s.id === result.staffId)?.name ?? null)
    : null;
  const stepIndex = STEPS.indexOf(step);

  return (
    <main className="page">
      <header className="top">
        <h1>คิวไม่ซ้อน</h1>
        {step !== "done" && (
          <p className="progress" aria-label={`ขั้นตอนที่ ${stepIndex + 1} จาก ${STEPS.length}`}>
            ขั้นตอนที่ {stepIndex + 1}/{STEPS.length}
          </p>
        )}
        <h2>{TITLES[step]}</h2>
      </header>

      {notice && (
        <div role="alert" className="alert warn">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="alert error">
          {error}
        </div>
      )}

      {step === "service" && (
        <section>
          {services === null && !error && <p className="muted">กำลังโหลด...</p>}
          {services?.length === 0 && <p className="muted">ร้านยังไม่มีบริการให้จอง</p>}
          <ul className="list">
            {services?.map((s) => (
              <li key={s.id}>
                <button type="button" className="card" onClick={() => pickService(s)}>
                  <span className="title">{s.name}</span>
                  <span className="sub">
                    {s.durationMin} นาที · {priceLabel(s.price)}
                    {s.deposit > 0 ? ` · มัดจำ ${priceLabel(s.deposit)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "staff" && (
        <section>
          <ul className="list">
            <li>
              <button type="button" className="card" onClick={() => pickStaff(ANY)}>
                <span className="title">ช่างคนไหนก็ได้</span>
                <span className="sub">เลือกให้อัตโนมัติ ได้คิวเร็วที่สุด</span>
              </button>
            </li>
            {staff.map((s) => (
              <li key={s.id}>
                <button type="button" className="card" onClick={() => pickStaff(s.id)}>
                  <span className="title">{s.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "date" && (
        <section>
          <ul className="grid days">
            {days.map((d) => (
              <li key={d.date}>
                <button
                  type="button"
                  className="chip day"
                  aria-label={dayLabel(d.date)}
                  onClick={() => pickDate(d.date)}
                >
                  <span>{d.weekday}</span>
                  <strong>{d.dayOfMonth}</strong>
                  <span>{d.month}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "time" && (
        <section>
          {date && <p className="muted">{dayLabel(date)}</p>}
          {slots === null && <p className="muted">กำลังโหลดเวลาว่าง...</p>}
          {slots?.length === 0 && !error && (
            <p className="muted">วันนี้ไม่มีเวลาว่าง กรุณาเลือกวันอื่น</p>
          )}
          <ul className="grid times">
            {slots?.map((s) => (
              <li key={s.start}>
                <button type="button" className="chip" onClick={() => pickSlot(s)}>
                  {timeLabel(s.start)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "confirm" && service && slot && date && (
        <section>
          <dl className="summary">
            <dt>บริการ</dt>
            <dd>{service.name}</dd>
            <dt>ช่าง</dt>
            <dd>{staffName}</dd>
            <dt>วันที่</dt>
            <dd>{dayLabel(date)}</dd>
            <dt>เวลา</dt>
            <dd>
              {timeLabel(slot.start)} - {timeLabel(slot.end)} น.
            </dd>
            <dt>ราคา</dt>
            <dd>{priceLabel(service.price)}</dd>
            {service.deposit > 0 && (
              <>
                <dt>มัดจำ</dt>
                <dd>{priceLabel(service.deposit)} (ชำระหลังกดยืนยัน)</dd>
              </>
            )}
          </dl>
          <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
            {busy ? "กำลังจอง..." : "ยืนยันการจอง"}
          </button>
        </section>
      )}

      {step === "done" && result && service && (
        <section>
          <p className="success">
            {result.deposit ? "รับจองแล้ว กรุณาชำระมัดจำเพื่อยืนยันคิว" : "จองคิวเรียบร้อยแล้ว"}
          </p>
          <dl className="summary">
            <dt>บริการ</dt>
            <dd>{service.name}</dd>
            {bookedStaffName && (
              <>
                <dt>ช่าง</dt>
                <dd>{bookedStaffName}</dd>
              </>
            )}
            <dt>วันที่</dt>
            <dd>{dayLabel(result.start.slice(0, 10))}</dd>
            <dt>เวลา</dt>
            <dd>
              {timeLabel(result.start)} - {timeLabel(result.end)} น.
            </dd>
          </dl>
          {result.deposit && (
            <DepositPanel api={api} bookingId={result.id} initial={result.deposit} />
          )}
          {onClose && (
            <button type="button" className="primary" onClick={onClose}>
              ปิด
            </button>
          )}
        </section>
      )}

      {stepIndex > 0 && step !== "done" && (
        <button type="button" className="link" onClick={back}>
          ย้อนกลับ
        </button>
      )}
    </main>
  );
}
