const { getDb } = require('../db');
const { notifyNewContacts } = require('./discord');

// Normalizes a header for matching: lowercase, strip anything that isn't
// a letter or digit. This makes "Email Address", "E-mail", "email_address"
// and "EMAIL" all match the same alias, since real-world CSV exports vary
// wildly in header naming/casing/punctuation.
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Normalized column aliases -> canonical field name. Anything not listed
// here falls through into the metadata JSON blob, unmodified.
// See product-spec.md §5 for the canonical set (email/name/company/phone/
// source_row_id); the extra variants below are common real-world spellings.
const FIELD_ALIASES = {
  email: 'email',
  emailaddress: 'email',
  mail: 'email',
  emailid: 'email',

  name: 'name',
  contactname: 'name',
  fullname: 'name',
  firstname: 'name',
  contact: 'name',

  company: 'company',
  businessname: 'company',
  companyname: 'company',
  organization: 'company',
  organisation: 'company',

  phone: 'phone',
  phonenumber: 'phone',
  telephone: 'phone',
  mobile: 'phone',
  contactnumber: 'phone',

  id: 'source_row_id',
  sourcerowid: 'source_row_id',
  rowid: 'source_row_id',
};

// mapping (optional): explicit { email: 'Source Header', name: '...', ... }
// overriding automatic alias detection for those specific canonical fields
// — set by the user via the CSV import mapping UI when auto-detection
// guesses wrong or a header is too unusual to match automatically.
function mapRow(row, mapping) {
  const mapped = { email: null, name: null, company: null, phone: null, source_row_id: null };
  const metadata = {};
  const explicitSourceKeys = new Set(mapping ? Object.values(mapping).filter(Boolean) : []);

  if (mapping) {
    for (const [canonical, sourceKey] of Object.entries(mapping)) {
      if (sourceKey && Object.prototype.hasOwnProperty.call(row, sourceKey)) {
        mapped[canonical] = row[sourceKey] === '' ? null : row[sourceKey];
      }
    }
  }

  for (const [key, value] of Object.entries(row)) {
    if (explicitSourceKeys.has(key)) continue; // already handled by explicit mapping
    const canonical = FIELD_ALIASES[normalizeKey(key)];
    if (canonical && mapped[canonical] === null) {
      mapped[canonical] = value === '' ? null : value;
    } else if (!canonical) {
      metadata[key] = value;
    }
  }

  return { ...mapped, metadata };
}

// Best-effort auto-suggested mapping for a set of CSV headers, used by the
// import preview UI so a user can see (and correct) what will map to what
// before committing to an import — email in particular should never be
// silently guessed wrong.
function suggestMapping(headers) {
  const suggestion = { email: null, name: null, company: null, phone: null };
  for (const header of headers) {
    const canonical = FIELD_ALIASES[normalizeKey(header)];
    if (canonical && canonical in suggestion && !suggestion[canonical]) {
      suggestion[canonical] = header;
    }
  }
  return suggestion;
}

const TABLES = {
  dedup: 'dedup_contacts',
  supplier: 'supplier_contacts',
};

/**
 * Imports a batch of raw row objects into either the dedup or supplier
 * contact table, using the shared field-mapping + merge rules. Used
 * identically by manual CSV paste and both extension-sync endpoints.
 *
 * @param {'dedup'|'supplier'} targetList
 * @param {object[]} rawRows
 * @param {'manual'|'extension'|'discord'} source
 * @param {{email?:string,name?:string,company?:string,phone?:string}} [mapping] explicit column mapping override
 * @returns {{importId:number, rowCount:number, addedCount:number, updatedCount:number, skippedCount:number}}
 */
function importRows(targetList, rawRows, source, mapping) {
  const db = getDb();
  const table = TABLES[targetList];
  if (!table) throw new Error(`Unknown target list: ${targetList}`);

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  const insertImportLog = db.prepare(`
    INSERT INTO imports (source, target_list, row_count, added_count, updated_count, skipped_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // subscribed only applies to dedup_contacts; supplier_contacts has no such column.
  const upsertDedup = db.prepare(`
    INSERT INTO dedup_contacts (email, name, company, phone, source_row_id, metadata)
    VALUES (@email, @name, @company, @phone, @source_row_id, @metadata)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      company = excluded.company,
      phone = excluded.phone,
      source_row_id = excluded.source_row_id,
      metadata = excluded.metadata
  `);

  const upsertSupplier = db.prepare(`
    INSERT INTO supplier_contacts (email, name, company, phone, source_row_id, metadata)
    VALUES (@email, @name, @company, @phone, @source_row_id, @metadata)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      company = excluded.company,
      phone = excluded.phone,
      source_row_id = excluded.source_row_id,
      metadata = excluded.metadata
  `);

  const existsCheck = db.prepare(`SELECT id FROM ${table} WHERE email = ?`);
  const upsert = targetList === 'dedup' ? upsertDedup : upsertSupplier;

  // node:sqlite's DatabaseSync has no `.transaction()` helper (unlike
  // better-sqlite3), so batch atomicity is done with explicit BEGIN/COMMIT.
  db.exec('BEGIN');
  try {
    for (const raw of rawRows) {
      const mapped = mapRow(raw, mapping);
      if (!mapped.email) {
        skippedCount++;
        continue;
      }

      const existing = existsCheck.get(mapped.email);
      upsert.run({
        email: mapped.email,
        name: mapped.name,
        company: mapped.company,
        phone: mapped.phone,
        source_row_id: mapped.source_row_id,
        metadata: JSON.stringify(mapped.metadata),
      });

      if (existing) {
        updatedCount++;
      } else {
        addedCount++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const result = insertImportLog.run(
    source,
    targetList,
    rawRows.length,
    addedCount,
    updatedCount,
    skippedCount
  );

  // Fire-and-forget — a Discord outage must never fail the import itself.
  notifyNewContacts({ source, targetList, addedCount, updatedCount, skippedCount });

  return {
    importId: result.lastInsertRowid,
    rowCount: rawRows.length,
    addedCount,
    updatedCount,
    skippedCount,
  };
}

module.exports = { importRows, mapRow, suggestMapping, normalizeKey };
