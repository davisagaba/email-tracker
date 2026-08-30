const express = require('express');
const { getDb } = require('../db');
const { sendCampaign } = require('../send');
const { checkThrottle } = require('../lib/reputation');

const router = express.Router();

router.post('/', (req, res) => {
  const { name, subject, body, track } = req.body || {};
  if (!name || !subject) {
    return res.status(400).json({ error: 'name and subject are required' });
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO campaigns (name, subject, body, track, status) VALUES (?, ?, ?, ?, 'draft')`
    )
    .run(name, subject, body || '', track === 'A' ? 'A' : 'B');

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  res.json(campaign);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

// Recipients this campaign would go to if sent now: all subscribed
// dedup_contacts (no segmentation/filtering in Phase 1).
router.get('/:id/recipients', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT id, email, name, company FROM dedup_contacts WHERE subscribed = 1')
    .all();
  res.json(rows);
});

router.post('/:id/send', async (req, res) => {
  const db = getDb();
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const throttle = checkThrottle();
  if (throttle.throttled) {
    return res.status(429).json({
      sent: false,
      throttled: true,
      reason: throttle.reason,
      bounceRate: throttle.bounceRate,
      complaintRate: throttle.complaintRate,
    });
  }

  try {
    const result = await sendCampaign(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
