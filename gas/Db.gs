/**
 * File: Db.gs
 * Google Sheets as a database.
 *  - Columns are resolved by header name (SCHEMA in Config.gs is the contract).
 *  - Rows are located by their immutable key at write time, never by a cached row number.
 *  - Whole rows are written in one setValues() call.
 *  - Business data is never deleted (soft delete via is_deleted / status).
 *  - All writes run inside withLock_() (script-wide lock → no lost updates / duplicate numbers).
 */

let DB_SS_ = null;          // Spreadsheet handle for this execution
let TABLE_CACHE_ = {};      // tab → parsed table, valid only inside one execution
let LOCK_DEPTH_ = 0;        // allows nested withLock_ calls in the same execution

function db_() {
  if (DB_SS_) return DB_SS_;
  const id = PropertiesService.getScriptProperties().getProperty(CFG.PROP.DB_ID);
  if (!id) {
    throw appError_('NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่าฐานข้อมูล กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  }
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}

/** Point this execution at another spreadsheet (used by tests). */
function useDatabase_(ss) {
  DB_SS_ = ss;
  TABLE_CACHE_ = {};
}

function sheet_(tab) {
  const sh = db_().getSheetByName(tab);
  if (!sh) throw appError_('SCHEMA_DRIFT', 'ไม่พบแท็บ "' + tab + '" ในฐานข้อมูล กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  return sh;
}

function invalidate_(tab) {
  if (tab) delete TABLE_CACHE_[tab];
  else TABLE_CACHE_ = {};
}

/** Header row + name→index map; verifies every schema column exists. */
function headers_(tab) {
  const cached = TABLE_CACHE_[tab];
  if (cached) return cached;
  const sh = sheet_(tab);
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i; });
  const missing = SCHEMA[tab].cols.filter(function (c) { return idx[c] === undefined; });
  if (missing.length) {
    throw appError_('SCHEMA_DRIFT', 'แท็บ "' + tab + '" ขาดคอลัมน์: ' + missing.join(', ') + ' — กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  }
  const meta = { sheet: sh, headers: headers, idx: idx, rows: null };
  TABLE_CACHE_[tab] = meta;
  return meta;
}

/** All rows of a tab as objects (read once per execution, batched). Do not mutate the result. */
function rows_(tab) {
  const meta = headers_(tab);
  if (meta.rows) return meta.rows;
  const sh = meta.sheet;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    meta.rows = [];
    return meta.rows;
  }
  const values = sh.getRange(2, 1, lastRow - 1, meta.headers.length).getValues();
  const keyCol = meta.idx[SCHEMA[tab].key];
  meta.rows = [];
  values.forEach(function (r, i) {
    if (r[keyCol] === '' || r[keyCol] === null) return;   // skip blank rows
    const o = { _row: i + 2 };
    meta.headers.forEach(function (h, c) { if (h) o[h] = cellUnsafe_(r[c]); });
    meta.rows.push(o);
  });
  return meta.rows;
}

function findOne_(tab, field, value) {
  const list = rows_(tab);
  for (let i = 0; i < list.length; i++) {
    if (String(list[i][field]) === String(value)) return list[i];
  }
  return null;
}

function findAll_(tab, field, value) {
  return rows_(tab).filter(function (r) { return String(r[field]) === String(value); });
}

function toCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return cellSafe_(v);
  return v;
}

/** Append objects as rows (one setValues call). Returns the objects. */
/** Tabs whose change makes cached ticket lists stale (see listTicketBoard). */
const BOARD_TABS_ = ['Tickets', 'TicketItems', 'Users', 'Departments', 'ProductGroups', 'Settings'];
let DATA_DIRTY_ = false;
function markDataChanged_(tab) {
  if (BOARD_TABS_.indexOf(tab) === -1) return;
  if (LOCK_DEPTH_ > 0) DATA_DIRTY_ = true;   // bumped once when the lock is released
  else bumpDataVersion_();
}
/** A new data version = every cached ticket list is ignored from now on. */
function bumpDataVersion_() {
  DATA_DIRTY_ = false;
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(Date.now()) + '-' + Math.floor(Math.random() * 1e6));
}
function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
}

function insertRows_(tab, objs) {
  if (!objs.length) return objs;
  markDataChanged_(tab);
  const meta = headers_(tab);
  const width = meta.headers.length;
  const data = objs.map(function (o) {
    const row = new Array(width).fill('');
    meta.headers.forEach(function (h, c) {
      if (h && Object.prototype.hasOwnProperty.call(o, h)) row[c] = toCell_(o[h]);
    });
    return row;
  });
  const sh = meta.sheet;
  sh.getRange(sh.getLastRow() + 1, 1, data.length, width).setValues(data);
  meta.rows = null;
  return objs;
}

function insertRow_(tab, obj) {
  insertRows_(tab, [obj]);
  return obj;
}

/**
 * Update one row located by its primary key (looked up fresh, not from cache).
 * Returns the merged row object.
 */
function updateRow_(tab, keyValue, patch) {
  markDataChanged_(tab);
  const meta = headers_(tab);
  const sh = meta.sheet;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
  const keyCol = meta.idx[SCHEMA[tab].key] + 1;
  const keys = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
  let rowNo = -1;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(keyValue)) { rowNo = i + 2; break; }
  }
  if (rowNo === -1) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');

  const width = meta.headers.length;
  const current = sh.getRange(rowNo, 1, 1, width).getValues()[0];
  const merged = { _row: rowNo };
  meta.headers.forEach(function (h, c) { if (h) merged[h] = cellUnsafe_(current[c]); });
  Object.keys(patch).forEach(function (k) {
    if (meta.idx[k] === undefined) throw new Error('updateRow_: unknown column ' + tab + '.' + k);
    merged[k] = patch[k];
  });
  const out = meta.headers.map(function (h) { return h ? toCell_(merged[h]) : ''; });
  sh.getRange(rowNo, 1, 1, width).setValues([out]);
  meta.rows = null;
  return merged;
}

/**
 * Run fn while holding the script-wide lock. Cache is dropped on entry so that
 * every read inside the lock sees the latest committed data.
 */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_TIMEOUT_MS)) {
    throw appError_('BUSY', 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งในไม่กี่วินาที');
  }
  LOCK_DEPTH_++;
  try {
    invalidate_();
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    LOCK_DEPTH_--;
    invalidate_();
    if (DATA_DIRTY_) bumpDataVersion_();
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Settings

function setting_(key, fallback) {
  const row = findOne_(TAB.SETTINGS, 'key', key);
  if (!row || row.value === '' || row.value === null) return fallback;
  return parseJson_(row.value, fallback);
}

function vatRate_() {
  const v = Number(setting_('vat_rate', 0.07));
  if (!isFinite(v) || v < 0 || v >= 1) throw appError_('INVALID_SETTING', 'ค่า vat_rate ในแท็บ Settings ไม่ถูกต้อง (ต้องอยู่ระหว่าง 0–1)');
  return v;
}

// ---------------------------------------------------------------- Counters

/** Next running number for a counter name. Must be called inside withLock_. */
function nextCounter_(name) {
  if (LOCK_DEPTH_ === 0) throw new Error('nextCounter_ must run inside withLock_');
  const row = findOne_(TAB.COUNTERS, 'name', name);
  if (!row) {
    insertRow_(TAB.COUNTERS, { name: name, last_no: 1, updated_at: new Date() });
    return 1;
  }
  const next = Number(row.last_no || 0) + 1;
  updateRow_(TAB.COUNTERS, name, { last_no: next, updated_at: new Date() });
  return next;
}
