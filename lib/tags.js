const { getDb } = require('../db');

function listTags() {
  const db = getDb();
  return db.prepare('SELECT id, name FROM tags ORDER BY name').all();
}

function getOrCreateTag(name) {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Tag name cannot be empty');
  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(trimmed);
  return db.prepare('SELECT id, name FROM tags WHERE name = ?').get(trimmed);
}

function addTagToContact(contactId, tagName) {
  const db = getDb();
  const tag = getOrCreateTag(tagName);
  db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?, ?)').run(contactId, tag.id);
  return tag;
}

function removeTagFromContact(contactId, tagId) {
  const db = getDb();
  db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?').run(contactId, tagId);
}

// Returns { contactId: ['tag1','tag2'] } for every dedup contact that has
// at least one tag, for attaching to a contact list response in one query.
function getTagsByContact() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ct.contact_id AS contactId, t.name AS name
       FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id`
    )
    .all();
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.contactId)) map.set(row.contactId, []);
    map.get(row.contactId).push(row.name);
  }
  return map;
}

function getContactIdsForTag(tagName) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ct.contact_id AS contactId
       FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE t.name = ?`
    )
    .all(tagName);
  return rows.map((r) => r.contactId);
}

module.exports = { listTags, getOrCreateTag, addTagToContact, removeTagFromContact, getTagsByContact, getContactIdsForTag };
