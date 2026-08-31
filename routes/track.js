const express = require('express');
const { getDb } = require('../db');
const { parseDevice } = require('../lib/deviceParse');
const { TRANSPARENT_GIF } = require('../lib/tracking');
const { createFlagIfNotExists } = require('../lib/flags');

const router = express.Router();

const OPEN_NO_CLICK_THRESHOLD = 5;

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

// 5+ opens with no click on this specific send is a sign of high interest
// without a clear next action worth a human following up on.
function checkOpenNoClickFlag(trackingId) {
  const db = getDb();
  const send = db.prepare('SELECT contact_id FROM sends WHERE tracking_id = ?').get(trackingId);
  if (!send) return;

  const counts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'open' THEN 1 ELSE 0 END) AS opens,
         SUM(CASE WHEN type = 'click' THEN 1 ELSE 0 END) AS clicks
       FROM events WHERE tracking_id = ?`
    )
    .get(trackingId);

  if (counts.opens >= OPEN_NO_CLICK_THRESHOLD && counts.clicks === 0) {
    createFlagIfNotExists(send.contact_id, '5+ opens with no click');
  }
}

router.get('/open/:tid.gif', (req, res) => {
  logEvent(req.params.tid, 'open', req);
  checkOpenNoClickFlag(req.params.tid);
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
