const express = require('express');
const { getDb } = require('../db');
const { createFlagIfNotExists } = require('../lib/flags');

const router = express.Router();

// SendGrid event -> our internal event type. Only bounce/complaint feed
// reputation in Phase 1; other event types are accepted but ignored.
const EVENT_TYPE_MAP = {
  bounce: 'bounce',
  dropped: 'bounce',
  spamreport: 'complaint',
};

// Signature verification is only attempted if a verification key is
// configured; otherwise it's skipped and documented as a known gap
// (untestable without a real SendGrid account).
function verifySignature(req) {
  const key = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY;
  if (!key) return { verified: 'skipped' };
  // Real verification would check the Ed25519 signature headers here.
  // Left unimplemented until a real SendGrid webhook can be tested against.
  return { verified: 'not_implemented' };
}

router.post('/sendgrid', (req, res) => {
  const sigResult = verifySignature(req);

  const events = Array.isArray(req.body) ? req.body : [req.body];
  const db = getDb();
  const findContact = db.prepare('SELECT id FROM dedup_contacts WHERE email = ?');
  const findLatestSend = db.prepare(
    'SELECT tracking_id FROM sends WHERE contact_id = ? ORDER BY sent_at DESC LIMIT 1'
  );
  const insertEvent = db.prepare(
    `INSERT INTO events (tracking_id, type, ip, user_agent) VALUES (?, ?, NULL, NULL)`
  );

  let logged = 0;
  let skipped = 0;

  for (const evt of events) {
    const internalType = EVENT_TYPE_MAP[evt.event];
    if (!internalType || !evt.email) {
      skipped++;
      continue;
    }

    const contact = findContact.get(evt.email);
    const send = contact ? findLatestSend.get(contact.id) : null;

    if (!send) {
      skipped++;
      continue;
    }

    insertEvent.run(send.tracking_id, internalType);
    logged++;

    if (internalType === 'bounce') {
      createFlagIfNotExists(contact.id, 'Bounced');
    }
  }

  res.json({ received: events.length, logged, skipped, signature: sigResult.verified });
});

module.exports = router;
