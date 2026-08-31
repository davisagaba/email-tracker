const { getDb } = require('../db');
const { createFlagIfNotExists } = require('./flags');
const { notifyReply } = require('./discord');
const { extractTrackingId } = require('./messageId');

/**
 * Matches one incoming parsed email to a contact and logs it as a reply.
 * Kept as a pure function of a plain "parsed message" object (not an IMAP
 * client) so it can be tested directly with synthetic input — the actual
 * IMAP network connection can't be verified in this build environment, but
 * this matching/logging logic can be, fully.
 *
 * @param {{from: string, subject: string, text: string, html: string,
 *          messageId: string, inReplyTo: string, references: string|string[]}} parsed
 */
function processIncomingMessage(parsed) {
  const db = getDb();

  // Primary match: thread by the trackingId embedded in our own
  // Message-ID, echoed back in the reply's In-Reply-To/References.
  let trackingId = extractTrackingId(parsed.inReplyTo) || extractTrackingId(parsed.references);
  let contactId = null;

  if (trackingId) {
    const send = db.prepare('SELECT contact_id FROM sends WHERE tracking_id = ?').get(trackingId);
    if (send) contactId = send.contact_id;
  }

  // Fallback: match by sender address alone (per product-spec.md §6 —
  // "sender address and/or In-Reply-To/Message-ID threading").
  let viaThreading = !!contactId;
  if (!contactId && parsed.from) {
    const contact = db.prepare('SELECT id FROM dedup_contacts WHERE email = ?').get(parsed.from);
    if (contact) contactId = contact.id;
  }

  if (!contactId) {
    return { matched: false, reason: 'no_matching_contact' };
  }

  // events.tracking_id is NOT NULL; if we matched by address only (no
  // threading header), attribute the reply to that contact's most recent
  // send as the best available association.
  if (!trackingId) {
    const latestSend = db
      .prepare('SELECT tracking_id FROM sends WHERE contact_id = ? ORDER BY sent_at DESC LIMIT 1')
      .get(contactId);
    trackingId = latestSend ? latestSend.tracking_id : null;
  }

  const body = parsed.text || parsed.html || '';

  db.prepare(
    `INSERT INTO messages (contact_id, direction, subject, body, message_id, in_reply_to)
     VALUES (?, 'inbound', ?, ?, ?, ?)`
  ).run(contactId, parsed.subject || null, body, parsed.messageId || null, parsed.inReplyTo || null);

  if (trackingId) {
    db.prepare(`INSERT INTO events (tracking_id, type) VALUES (?, 'reply')`).run(trackingId);
  }

  const flagResult = createFlagIfNotExists(contactId, 'Replied');

  const contact = db.prepare('SELECT email FROM dedup_contacts WHERE id = ?').get(contactId);
  notifyReply({ email: contact.email, snippet: body.slice(0, 200) });

  return { matched: true, contactId, viaThreading, flagCreated: flagResult.created };
}

module.exports = { processIncomingMessage };
