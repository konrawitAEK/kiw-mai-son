import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Service } from "@kms/core";
import { ApiError, GENERIC_ERROR } from "./api.js";
import type { AdminApi, AdminBooking, AdminSchedule, AdminSettings } from "./admin-api.js";
import { dayLabel, priceLabel, timeLabel, todayBangkok } from "./format.js";

type View = "today" | "week";
type Mode = "schedule" | "add" | "block" | "settings";

interface Props {
  api: AdminApi;
  now?: () => number;
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : GENERIC_ERROR);

export function AdminPage({ api, now = Date.now }: Props) {
  const [view, setView] = useState<View>("today");
  const [mode, setMode] = useState<Mode>("schedule");
  const [schedule, setSchedule] = useState<AdminSchedule | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slip, setSlip] = useState<{ id: string; src: string | null; empty: boolean } | null>(null);

  const today = todayBangkok(now());

  const load = useCallback(async () => {
    try {
      const s = await api.getSchedule(today, view === "today" ? 1 : 7);
      setSchedule(s);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 401)) setForbidden(e.message);
      else setError(msg(e));
    }
  }, [api, today, view]);

  useEffect(() => {
    setSchedule(null);
    void load();
  }, [load]);

  useEffect(() => {
    api
      .listServices()
      .then(setServices)
      .catch(() => {
        /* the add form shows an empty list; schedule errors are reported separately */
      });
  }, [api]);

  async function run(action: () => Promise<void>, done: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setMode("schedule");
      setConfirmCancel(null);
      await load();
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function viewSlip(id: string) {
    setError(null);
    try {
      const r = await api.getSlip(id);
      setSlip({
        id,
        src: r ? `data:${r.contentType};base64,${r.dataBase64}` : null,
        empty: r === null,
      });
    } catch (e) {
      setError(msg(e));
    }
  }

  if (forbidden) {
    return (
      <main className="page">
        <header className="top">
          <h1>คิวไม่ซ้อน</h1>
          <h2>หน้าเจ้าของร้าน</h2>
        </header>
        <div role="alert" className="alert error">
          {forbidden}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="top">
        <h1>คิวไม่ซ้อน · เจ้าของร้าน</h1>
        <h2>
          {mode === "add"
            ? "เพิ่มจองให้ลูกค้าโทร"
            : mode === "block"
              ? "บล็อกเวลา"
              : mode === "settings"
                ? "ตั้งค่ามัดจำ"
                : "ตารางคิว"}
        </h2>
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

      {mode === "schedule" && (
        <>
          <div className="seg" role="group" aria-label="มุมมอง">
            <button type="button" aria-pressed={view === "today"} onClick={() => setView("today")}>
              วันนี้
            </button>
            <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>
              สัปดาห์
            </button>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={() => setMode("add")}>
              เพิ่มจองให้ลูกค้าโทร
            </button>
            <button type="button" className="secondary" onClick={() => setMode("block")}>
              บล็อกเวลา
            </button>
            <button type="button" className="secondary" onClick={() => setMode("settings")}>
              ตั้งค่ามัดจำ
            </button>
          </div>

          {slip && (
            <section className="slip-view" aria-label="สลิปมัดจำ">
              {slip.src ? (
                <img className="slip-img" src={slip.src} alt="สลิปการโอนมัดจำ" />
              ) : (
                <p className="muted">ลูกค้ายังไม่ได้ส่งสลิป</p>
              )}
              <button type="button" className="link" onClick={() => setSlip(null)}>
                ปิดสลิป
              </button>
            </section>
          )}

          {schedule === null && !error && <p className="muted">กำลังโหลด...</p>}
          {schedule && (
            <ScheduleView
              schedule={schedule}
              showDay={view === "week"}
              confirmCancel={confirmCancel}
              busy={busy}
              onAskCancel={setConfirmCancel}
              onCancel={(id) => void run(() => api.cancelBooking(id), "ยกเลิกคิวเรียบร้อยแล้ว")}
              onViewSlip={(id) => void viewSlip(id)}
              onDecide={(id, d) => {
                setSlip(null);
                void run(
                  () => api.decideDeposit(id, d),
                  d === "confirm" ? "ยืนยันมัดจำแล้ว คิวนี้ยืนยันเรียบร้อย" : "ปฏิเสธสลิปแล้ว",
                );
              }}
            />
          )}
        </>
      )}

      {mode === "add" && schedule && (
        <AddForm
          key={services.length}
          services={services}
          staff={schedule.staff}
          today={today}
          busy={busy}
          onBack={() => setMode("schedule")}
          onSubmit={(v) =>
            run(
              () =>
                api.addBooking({
                  serviceId: v.serviceId,
                  staffId: v.staffId,
                  start: `${v.date}T${v.time}:00+07:00`,
                  customerName: v.name,
                  phone: v.phone,
                }),
              "เพิ่มคิวเรียบร้อยแล้ว",
            )
          }
        />
      )}

      {mode === "settings" && (
        <SettingsForm
          api={api}
          busy={busy}
          onBack={() => setMode("schedule")}
          onSave={(v) => run(() => api.saveSettings(v), "บันทึกการตั้งค่าแล้ว")}
        />
      )}

      {mode === "block" && schedule && (
        <BlockForm
          staff={schedule.staff}
          today={today}
          busy={busy}
          onBack={() => setMode("schedule")}
          onSubmit={(v) =>
            run(
              () =>
                api.blockTime({
                  staffId: v.staffId || null,
                  start: `${v.date}T${v.from}:00+07:00`,
                  end: `${v.date}T${v.to}:00+07:00`,
                  reason: v.reason,
                }),
              "บล็อกเวลาเรียบร้อยแล้ว",
            )
          }
        />
      )}
    </main>
  );
}

function ScheduleView(props: {
  schedule: AdminSchedule;
  showDay: boolean;
  confirmCancel: string | null;
  busy: boolean;
  onAskCancel: (id: string | null) => void;
  onCancel: (id: string) => void;
  onViewSlip: (id: string) => void;
  onDecide: (id: string, decision: "confirm" | "reject") => void;
}) {
  const { schedule, showDay } = props;
  const when = (iso: string) => (showDay ? `${dayLabel(iso.slice(0, 10))} ` : "");
  const groups: { id: string | null; name: string }[] = [
    ...schedule.staff.map((s) => ({ id: s.id, name: s.name })),
    ...(schedule.timeOff.some((t) => t.staffId === null) ? [{ id: null, name: "ทั้งร้าน" }] : []),
  ];
  if (groups.length === 0) return <p className="muted">ยังไม่มีช่างในร้าน</p>;

  return (
    <div>
      {groups.map((g) => {
        const bookings = schedule.bookings.filter((b) => b.staffId === g.id);
        const off = schedule.timeOff.filter((t) => t.staffId === g.id);
        return (
          <section key={g.id ?? "shop"} className="staff-block" aria-label={g.name}>
            <h3>{g.name}</h3>
            {bookings.length === 0 && off.length === 0 && <p className="muted">ไม่มีคิว</p>}
            <ul className="list">
              {off.map((t) => (
                <li key={t.id} className="slot off">
                  <span className="time">
                    {when(t.start)}
                    {timeLabel(t.start)}-{timeLabel(t.end)}
                  </span>
                  <span className="who">ปิดรับคิว{t.reason ? ` · ${t.reason}` : ""}</span>
                </li>
              ))}
              {bookings.map((b) => (
                <BookingRow
                  key={b.id}
                  b={b}
                  prefix={when(b.start)}
                  asking={props.confirmCancel === b.id}
                  busy={props.busy}
                  onAsk={props.onAskCancel}
                  onCancel={props.onCancel}
                  onViewSlip={props.onViewSlip}
                  onDecide={props.onDecide}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const DEPOSIT_LABEL: Record<string, string> = {
  pending: "รอโอนมัดจำ",
  submitted: "รอตรวจสลิป",
  paid: "ชำระแล้ว",
  rejected: "สลิปไม่ผ่าน",
  refunded: "คืนมัดจำแล้ว",
};

function BookingRow(props: {
  b: AdminBooking;
  prefix: string;
  asking: boolean;
  busy: boolean;
  onAsk: (id: string | null) => void;
  onCancel: (id: string) => void;
  onViewSlip: (id: string) => void;
  onDecide: (id: string, decision: "confirm" | "reject") => void;
}) {
  const { b } = props;
  const dep = b.depositStatus ?? "none";
  const openDeposit = b.status === "pending" && ["pending", "submitted", "rejected"].includes(dep);
  return (
    <li className="slot">
      <span className="time">
        {props.prefix}
        {timeLabel(b.start)}-{timeLabel(b.end)}
      </span>
      <span className="who">
        {b.customerName} · {b.serviceName}
        {b.channel === "owner" ? " (โทรจอง)" : ""}
        {b.customerPhone && (
          <>
            {" "}
            <a href={`tel:${b.customerPhone}`}>{b.customerPhone}</a>
          </>
        )}
      </span>
      {dep !== "none" && (
        <span className="who">
          <span
            className={`badge ${dep === "paid" ? "paid" : dep === "rejected" ? "rejected" : ""}`}
          >
            {DEPOSIT_LABEL[dep] ?? dep}
          </span>{" "}
          มัดจำ {priceLabel(b.depositAmount ?? 0)}
        </span>
      )}
      {openDeposit && (
        <span className="row-actions">
          {dep === "submitted" && (
            <button type="button" className="link" onClick={() => props.onViewSlip(b.id)}>
              ดูสลิป
            </button>
          )}
          <button
            type="button"
            className="primary-sm"
            disabled={props.busy}
            aria-label={`ยืนยันมัดจำ ${b.customerName} ${timeLabel(b.start)}`}
            onClick={() => props.onDecide(b.id, "confirm")}
          >
            ยืนยันมัดจำ
          </button>
          {dep !== "rejected" && (
            <button
              type="button"
              className="link"
              disabled={props.busy}
              aria-label={`ปฏิเสธสลิป ${b.customerName} ${timeLabel(b.start)}`}
              onClick={() => props.onDecide(b.id, "reject")}
            >
              ปฏิเสธสลิป
            </button>
          )}
        </span>
      )}
      {props.asking ? (
        <span className="row-actions">
          <button
            type="button"
            className="danger"
            disabled={props.busy}
            onClick={() => props.onCancel(b.id)}
          >
            ยืนยันยกเลิก
          </button>
          <button type="button" className="link" onClick={() => props.onAsk(null)}>
            ไม่ยกเลิก
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="link"
          aria-label={`ยกเลิกคิว ${b.customerName} ${timeLabel(b.start)}`}
          onClick={() => props.onAsk(b.id)}
        >
          ยกเลิกคิว
        </button>
      )}
    </li>
  );
}

function AddForm(props: {
  services: Service[];
  staff: { id: string; name: string }[];
  today: string;
  busy: boolean;
  onBack: () => void;
  onSubmit: (v: {
    name: string;
    phone: string;
    serviceId: string;
    staffId: string;
    date: string;
    time: string;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState(props.services[0]?.id ?? "");
  const [staffId, setStaffId] = useState(props.staff[0]?.id ?? "");
  const [date, setDate] = useState(props.today);
  const [time, setTime] = useState("10:00");

  function submit(e: FormEvent) {
    e.preventDefault();
    void props.onSubmit({ name: name.trim(), phone: phone.trim(), serviceId, staffId, date, time });
  }
  const ok = name.trim() !== "" && serviceId !== "" && staffId !== "" && date !== "" && time !== "";

  return (
    <form onSubmit={submit} className="form">
      <label>
        ชื่อลูกค้า
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      <label>
        เบอร์โทร
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="08x-xxx-xxxx"
        />
      </label>
      <label>
        บริการ
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {props.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMin} นาที)
            </option>
          ))}
        </select>
      </label>
      <label>
        ช่าง
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          {props.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="two">
        <label>
          วันที่
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          เวลา
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
      </div>
      <button type="submit" className="primary" disabled={props.busy || !ok}>
        {props.busy ? "กำลังบันทึก..." : "บันทึกคิว"}
      </button>
      <button type="button" className="link" onClick={props.onBack}>
        ย้อนกลับ
      </button>
    </form>
  );
}

function BlockForm(props: {
  staff: { id: string; name: string }[];
  today: string;
  busy: boolean;
  onBack: () => void;
  onSubmit: (v: {
    staffId: string;
    date: string;
    from: string;
    to: string;
    reason: string;
  }) => Promise<boolean>;
}) {
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(props.today);
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("13:00");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (to <= from) {
      setLocalError("เวลาสิ้นสุดต้องหลังเวลาเริ่ม");
      return;
    }
    setLocalError(null);
    void props.onSubmit({ staffId, date, from, to, reason: reason.trim() });
  }

  return (
    <form onSubmit={submit} className="form">
      {localError && (
        <div role="alert" className="alert error">
          {localError}
        </div>
      )}
      <label>
        ช่าง
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">ทั้งร้าน</option>
          {props.staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        วันที่
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <div className="two">
        <label>
          ตั้งแต่
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          ถึง
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} required />
        </label>
      </div>
      <label>
        เหตุผล (ไม่บังคับ)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} />
      </label>
      <button type="submit" className="primary" disabled={props.busy}>
        {props.busy ? "กำลังบันทึก..." : "บล็อกเวลา"}
      </button>
      <button type="button" className="link" onClick={props.onBack}>
        ย้อนกลับ
      </button>
    </form>
  );
}

function SettingsForm(props: {
  api: AdminApi;
  busy: boolean;
  onBack: () => void;
  onSave: (v: AdminSettings) => Promise<boolean>;
}) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [promptPayId, setPromptPayId] = useState("");
  const [autoCancel, setAutoCancel] = useState(false);
  const [hours, setHours] = useState("24");

  useEffect(() => {
    props.api
      .getSettings()
      .then((s) => {
        setPromptPayId(s.promptPayId ?? "");
        setAutoCancel(s.depositTimeoutHours !== null);
        if (s.depositTimeoutHours !== null) setHours(String(s.depositTimeoutHours));
        setLoaded(true);
      })
      .catch((e: unknown) => setLoadError(msg(e)));
  }, [props.api]);

  const hoursNum = Number(hours);
  const hoursOk = !autoCancel || (Number.isInteger(hoursNum) && hoursNum >= 1 && hoursNum <= 720);

  function submit(e: FormEvent) {
    e.preventDefault();
    void props.onSave({
      promptPayId: promptPayId.trim() === "" ? null : promptPayId.trim(),
      depositTimeoutHours: autoCancel ? hoursNum : null,
    });
  }

  if (loadError) {
    return (
      <div role="alert" className="alert error">
        {loadError}
      </div>
    );
  }
  if (!loaded) return <p className="muted">กำลังโหลด...</p>;

  return (
    <form onSubmit={submit} className="form">
      <label>
        พร้อมเพย์ของร้าน (เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน/ผู้เสียภาษี 13 หลัก)
        <input
          inputMode="numeric"
          value={promptPayId}
          onChange={(e) => setPromptPayId(e.target.value)}
          placeholder="08x-xxx-xxxx"
          autoComplete="off"
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={autoCancel}
          onChange={(e) => setAutoCancel(e.target.checked)}
        />
        ยกเลิกคิวอัตโนมัติถ้าไม่โอนมัดจำ
      </label>
      {autoCancel && (
        <label>
          ภายในกี่ชั่วโมงหลังจอง (1-720)
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
      )}
      <p className="muted">
        ปิดไว้เป็นค่าเริ่มต้น คิวที่ลูกค้าส่งสลิปแล้ว (รอร้านตรวจ) จะไม่ถูกยกเลิกอัตโนมัติ
      </p>
      <button type="submit" className="primary" disabled={props.busy || !hoursOk}>
        {props.busy ? "กำลังบันทึก..." : "บันทึก"}
      </button>
      <button type="button" className="link" onClick={props.onBack}>
        ย้อนกลับ
      </button>
    </form>
  );
}
