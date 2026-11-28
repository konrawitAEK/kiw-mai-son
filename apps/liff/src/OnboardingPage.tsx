import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Service, Staff } from "@kms/core";
import { ApiError, GENERIC_ERROR } from "./api.js";
import { dayLabel, priceLabel, timeLabel, upcomingDays } from "./format.js";
import type { OnboardingApi, SetupStatus, ShopSetupApi } from "./onboarding-api.js";

interface Props {
  api: OnboardingApi;
  /** From `?shop=`; empty when the owner has not created the shop yet. */
  initialShopId?: string;
  now?: () => number;
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : GENERIC_ERROR);
const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function readFile(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsArrayBuffer(file);
  });
}

export function OnboardingPage({ api, initialShopId = "", now = Date.now }: Props) {
  const [shopId, setShopId] = useState(initialShopId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createShop(name: string, inviteCode: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.createShop({ name, inviteCode });
      setShopId(r.shopId);
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <header className="top">
        <h1>คิวไม่ซ้อน · ตั้งค่าร้าน</h1>
        <h2>เริ่มใช้งานร้านของคุณ</h2>
      </header>
      {!shopId ? (
        <CreateShop busy={busy} error={error} onSubmit={createShop} />
      ) : (
        <Setup key={shopId} shopId={shopId} api={api.forShop(shopId)} now={now} />
      )}
    </main>
  );
}

function CreateShop(props: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string, inviteCode: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(name.trim(), code.trim());
      }}
    >
      <p className="muted">ขั้นแรก ตั้งชื่อร้าน แล้วเราจะพาตั้งค่าทีละขั้นตอน</p>
      {props.error && (
        <div role="alert" className="alert error">
          {props.error}
        </div>
      )}
      <label>
        ชื่อร้าน
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        รหัสเชิญ (ถ้าได้รับจากทีมงาน)
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
      </label>
      <button type="submit" className="primary" disabled={props.busy || name.trim() === ""}>
        สร้างร้าน
      </button>
    </form>
  );
}

function Setup({ shopId, api, now }: { shopId: string; api: ShopSetupApi; now: () => number }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testDone, setTestDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, sv, st] = await Promise.all([api.getSetup(), api.listServices(), api.listStaff()]);
      setStatus(s);
      setServices(sv);
      setStaff(st);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setForbidden(e.message);
      else setError(msg(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<string | void>, done: string): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const extra = await action();
      setNotice(extra || done);
      await load();
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testBooking() {
    await run(async () => {
      const service = services[0];
      if (!service) throw new ApiError(0, "กรุณาเพิ่มบริการก่อน");
      const t = now();
      for (const day of upcomingDays(t, 7)) {
        const slots = await api.listSlots(service.id, day.date, null);
        const slot = slots.find((s) => Date.parse(s.start) > t && s.staffIds[0]);
        if (slot && slot.staffIds[0]) {
          await api.addTestBooking({
            serviceId: service.id,
            staffId: slot.staffIds[0],
            start: slot.start,
          });
          setTestDone(true);
          return `จองทดสอบสำเร็จ: ${service.name} ${dayLabel(day.date)} ${timeLabel(slot.start)} น. (ดูและยกเลิกได้ที่หน้าเจ้าของร้าน)`;
        }
      }
      throw new ApiError(0, "ไม่พบเวลาว่างใน 7 วันข้างหน้า กรุณาตรวจสอบเวลาทำการของช่าง");
    }, "");
  }

  if (forbidden) {
    return (
      <div role="alert" className="alert error">
        {forbidden}
      </div>
    );
  }
  if (!status) {
    return error ? (
      <div role="alert" className="alert error">
        {error}
      </div>
    ) : (
      <p className="muted">กำลังโหลด...</p>
    );
  }

  const withHours = new Set(status.staffWithHours);
  const checklist: [string, boolean][] = [
    ["เชื่อมต่อ LINE OA", status.channel.connected],
    ["เพิ่มบริการ", services.length > 0],
    ["เพิ่มช่าง", staff.length > 0],
    ["ตั้งเวลาทำการ", staff.length > 0 && staff.every((s) => withHours.has(s.id))],
    ["ตั้งค่าริชเมนู", status.richMenuDone],
    ["ลองจองทดสอบ", testDone],
  ];
  const done = checklist.filter(([, ok]) => ok).length;

  return (
    <>
      <p className="progress">
        ร้าน {status.shop.name} · เสร็จแล้ว {done}/{checklist.length} ขั้นตอน
      </p>
      <ul aria-label="ความคืบหน้า" className="list">
        {checklist.map(([label, ok]) => (
          <li key={label} className="sub">
            {ok ? "✅" : "⬜"} {label}
          </li>
        ))}
      </ul>

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

      <ChannelSection
        status={status}
        busy={busy}
        onSave={(v) =>
          run(async () => {
            const r = await api.saveChannel(v);
            return `เชื่อมต่อสำเร็จ: ${r.botName || "LINE OA"}`;
          }, "")
        }
      />
      <ServicesSection
        services={services}
        busy={busy}
        onAdd={(v) => run(() => api.addService(v).then(() => {}), "เพิ่มบริการแล้ว")}
      />
      <StaffSection
        staff={staff}
        withHours={withHours}
        busy={busy}
        onAdd={(name) => run(() => api.addStaff(name).then(() => {}), "เพิ่มช่างแล้ว")}
        onHours={(id, windows) => run(() => api.setHours(id, windows), "บันทึกเวลาทำการแล้ว")}
      />
      <RichMenuSection
        done={status.richMenuDone}
        connected={status.channel.connected}
        busy={busy}
        onUpload={(file) =>
          run(async () => {
            const bytes = await readFile(file);
            await api.uploadRichMenu(toBase64(bytes));
          }, "ตั้งค่าริชเมนูเรียบร้อยแล้ว")
        }
      />
      <section aria-labelledby="s-test" className="section">
        <h3 id="s-test">6. ลองจองทดสอบ</h3>
        <p className="muted">
          ระบบจะจองคิวแรกที่ว่างให้ชื่อ “ทดสอบระบบ” แล้วคุณลองเปิดเมนูของร้านใน LINE
          จองจากมือถืออีกเครื่องได้เลย
        </p>
        <button
          type="button"
          className="primary"
          disabled={busy || services.length === 0 || staff.length === 0}
          onClick={() => void testBooking()}
        >
          ทดสอบจองคิว
        </button>
        <p>
          <a className="link" href={`?page=admin&shop=${encodeURIComponent(shopId)}`}>
            ไปหน้าเจ้าของร้าน (ดู/ยกเลิกคิว)
          </a>
        </p>
      </section>
    </>
  );
}

function ChannelSection(props: {
  status: SetupStatus;
  busy: boolean;
  onSave: (v: {
    channelId: string;
    channelSecret: string;
    accessToken: string;
  }) => Promise<boolean>;
}) {
  const [channelId, setChannelId] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const ch = props.status.channel;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await props.onSave({
      channelId: channelId.trim(),
      channelSecret: channelSecret.trim(),
      accessToken: accessToken.trim(),
    });
    // Secrets never stay in the page after a successful save.
    if (ok) {
      setChannelSecret("");
      setAccessToken("");
    }
  }

  return (
    <section aria-labelledby="s-channel" className="section">
      <h3 id="s-channel">1. เชื่อมต่อ LINE OA</h3>
      {ch.connected && (
        <p className="muted">
          เชื่อมต่อแล้ว (Channel ID {ch.channelId}) วางใหม่ได้ถ้าต้องการเปลี่ยน
        </p>
      )}
      <p className="muted">
        คัดลอกจาก LINE Developers → ช่อง Messaging API ของร้าน ระบบตรวจกับ LINE และเก็บแบบเข้ารหัส
      </p>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          Channel ID
          <input
            value={channelId}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setChannelId(e.target.value)}
            required
          />
        </label>
        <label>
          Channel secret
          <input
            type="password"
            value={channelSecret}
            autoComplete="off"
            onChange={(e) => setChannelSecret(e.target.value)}
            required
          />
        </label>
        <label>
          Channel access token (long-lived)
          <input
            type="password"
            value={accessToken}
            autoComplete="off"
            onChange={(e) => setAccessToken(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary" disabled={props.busy}>
          ตรวจสอบและบันทึก
        </button>
      </form>
    </section>
  );
}

function ServicesSection(props: {
  services: Service[];
  busy: boolean;
  onAdd: (v: {
    name: string;
    durationMin: number;
    price: number;
    deposit: number;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [duration, setDuration] = useState("30");
  const [price, setPrice] = useState("");
  const [deposit, setDeposit] = useState("0");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await props.onAdd({
      name: name.trim(),
      durationMin: Number(duration),
      price: Number(price),
      deposit: Number(deposit || 0),
    });
    if (ok) {
      setName("");
      setPrice("");
      setDeposit("0");
    }
  }

  return (
    <section aria-labelledby="s-services" className="section">
      <h3 id="s-services">2. บริการ</h3>
      <ul className="list">
        {props.services.map((s) => (
          <li key={s.id} className="sub">
            {s.name} · {s.durationMin} นาที · {priceLabel(s.price)}
            {s.deposit > 0 ? ` (มัดจำ ${priceLabel(s.deposit)})` : ""}
          </li>
        ))}
      </ul>
      <form className="form" onSubmit={(e) => void submit(e)}>
        <label>
          ชื่อบริการ
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="two">
          <label>
            ใช้เวลา (นาที)
            <input
              type="number"
              inputMode="numeric"
              min={5}
              max={600}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              required
            />
          </label>
          <label>
            ราคา (บาท)
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </label>
        </div>
        <label>
          มัดจำ (บาท, 0 = ไม่มี)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </label>
        <button type="submit" className="secondary" disabled={props.busy || name.trim() === ""}>
          เพิ่มบริการ
        </button>
      </form>
    </section>
  );
}

function StaffSection(props: {
  staff: Staff[];
  withHours: Set<string>;
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onHours: (
    staffId: string,
    windows: { weekday: number; start: string; end: string }[],
  ) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  return (
    <section aria-labelledby="s-staff" className="section">
      <h3 id="s-staff">3. ช่าง/พนักงาน และเวลาทำการ</h3>
      {props.staff.map((s) => (
        <HoursForm
          key={s.id}
          staff={s}
          saved={props.withHours.has(s.id)}
          busy={props.busy}
          onSave={(w) => props.onHours(s.id, w)}
        />
      ))}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void props.onAdd(name.trim()).then((ok) => ok && setName(""));
        }}
      >
        <label>
          ชื่อช่าง/พนักงาน
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" className="secondary" disabled={props.busy || name.trim() === ""}>
          เพิ่มช่าง
        </button>
      </form>
    </section>
  );
}

function HoursForm(props: {
  staff: Staff;
  saved: boolean;
  busy: boolean;
  onSave: (w: { weekday: number; start: string; end: string }[]) => Promise<boolean>;
}) {
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("19:00");
  const toggle = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  return (
    <form
      className="form hours"
      aria-label={`เวลาทำการ ${props.staff.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        void props.onSave([...days].sort().map((weekday) => ({ weekday, start, end })));
      }}
    >
      <strong>
        {props.staff.name} {props.saved ? "✅" : ""}
      </strong>
      <div className="seg" role="group" aria-label={`วันทำการ ${props.staff.name}`}>
        {DAYS.map((label, d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}>
            {label}
          </button>
        ))}
      </div>
      <div className="two">
        <label>
          เปิด
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          ปิด
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      <button type="submit" className="secondary" disabled={props.busy || end <= start}>
        บันทึกเวลาทำการ
      </button>
    </form>
  );
}

function RichMenuSection(props: {
  done: boolean;
  connected: boolean;
  busy: boolean;
  onUpload: (file: File) => Promise<boolean>;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <section aria-labelledby="s-menu" className="section">
      <h3 id="s-menu">5. ริชเมนู (จองคิว / นัดของฉัน / ติดต่อร้าน) {props.done ? "✅" : ""}</h3>
      {!props.connected && <p className="muted">เชื่อมต่อ LINE OA ในขั้นที่ 1 ก่อน</p>}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) void props.onUpload(file);
        }}
      >
        <label>
          รูปเมนู PNG ขนาด 2500x843 พิกเซล ไม่เกิน 1 MB
          <input
            type="file"
            accept="image/png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="submit"
          className="secondary"
          disabled={props.busy || !props.connected || !file}
        >
          ตั้งค่าริชเมนู
        </button>
      </form>
    </section>
  );
}
