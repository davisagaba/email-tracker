const express = require('express');
const { parseCsv } = require('../lib/csv');
const { importRows } = require('../lib/importer');

const router = express.Router();

function handleImport(targetList) {
  return (req, res) => {
    const { csv } = req.body;
    if (!csv || typeof csv !== 'string' || !csv.trim()) {
      return res.status(400).json({ error: 'Missing "csv" field with pasted CSV/TSV text' });
    }

    const rows = parseCsv(csv);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No data rows found (need a header row plus at least one data row)' });
    }

    const result = importRows(targetList, rows, 'manual');
    res.json(result);
  };
}

router.post('/dedup', handleImport('dedup'));
router.post('/supplier', handleImport('supplier'));

module.exports = router;
