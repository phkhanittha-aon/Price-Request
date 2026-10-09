#!/usr/bin/env node
/**
 * File: dev/portal-test.js
 * Developer tool — NOT deployed. Tests portal/Code.gs (the separate หน้ารวม web app) under Node:
 *   • Food summary computed from the Food demo database (gas/ seeded with the local runner)
 *   • Mech summary from sample rows of the MGS Project Pricing "Quotations" tab
 *   • who may open the portal
 *   node dev/portal-test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createSandbox } = require('./gas-local-runner.js');

/** Spreadsheet mock built from row objects ({tab: [objects]}) — only what readTable_ uses. */
function mockSpreadsheet(name, tables) {
  return {
    getName: () => name,
    getSheetByName(tab) {
      const rows = tables[tab];
      if (!rows) return null;
      const headers = rows.headers || Object.keys(rows[0] || {});
      const grid = [headers].concat(rows.map((r) => headers.map((h) => (r[h] === undefined ? '' : r[h]))));
      return {
        getLastRow: () => grid.length, getLastColumn: () => headers.length,
        getRange: (row, col, nr, nc) => ({ getValues: () => grid.slice(row - 1, row - 1 + nr).map((line) => line.slice(col - 1, col - 1 + nc)) })
      };
    }
  };
}

function mechRows(today) {
  const H = ['Id', 'DocType', 'DocNo', 'Title', 'Customer', 'Sales', 'Currency', 'Exrate', 'OfferDate', 'Status', 'Total', 'Cost', 'Profit', 'GP', 'UpdatedAt', 'Deleted', 'Detail'];
  const q = (id, type, no, title, cust, cur, ex, status, total, profit, gp, deleted) =>
    ({ Id: id, DocType: type, DocNo: no, Title: title, Customer: cust, Sales: 's', Currency: cur, Exrate: ex, OfferDate: today, Status: status,
       Total: total, Cost: total - profit, Profit: profit, GP: gp, UpdatedAt: today, Deleted: deleted || '', Detail: '{"huge":"json never read"}' });
  const rows = [
    q('1', 'SR', 'SR-1', 'Solar 500 kWp', 'A', 'THB', 0, 'Submitted', 0, 0, 0),
    q('1b', 'SR', 'SR-2', 'Draft one', 'A', 'THB', 0, 'Draft', 0, 0, 0),
    q('2', 'QT', 'QT-1', 'Inverter', 'B', 'THB', 0, 'Submitted', 1000000, 150000, 15),
    q('3', 'QT', 'QT-2', 'Mounting', 'C', 'USD', 35, 'Partial Approved', 10000, 2000, 20),
    q('4', 'QT', 'QT-3', 'Carport', 'D', 'THB', 0, 'Pending', 500000, 100000, 20),
    q('5', 'QT', 'QT-4', 'EV', 'E', 'THB', 0, 'Won', 300000, 45000, 15),
    q('6', 'QT', 'QT-5', 'Cable', 'F', 'THB', 0, 'Closed', 200000, 20000, 10),
    q('7', 'QT', 'QT-6', 'deleted one', 'G', 'THB', 0, 'Won', 999999, 0, 0, 'TRUE'),
    q('8', 'QT', 'QT-7', 'Euro offer', 'H', 'EUR', 0, 'Pending', 1000, 200, 20),
    q('9', 'QT', 'QT-8', 'Hybrid', 'I', 'THB', 0, 'Approved', 640000, 115200, 18)
  ];
  rows.headers = H;
  return rows;
}

/** Food demo database → { tab: [row objects] } (with schema headers). */
function foodTables() {
  const sb = createSandbox();
  sb.__api.setupDatabase();
  sb.__api.seedDemoData();
  const out = {};
  ['Tickets', 'TicketItems', 'Quotations', 'Settings', 'Users'].forEach((tab) => {
    const rows = sb.__api.rows_(tab);
    rows.headers = Object.keys(rows[0] || {});
    out[tab] = rows;
  });
  return out;
}

function loadPortal(env) {
  const props = Object.assign({}, env.props);
  const sandbox = {
    console: { log() {}, error() {}, warn() {} },
    Session: { getActiveUser: () => ({ getEmail: () => env.email }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    SpreadsheetApp: { openById: (id) => { if (!env.sheets[id]) throw new Error('no access to ' + id); return env.sheets[id]; } },
    HtmlService: {}, Intl, Date, JSON, Math, Number, String, Array, Object, isFinite, isNaN, RegExp, Error
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'portal', 'Code.gs'), 'utf8') +
    '\n;globalThis.__p = { getPortalData, summarizeFood_, summarizeMech_, readFoodTables_ };', sandbox);
  return sandbox.__p;
}

if (require.main === module) {
  const results = [];
  const ok = (c, name) => { results.push((c ? 'PASS: ' : 'FAIL: ') + name); };
  const today = new Date().toISOString().slice(0, 10);
  const food = foodTables();
  const sheets = { FOOD: mockSpreadsheet('Food DB', food), MECH: mockSpreadsheet('Mech', { Quotations: mechRows(today) }) };
  const props = { FOOD_SHEET_ID: 'FOOD', MECH_SHEET_ID: 'MECH', FOOD_WEBAPP_URL: 'https://food/exec', MECH_WEBAPP_URL: 'https://mech/exec', PORTAL_ALLOWED_EMAILS: 'bd.mgr@example.co.th, proc.mgr@example.co.th' };
  const as = (email, p) => loadPortal({ email, props: p || props, sheets }).getPortalData(true);

  // access
  const gm = as('gm@example.co.th');
  ok(gm.ok && gm.data.me.name.indexOf('GM') !== -1, 'Access: Food GM opens the portal');
  ok(as('sr.manager@example.co.th').ok && as('admin@example.co.th').ok, 'Access: Food SR Manager / Admin open the portal');
  ok(as('bd.mgr@example.co.th').ok, 'Access: Mech manager listed in PORTAL_ALLOWED_EMAILS opens the portal');
  ok(!as('sales.food1@example.co.th').ok && as('sales.food1@example.co.th').code === 'FORBIDDEN', 'Access: Sales cannot open the portal');
  ok(!as('mgr.food@example.co.th').ok && !as('sr1@example.co.th').ok, 'Access: Sales Manager / SR cannot open the portal (cost / GP inside)');
  ok(!as('stranger@other.com').ok && as('').code === 'NO_EMAIL', 'Access: unknown or anonymous users are refused');

  // food summary vs the Food app's own numbers
  const f = gm.data.food;
  const tickets = food.Tickets;
  const count = (st) => tickets.filter((t) => st.indexOf(String(t.stage)) !== -1).length;
  ok(f.configured && f.stages.req === count(['pending_manager', 'returned', 'pending_gm']) && f.stages.wip === count(['pending_assign', 'doc_check', 'need_info', 'sourcing']) &&
    f.stages.approval === count(['pending_sr_manager', 'pending_gm_price']), 'Food: stage counts match the Food tickets');
  ok(f.waiting_total === count(['pending_gm', 'pending_sr_manager', 'pending_gm_price']) && f.waiting.every((w) => w.doc_no && w.label), 'Food: waiting-for-management list');
  const sbFood = createSandbox(); sbFood.__api.setupDatabase(); sbFood.__api.seedDemoData();
  const gp = sbFood.__call('getGpSummary', [], 'gm@example.co.th');
  const lines = gp.data.rows;
  const won = lines.filter((r) => r.deal_status === 'won');
  const sum = (a, k) => a.reduce((s, r) => s + k(r), 0);
  ok(f.quoted === lines.length && f.won === won.length && f.lost === lines.filter((r) => r.deal_status === 'lost').length, 'Food: quoted / won / lost = the Food GP summary (' + lines.length + ' lines)');
  const gpPct = Math.round(sum(lines, (r) => r.profit_thb * r.qty) / sum(lines, (r) => r.sell_price_thb * r.qty) * 1000) / 10;
  ok(Math.abs(f.gp_percent - gpPct) <= 0.1, 'Food: weighted GP % = Food GP page (' + f.gp_percent + '% vs ' + gpPct + '%)');
  ok(Math.abs(f.won_value - Math.round(sum(won, (r) => r.sell_price_thb * r.qty))) <= 1, 'Food: won value / month = Σ selling price × volume');
  ok(f.trend.length === 6 && f.trend.reduce((s, x) => s + x.quoted, 0) <= f.quoted, 'Food: 6-month trend');

  // mech summary
  const m = gm.data.mech;
  ok(m.configured && m.stages.req === 1 && m.stages.approval === 2 && m.stages.approved === 1 && m.stages.ready === 2 && m.stages.won === 1 && m.stages.closed === 1,
    'Mech: statuses mapped (draft + deleted skipped)');
  ok(m.waiting_total === 2 && m.waiting[0].doc_no === 'QT-1' && m.waiting[1].value_thb === 350000, 'Mech: approval list, USD × quote rate');
  ok(m.ready_value === 500000 && m.won_value === 300000 && m.unconverted === 1, 'Mech: THB values; other currency counted separately');
  ok(m.close_rate === 20 && m.gp_percent === Math.round((115200 + 100000 + 45000 + 20000) / (640000 + 500000 + 300000 + 200000) * 1000) / 10, 'Mech: close rate + GP %');
  ok(m.trend[5].quoted === 5 && m.trend[5].won === 1, 'Mech: this month in the trend');
  ok(gm.data.links.food === 'https://food/exec' && gm.data.links.mech === 'https://mech/exec', 'Links to both pricing web apps');

  // not configured / no access to a sheet
  const noMech = as('gm@example.co.th', Object.assign({}, props, { MECH_SHEET_ID: '' }));
  ok(noMech.ok && noMech.data.mech.configured === false && noMech.data.food.configured, 'Mech not configured → card says so, Food still shown');
  const badMech = loadPortal({ email: 'gm@example.co.th', props: Object.assign({}, props, { MECH_SHEET_ID: 'NOPE' }), sheets }).getPortalData(true);
  ok(badMech.ok && /อ่านข้อมูลไม่สำเร็จ/.test(badMech.data.mech.error), 'No access to the Mech sheet → error on the Mech card only');
  const src = fs.readFileSync(path.join(__dirname, '..', 'portal', 'Code.gs'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'portal', 'appsscript.json'), 'utf8');
  ok(!/setValue|appendRow|insertRow|deleteRow|clear\(/.test(src) && /spreadsheets\.readonly/.test(src), 'Portal never writes: read-only scope, no write calls');

  const failed = results.filter((r) => r.indexOf('FAIL') === 0);
  console.log(results.join('\n') + '\n' + (failed.length ? '❌ ' + failed.length + ' FAILED' : '✅ ALL PORTAL TESTS PASSED') + ' — ' + (results.length - failed.length) + '/' + results.length);
  process.exit(failed.length ? 1 : 0);
}
module.exports = { mockSpreadsheet, mechRows, foodTables, loadPortal };
