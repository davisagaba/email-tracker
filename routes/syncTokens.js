const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDb();
  const tokens = db
    .prepare('SELECT id, token, label, created_at, last_used_at, revoked FROM sync_tokens ORDER BY created_at DESC')
    .all();
  res.json(tokens);
});

router.post('/', (req, res) => {
  const { label } = req.body || {};
  const token = crypto.randomBytes(24).toString('hex');
  const db = getDb();
  const result = db
    .prepare('INSERT INTO sync_tokens (token, label) VALUES (?, ?)')
    .run(token, label || null);

  res.json({
    id: result.lastInsertRowid,
    token,
    label: label || null,
  });
});

router.post('/:id/revoke', (req, res) => {
  const db = getDb();
  const result = db.prepare('UPDATE sync_tokens SET revoked = 1 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Token not found' });
  res.json({ revoked: true });
});

module.exports = router;
