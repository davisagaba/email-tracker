const { getDb } = require('../db');

// Verifies a per-client sync token, supplied either as `Authorization: Bearer <token>`
// or an `X-Sync-Token` header. Updates last_used_at on success.
function requireSyncToken(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch ? bearerMatch[1] : req.get('X-Sync-Token');

  if (!token) {
    return res.status(401).json({ error: 'Missing sync token' });
  }

  const db = getDb();
  const row = db.prepare('SELECT * FROM sync_tokens WHERE token = ? AND revoked = 0').get(token);

  if (!row) {
    return res.status(401).json({ error: 'Invalid or revoked sync token' });
  }

  db.prepare('UPDATE sync_tokens SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);
  req.syncToken = row;
  next();
}

module.exports = { requireSyncToken };
