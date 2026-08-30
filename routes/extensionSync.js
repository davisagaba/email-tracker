const express = require('express');
const { requireSyncToken } = require('../lib/auth');
const { importRows } = require('../lib/importer');

const router = express.Router();

function handleSync(targetList) {
  return (req, res) => {
    const rows = Array.isArray(req.body) ? req.body : req.body && req.body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: 'Expected a JSON array of row objects, or {"rows": [...]}',
      });
    }

    const result = importRows(targetList, rows, 'extension');
    res.json(result);
  };
}

router.post('/dedup', requireSyncToken, handleSync('dedup'));
router.post('/supplier', requireSyncToken, handleSync('supplier'));

module.exports = router;
