/**
 * File: Util.gs
 * Shared helpers: structured results, business errors, parsing, dates, hashing.
 * Every function ending with "_" is private — google.script.run cannot call it.
 */

// ---------------------------------------------------------------- Service seams (tests swap these; production uses the real services)

let TEST_HTTP_ = null;     // fake UrlFetchApp
let TEST_DRIVE_ = null;    // fake DriveApp
let TEST_LARK_ = null;     // fake Lark config { app_id, app_secret, host, group_chat_id }

function http_() { return TEST_HTTP_ || UrlFetchApp; }
function drive_() { return TEST_DRIVE_ || DriveApp; }

// ---------------------------------------------------------------- Errors & results

/** Business error: `message` is Thai text safe to show users, `code` is for the UI logic. */
function appError_(code, message, details) {
  const e = new Error(message);
  e.name = 'AppError';
  e.code = code;
  e.isApp = true;
  if (details !== undefined) e.details = details;
  return e;
}

/**
 * Wraps every public API function: never throws to the client, always returns
 * { ok: true, data } or { ok: false, code, error, details? }.
 */
function api_(fnName, fn) {
  try {
    const data = fn();
    // Lark cards queued during the request are sent only now, after everything is committed (Bots.gs)
    if (BOT_QUEUE_.length) { try { flushBotQueue_(); } catch (e) { console.error('flushBotQueue_', e); } }
    return { ok: true, data: data };
  } catch (err) {
    BOT_QUEUE_ = [];   // nothing was approved → nothing is announced
    if (err && err.isApp) {
      return { ok: false, code: err.code, error: err.message, details: err.details || null };
    }
    logError_(fnName, err);
    return { ok: false, code: 'SYSTEM_ERROR', error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ (' + fnName + ')' };
  }
}

function logError_(fnName, err, context) {
  const message = err && err.message ? err.message : String(err);
  console.error(fnName, message, err && err.stack);
  try {
    const sh = db_().getSheetByName(TAB.ERRORS);
    if (sh) {
      sh.appendRow([
        new Date(), fnName, safeEmail_(), (err && err.code) || '', message.slice(0, 1000),
        String((err && err.stack) || '').slice(0, 3000), JSON.stringify(context || {}).slice(0, 2000), APP_VERSION
      ]);
    }
  } catch (e) {
    console.error('logError_ failed', e);
  }
}

function safeEmail_() {
  try { return currentEmail_(); } catch (e) { return ''; }
}

// ---------------------------------------------------------------- Ids & hashing

function uuid_() {
  return Utilities.getUuid();
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// ---------------------------------------------------------------- Text & numbers

function cleanText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/ /g, ' ').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function requireText_(v, field, maxLen) {
  const s = cleanText_(v, maxLen || CFG.MAX_TEXT);
  if (!s) throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  return s;
}

/**
 * Strict number parser. Blank → null when allowBlank, otherwise error.
 * Never turns garbage into 0 (a silent 0 on a price is a commercial error).
 * opts: { allowBlank, min, gt, max, integer }
 */
function toNumber_(v, field, opts) {
  const o = opts || {};
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (o.allowBlank) return null;
    throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  }
  let n;
  if (typeof v === 'number') {
    n = v;
  } else {
    const s = String(v).replace(/ /g, '').replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw appError_('VALIDATION', field + ' ต้องเป็นตัวเลข');
    n = Number(s);
  }
  if (!isFinite(n)) throw appError_('VALIDATION', field + ' ต้องเป็นตัวเลข');
  if (o.integer && Math.floor(n) !== n) throw appError_('VALIDATION', field + ' ต้องเป็นจำนวนเต็ม');
  if (o.gt !== undefined && !(n > o.gt)) throw appError_('VALIDATION', field + ' ต้องมากกว่า ' + o.gt);
  if (o.min !== undefined && n < o.min) throw appError_('VALIDATION', field + ' ต้องไม่น้อยกว่า ' + o.min);
  if (o.max !== undefined && n > o.max) throw appError_('VALIDATION', field + ' ต้องไม่เกิน ' + o.max);
  return n;
}

function round_(n, digits) {
  const f = Math.pow(10, digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}

function toBool_(v) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function oneOf_(v, allowed, field) {
  const s = cleanText_(v);
  if (allowed.indexOf(s) === -1) throw appError_('VALIDATION', field + ' ไม่ถูกต้อง');
  return s;
}

function parseJson_(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text === 'object') return text;
  try { return JSON.parse(String(text)); } catch (e) { return fallback; }
}

/** Prevent formula injection for user text written into cells. */
function cellSafe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** Undo cellSafe_ prefix when reading back. */
function cellUnsafe_(v) {
  if (typeof v === 'string' && /^'[=+\-@]/.test(v)) return v.slice(1);
  return v;
}

// ---------------------------------------------------------------- Dates (Asia/Bangkok)

function fmtDate_(d, pattern) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CFG.TZ, pattern || 'yyyy-MM-dd');
}

function todayBkk_() {
  return fmtDate_(new Date(), 'yyyy-MM-dd');
}

/** Parse 'yyyy-MM-dd' explicitly (never new Date(ambiguousString)). Returns Date at 00:00 Bangkok. */
function parseYmd_(v, field, allowBlank) {
  if (v instanceof Date) return v;
  const s = cleanText_(v);
  if (!s) {
    if (allowBlank) return '';
    throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw appError_('VALIDATION', field + ' ต้องอยู่ในรูปแบบ ปปปป-ดด-วว');
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  // 00:00 Asia/Bangkok = 17:00 UTC of the previous day
  const date = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 7 * 3600 * 1000);
  if (fmtDate_(date) !== s) throw appError_('VALIDATION', field + ' ไม่ใช่วันที่ที่ถูกต้อง');
  return date;
}

function isoOrBlank_(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function hoursBetween_(a, b) {
  return (b.getTime() - a.getTime()) / 3600000;
}
