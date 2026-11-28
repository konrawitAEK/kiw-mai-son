import { PRIVACY_NOTICE, SHOP_TERMS, type LegalDoc } from "@kms/core";

/** `?page=privacy` / `?page=terms`: static Thai text, no login and no network. */
export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const doc: LegalDoc = kind === "privacy" ? PRIVACY_NOTICE : SHOP_TERMS;
  return (
    <main className="page legal">
      <header className="top">
        <h1>คิวไม่ซ้อน</h1>
        <h2>{doc.title}</h2>
        <p className="muted">{doc.updated}</p>
      </header>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h3>{s.heading}</h3>
          {s.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </section>
      ))}
      <LegalLinks except={kind} />
      <button type="button" className="link" onClick={() => window.history.back()}>
        ย้อนกลับ
      </button>
    </main>
  );
}

/** Footer links shown on the booking page, the owner page and the legal pages themselves. */
export function LegalLinks({
  except,
  owner = false,
}: {
  except?: "privacy" | "terms";
  owner?: boolean;
}) {
  return (
    <nav className="legal-links" aria-label="ข้อมูลทางกฎหมาย">
      {except !== "privacy" && <a href="?page=privacy">ประกาศความเป็นส่วนตัว</a>}
      {(owner || except === "privacy") && except !== "terms" && (
        <a href="?page=terms">ข้อตกลงการประมวลผลข้อมูลสำหรับร้านค้า</a>
      )}
    </nav>
  );
}
