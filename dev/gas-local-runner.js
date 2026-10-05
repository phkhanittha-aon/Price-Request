#!/usr/bin/env node
/**
 * File: dev/gas-local-runner.js
 * Developer tool — NOT deployed to Apps Script.
 *
 * Runs the gas/*.gs code under Node with in-memory mocks of SpreadsheetApp, LockService,
 * Session, Utilities, PropertiesService, DriveApp, so business rules and acceptance tests
 * can be verified before pasting code into the Apps Script editor.
 *
 *   node dev/gas-local-runner.js tests      # runAcceptanceTests()
 *   node dev/gas-local-runner.js seed       # setupDatabase() + seedDemoData() and print tab sizes
 *
 * The mocks implement only the API surface this project uses.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const OWNER = 'owner@example.co.th';
const FILE_ORDER = ['Config', 'Util', 'Db', 'Audit', 'Auth', 'Pricing', 'Notify', 'Workflow', 'Editing',
  'Api', 'Files', 'Lark', 'Jobs', 'Code', 'Setup', 'Tests'];

// ------------------------------------------------------------------ Sheets mock
class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error(`Invalid range ${row},${col},${numRows},${numCols}`);
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
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
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error(`setValues: dimensions mismatch (${values.length}x${values[0] && values[0].length} vs ${this.numRows}x${this.numCols})`);
    }
    for (let r = 0; r < this.numRows; r++) {
      const idx = this.row - 1 + r;
      this.sheet.data[idx] = this.sheet.data[idx] || [];
      for (let c = 0; c < this.numCols; c++) {
        const v = values[r][c];
        this.sheet.data[idx][this.col - 1 + c] = v instanceof Date ? new Date(v.getTime()) : v;
      }
    }
    this.sheet.maxRows = Math.max(this.sheet.maxRows, this.row + this.numRows - 1);
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { return this.setValues([[v]]); }
}
['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setDataValidation', 'setWrap'].forEach((m) => {
  MockRange.prototype[m] = function () { return this; };
});

class MockSheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) {
      if ((this.data[r] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r + 1;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((row) => (row || []).forEach((v, c) => { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, c + 1); }));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(_after, n) { this.maxCols += n; }
  getRange(row, col, numRows, numCols) {
    const range = new MockRange(this, row, col, numRows || 1, numCols || 1);
    if (col + (numCols || 1) - 1 > this.maxCols) this.maxCols = col + (numCols || 1) - 1;
    return range;
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
  setFrozenRows() { return this; }
  getProtections() { return []; }
  protect() {
    const editors = [{ getEmail: () => OWNER }];
    return {
      setDescription() { return this; }, setWarningOnly() { return this; }, addEditor() { return this; },
      getEditors() { return editors; }, removeEditors() { return this; }, canDomainEdit() { return false; }, setDomainEdit() { return this; }
    };
  }
}

class MockSpreadsheet {
  constructor(name) { this.id = crypto.randomUUID(); this.name = name; this.sheets = [new MockSheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new MockSheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setSpreadsheetTimeZone() { return this; }
}

const spreadsheets = {};
const SpreadsheetApp = {
  create(name) { const ss = new MockSpreadsheet(name); spreadsheets[ss.id] = ss; return ss; },
  openById(id) { if (!spreadsheets[id]) throw new Error('No spreadsheet ' + id); return spreadsheets[id]; },
  flush() {},
  newDataValidation() {
    const b = { requireValueInList() { return b; }, setAllowInvalid() { return b; }, build() { return {}; } };
    return b;
  },
  ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' }
};

// ------------------------------------------------------------------ Other services
let activeEmail = OWNER;
const Session = {
  getActiveUser: () => ({ getEmail: () => activeEmail }),
  getEffectiveUser: () => ({ getEmail: () => OWNER })
};

const LockService = {
  getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true })
};

const props = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; }
  })
};

function formatDate(date, tz, pattern) {
  if (tz !== 'Asia/Bangkok') throw new Error('mock formatDate supports Asia/Bangkok only');
  const d = new Date(date.getTime() + 7 * 3600 * 1000);
  const pad = (n, w) => String(n).padStart(w || 2, '0');
  const map = {
    yyyy: String(d.getUTCFullYear()), MM: pad(d.getUTCMonth() + 1), dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()), mm: pad(d.getUTCMinutes()), ss: pad(d.getUTCSeconds())
  };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => map[t]);
}

const toBuf = (v) => Buffer.from(Array.isArray(v) ? v.map((b) => (b < 0 ? b + 256 : b)) : String(v), Array.isArray(v) ? undefined : 'utf8');
const Utilities = {
  getUuid: () => crypto.randomUUID(),
  base64Encode: (v) => toBuf(v).toString('base64'),
  base64Decode: (s) => Array.from(Buffer.from(String(s), 'base64')).map((b) => (b > 127 ? b - 256 : b)),
  newBlob: (v) => ({ getBytes: () => Array.from(toBuf(v)).map((b) => (b > 127 ? b - 256 : b)) }),
  DigestAlgorithm: { SHA_256: 'sha256' },
  Charset: { UTF_8: 'utf8' },
  computeDigest(alg, text) {
    return Array.from(crypto.createHash(alg).update(String(text), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
  },
  formatDate,
  sleep: () => {}
};

const cacheStore = {};
const CacheService = {
  getScriptCache: () => ({
    get: (k) => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { if (String(v).length > 100000) throw new Error('Cache value too large'); cacheStore[k] = String(v); },
    remove: (k) => { delete cacheStore[k]; }
  })
};

const triggers = [];
const triggerBuilder = (fn) => {
  const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b,
    onWeekDay: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
  return b;
};
const ScriptApp = {
  getOAuthToken: () => 'owner-token',
  getService: () => ({ getUrl: () => 'https://script.google.com/a/macros/example.co.th/s/FAKE/exec' }),
  getProjectTriggers: () => triggers.slice(),
  deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i !== -1) triggers.splice(i, 1); },
  newTrigger: triggerBuilder,
  WeekDay: { MONDAY: 'MONDAY' }
};

const UrlFetchApp = { fetch: () => { throw new Error('Real network call attempted in local test'); } };

const DriveApp = {
  createFolder: (name) => ({ getId: () => 'folder-' + crypto.randomUUID(), getName: () => name }),
  getFileById: () => ({ setTrashed: () => {} })
};

// ------------------------------------------------------------------ Load project
function createSandbox() {
  const gasDir = path.join(__dirname, '..', 'gas');
  const files = fs.readdirSync(gasDir).filter((f) => f.endsWith('.gs')).map((f) => f.replace(/\.gs$/, ''));
  const unknown = files.filter((f) => FILE_ORDER.indexOf(f) === -1);
  const ordered = FILE_ORDER.filter((f) => files.indexOf(f) !== -1).concat(unknown);
  const source = ordered.map((f) => `// ==== ${f}.gs ====\n` + fs.readFileSync(path.join(gasDir, f + '.gs'), 'utf8')).join('\n');
  const sandbox = {
    SpreadsheetApp, Session, LockService, PropertiesService, Utilities, DriveApp, CacheService, ScriptApp, UrlFetchApp, console,
    __setActiveEmail: (e) => { activeEmail = e; }
  };
  vm.createContext(sandbox);
  vm.runInContext(source + `
;globalThis.__api = { runAcceptanceTests, setupDatabase, seedDemoData, rows_, TAB, demoUsers_ };
globalThis.__call = function (fn, args, email) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(fn) || typeof globalThis[fn] !== 'function') return { ok: false, code: 'NO_FN', error: 'unknown function ' + fn };
  return withIdentity_(email, function () { return globalThis[fn].apply(null, args || []); });
};`, sandbox, { filename: 'gas-bundle.js' });
  return sandbox;
}

module.exports = { createSandbox };
// ------------------------------------------------------------------ Commands
if (require.main !== module) return;
const sandbox = createSandbox();
const cmd = process.argv[2] || 'tests';
if (cmd === 'tests') {
  const res = sandbox.__api.runAcceptanceTests();
  process.exit(res.failed ? 1 : 0);
} else if (cmd === 'seed') {
  sandbox.__api.setupDatabase();
  sandbox.__api.seedDemoData();
  const T = sandbox.__api.TAB;
  Object.keys(T).forEach((k) => console.log(T[k].padEnd(15), sandbox.__api.rows_(T[k]).length));
  console.log(sandbox.__api.rows_(T.TICKETS).map((t) => `${t.ticket_no}  ${t.status.padEnd(10)} ${t.stage}`).join('\n'));
} else {
  console.error('usage: node dev/gas-local-runner.js [tests|seed]');
  process.exit(2);
}
