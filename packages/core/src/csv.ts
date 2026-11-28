// CSV export helpers (owner data export). Pure; no I/O.

const NUMBERISH = /^[+-]?[0-9][0-9\s-]*$/;

/** Neutralises spreadsheet formulas (=, @, and +/- unless it is just a phone-like number). */
function safeCell(value: string): string {
  if (/^[=@\t\r]/.test(value)) return `'${value}`;
  if (/^[+-]/.test(value) && !NUMBERISH.test(value)) return `'${value}`;
  return value;
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = safeCell(String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * RFC 4180 CSV with CRLF line ends and a UTF-8 BOM so Excel opens Thai text correctly.
 * Cells that could run as spreadsheet formulas are prefixed with an apostrophe.
 */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [header, ...rows].map((r) => r.map(cell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
