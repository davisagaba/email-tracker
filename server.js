require('dotenv').config();
const path = require('path');
const express = require('express');
const { getDb } = require('./db');

getDb(); // initialize schema on boot

const app = express();
app.use(express.json());

// api.js exposes multiple resource paths (contacts, supplier-contacts,
// imports, campaigns, flags) under a single router — mount at /api.
app.use('/api', require('./routes/api'));
app.use('/api/import', require('./routes/imports'));
app.use('/api/sync-tokens', require('./routes/syncTokens'));
app.use('/api/campaigns', require('./routes/campaigns'));
app.use('/api/reputation', require('./routes/reputation'));

app.use('/extension-sync', require('./routes/extensionSync'));
app.use('/track', require('./routes/track'));
app.use('/unsubscribe', require('./routes/unsubscribe'));
app.use('/webhooks', require('./routes/webhooks'));

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Email tracker listening on port ${PORT}`);
});

module.exports = app;
