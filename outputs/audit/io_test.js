#!/usr/bin/env node
/**
 * outputs/audit/io_test.js — sheet reads per server call + payload size + Date-in-payload (AUDIT, never deployed).
 * A read = one Range.getValues() (each one pulls a whole tab or key column in production: ~0.1–1 s on Apps Script).
 * Builds ~1 year of data (N tickets, default 300) so the numbers reflect production size.
 *   node outputs/audit/io_test.js [N]
 */
'use strict';
const { boot } = require('./audit_lib.js');
const N = Number(process.argv[2] || 300);
const A = boot();
const U = A.U;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = (id) => A.run(`ticketById_('${id}')`);
A.setSettings({ sales_manager_step: 'false', assign_by_group: 'true', min_suppliers: '1' });
const sales = [U.salesFood1, U.salesFood2, U.salesFood3];
const groups = ['FOOD-SHRIMP', 'FOOD-FISH', 'FOOD-CEPHALOPOD', 'FOOD-PROCESSED'];
const t0 = Date.now();
let closedIds = [];
for (let i = 0; i < N; i++) {
  const r = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Bulk ' + i, due_date: inDays(3), items: [0, 1, 2].map((k) => (
    { product_group_code: groups[(i + k) % 4], product_name: 'สินค้า ' + i + '-' + k, net_weight: '90%', size: 'M', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 })) }], sales[i % 3]);
  if (i % 3 === 0) {   // a third goes all the way to closed (quotes, logs, notifications)
    const id = r.data.ticket.ticket_id;
    const go = (w, a, x) => A.call('transitionTicket', [id, a, '', Object.assign({ expected_version: T(id).version }, x || {})], w);
    go(U.gm, 'gm_approve');
    if (T(id).stage === 'pending_assign') go(U.srManager, 'assign', { sr_email: U.sr1 });
    const srs = T(id).srs;
    const sr0 = srs[0];
    A.call('getTicket', [id], sr0).data.checklist.filter((c) => c.is_required).forEach((c) => A.call('updateChecklist', [c.check_id, true, ''], sr0));
    go(sr0, 'doc_complete');
    srs.forEach((sr) => {
      const mine = A.run(`activeItemsOf_('${id}')`).filter((it) => it.sr_email === sr);
      const rows = mine.map((it) => { const qs = [1, 2, 3].map((n) => ({ quote_id: A.run('Utilities.getUuid()'), vendor_name: 'V' + n, unit_price: 100 + n, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) })); return { item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id }; });
      A.call('saveSourcingDraft', [id, rows], sr);
      go(sr, 'submit_quote');
    });
    go(U.srManager, 'srm_approve'); go(U.gm, 'gm_price_approve'); go(sales[i % 3], 'accept');
    closedIds.push(id);
  }
}
console.log('Built ' + N + ' requests (' + closedIds.length + ' closed) in ' + Math.round((Date.now() - t0) / 1000) + ' s');
const tabs = A.run('Object.keys(TAB).map(function (k) { var h = headers_(TAB[k]); return [TAB[k], rows_(TAB[k]).length, h.headers.length]; })');
console.log('\n| Tab | rows | cols | cells |\n|---|---|---|---|');
let cells = 0;
tabs.forEach((t) => { cells += t[1] * t[2]; console.log('| ' + t[0] + ' | ' + t[1] + ' | ' + t[2] + ' | ' + t[1] * t[2] + ' |'); });
console.log('| **total** | | | **' + cells + '** (' + (cells / N).toFixed(0) + ' cells / request) |');

// fresh request for the write-path measurements
const fresh = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'IO', due_date: inDays(3), items: [0, 1, 2, 3, 4].map((k) => (
  { product_group_code: groups[k % 4], product_name: 'IO ' + k, net_weight: '1', size: '1', packing_size: '1', qty: 1, uom: 'กก.', target_price: 0 })) }], U.salesFood1).data.ticket;
const id = fresh.ticket_id;
const measure = [];
const m = (label, fn, args, who) => {
  A.run('TABLE_CACHE_ = {};');   // production: every google.script.run call is a new execution (cold cache)
  const r = A.call(fn, args, who);
  const size = JSON.stringify(r).length;
  measure.push('| ' + label + ' | ' + (r && r.__meta ? r.__meta.reads : '?') + ' | ' + (size / 1024).toFixed(1) + ' KB | ' + (r && r.__meta && r.__meta.hasDate ? '⚠ Date in payload' : 'ok') + ' | ' + (r && r.ok === false ? r.code : 'ok') + ' |');
  return r;
};
m('getBootstrap (Sales)', 'getBootstrap', [], U.salesFood1);
m('getBootstrap (SR — vendors in ref data)', 'getBootstrap', [], U.sr1);
m('listTicketBoard (Admin, all rows)', 'listTicketBoard', [], U.admin);
m('listTicketBoard (Sales)', 'listTicketBoard', [], U.salesFood1);
m('getPoll (every 60 s per open page)', 'getPoll', [{ home: 1 }], U.gm);
m('getTicket (GM)', 'getTicket', [id], U.gm);
m('getDashboard (GM)', 'getDashboard', [{}], U.gm);
m('listDeals (Sales Mgr)', 'listDeals', [], U.mgrFood);
m('getGpSummary (GM)', 'getGpSummary', [], U.gm);
A.call('transitionTicket', [id, 'gm_approve', '', { expected_version: T(id).version }], U.gm);
const srs = T(id).srs;
m('getTicket (SR, 5 items)', 'getTicket', [id], srs[0]);
A.call('getTicket', [id], srs[0]).data.checklist.filter((c) => c.is_required).forEach((c) => A.call('updateChecklist', [c.check_id, true, ''], srs[0]));
A.call('transitionTicket', [id, 'doc_complete', '', { expected_version: T(id).version }], srs[0]);
const mine = A.run(`activeItemsOf_('${id}')`).filter((it) => it.sr_email === srs[0]);
const rows = mine.map((it) => { const qs = [1, 2, 3, 4, 5].map((n) => ({ quote_id: A.run('Utilities.getUuid()'), vendor_name: 'V' + n, unit_price: 100 + n, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) })); return { item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id }; });
m('saveSourcingDraft (' + mine.length + ' items × 5 suppliers, first save)', 'saveSourcingDraft', [id, rows], srs[0]);
m('saveSourcingDraft (same data again, nothing changed)', 'saveSourcingDraft', [id, rows], srs[0]);
m('transition submit_quote', 'transitionTicket', [id, 'submit_quote', '', { expected_version: T(id).version }], srs[0]);
m('sendSlaReminders (hourly job)', 'sendSlaReminders', [], U.admin);
console.log('\n| Server call | sheet reads | payload | serialisation | result |\n|---|---|---|---|---|');
console.log(measure.join('\n'));
