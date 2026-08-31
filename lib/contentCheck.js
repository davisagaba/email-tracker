// Pre-send spam-trigger scan, per product-spec.md §14's own content
// guidance ("avoid spam-trigger patterns... too many links... image-only
// emails get flagged more often") — advisory only, never blocks a send,
// matching this app's existing philosophy that flags inform the operator
// rather than auto-pausing things.
const TRIGGER_PHRASES = [
  'act now', 'buy now', 'click here', 'limited time', 'risk-free', 'risk free',
  'no obligation', 'guarantee', 'winner', 'cash bonus', "100% free", 'free gift',
  'act immediately', 'urgent', 'congratulations you',
];

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkContentRisk(subject, htmlBody) {
  const warnings = [];
  const subjectText = subject || '';
  const bodyText = stripHtml(htmlBody);

  const letters = subjectText.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 8 && letters === letters.toUpperCase()) {
    warnings.push('Subject is all caps — a strong spam-filter trigger.');
  }

  const exclamations = (subjectText.match(/!/g) || []).length;
  if (exclamations >= 2) {
    warnings.push(`Subject has ${exclamations} exclamation points — filters weight this heavily.`);
  }

  const combined = `${subjectText} ${bodyText}`.toLowerCase();
  const foundPhrases = TRIGGER_PHRASES.filter((p) => combined.includes(p));
  if (foundPhrases.length > 0) {
    warnings.push(`Contains common spam-trigger phrases: ${foundPhrases.join(', ')}.`);
  }

  const linkCount = (htmlBody.match(/<a\s/gi) || []).length;
  if (linkCount > 10) {
    warnings.push(`${linkCount} links in one email — consider trimming; too many links reads as spam to most filters.`);
  }

  const imgCount = (htmlBody.match(/<img\s/gi) || []).length;
  if (imgCount > 0 && bodyText.length < 100) {
    warnings.push('Mostly images with very little text — image-only emails are penalized by many filters.');
  }

  return {
    riskLevel: warnings.length === 0 ? 'low' : warnings.length <= 1 ? 'medium' : 'high',
    warnings,
  };
}

module.exports = { checkContentRisk, stripHtml };
