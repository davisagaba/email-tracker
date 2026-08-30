// Classifies a User-Agent string into desktop/tablet/mobile/unknown.
function parseDevice(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();

  if (/ipad|tablet|playbook|silk/.test(ua) && !/mobile/.test(ua)) {
    return 'tablet';
  }
  if (/mobi|iphone|ipod|android.*mobile|blackberry|windows phone/.test(ua)) {
    return 'mobile';
  }
  if (/android/.test(ua)) {
    return 'tablet';
  }
  return 'desktop';
}

module.exports = { parseDevice };
