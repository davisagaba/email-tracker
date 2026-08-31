const { getDb } = require('../db');

// open = +1, click = +3, reply = +10, per product-spec.md §9a's proposed
// engagement score — replaces sorting by recency with sorting by actual
// interest.
const WEIGHTS = { open: 1, click: 3, reply: 10 };

function getEngagementScores() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.contact_id AS contactId,
         SUM(CASE e.type WHEN 'open' THEN ${WEIGHTS.open} WHEN 'click' THEN ${WEIGHTS.click} WHEN 'reply' THEN ${WEIGHTS.reply} ELSE 0 END) AS score
       FROM events e
       JOIN sends s ON s.tracking_id = e.tracking_id
       GROUP BY s.contact_id`
    )
    .all();
  const map = new Map();
  for (const row of rows) map.set(row.contactId, row.score);
  return map;
}

function getEngagementScore(contactId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT SUM(CASE e.type WHEN 'open' THEN ${WEIGHTS.open} WHEN 'click' THEN ${WEIGHTS.click} WHEN 'reply' THEN ${WEIGHTS.reply} ELSE 0 END) AS score
       FROM events e
       JOIN sends s ON s.tracking_id = e.tracking_id
       WHERE s.contact_id = ?`
    )
    .get(contactId);
  return row.score || 0;
}

module.exports = { getEngagementScores, getEngagementScore, WEIGHTS };
