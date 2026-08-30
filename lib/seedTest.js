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

module.exports = { getSeedAddresses, logSeedResults, providerFromEmail };
