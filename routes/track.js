const express = require('express');
const { getDb } = require('../db');
const { parseDevice } = require('../lib/deviceParse');
const { TRANSPARENT_GIF } = require('../lib/tracking');

const router = express.Router();

function logEvent(trackingId, type, req, extra = {}) {
  const db = getDb();
  const userAgent = req.get('User-Agent') || null;
  const device = type === 'open' ? parseDevice(userAgent) : null;
  const ip = req.ip || null;

  db.prepare(
    `INSERT INTO events (tracking_id, type, url, ip, user_agent, device)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(trackingId, type, extra.url || null, ip, userAgent, device);
}

router.get('/open/:tid.gif', (req, res) => {
  logEvent(req.params.tid, 'open', req);
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.send(TRANSPARENT_GIF);
});

router.get('/click/:tid', (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');

  logEvent(req.params.tid, 'click', req, { url: targetUrl });
  res.redirect(302, targetUrl);
});

module.exports = router;
