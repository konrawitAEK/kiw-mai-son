// Syncs links from site.config.json into index.html (elements with
// data-link="demo|signup") and regenerates qr-demo.svg.
// Run after H3/H7 put the real LINE OA URLs into site.config.json:
//   pnpm --filter @kms/landing qr
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const dir = new URL("../", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, dir));
const config = JSON.parse(readFileSync(path("site.config.json"), "utf8"));
const urls = { demo: config.demoOaUrl, signup: config.signupOaUrl };

let html = readFileSync(path("index.html"), "utf8");
html = html.replace(
  /(<a\b[^>]*?data-link="(demo|signup)"[^>]*?href=")[^"]*(")/g,
  (_m, a, key, b) => `${a}${urls[key]}${b}`,
);
writeFileSync(path("index.html"), html);

const svg = await QRCode.toString(config.demoOaUrl, {
  type: "svg",
  margin: 2,
  errorCorrectionLevel: "M",
  color: { dark: "#1a1a1a", light: "#ffffff" },
});
writeFileSync(path("qr-demo.svg"), svg + "\n");
console.log("synced links + qr-demo.svg for", config.demoOaUrl);
