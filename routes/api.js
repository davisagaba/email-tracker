const express = require('express');
const { getDb } = require('../db');
const { getEngagementScores } = require('../lib/engagement');
const { getSeverity } = require('../lib/severity');
const { listTags, addTagToContact, removeTagFromContact, getTagsByContact, getContactIdsForTag } = require('../lib/tags');

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
  let rows = db.prepare('SELECT * FROM dedup_contacts ORDER BY created_at DESC').all();

  const scores = getEngagementScores();
  const tagsByContact = getTagsByContact();
  rows = rows.map((row) => ({
    ...parseContactRow(row),
    engagementScore: scores.get(row.id) || 0,
    tags: tagsByContact.get(row.id) || [],
  }));

  if (req.query.tag) {
    const idsWithTag = new Set(getContactIdsForTag(req.query.tag));
    rows = rows.filter((c) => idsWithTag.has(c.id));
  }

  res.json(rows);
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

  const tagsByContact = getTagsByContact();
  res.json({ ...parseContactRow(row), events, tags: tagsByContact.get(row.id) || [] });
});

router.post('/contacts/:id/tags', (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Missing "name"' });
  try {
    const tag = addTagToContact(req.params.id, name);
    res.json(tag);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/contacts/:id/tags/:tagId', (req, res) => {
  removeTagFromContact(req.params.id, req.params.tagId);
  res.json({ removed: true });
});

router.get('/tags', (req, res) => {
  res.json(listTags());
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
  const rows = db
    .prepare(
      `SELECT id, name, subject, body, track, status, created_at, sent_at, attachment_filename, attachment_content_type
       FROM campaigns ORDER BY created_at DESC`
    )
    .all();
  res.json(rows);
});

router.get('/campaigns/:id/stats', (req, res) => {
  const db = getDb();
  const campaign = db
    .prepare(
      `SELECT id, name, subject, body, track, status, created_at, sent_at, attachment_filename, attachment_content_type
       FROM campaigns WHERE id = ?`
    )
    .get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const sentCount = db
    .prepare('SELECT COUNT(*) AS n FROM sends WHERE campaign_id = ?')
    .get(req.params.id).n;

  // COUNT(DISTINCT tracking_id), not COUNT(*): a recipient opening the
  // same email 5 times is one "opened" for the funnel, not five — the
  // 5+-opens flagging trigger (Stage 3) still counts every individual
  // open event, which is a different, deliberately raw metric.
  const eventCounts = db
    .prepare(
      `SELECT e.type, COUNT(DISTINCT s.tracking_id) AS n FROM events e
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

  // Time-to-first-open: average minutes between send and each send's
  // earliest open — a fast engagement latency is a healthy sign, a slow
  // one (or none) is worth noticing before it shows up as a bounce/complaint.
  const timeToFirstOpen = db
    .prepare(
      `SELECT AVG((julianday(first_open) - julianday(s.sent_at)) * 24 * 60) AS avgMinutes
       FROM sends s
       JOIN (
         SELECT tracking_id, MIN(created_at) AS first_open
         FROM events WHERE type = 'open'
         GROUP BY tracking_id
       ) fo ON fo.tracking_id = s.tracking_id
       WHERE s.campaign_id = ?`
    )
    .get(req.params.id);

  const stats = { sent: sentCount, open: 0, click: 0, bounce: 0, complaint: 0, reply: 0 };
  for (const row of eventCounts) stats[row.type] = row.n;

  // Click-to-open rate: of the people who opened, how many also clicked —
  // a low CTOR alongside a healthy open rate is an early content/offer
  // problem, not a deliverability one.
  const clickToOpenRate = stats.open > 0 ? Number(((stats.click / stats.open) * 100).toFixed(1)) : null;

  res.json({
    campaign,
    stats,
    devices: deviceCounts.reduce((acc, r) => ({ ...acc, [r.device]: r.n }), {}),
    seedResults,
    clickToOpenRate,
    avgMinutesToFirstOpen: timeToFirstOpen.avgMinutes != null ? Math.round(timeToFirstOpen.avgMinutes) : null,
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
       WHERE f.resolved = 0`
    )
    .all();

  const scores = getEngagementScores();
  const withSeverity = rows.map((row) => ({
    ...row,
    severity: getSeverity(row.reason).level,
    engagementScore: scores.get(row.contact_id) || 0,
  }));

  const sortBy = req.query.sort || 'severity';
  if (sortBy === 'score') {
    withSeverity.sort((a, b) => b.engagementScore - a.engagementScore);
  } else if (sortBy === 'newest') {
    withSeverity.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else {
    withSeverity.sort((a, b) => getSeverity(a.reason).rank - getSeverity(b.reason).rank || new Date(b.created_at) - new Date(a.created_at));
  }

  res.json(withSeverity);
});

router.post('/flags/:id/resolve', (req, res) => {
  const db = getDb();
  const result = db.prepare('UPDATE flags SET resolved = 1 WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Flag not found' });
  res.json({ resolved: true });
});

module.exports = router;
