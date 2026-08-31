const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'tracker.db');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dedup_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  phone TEXT,
  source_row_id TEXT,
  metadata TEXT,
  subscribed INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_import_id INTEGER
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  company TEXT,
  phone TEXT,
  source_row_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source_import_id INTEGER
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  template_file TEXT,
  body TEXT,
  track TEXT NOT NULL DEFAULT 'B',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT NOT NULL UNIQUE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  contact_id INTEGER NOT NULL REFERENCES dedup_contacts(id),
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT,
  ip TEXT,
  user_agent TEXT,
  device TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES dedup_contacts(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  target_list TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  added_count INTEGER NOT NULL,
  updated_count INTEGER NOT NULL,
  skipped_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES dedup_contacts(id),
  direction TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seed_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  provider TEXT NOT NULL,
  placement TEXT NOT NULL DEFAULT 'unknown',
  checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_send_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  track TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(day, track)
);
`;

// Columns added after the initial CREATE TABLE need an explicit migration
// since "CREATE TABLE IF NOT EXISTS" doesn't touch existing tables.
function migrate(database) {
  const campaignColumns = database.prepare(`PRAGMA table_info(campaigns)`).all().map((c) => c.name);
  const addColumn = (name, def) => {
    if (!campaignColumns.includes(name)) {
      database.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${def}`);
    }
  };
  addColumn('attachment_filename', 'TEXT');
  addColumn('attachment_content_type', 'TEXT');
  addColumn('attachment_data', 'BLOB');
}

function getDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { getDb, DB_PATH };
