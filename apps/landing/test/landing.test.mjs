import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { PRIVACY_NOTICE, SHOP_TERMS } from "../../../packages/core/src/legal.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("index.html");
const config = JSON.parse(read("site.config.json"));

describe("landing page", () => {
  it("is Thai and mobile-ready", () => {
    expect(html).toMatch(/<html lang="th">/);
    expect(html).toMatch(/name="viewport" content="width=device-width, initial-scale=1"/);
    expect(html).toMatch(/<title>[^<]*คิวไม่ซ้อน/);
    expect(html).toMatch(/name="description"/);
  });

  it("has the required sections", () => {
    expect(html).toContain("ลองจองร้านเดโม");
    expect(html).toMatch(/id="who"/);
    expect(html).toContain("ใครทำ");
    expect(html).toMatch(/id="demo"/);
  });

  it("links match site.config.json (run `pnpm --filter @kms/landing qr` to sync)", () => {
    const hrefs = (key) =>
      [...html.matchAll(new RegExp(`data-link="${key}"[^>]*href="([^"]*)"`, "g"))].map((m) => m[1]);
    expect(hrefs("signup").length).toBeGreaterThan(0);
    expect(hrefs("demo").length).toBeGreaterThan(0);
    for (const h of hrefs("signup")) expect(h).toBe(config.signupOaUrl);
    for (const h of hrefs("demo")) expect(h).toBe(config.demoOaUrl);
  });

  it("sign-up and demo links point to LINE", () => {
    expect(config.signupOaUrl).toMatch(/^https:\/\/(line\.me|lin\.ee)\//);
    expect(config.demoOaUrl).toMatch(/^https:\/\/(line\.me|lin\.ee)\//);
  });

  it("has a QR image with alt text and fixed size, and the file exists", () => {
    expect(html).toMatch(
      /<img[^>]*src="qr-demo\.svg"[^>]*width="200"[^>]*height="200"[^>]*alt="[^"]+"/,
    );
    expect(statSync(new URL("../qr-demo.svg", import.meta.url)).size).toBeGreaterThan(500);
  });

  it("stays light: no scripts, no external requests, small file", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/(src|href)="https?:\/\/(?!line\.me|lin\.ee)/);
    expect(html).not.toMatch(/@import|fonts\.googleapis/);
    expect(Buffer.byteLength(html)).toBeLessThan(30_000);
  });

  it("does not track visitors", () => {
    expect(html).not.toMatch(/analytics|gtag|pixel/i);
  });

  it("external links use rel=noopener", () => {
    for (const m of html.matchAll(/<a\b[^>]*href="https:[^>]*>/g))
      expect(m[0]).toContain("noopener");
  });
});

describe("privacy notice and shop terms pages", () => {
  const docs = [
    ["privacy.html", PRIVACY_NOTICE],
    ["terms.html", SHOP_TERMS],
  ];

  it("landing page footer links to both", () => {
    expect(html).toContain('href="privacy.html"');
    expect(html).toContain('href="terms.html"');
  });

  it.each(docs)("%s is Thai, mobile-ready, untracked and matches legal.ts", (file, doc) => {
    const page = read(file);
    expect(page).toMatch(/<html lang="th">/);
    expect(page).toMatch(/name="viewport" content="width=device-width, initial-scale=1"/);
    expect(page).toContain(`<h1>${doc.title}</h1>`);
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/(src|href)="https?:\/\//);
    for (const s of doc.sections) {
      expect(page).toContain(`<h2>${s.heading}</h2>`);
      for (const p of s.paragraphs) expect(page).toContain(`<p>${p}</p>`);
    }
  });

  it("states the roles clearly (shop = controller, we = processor) and the delete/export promise", () => {
    expect(SHOP_TERMS.sections.map((s) => s.paragraphs.join(" ")).join(" ")).toMatch(
      /ผู้ควบคุมข้อมูล.*ผู้ประมวลผล/,
    );
    expect(read("terms.html")).toMatch(/CSV/);
    expect(read("terms.html")).toMatch(/ลบร้าน/);
  });
});
