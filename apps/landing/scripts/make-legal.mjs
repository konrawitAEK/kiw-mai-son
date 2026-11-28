// Regenerates privacy.html and terms.html from packages/core/src/legal.ts (the single source of the
// Thai legal text, also shown in LIFF). Run after editing legal.ts:
//   pnpm --filter @kms/landing legal && pnpm format
// Needs Node >= 22.18 (runs the .ts file directly, same as `pnpm rich-menu`).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRIVACY_NOTICE, SHOP_TERMS } from "../../../packages/core/src/legal.ts";

const dir = new URL("../", import.meta.url);
const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(doc, file, other) {
  const body = doc.sections
    .map(
      (s) =>
        `<section>\n<h2>${esc(s.heading)}</h2>\n${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("\n")}\n</section>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(doc.title)} - คิวไม่ซ้อน</title>
<meta name="description" content="${esc(doc.title)} ของระบบจองคิว คิวไม่ซ้อน" />
<meta name="theme-color" content="#06a755" />
<style>
:root { --green: #05803f; --ink: #1a1a1a; --muted: #4d4d4d; --line: #dfe7e2; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Sarabun", "Noto Sans Thai", "Thonburi", "Leelawadee UI", "Tahoma", system-ui, sans-serif; font-size: 17px; line-height: 1.7; color: var(--ink); background: #fff; }
.wrap { max-width: 720px; margin: 0 auto; padding: 0 16px 40px; }
header { padding: 14px 0; border-bottom: 1px solid var(--line); }
header a { font-weight: 700; font-size: 20px; color: var(--green); text-decoration: none; }
h1 { font-size: 26px; line-height: 1.35; margin: 24px 0 4px; }
h2 { font-size: 19px; margin: 28px 0 4px; }
p { margin: 8px 0; }
.note { color: var(--muted); font-size: 15px; }
nav { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 16px; }
nav a { color: var(--green); display: inline-block; padding: 8px 16px 8px 0; }
</style>
</head>
<body>
<div class="wrap">
<header><a href="index.html">คิวไม่ซ้อน</a></header>
<main>
<h1>${esc(doc.title)}</h1>
<p class="note">${esc(doc.updated)}</p>
${body}
</main>
<nav aria-label="เอกสารอื่น">
<a href="index.html">กลับหน้าแรก</a>
<a href="${other.file}">${esc(other.title)}</a>
</nav>
</div>
</body>
</html>
`;
  writeFileSync(fileURLToPath(new URL(file, dir)), html);
}

page(PRIVACY_NOTICE, "privacy.html", { file: "terms.html", title: SHOP_TERMS.title });
page(SHOP_TERMS, "terms.html", { file: "privacy.html", title: PRIVACY_NOTICE.title });
console.log("wrote privacy.html and terms.html");
