// Maps a flag's reason text to a severity tier for the Needs Attention
// dashboard — a bounce and a hot lead currently render identically, this
// gives the operator a way to sort what's actually urgent from what's
// actually good news.
const SEVERITY_BY_REASON = {
  Bounced: { level: 'critical', rank: 0 },
  'Unsubscribed within 24h of send': { level: 'warning', rank: 1 },
  '5+ opens with no click': { level: 'opportunity', rank: 2 },
  Replied: { level: 'opportunity', rank: 2 },
};

function getSeverity(reason) {
  return SEVERITY_BY_REASON[reason] || { level: 'warning', rank: 1 };
}

module.exports = { getSeverity };
