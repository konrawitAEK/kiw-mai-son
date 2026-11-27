import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";

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
