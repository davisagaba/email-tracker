const express = require('express');
const { getDb } = require('../db');
const { createFlagIfNotExists } = require('../lib/flags');

const router = express.Router();

const UNSUBSCRIBE_FLAG_WINDOW_HOURS = 24;

router.get('/:tid', (req, res) => {
  const db = getDb();
  const send = db.prepare('SELECT * FROM sends WHERE tracking_id = ?').get(req.params.tid);
  if (!send) return res.status(404).send('Unknown tracking link');

  db.prepare('UPDATE dedup_contacts SET subscribed = 0 WHERE id = ?').run(send.contact_id);
  db.prepare(
    `INSERT INTO events (tracking_id, type, ip, user_agent) VALUES (?, 'unsubscribe', ?, ?)`
  ).run(req.params.tid, req.ip || null, req.get('User-Agent') || null);

  const hoursSinceSend = db
    .prepare(`SELECT (julianday('now') - julianday(sent_at)) * 24 AS hours FROM sends WHERE tracking_id = ?`)
    .get(req.params.tid).hours;

  if (hoursSinceSend <= UNSUBSCRIBE_FLAG_WINDOW_HOURS) {
    createFlagIfNotExists(send.contact_id, 'Unsubscribed within 24h of send');
  }

  res.send('You have been unsubscribed and will not receive further emails.');
});

module.exports = router;
