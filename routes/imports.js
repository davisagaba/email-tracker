const express = require('express');
const { parseCsv } = require('../lib/csv');
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

module.exports = router;
