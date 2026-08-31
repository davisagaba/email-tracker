const { getDb } = require('../db');
const { notifyFlagged } = require('./discord');

// Creates a flag for a contact unless an unresolved flag with the exact
// same reason already exists — prevents re-flagging on every subsequent
// open/bounce once a contact is already flagged for that reason.
function createFlagIfNotExists(contactId, reason) {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM flags WHERE contact_id = ? AND reason = ? AND resolved = 0`
    )
    .get(contactId, reason);

  if (existing) return { created: false, flagId: existing.id };

  const result = db
    .prepare(`INSERT INTO flags (contact_id, reason) VALUES (?, ?)`)
    .run(contactId, reason);

  const contact = db.prepare('SELECT email FROM dedup_contacts WHERE id = ?').get(contactId);
  if (contact) notifyFlagged({ email: contact.email, reason });

  return { created: true, flagId: result.lastInsertRowid };
}

module.exports = { createFlagIfNotExists };
