const express = require('express');
const { parseCsv, parseEmailList } = require('../lib/csv');
const { importRows, suggestMapping } = require('../lib/importer');

const router = express.Router();

// Lets the dashboard show a column-mapping step before committing to an
// import — parses just the headers + a couple of sample rows and returns
// an auto-suggested mapping, so the user can see (and correct) which
// source column becomes email/name/company/phone before anything is saved.
router.post('/preview', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'Missing "csv" field with pasted CSV/TSV text' });
  }

  const rows = parseCsv(csv);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No data rows found (need a header row plus at least one data row)' });
  }

  const headers = Object.keys(rows[0]);
  res.json({
    headers,
    suggestedMapping: suggestMapping(headers),
    rowCount: rows.length,
    sampleRows: rows.slice(0, 3),
  });
});

function handleImport(targetList) {
  return (req, res) => {
    const { csv, mapping } = req.body;
    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'Missing "csv" field with pasted CSV/TSV text' });
    }

    const rows = parseCsv(csv);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found (need a header row plus at least one data row)' });
    }

    const result = importRows(targetList, rows, 'manual', mapping);
    res.json(result);
  };
}

router.post('/dedup', handleImport('dedup'));
router.post('/supplier', handleImport('supplier'));

// Plain email list import — for a client who only has a .txt file of bare
// addresses with no name/company/phone, no CSV structure, no header row.
// One address per line (or comma/semicolon-separated). Each row is
// inserted with just an email; every other field stays null until a
// richer import fills them in later (re-importing the same address with
// a fuller row updates it in place, per the normal merge rules).
function handleEmailListImport(targetList) {
  return (req, res) => {
    const { emails } = req.body || {};
    if (!emails || typeof emails !== 'string' || !emails.trim()) {
      return res.status(400).json({ error: 'Missing "emails" field with one address per line' });
    }

    const { rows, invalidLines } = parseEmailList(emails);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid email addresses found', invalidLines });
    }

    const result = importRows(targetList, rows, 'manual');
    res.json({ ...result, invalidLineCount: invalidLines.length, invalidLines: invalidLines.slice(0, 20) });
  };
}

router.post('/dedup/emails', handleEmailListImport('dedup'));
router.post('/supplier/emails', handleEmailListImport('supplier'));

module.exports = router;
