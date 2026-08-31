const express = require('express');
const multer = require('multer');
const { getDb } = require('../db');
const { sendCampaign } = require('../send');
const { checkThrottle } = require('../lib/reputation');

const router = express.Router();

// Attachment held in memory only long enough to write into SQLite as a
// BLOB — not written to local disk, since Railway's filesystem is
// ephemeral and wouldn't survive a redeploy.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/', upload.single('attachment'), (req, res) => {
  const { name, subject, body, track } = req.body || {};
  if (!name || !subject) {
    return res.status(400).json({ error: 'name and subject are required' });
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO campaigns (name, subject, body, track, status, attachment_filename, attachment_content_type, attachment_data)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
    )
    .run(
      name,
      subject,
      body || '',
      track === 'A' ? 'A' : 'B',
      req.file ? req.file.originalname : null,
      req.file ? req.file.mimetype : null,
      req.file ? req.file.buffer : null
    );

  const campaign = db
    .prepare(
      'SELECT id, name, subject, body, track, status, created_at, sent_at, attachment_filename, attachment_content_type FROM campaigns WHERE id = ?'
    )
    .get(result.lastInsertRowid);
  res.json(campaign);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const campaign = db
    .prepare(
      'SELECT id, name, subject, body, track, status, created_at, sent_at, attachment_filename, attachment_content_type FROM campaigns WHERE id = ?'
    )
    .get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  res.json(campaign);
});

// Lets the dashboard offer a "download attachment" link to confirm what
// was actually uploaded, without bloating the campaign JSON with a BLOB.
router.get('/:id/attachment', (req, res) => {
  const db = getDb();
  const campaign = db
    .prepare('SELECT attachment_filename, attachment_content_type, attachment_data FROM campaigns WHERE id = ?')
    .get(req.params.id);
  if (!campaign || !campaign.attachment_data) {
    return res.status(404).json({ error: 'No attachment on this campaign' });
  }
  res.set('Content-Type', campaign.attachment_content_type || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${campaign.attachment_filename}"`);
  res.send(Buffer.from(campaign.attachment_data));
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
