// Every outbound campaign email gets a Message-ID of <trackingId@domain>.
// When a contact replies, their mail client copies that into In-Reply-To
// (and usually References) — extracting the trackingId back out of those
// headers is how Stage 5 threads a reply to the exact send/contact/campaign
// it was a reply to, without needing any separate mapping table.

function getDomain() {
  try {
    return new URL(process.env.PUBLIC_URL || '').hostname || 'email-tracker.local';
  } catch {
    return 'email-tracker.local';
  }
}

function buildMessageId(trackingId) {
  return `<${trackingId}@${getDomain()}>`;
}

// trackingId is always a 32-char hex string (see lib/tracking.js).
function extractTrackingId(headerValue) {
  if (!headerValue) return null;
  const str = Array.isArray(headerValue) ? headerValue.join(' ') : String(headerValue);
  const match = str.match(/<([a-f0-9]{32})@[^>]+>/);
  return match ? match[1] : null;
}

module.exports = { buildMessageId, extractTrackingId };
