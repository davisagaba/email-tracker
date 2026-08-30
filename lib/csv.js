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

module.exports = { parseCsv, detectDelimiter, splitLine };
