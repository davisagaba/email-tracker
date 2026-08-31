const dns = require('node:dns').promises;

// Real DNS lookups for SPF/DKIM/DMARC — product-spec.md §6 calls for a
// "domain health checklist item (SPF/DKIM/DMARC verified) surfaced in
// dashboard setup screen" that was never actually built in Phase 1.
// DKIM has no fixed record name (it's provider-chosen, e.g. `s1._domainkey`
// for SendGrid) — we check the common selector patterns and report
// best-effort rather than claiming certainty either way.
const COMMON_DKIM_SELECTORS = ['s1', 's2', 'selector1', 'selector2', 'google', 'default', 'k1'];

async function checkTxtRecord(hostname, predicate) {
  try {
    const records = await dns.resolveTxt(hostname);
    const flat = records.map((r) => r.join(''));
    const match = flat.find(predicate);
    return { found: !!match, record: match || null };
  } catch (err) {
    return { found: false, record: null, error: err.code || err.message };
  }
}

async function checkSpf(domain) {
  return checkTxtRecord(domain, (r) => r.toLowerCase().startsWith('v=spf1'));
}

async function checkDmarc(domain) {
  return checkTxtRecord(`_dmarc.${domain}`, (r) => r.toLowerCase().startsWith('v=dmarc1'));
}

async function checkDkim(domain) {
  for (const selector of COMMON_DKIM_SELECTORS) {
    const result = await checkTxtRecord(`${selector}._domainkey.${domain}`, (r) => r.toLowerCase().includes('v=dkim1'));
    if (result.found) return { ...result, selector };
  }
  return { found: false, record: null, selector: null, note: 'No record at common selectors — DKIM may use a custom selector name; this is not conclusive proof it is missing.' };
}

async function checkDomainAuth(domain) {
  const [spf, dmarc, dkim] = await Promise.all([checkSpf(domain), checkDmarc(domain), checkDkim(domain)]);
  return { domain, spf, dmarc, dkim };
}

module.exports = { checkDomainAuth, checkSpf, checkDmarc, checkDkim };
