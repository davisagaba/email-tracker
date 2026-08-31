// Minimal CSV/TSV paste parser: auto-detects comma vs tab delimiter from
// the header line, handles double-quoted fields (with "" escaping), and
// returns an array of row objects keyed by header.

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? '\t' : ',';
}

function splitLine(line, delimiter) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

function parseCsv(text) {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitLine(lines[0], delimiter);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitLine(lines[i], delimiter);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = fields[idx] !== undefined ? fields[idx] : '';
    });
    rows.push(row);
  }
  return rows;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// For clients who only have a plain list of email addresses — no CSV
// structure, no header row, no name/company/phone. One address per line
// (commas/semicolons also accepted as separators, since a plain .txt list
// sometimes comes that way too). Lines that don't look like an email are
// reported separately rather than silently dropped or inserted as garbage.
function parseEmailList(text) {
  const tokens = text
    .split(/[\r\n,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const rows = [];
  const invalidLines = [];
  for (const token of tokens) {
    if (EMAIL_PATTERN.test(token)) {
      rows.push({ email: token });
    } else {
      invalidLines.push(token);
    }
  }
  return { rows, invalidLines };
}

module.exports = { parseCsv, detectDelimiter, splitLine, parseEmailList };
