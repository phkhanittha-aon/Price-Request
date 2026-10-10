/**
 * outputs/audit/audit_lib.js — AUDIT HARNESS, never deployed (lives outside gas/).
 * Loads the real gas/*.gs into the Node sandbox of dev/gas-local-runner.js (in-memory Sheets / Drive /
 * Properties mocks), builds a FRESH demo database (no production data is touched) and lets a test
 * call any public server function exactly like google.script.run would: as a given user, with the
 * result serialised through JSON (google.script.run drops Date objects / functions).
 */
'use strict';
const vm = require('vm');
const path = require('path');
const { createSandbox } = require(path.join(__dirname, '..', '..', 'dev', 'gas-local-runner.js'));

function boot(opts) {
  const o = opts || {};
  const sb = createSandbox();
  sb.__setActiveEmail('owner@example.co.th');   // script owner runs setup, like in the editor
  sb.__api.setupDatabase();
  if (o.seed !== false) sb.__api.seedDemoData();
  const run = function (code) { return vm.runInContext(code, sb); };
  run('TEST_HTTP_ = fakeHttp_(); TEST_DRIVE_ = fakeDrive_();');
  const U = sb.__api.demoUsers_();
  // count sheet reads (getValues) — I/O audit
  const proto = Object.getPrototypeOf(run('sheet_(TAB.TICKETS).getRange(1, 1, 1, 1)'));
  const orig = proto.getValues;
  let reads = 0;
  proto.getValues = function () { reads++; return orig.apply(this, arguments); };
  /** Call a public function as `email` (also sets Session.getActiveUser, like a real browser call). */
  const call = function (fn, args, email) {
    sb.__setActiveEmail(email);
    const before = reads;
    let raw;
    try { raw = sb.__call(fn, args || [], email); } catch (e) { raw = { ok: false, code: 'THROWN', error: String(e && e.message || e) }; }
    const hasDate = (function scan(v, d) { if (d > 12 || v === null || v === undefined) return false; if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return true; if (typeof v === 'object') return Object.keys(v).some(function (k) { return scan(v[k], d + 1); }); return false; })(raw, 0);
    const out = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
    if (out && typeof out === 'object') Object.defineProperty(out, '__meta', { value: { reads: reads - before, hasDate: hasDate }, enumerable: false });
    return out;
  };
  const setSettings = function (kv) { run('setTestSettings_(' + JSON.stringify(kv) + ')'); };
  return { sb: sb, run: run, call: call, U: U, setSettings: setSettings, reads: function () { return reads; } };
}

const ROLES = { sales: 'salesFood1', sales_other: 'salesFood2', manager: 'mgrFood', gm: 'gm', sr: 'sr1', sr_other: 'sr2', sr_manager: 'srManager', admin: 'admin' };

/** Cost / purchasing keys that must never reach Sales or the Sales Manager. */
const COST_KEYS = ['unit_price', 'net_unit_cost', 'net_unit_cost_thb', 'gross_unit_price_thb', 'landed_unit_cost_thb', 'landed_cost_thb',
  'clearance_thb', 'clearance_per_kg', 'cost_breakdown', 'cost_breakdown_json', 'gp_percent', 'profit_thb', 'product_cost_thb', 'vendor_name', 'vendor_id',
  'fx_rate', 'total_cost_thb', 'grand_total_cost_thb', 'winners', 'quotations', 'cost_rank', 'is_cheapest', 'supplier_warnings', 'margin', 'gp'];

/** Every path in `obj` whose key is a cost key and whose value is not empty. */
function findCostKeys(obj) {
  const hits = [];
  (function walk(v, p) {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { v.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
    if (typeof v !== 'object') return;
    Object.keys(v).forEach(function (k) {
      const val = v[k];
      const empty = val === null || val === '' || val === undefined || (Array.isArray(val) && !val.length);
      if (COST_KEYS.indexOf(k) !== -1 && !empty) hits.push(p + '.' + k + '=' + JSON.stringify(val).slice(0, 60));
      walk(val, p + '.' + k);
    });
  })(obj, '$');
  return hits;
}

module.exports = { boot: boot, ROLES: ROLES, findCostKeys: findCostKeys, COST_KEYS: COST_KEYS };
