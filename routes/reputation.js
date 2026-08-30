const express = require('express');
const { getReputationStatus } = require('../lib/reputation');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(getReputationStatus());
});

module.exports = router;
