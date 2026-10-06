/**
 * File: dev/gas-browser-mocks.js
 * Developer tool — NOT deployed to Apps Script.
 * In-memory browser versions of the Google services this project uses, so the real gas/*.gs
 * code can run inside a static prototype page (see dev/build-prototype.js).
 * Inlined by the build inside an IIFE — nothing here leaks to window.
 */
/* global window */
var OWNER_EMAIL_ = 'owner@example.co.th';
var ACTIVE_EMAIL_ = OWNER_EMAIL_;

// ---------------------------------------------------------------- SHA-256 (sync, for the audit hash chain)
function sha256Bytes_(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const bytes = [];
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
  const w = new Array(64);
  const rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = [];
  H.forEach(function (x) { for (let i = 3; i >= 0; i--) { const v = (x >>> (i * 8)) & 0xff; out.push(v > 127 ? v - 256 : v); } });
  return out;
}

// ---------------------------------------------------------------- Sheets
function MockRange_(sheet, row, col, numRows, numCols) {
  this.sheet = sheet; this.row = row; this.col = col; this.numRows = numRows; this.numCols = numCols;
}
MockRange_.prototype.getValues = function () {
  const out = [];
  for (let r = 0; r < this.numRows; r++) {
    const src = this.sheet.data[this.row - 1 + r] || [];
    const line = [];
    for (let c = 0; c < this.numCols; c++) {
      const v = src[this.col - 1 + c];
      line.push(v === undefined || v === null ? '' : v instanceof Date ? new Date(v.getTime()) : v);
    }
    out.push(line);
  }
  return out;
};
MockRange_.prototype.setValues = function (values) {
  for (let r = 0; r < this.numRows; r++) {
    const idx = this.row - 1 + r;
    this.sheet.data[idx] = this.sheet.data[idx] || [];
    for (let c = 0; c < this.numCols; c++) {
      const v = values[r][c];
      this.sheet.data[idx][this.col - 1 + c] = v instanceof Date ? new Date(v.getTime()) : v;
    }
  }
  return this;
};
MockRange_.prototype.getValue = function () { return this.getValues()[0][0]; };
MockRange_.prototype.setValue = function (v) { return this.setValues([[v]]); };
['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setDataValidation', 'setWrap'].forEach(function (m) {
  MockRange_.prototype[m] = function () { return this; };
});

function MockSheet_(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
MockSheet_.prototype.getName = function () { return this.name; };
MockSheet_.prototype.getLastRow = function () {
  for (let r = this.data.length - 1; r >= 0; r--) {
    if ((this.data[r] || []).some(function (v) { return v !== '' && v !== undefined && v !== null; })) return r + 1;
  }
  return 0;
};
MockSheet_.prototype.getLastColumn = function () {
  let max = 0;
  this.data.forEach(function (row) { (row || []).forEach(function (v, c) { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, c + 1); }); });
  return max;
};
MockSheet_.prototype.getMaxRows = function () { return this.maxRows; };
MockSheet_.prototype.getMaxColumns = function () { return this.maxCols; };
MockSheet_.prototype.insertColumnsAfter = function (_a, n) { this.maxCols += n; };
MockSheet_.prototype.getRange = function (row, col, numRows, numCols) {
  if (col + (numCols || 1) - 1 > this.maxCols) this.maxCols = col + (numCols || 1) - 1;
  return new MockRange_(this, row, col, numRows || 1, numCols || 1);
};
MockSheet_.prototype.appendRow = function (values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; };
MockSheet_.prototype.setFrozenRows = function () { return this; };
MockSheet_.prototype.getProtections = function () { return []; };
MockSheet_.prototype.protect = function () {
  const p = { setDescription: function () { return p; }, setWarningOnly: function () { return p; }, addEditor: function () { return p; },
    getEditors: function () { return []; }, removeEditors: function () { return p; }, canDomainEdit: function () { return false; }, setDomainEdit: function () { return p; } };
  return p;
};

function MockSpreadsheet_(name) { this.id = 'ss-' + Math.random().toString(36).slice(2); this.name = name; this.sheets = [new MockSheet_('Sheet1')]; }
MockSpreadsheet_.prototype.getId = function () { return this.id; };
MockSpreadsheet_.prototype.getName = function () { return this.name; };
MockSpreadsheet_.prototype.getUrl = function () { return '#'; };
MockSpreadsheet_.prototype.getSheetByName = function (n) { return this.sheets.filter(function (s) { return s.name === n; })[0] || null; };
MockSpreadsheet_.prototype.getSheets = function () { return this.sheets.slice(); };
MockSpreadsheet_.prototype.insertSheet = function (n) { const s = new MockSheet_(n); this.sheets.push(s); return s; };
MockSpreadsheet_.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };
MockSpreadsheet_.prototype.setSpreadsheetTimeZone = function () { return this; };

var MOCK_SHEETS_ = {};
var SpreadsheetApp = {
  create: function (name) { const ss = new MockSpreadsheet_(name); MOCK_SHEETS_[ss.id] = ss; return ss; },
  openById: function (id) { return MOCK_SHEETS_[id]; },
  flush: function () {},
  newDataValidation: function () {
    const b = { requireValueInList: function () { return b; }, setAllowInvalid: function () { return b; }, build: function () { return {}; } };
    return b;
  },
  ProtectionType: { SHEET: 'SHEET' }
};

// ---------------------------------------------------------------- Other services
var Session = {
  getActiveUser: function () { return { getEmail: function () { return ACTIVE_EMAIL_; } }; },
  getEffectiveUser: function () { return { getEmail: function () { return OWNER_EMAIL_; } }; }
};
var LockService = { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
var MOCK_PROPS_ = {};
var PropertiesService = {
  getScriptProperties: function () {
    return {
      getProperty: function (k) { return k in MOCK_PROPS_ ? MOCK_PROPS_[k] : null; },
      setProperty: function (k, v) { MOCK_PROPS_[k] = String(v); },
      deleteProperty: function (k) { delete MOCK_PROPS_[k]; }
    };
  }
};
var MOCK_CACHE_ = {};
var CacheService = {
  getScriptCache: function () {
    return { get: function (k) { return k in MOCK_CACHE_ ? MOCK_CACHE_[k] : null; }, put: function (k, v) { MOCK_CACHE_[k] = String(v); },
      remove: function (k) { delete MOCK_CACHE_[k]; } };
  }
};
function bytesToBinary_(v) {
  if (!Array.isArray(v)) return unescape(encodeURIComponent(String(v)));
  let s = '';
  for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i] < 0 ? v[i] + 256 : v[i]);
  return s;
}
var Utilities = {
  getUuid: function () {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  },
  DigestAlgorithm: { SHA_256: 'sha256' },
  Charset: { UTF_8: 'utf8' },
  computeDigest: function (_alg, text) { return sha256Bytes_(String(text)); },
  base64Encode: function (v) { return btoa(bytesToBinary_(v)); },
  base64Decode: function (s) {
    const bin = atob(String(s));
    const out = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) { const b = bin.charCodeAt(i); out[i] = b > 127 ? b - 256 : b; }
    return out;
  },
  formatDate: function (date, _tz, pattern) {
    const d = new Date(date.getTime() + 7 * 3600 * 1000);
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const map = { yyyy: String(d.getUTCFullYear()), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()), HH: pad(d.getUTCHours()),
      mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds()) };
    return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, function (t) { return map[t]; });
  },
  sleep: function () {}
};
var DriveApp = {
  createFolder: function (name) { return { getId: function () { return 'folder-' + name; } }; },
  getFileById: function () { return { setTrashed: function () {} }; },
  getFolderById: function () {
    return { getFoldersByName: function () { return { hasNext: function () { return false; } }; },
      createFolder: function (n) { return { getId: function () { return 'folder-' + n; } }; } };
  }
};
var ScriptApp = {
  getOAuthToken: function () { return 'prototype'; },
  getService: function () { return { getUrl: function () { return ''; } }; },
  getProjectTriggers: function () { return []; }
};
var UrlFetchApp = { fetch: function () { throw new Error('Prototype: no network'); } };
var HtmlService = {};
