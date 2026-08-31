const express = require('express');
const { getReputationStatus } = require('../lib/reputation');
const { getSeedPlacementSummary } = require('../lib/seedTest');
const { checkDomainAuth } = require('../lib/domainAuth');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ ...getReputationStatus(), seedPlacement: getSeedPlacementSummary() });
});

router.get('/domain-auth', async (req, res) => {
  const domain = req.query.domain;
  if (!domain) return res.status(400).json({ error: 'Missing "domain" query param' });
  const result = await checkDomainAuth(domain);
  res.json(result);
});

module.exports = router;
