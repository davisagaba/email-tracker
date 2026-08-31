const { getDb } = require('../db');

const BOUNCE_THRESHOLD_PCT = 5;
const COMPLAINT_THRESHOLD_PCT = 0.1;

// Warm-up ramp-up curve per product-spec.md §6/§14. Day counts are
// 1-indexed from the first Track B send ever recorded.
const WARMUP_CURVE = [
  { maxDay: 3, cap: 50 },
  { maxDay: 7, cap: 150 },
  { maxDay: 14, cap: 300 },
  { maxDay: 28, cap: 500 },
  { maxDay: Infinity, cap: 1000 },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isWarmupActive() {
  return String(process.env.DOMAIN_SENT_BEFORE || 'false').toLowerCase() !== 'true';
}

// Warm-up start = the date of the earliest Track B send ever logged.
// If Track B hasn't sent anything yet, warm-up hasn't started (day 0).
function getWarmupStartDay(db) {
  const row = db.prepare(`SELECT MIN(day) AS day FROM daily_send_log WHERE track = 'B'`).get();
  return row.day || null;
}

function getDaysSinceWarmupStart(db) {
  const startDay = getWarmupStartDay(db);
  if (!startDay) return 0;
  const start = new Date(`${startDay}T00:00:00Z`);
  const now = new Date(`${today()}T00:00:00Z`);
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return diffDays + 1; // day of first send counts as day 1
}

function getDailyCap(track) {
  if (track !== 'B' || !isWarmupActive()) return Infinity;
  const db = getDb();
  const day = getDaysSinceWarmupStart(db) || 1;
  const tier = WARMUP_CURVE.find((t) => day <= t.maxDay);
  return tier.cap;
}

function getTodaySentCount(track) {
  const db = getDb();
  const row = db
    .prepare('SELECT count FROM daily_send_log WHERE day = ? AND track = ?')
    .get(today(), track);
  return row ? row.count : 0;
}

function incrementDailySendLog(track, n = 1) {
  const db = getDb();
  db.prepare(
    `INSERT INTO daily_send_log (day, track, count) VALUES (?, ?, ?)
     ON CONFLICT(day, track) DO UPDATE SET count = count + excluded.count`
  ).run(today(), track, n);
}

function getBounceRate(db) {
  const totalSends = db.prepare('SELECT COUNT(*) AS n FROM sends').get().n;
  if (totalSends === 0) return 0;
  const bounces = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'bounce'`).get().n;
  return (bounces / totalSends) * 100;
}

function getComplaintRate(db) {
  const totalSends = db.prepare('SELECT COUNT(*) AS n FROM sends').get().n;
  if (totalSends === 0) return 0;
  const complaints = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE type = 'complaint'`).get().n;
  return (complaints / totalSends) * 100;
}

// Automatic bounce/complaint throttling — stays active regardless of
// whether warm-up itself is running (product-spec.md §6).
function checkThrottle() {
  const db = getDb();
  const bounceRate = getBounceRate(db);
  const complaintRate = getComplaintRate(db);

  if (bounceRate > BOUNCE_THRESHOLD_PCT) {
    return { throttled: true, reason: `Bounce rate ${bounceRate.toFixed(2)}% exceeds ${BOUNCE_THRESHOLD_PCT}% threshold`, bounceRate, complaintRate };
  }
  if (complaintRate > COMPLAINT_THRESHOLD_PCT) {
    return { throttled: true, reason: `Complaint rate ${complaintRate.toFixed(2)}% exceeds ${COMPLAINT_THRESHOLD_PCT}% threshold`, bounceRate, complaintRate };
  }
  return { throttled: false, reason: null, bounceRate, complaintRate };
}

// Collapses bounce rate + complaint rate into one 0-100 number, so the
// dashboard can lead with a single health score instead of separate
// tiles the operator has to interpret themselves (the "Domain Health Hub"
// pattern every deliverability-first tool in the competitive review uses).
function computeHealthScore(bounceRate, complaintRate) {
  const penalty = Math.min(100, bounceRate * 10) + Math.min(100, complaintRate * 500);
  return Math.max(0, Math.round(100 - penalty));
}

function getHealthScore() {
  const db = getDb();
  const bounceRate = getBounceRate(db);
  const complaintRate = getComplaintRate(db);
  return computeHealthScore(bounceRate, complaintRate);
}

// A lightweight approximation, not a stored historical snapshot: we don't
// keep a per-day health-score table, so this recomputes each day's rate
// from sends/events grouped by date. A day with no sends carries forward
// the previous day's rate rather than showing a misleading 0% (no
// evidence either way, not evidence of health).
function getHealthTrend(days = 14) {
  const db = getDb();
  const sendsByDay = db
    .prepare(
      `SELECT date(sent_at) AS day, COUNT(*) AS n FROM sends
       WHERE sent_at >= date('now', ?) GROUP BY day`
    )
    .all(`-${days - 1} days`);
  const eventsByDay = db
    .prepare(
      `SELECT date(created_at) AS day,
         SUM(CASE WHEN type = 'bounce' THEN 1 ELSE 0 END) AS bounces,
         SUM(CASE WHEN type = 'complaint' THEN 1 ELSE 0 END) AS complaints
       FROM events WHERE created_at >= date('now', ?) GROUP BY day`
    )
    .all(`-${days - 1} days`);

  const sendsMap = new Map(sendsByDay.map((r) => [r.day, r.n]));
  const eventsMap = new Map(eventsByDay.map((r) => [r.day, r]));

  const trend = [];
  let lastScore = 100;
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const sends = sendsMap.get(day) || 0;
    if (sends > 0) {
      const ev = eventsMap.get(day) || { bounces: 0, complaints: 0 };
      const bounceRate = (ev.bounces / sends) * 100;
      const complaintRate = (ev.complaints / sends) * 100;
      lastScore = computeHealthScore(bounceRate, complaintRate);
    }
    trend.push({ day, score: lastScore });
  }
  return trend;
}

function getReputationStatus() {
  const db = getDb();
  const throttle = checkThrottle();
  const dailyCapB = getDailyCap('B');
  const sentTodayB = getTodaySentCount('B');

  return {
    warmupActive: isWarmupActive(),
    daysSinceWarmupStart: getDaysSinceWarmupStart(db),
    bounceRate: Number(throttle.bounceRate.toFixed(2)),
    complaintRate: Number(throttle.complaintRate.toFixed(2)),
    thresholds: { bouncePct: BOUNCE_THRESHOLD_PCT, complaintPct: COMPLAINT_THRESHOLD_PCT },
    throttled: throttle.throttled,
    throttleReason: throttle.reason,
    healthScore: computeHealthScore(throttle.bounceRate, throttle.complaintRate),
    healthTrend: getHealthTrend(14),
    trackB: {
      dailyCap: dailyCapB === Infinity ? null : dailyCapB,
      sentToday: sentTodayB,
      remainingToday: dailyCapB === Infinity ? null : Math.max(0, dailyCapB - sentTodayB),
    },
    trackA: {
      dailyCap: null,
      sentToday: getTodaySentCount('A'),
    },
  };
}

module.exports = {
  checkThrottle,
  getReputationStatus,
  getDailyCap,
  getTodaySentCount,
  incrementDailySendLog,
  getBounceRate,
  getComplaintRate,
  isWarmupActive,
  getHealthScore,
  getHealthTrend,
};
