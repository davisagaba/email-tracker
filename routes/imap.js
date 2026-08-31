const express = require('express');
const { checkForReplies, isConfigured } = require('../lib/imapWatcher');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// Manual trigger — useful for an operator who doesn't want to wait for the
// next poll, and for testing the matching logic against a real inbox once
// IMAP credentials are configured.
router.post('/check-now', async (req, res) => {
  const result = await checkForReplies();
  res.json(result);
});

module.exports = router;
