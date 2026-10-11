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
let NOTIF_DIRTY_ = false;
function markDataChanged_(tab) {
  if (tab === TAB.NOTIFICATIONS) {   // only the bell / poll counts depend on it (M9)
    if (LOCK_DEPTH_ > 0) NOTIF_DIRTY_ = true;
    else bumpNotifVersion_();
    return;
  }
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
/** Same idea for the Notifications tab: a new value = every cached poll answer is ignored. */
function bumpNotifVersion_() {
  NOTIF_DIRTY_ = false;
  PropertiesService.getScriptProperties().setProperty('NOTIF_VERSION', String(Date.now()) + '-' + Math.floor(Math.random() * 1e6));
}
function notifVersion_() {
  return PropertiesService.getScriptProperties().getProperty('NOTIF_VERSION') || '0';
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
  const first = sh.getLastRow() + 1;
  sh.getRange(first, 1, data.length, width).setValues(data);
  if (meta.rows && LOCK_DEPTH_ > 0) {
    // inside the lock the cache is fresh (dropped on entry) → append instead of re-reading the whole tab (M8)
    const keyCol = meta.idx[SCHEMA[tab].key];
    data.forEach(function (r, i) {
      if (r[keyCol] === '' || r[keyCol] === null) return;
      const o = { _row: first + i };
      meta.headers.forEach(function (h, c) { if (h) o[h] = sheetLike_(h, cellUnsafe_(r[c])); });
      meta.rows.push(o);
    });
  } else {
    meta.rows = null;
  }
  return objs;
}

function insertRow_(tab, obj) {
  insertRows_(tab, [obj]);
  return obj;
}

/**
 * Update one row located by its primary key. Returns the merged row object.
 * Inside the lock with the tab already read this execution, the cached row is current (the cache is dropped on
 * lock entry and every write below keeps it in step) → no extra reads, and the cache is patched in place
 * instead of being thrown away (M8: saving a pricing page used to re-read whole tabs after every quote).
 * Otherwise the row is looked up fresh, as before.
 */
function updateRow_(tab, keyValue, patch) {
  markDataChanged_(tab);
  const meta = headers_(tab);
  const sh = meta.sheet;
  const width = meta.headers.length;
  const keyName = SCHEMA[tab].key;
  Object.keys(patch).forEach(function (k) {
    if (meta.idx[k] === undefined) throw new Error('updateRow_: unknown column ' + tab + '.' + k);
  });

  let rowNo = -1, cachedAt = -1, current = null;
  if (meta.rows && LOCK_DEPTH_ > 0) {
    for (let i = 0; i < meta.rows.length; i++) {
      if (String(meta.rows[i][keyName]) === String(keyValue)) { cachedAt = i; rowNo = meta.rows[i]._row; break; }
    }
  }
  const merged = { _row: 0 };
  if (cachedAt !== -1) {
    const c = meta.rows[cachedAt];
    meta.headers.forEach(function (h) { if (h) merged[h] = c[h]; });
  } else {
    const lastRow = sh.getLastRow();
    if (lastRow < 2) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
    const keys = sh.getRange(2, meta.idx[keyName] + 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === String(keyValue)) { rowNo = i + 2; break; }
    }
    if (rowNo === -1) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
    current = sh.getRange(rowNo, 1, 1, width).getValues()[0];
    meta.headers.forEach(function (h, c) { if (h) merged[h] = cellUnsafe_(current[c]); });
  }
  merged._row = rowNo;
  Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
  const out = meta.headers.map(function (h) { return h ? toCell_(merged[h]) : ''; });
  sh.getRange(rowNo, 1, 1, width).setValues([out]);

  if (cachedAt !== -1) {
    // a new object (callers may still hold the old one); values as the sheet would return them
    const fresh = { _row: rowNo };
    meta.headers.forEach(function (h, c) { if (h) fresh[h] = sheetLike_(h, cellUnsafe_(out[c])); });
    meta.rows[cachedAt] = fresh;
  } else {
    meta.rows = null;
  }
  return merged;
}

/**
 * A written value as Sheets hands it back on the next read (column formats from setupSchema_): date strings in
 * date columns become Dates, numeric strings in number columns become numbers, TRUE/FALSE become booleans.
 * Keeps the patched cache identical to a fresh read.
 */
function sheetLike_(h, v) {
  if (typeof v !== 'string' || v === '') return v;
  if (DATE_COLS_.indexOf(h) !== -1 || DAY_COLS_.indexOf(h) !== -1) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - 7 * 3600000);   // Asia/Bangkok
    return v;
  }
  if (NUMBER_COLS_.indexOf(h) !== -1) return /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v;
  if (BOOL_COLS_.indexOf(h) !== -1) {
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v)) return false;
  }
  return v;
}

/**
 * Delete every row of `tab` for which pred(row) is true (retention only — business rows are never deleted).
 * Row numbers come from a fresh read inside the lock; deleted bottom-up in contiguous blocks.
 */
function deleteRowsWhere_(tab, pred) {
  if (LOCK_DEPTH_ === 0) throw new Error('deleteRowsWhere_ must run inside withLock_');
  invalidate_(tab);
  const meta = headers_(tab);
  const nums = rows_(tab).filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < nums.length) {
    let start = nums[i], count = 1;
    while (i + count < nums.length && nums[i + count] === start - 1) { start--; count++; }
    meta.sheet.deleteRows(start, count);
    i += count;
  }
  if (nums.length) { markDataChanged_(tab); invalidate_(tab); }
  return nums.length;
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
    if (NOTIF_DIRTY_) bumpNotifVersion_();
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
