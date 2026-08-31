const { getDb } = require('../db');

// Guesses a provider label from a seed address's domain, for grouping on
// the campaign stats page (gmail/outlook/yahoo/other).
function providerFromEmail(email) {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (domain.includes('gmail')) return 'gmail';
  if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live')) return 'outlook';
  if (domain.includes('yahoo')) return 'yahoo';
  return domain || 'other';
}

function getSeedAddresses() {
  return (process.env.SEED_ADDRESSES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Records a pending seed-placement check row for every configured seed
// address on this campaign. Actual inbox-vs-spam placement is checked via
// IMAP in Stage 5 — Phase 1 only scaffolds the row with placement="unknown".
function logSeedResults(campaignId) {
  const db = getDb();
  const seeds = getSeedAddresses();
  const insert = db.prepare(
    `INSERT INTO seed_results (campaign_id, provider, placement) VALUES (?, ?, 'unknown')`
  );
  for (const address of seeds) {
    insert.run(campaignId, providerFromEmail(address));
  }
  return seeds;
}

// Per-provider placement summary for the Reputation page. Placement is
// only ever "unknown" until the Stage 5 IMAP watcher actually reads the
// seed mailboxes and reports inbox-vs-spam — that check isn't built yet,
// so this reports real (empty/unknown) state rather than inventing
// percentages the system hasn't actually measured.
function getSeedPlacementSummary() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT provider,
         COUNT(*) AS total,
         SUM(CASE WHEN placement = 'inbox' THEN 1 ELSE 0 END) AS inbox,
         SUM(CASE WHEN placement = 'spam' THEN 1 ELSE 0 END) AS spam,
         SUM(CASE WHEN placement = 'unknown' THEN 1 ELSE 0 END) AS unknown
       FROM seed_results GROUP BY provider`
    )
    .all();
  return rows;
}

module.exports = { getSeedAddresses, logSeedResults, providerFromEmail, getSeedPlacementSummary };
