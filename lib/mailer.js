const nodemailer = require('nodemailer');
const { pixelUrl, clickUrl } = require('./tracking');

// Track A = established mailbox (low volume, immediate use).
// Track B = custom sending domain (bulk, subject to warm-up).
function buildTransport(track) {
  const prefix = track === 'A' ? 'SMTP_A' : 'SMTP_B';
  const host = process.env[`${prefix}_HOST`];
  const port = Number(process.env[`${prefix}_PORT`] || 587);
  const user = process.env[`${prefix}_USER`];
  const pass = process.env[`${prefix}_PASS`];
  const from = process.env[`${prefix}_FROM`];

  if (!host || !user || !pass || !from) {
    return { transport: null, from, configured: false };
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  return { transport, from, configured: true };
}

function personalize(body, contact) {
  return body
    .replace(/\{\{\s*name\s*\}\}/gi, contact.name || '')
    .replace(/\{\{\s*company\s*\}\}/gi, contact.company || '')
    .replace(/\{\{\s*email\s*\}\}/gi, contact.email || '');
}

// Rewrites every <a href="..."> in the HTML body to route through the
// click-tracking redirect, and appends an open-tracking pixel + unsubscribe
// footer link before the closing tag.
function injectTracking(html, publicUrl, trackingId) {
  let out = html.replace(/href\s*=\s*"([^"]+)"/gi, (match, url) => {
    if (url.startsWith('mailto:') || url.includes('/unsubscribe/')) return match;
    return `href="${clickUrl(publicUrl, trackingId, url)}"`;
  });

  const pixel = `<img src="${pixelUrl(publicUrl, trackingId)}" width="1" height="1" alt="" style="display:none" />`;
  const unsubscribe = `<p style="font-size:11px;color:#888"><a href="${publicUrl}/unsubscribe/${trackingId}">Unsubscribe</a></p>`;
  const footer = `${unsubscribe}${pixel}`;

  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${footer}</body>`);
  } else {
    out += footer;
  }
  return out;
}

module.exports = { buildTransport, personalize, injectTracking };
