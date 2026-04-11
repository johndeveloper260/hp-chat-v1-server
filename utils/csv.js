/**
 * csv.js — Lightweight CSV serialiser/parser (no external dependencies).
 *
 * Handles: quoted fields, embedded commas/newlines, escaped double-quotes,
 * CRLF and LF line endings, and YYYY/MM/DD ↔ YYYY-MM-DD date conversion.
 */

/**
 * Formats a date value as YYYY/MM/DD for CSV export.
 * Accepts Date objects, ISO strings (YYYY-MM-DD…), or null/undefined.
 */
export const formatDate = (val) => {
  if (!val) return "";
  // PostgreSQL returns dates as strings like "2024-03-15T00:00:00.000Z" or "2024-03-15"
  const s = val instanceof Date ? val.toISOString() : String(val);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[1]}/${m[2]}/${m[3]}`;
};

/**
 * Converts a YYYY/MM/DD string to YYYY-MM-DD for PostgreSQL.
 * Returns null if blank or invalid format.
 */
export const parseDate = (val) => {
  if (!val || !val.trim()) return null;
  const m = val.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
};

/**
 * Serialises a 2D array (header row + data rows) into a CSV string.
 * Fields containing commas, double-quotes, or newlines are quoted.
 * Output uses CRLF line endings per RFC 4180.
 */
export const toCsv = (rows) =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
            return '"' + s.replace(/"/g, '""') + '"';
          }
          return s;
        })
        .join(","),
    )
    .join("\r\n");

/**
 * Parses a CSV string into an array of plain objects keyed by the header row.
 * Handles quoted fields with embedded commas, newlines, and escaped quotes.
 */
export const parseCsv = (text) => {
  const lines = _splitLines(text);
  if (lines.length < 2) return [];
  const headers = _parseRow(lines[0]);
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = _parseRow(line);
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = vals[i] ?? "";
      });
      return obj;
    });
};

// ── internal helpers ──────────────────────────────────────────────────────────

function _splitLines(text) {
  const lines = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (!inQ && (ch === "\n" || (ch === "\r" && text[i + 1] === "\n"))) {
      if (ch === "\r") i++;
      lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) lines.push(cur);
  return lines;
}

function _parseRow(line) {
  const fields = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}
