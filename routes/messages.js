const express = require('express');
const { getDb } = require('../db');
const { buildTransport } = require('../lib/mailer');

const router = express.Router();

// Reply feed — recent replies across all contacts (product-spec.md Stage 5).
router.get('/replies', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.*, c.email, c.name, c.company
       FROM messages m
       JOIN dedup_contacts c ON c.id = m.contact_id
       WHERE m.direction = 'inbound'
       ORDER BY m.created_at DESC
       LIMIT 50`
    )
    .all();
  res.json(rows);
});

// Full email thread for one contact — read history in one place, not just
// an event log (product-spec.md Stage 5).
router.get('/contacts/:id/messages', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at ASC')
    .all(req.params.id);
  res.json(rows);
});

// Send a reply directly from the dashboard, threaded into the same
// conversation via In-Reply-To/References — reuses the campaign send
// transport, not a new integration.
router.post('/contacts/:id/reply', async (req, res) => {
  const { body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'Missing "body"' });

  const db = getDb();
  const contact = db.prepare('SELECT * FROM dedup_contacts WHERE id = ?').get(req.params.id);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });

  const lastInbound = db
    .prepare(
      `SELECT * FROM messages WHERE contact_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1`
    )
    .get(req.params.id);

  const subject = lastInbound && lastInbound.subject ? `Re: ${lastInbound.subject.replace(/^Re:\s*/i, '')}` : 'Re: your message';

  const { transport, from, configured } = buildTransport('B');

  if (configured) {
    await transport.sendMail({
      from,
      to: contact.email,
      subject,
      text: body,
      inReplyTo: lastInbound ? lastInbound.message_id : undefined,
      references: lastInbound ? lastInbound.message_id : undefined,
    });
  }

  const result = db
    .prepare(
      `INSERT INTO messages (contact_id, direction, subject, body, in_reply_to)
       VALUES (?, 'outbound', ?, ?, ?)`
    )
    .run(req.params.id, subject, body, lastInbound ? lastInbound.message_id : null);

  res.json({ sent: true, simulated: !configured, messageId: result.lastInsertRowid });
});

module.exports = router;
