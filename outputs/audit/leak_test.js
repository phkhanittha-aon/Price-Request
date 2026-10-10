#!/usr/bin/env node
/**
 * outputs/audit/leak_test.js — "Sales must never receive a single cost field" (AUDIT, never deployed).
 * Calls every read API as Sales (owner) and Sales Manager for requests in EVERY stage of the demo
 * database and scans the real JSON payload (not the screen) for cost keys, vendor names and
 * purchasing photos. Also scans the in-app notifications + Lark DM text Sales receives.
 *   node outputs/audit/leak_test.js
 */
'use strict';
const { boot, findCostKeys } = require('./audit_lib.js');
const A = boot();
const U = A.U;
const vendors = A.run('rows_(TAB.VENDORS).map(function (v) { return String(v.name); })');
const tickets = A.run('rows_(TAB.TICKETS).map(normTicket_)');
const results = [];
const check = (who, label, payload, extra) => {
  const hits = findCostKeys(payload);
  const text = JSON.stringify(payload);
  const vend = vendors.filter((v) => v.length > 4 && text.indexOf(v) !== -1);
  const shortfall = /supplier_shortfall_reason":"[^"]+/.test(text);
  const bad = hits.length || vend.length || (extra && extra(payload));
  results.push((bad ? 'FAIL' : 'PASS') + ' | ' + who + ' | ' + label + (hits.length ? ' | keys: ' + hits.slice(0, 4).join(' ; ') : '') +
    (vend.length ? ' | vendor names: ' + vend.join(', ') : '') + (shortfall ? ' | NOTE supplier_shortfall_reason present' : ''));
};
const sales = [U.salesFood1, U.salesFood2, U.salesFood3];
const asSalesSide = [U.mgrFood].concat(sales);

tickets.forEach((t) => {
  [t.requestor_email, U.mgrFood].forEach((e) => {
    const r = A.call('getTicket', [t.ticket_id], e);
    if (!r.ok) { results.push('INFO | ' + e + ' | getTicket ' + t.ticket_no + ' → ' + r.code); return; }
    check(e, 'getTicket ' + t.ticket_no + ' (' + t.stage + ')', r.data, (d) => (d.attachments || []).some((a) => a.category === 'quote_photo' || a.category === 'quotation'));
    const photoIds = A.run(`rows_(TAB.ATTACHMENTS).filter(function (a) { return String(a.ticket_id) === '${t.ticket_id}' && String(a.category) === 'quote_photo'; }).map(function (a) { return String(a.attachment_id); })`);
    if (photoIds.length) {
      const pv = A.call('getPhotoPreviews', [photoIds, 'thumb'], e);
      results.push((pv.ok && Object.keys(pv.data.previews || {}).length ? 'FAIL' : 'PASS') + ' | ' + e + ' | getPhotoPreviews ' + t.ticket_no + ' (' + photoIds.length + ' supplier photos)');
      const oa = A.call('openAttachment', [photoIds[0]], e);
      results.push((oa.ok ? 'FAIL' : 'PASS') + ' | ' + e + ' | openAttachment supplier photo ' + t.ticket_no + ' → ' + (oa.ok ? 'OPENED' : oa.code));
    }
  });
});
asSalesSide.forEach((e) => {
  ['getBootstrap', 'listTicketBoard', 'listDeals', 'getPoll', 'getNotifications', 'getSalesHistory'].forEach((fn) => {
    const r = A.call(fn, fn === 'getNotifications' ? [100] : [], e);
    if (r.ok) check(e, fn, r.data); else results.push('INFO | ' + e + ' | ' + fn + ' → ' + r.code);
  });
  const d = A.call('getDashboard', [{}], e); if (d.ok) check(e, 'getDashboard', d.data);
  ['listSuppliers', 'getGpSummary'].forEach((fn) => { const r = A.call(fn, [], e); results.push((r.ok ? 'FAIL' : 'PASS') + ' | ' + e + ' | ' + fn + ' → ' + (r.ok ? 'ALLOWED' : r.code)); });
  const sh = A.call('supplierHints', [tickets[0].ticket_id], e); results.push((sh.ok ? 'FAIL' : 'PASS') + ' | ' + e + ' | supplierHints → ' + (sh.ok ? 'ALLOWED' : sh.code));
});
// Lark DM / in-app notification text that went to Sales
const notif = A.run(`rows_(TAB.NOTIFICATIONS).filter(function (n) { return ${JSON.stringify(asSalesSide)}.indexOf(String(n.user_email)) !== -1; }).map(function (n) { return String(n.title) + ' ' + String(n.body); })`);
const notifVend = notif.filter((x) => vendors.some((v) => x.indexOf(v) !== -1));
const notifCost = notif.filter((x) => /ต้นทุน|GP\s*\d|landed|ค่าเคลียร์/i.test(x));
results.push((notifVend.length || notifCost.length ? 'FAIL' : 'PASS') + ' | sales side | ' + notif.length + ' notifications / Lark DMs scanned' +
  (notifVend.length ? ' | vendor in: ' + notifVend[0].slice(0, 120) : '') + (notifCost.length ? ' | cost words in: ' + notifCost[0].slice(0, 160) : ''));
const sellDm = notif.filter((x) => /ราคาขาย/.test(x)).slice(0, 1);
results.push('INFO | sales DM sample with selling price: ' + (sellDm[0] || '-').replace(/\s+/g, ' ').slice(0, 200));
// Lark GROUP cards (everyone in the group incl. Sales sees them)
const cards = A.run('rows_(TAB.NOTIF_LOG).map(function (n) { return String(n.summary); })');
const cardVend = cards.filter((x) => vendors.some((v) => x.indexOf(v) !== -1));
const cardCost = cards.filter((x) => /ต้นทุน\s*\d|GP\s*\d|\d+(\.\d+)?\s*บาท\/|landed/i.test(x));
results.push((cardVend.length || cardCost.length ? 'FAIL' : 'PASS') + ' | Lark group | ' + cards.length + ' cards scanned' + (cardCost.length ? ' | ' + cardCost[0].slice(0, 160) : ''));

console.log(results.join('\n'));
console.log('\n' + results.filter((r) => r.indexOf('FAIL') === 0).length + ' FAIL / ' + results.filter((r) => r.indexOf('PASS') === 0).length + ' PASS');
