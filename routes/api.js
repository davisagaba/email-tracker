const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

function parseContactRow(row) {
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    subscribed: row.subscribed === undefined ? undefined : !!row.subscribed,
  };
}

// ---- dedup contacts ----

router.get('/contacts', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM dedup_contacts ORDER BY created_at DESC').all();
  res.json(rows.map(parseContactRow));
});

router.get('/contacts/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM dedup_contacts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Contact not found' });

  const events = db
    .prepare(
      `SELECT e.* FROM events e
       JOIN sends s ON s.tracking_id = e.tracking_id
       WHERE s.contact_id = ?
       ORDER BY e.created_at DESC`
    )
    .all(req.params.id);

  res.json({ ...parseContactRow(row), events });
});

// ---- supplier contacts (view-only) ----

router.get('/supplier-contacts', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM supplier_contacts ORDER BY created_at DESC').all();
  res.json(rows.map(parseContactRow));
});

// ---- imports log ----

router.get('/imports', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM imports ORDER BY created_at DESC').all();
  res.json(rows);
});

// ---- campaigns ----

router.get('/campaigns', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  res.json(rows);
});

router.get('/campaigns/:id/stats', (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const sentCount = db
    .prepare('SELECT COUNT(*) AS n FROM sends WHERE campaign_id = ?')
    .get(req.params.id).n;

  const eventCounts = db
    .prepare(
      `SELECT e.type, COUNT(*) AS n FROM events e
       JOIN sends s ON s.tracking_id = e.tracking_id
       WHERE s.campaign_id = ?
       GROUP BY e.type`
    )
    .all(req.params.id);

  const deviceCounts = db
    .prepare(
      `SELECT e.device, COUNT(*) AS n FROM events e
       JOIN sends s ON s.tracking_id = e.tracking_id
       WHERE s.campaign_id = ? AND e.type = 'open' AND e.device IS NOT NULL
       GROUP BY e.device`
    )
    .all(req.params.id);

  const seedResults = db
    .prepare('SELECT * FROM seed_results WHERE campaign_id = ?')
    .all(req.params.id);

  const stats = { sent: sentCount, open: 0, click: 0, bounce: 0, complaint: 0, reply: 0 };
  for (const row of eventCounts) stats[row.type] = row.n;

  res.json({
    campaign,
    stats,
    devices: deviceCounts.reduce((acc, r) => ({ ...acc, [r.device]: r.n }), {}),
    seedResults,
  });
});

// ---- needs attention (flags) ----

router.get('/flags', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT f.*, c.email, c.name, c.company
       FROM flags f
       JOIN dedup_contacts c ON c.id = f.contact_id
       WHERE f.resolved = 0
       ORDER BY f.created_at DESC`
    )
    .all();
  res.json(rows);
});

router.post('/flags/:id/resolve', (req, res) => {
  const db = getDb();
  const result = db.prepare('UPDATE flags SET resolved = 1 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Flag not found' });
  res.json({ resolved: true });
});

module.exports = router;
