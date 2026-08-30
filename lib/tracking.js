const crypto = require('crypto');

function generateTrackingId() {
  return crypto.randomBytes(16).toString('hex');
}

function pixelUrl(publicUrl, trackingId) {
  return `${publicUrl}/track/open/${trackingId}.gif`;
}

function clickUrl(publicUrl, trackingId, targetUrl) {
  return `${publicUrl}/track/click/${trackingId}?url=${encodeURIComponent(targetUrl)}`;
}

// 1x1 transparent GIF, served by the open-tracking pixel endpoint.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7',
  'base64'
);

module.exports = { generateTrackingId, pixelUrl, clickUrl, TRANSPARENT_GIF };
