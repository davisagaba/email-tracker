const { getDb } = require('../db');

// Known column aliases -> canonical field name. Anything not listed here
// falls through into the metadata JSON blob, unmodified. See product-spec.md §5.
const FIELD_ALIASES = {
  email: 'email',
  name: 'name',
  contactName: 'name',
  company: 'company',
  businessName: 'company',
  phone: 'phone',
  source_row_id: 'source_row_id',
  id: 'source_row_id',
};

function mapRow(row) {
  const mapped = { email: null, name: null, company: null, phone: null, source_row_id: null };
  const metadata = {};

  for (const [key, value] of Object.entries(row)) {
    const canonical = FIELD_ALIASES[key];
    if (canonical) {
      mapped[canonical] = value === '' ? null : value;
    } else {
      metadata[key] = value;
    }
  }

  return { ...mapped, metadata };
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
 * @returns {{importId:number, rowCount:number, addedCount:number, updatedCount:number, skippedCount:number}}
 */
function importRows(targetList, rawRows, source) {
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
      const mapped = mapRow(raw);
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

  return {
    importId: result.lastInsertRowid,
    rowCount: rawRows.length,
    addedCount,
    updatedCount,
    skippedCount,
  };
}

module.exports = { importRows, mapRow };
