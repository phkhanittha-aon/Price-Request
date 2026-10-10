#!/usr/bin/env node
/**
 * outputs/audit/edge_test.js — edge cases real users hit (AUDIT, never deployed).
 *   concurrency / stale page · number parsing · FX · formula / script text · row order · missing config · old data
 *   node outputs/audit/edge_test.js
 */
'use strict';
const { boot } = require('./audit_lib.js');
const A = boot();
const U = A.U;
const out = [];
const log = (ok, label, detail) => out.push((ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL') + ' | ' + label + (detail ? ' | ' + detail : ''));
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = (id) => A.run(`ticketById_('${id}')`);
const quotesOf = (itemId) => A.run(`activeQuotesOfItem_('${itemId}').map(function (q) { return q.vendor_name + '@' + q.unit_price; })`);
const uuid = () => A.run('Utilities.getUuid()');
const q = (n, p, x) => Object.assign({ quote_id: uuid(), vendor_name: n, unit_price: p, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }, x || {});

// a request in PRICING owned by SR1 (whole ticket)
A.setSettings({ sales_manager_step: 'false', assign_by_group: 'true', min_suppliers: '1' });
const mk = (items) => A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Edge', due_date: inDays(3), items: items || [
  { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', net_weight: '80%', size: 'M', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 }] }], U.salesFood1);
const toPricing = () => {
  const id = mk().data.ticket.ticket_id;
  const g = (w, a, x) => A.call('transitionTicket', [id, a, '', Object.assign({ expected_version: T(id).version }, x || {})], w);
  g(U.gm, 'gm_approve');
  A.call('getTicket', [id], U.sr1).data.checklist.filter((c) => c.is_required).forEach((c) => A.call('updateChecklist', [c.check_id, true, ''], U.sr1));
  g(U.sr1, 'doc_complete');
  return id;
};

// ---- 1. stale page: SR saves an old list after Admin added a supplier → silent delete?
let id = toPricing();
let it = A.run(`activeItemsOf_('${id}')[0]`);
const qa = q('Sup A', 100);
A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [qa], winner_quote_id: qa.quote_id }]], U.sr1);
const qd = q('Admin Sup D', 90);
A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [qa, qd], winner_quote_id: qa.quote_id }]], U.admin);
const afterAdmin = quotesOf(it.item_id);
A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [Object.assign({}, qa, { unit_price: 98 })], winner_quote_id: qa.quote_id }]], U.sr1);  // SR's page still shows only A
const afterSr = quotesOf(it.item_id);
log(afterSr.some((x) => /Admin Sup D/.test(x)), 'Stale page: Admin adds supplier D, SR saves old page', 'before ' + afterAdmin.join(', ') + ' → after ' + afterSr.join(', ') + ' (saveSourcingDraft has no version check; missing quotes are deleted)');

// ---- 2. double click on transitions / stale version
const t2 = mk().data.ticket;
const v = T(t2.ticket_id).version;
const r1 = A.call('transitionTicket', [t2.ticket_id, 'gm_approve', '', { expected_version: v }], U.gm);
const r2 = A.call('transitionTicket', [t2.ticket_id, 'gm_approve', '', { expected_version: v }], U.gm);
log(r1.ok && r2.code === 'VERSION_CONFLICT', 'Double click on approve', 'second → ' + r2.code);
const e1 = A.call('updateTicketRequest', [mk().data.ticket.ticket_id, { customer_name: 'x' }, 999], U.admin);
log(e1.code === 'VERSION_CONFLICT', 'Edit with stale version', e1.code);

// ---- 3. number parsing (qty on the form, unit price on a quotation)
const numCase = (raw) => {
  const r = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Num', due_date: inDays(3), items: [
    { product_group_code: 'FOOD-SHRIMP', product_name: 'n', net_weight: '1', size: '1', packing_size: '1', qty: raw, uom: 'กก.', target_price: 0 }] }], U.salesFood1);
  return r.ok ? 'stored ' + A.run(`activeItemsOf_('${r.data.ticket.ticket_id}')[0].qty`) : r.code;
};
['1,000', ' 12 ', '1 000', '12.5', '', 'abc', '-5', '0', '1e3', '๑๒', '12บาท'].forEach((raw) => log(null, 'qty "' + raw + '"', numCase(raw)));
id = toPricing(); it = A.run(`activeItemsOf_('${id}')[0]`);
['1,234.50', ' 99 ', '', 'abc', '-1', '0'].forEach((raw) => {
  const qq = q('P ' + raw, raw);
  const r = A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [qq], winner_quote_id: qq.quote_id }]], U.sr1);
  log(null, 'unit price "' + raw + '"', r.ok ? 'stored ' + quotesOf(it.item_id).join(',') : r.code + ' ' + r.error);
});

// ---- 4. FX + VAT + landed cost
const fx = (x) => {
  const qq = q('FX', x.price, x);
  const r = A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [qq], winner_quote_id: qq.quote_id, gp_percent: '15' }]], U.sr1);
  if (!r.ok) return r.code + ' ' + r.error;
  const s = A.run(`activeQuotesOfItem_('${it.item_id}')[0]`);
  const p = r.data.detail.items[0].pricing;
  return 'net THB ' + s.net_unit_cost_thb + ' · landed ' + s.landed_unit_cost_thb + ' · sell ' + p.sell_price_thb;
};
log(null, 'USD 3 × 35, no VAT', fx({ price: 3, currency: 'USD', fx_rate: 35, vat_term: 'no_vat' }) + ' (expect 105 / 105 / 123.53)');
log(null, 'THB 107 include VAT 7%', fx({ price: 107, vat_term: 'include_vat' }) + ' (expect net 100)');
log(null, 'USD with blank FX', fx({ price: 3, currency: 'USD', fx_rate: '', vat_term: 'no_vat' }));
log(null, 'USD with FX 0', fx({ price: 3, currency: 'USD', fx_rate: 0, vat_term: 'no_vat' }));
log(null, 'USD FX "35,5" (comma decimal)', fx({ price: 3, currency: 'USD', fx_rate: '35,5', vat_term: 'no_vat' }));
log(null, 'Breakdown: USD 3×35 + freight 5 + ins 0.5 + duty 10% + cold 2', fx({ price: 3, currency: 'USD', fx_rate: 35, vat_term: 'no_vat', cost_breakdown: { freight: 5, insurance: 0.5, duty_pct: 10, cold: 2 } }) + ' (expect landed 105+5+0.5+11.05+2 = 123.55)');

// ---- 5. formula / script text stored in the Sheet
const evil = '=IMPORTXML("http://x","//a")';
const xss = '<img src=x onerror=alert(1)>';
const r5 = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: evil, description: xss, due_date: inDays(3), items: [
  { product_group_code: 'FOOD-SHRIMP', product_name: xss, net_weight: '1', size: '1', packing_size: '1', qty: 1, uom: 'กก.', target_price: 0 }] }], U.salesFood1);
const raw = A.run(`(function () { var s = sheet_(TAB.TICKETS); var h = headers_(TAB.TICKETS); var row = rows_(TAB.TICKETS).filter(function (r) { return r.ticket_id === '${r5.data.ticket.ticket_id}'; })[0]; return s.getRange(row._row, h.idx.customer_name + 1).getValue(); })()`);
log(String(raw).charAt(0) !== '=', 'Formula injection: customer "' + evil + '"', 'cell holds ' + JSON.stringify(raw) + ' · read back ' + JSON.stringify(A.call('getTicket', [r5.data.ticket.ticket_id], U.salesFood1).data.ticket.customer_name));
log(null, 'Script text stored as-is (escaping is the page\'s job — see xss_e2e.js)', JSON.stringify(A.call('getTicket', [r5.data.ticket.ticket_id], U.salesFood1).data.items[0].product_name));

// ---- 6. rows re-ordered / blank row inserted in the Sheet
const before = A.run(`ticketById_('${id}').ticket_no`);
A.run(`(function () { var s = sheet_(TAB.TICKETS); var d = s.data; var head = d[0]; var body = d.slice(1).reverse(); body.splice(3, 0, []); s.data = [head].concat(body); s.maxRows = s.data.length; invalidate_(); })()`);
const afterSort = A.run(`ticketById_('${id}').ticket_no`);
const tr = A.call('transitionTicket', [id, 'request_info', 'หลังเรียงแถวใหม่', { expected_version: T(id).version }], U.sr1);
log(before === afterSort && tr.ok && T(id).stage === 'need_info', 'Sheet rows reversed + blank row inserted', 'lookup by key still finds ' + afterSort + ', transition saved to the right row');

// ---- 7. legacy single-SR ticket (production data before v2026.10.11-1: no sr_emails, no item sr_email)
id = toPricing(); it = A.run(`activeItemsOf_('${id}')[0]`);
A.run(`withLock_(function () { updateRow_(TAB.TICKETS, '${id}', { sr_emails: '' }); updateRow_(TAB.ITEMS, '${it.item_id}', { sr_email: '' }); })`);
const lq = q('Legacy Sup', 50);
const ls = A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: [lq], winner_quote_id: lq.quote_id }]], U.sr1);
const lsub = A.call('transitionTicket', [id, 'submit_quote', '', { expected_version: T(id).version }], U.sr1);
log(ls.ok && lsub.ok && T(id).stage === 'pending_sr_manager', 'Old ticket (no sr_emails / item sr_email)', 'SR prices + submits: ' + (ls.ok ? 'ok' : ls.code) + ' / ' + (lsub.ok ? 'ok' : lsub.code + ' ' + lsub.error));

// ---- 8. missing configuration
const prop = (k, v) => A.run(`PropertiesService.getScriptProperties().${v === null ? 'deleteProperty(\'' + k + '\')' : 'setProperty(\'' + k + '\', \'' + v + '\')'}`);
const dbId = A.run(`PropertiesService.getScriptProperties().getProperty(CFG.PROP.DB_ID)`);
const keep = A.run('DB_SS_');
A.run(`PropertiesService.getScriptProperties().deleteProperty(CFG.PROP.DB_ID); DB_SS_ = null; TABLE_CACHE_ = {};`);
const nb = A.call('getBootstrap', [], U.salesFood1);
log(nb.ok === false && /setupDatabase/.test(nb.error || ''), 'DB_ID property missing', nb.code + ' — ' + nb.error);
A.run(`PropertiesService.getScriptProperties().setProperty(CFG.PROP.DB_ID, '${dbId}'); DB_SS_ = null; TABLE_CACHE_ = {};`);
A.run(`(function(){ var ss = db_(); })()`);
const drv = A.run(`PropertiesService.getScriptProperties().getProperty(CFG.PROP.DRIVE_ROOT_ID)`);
A.run(`PropertiesService.getScriptProperties().deleteProperty(CFG.PROP.DRIVE_ROOT_ID); TEST_DRIVE_ = null;`);
const up = A.call('beginUpload', [{ ticket_id: mk().data.ticket.ticket_id, file_name: 'a.png', mime_type: 'image/png', size_bytes: 10, category: 'request' }], U.salesFood1);
log(up.ok === false, 'DRIVE_ROOT_ID missing → upload', up.ok ? 'ALLOWED' : up.code + ' — ' + up.error);
A.run(`TEST_DRIVE_ = fakeDrive_();`);
const hdr = A.run(`(function () { var s = sheet_(TAB.TICKETS); var old = s.data[0][3]; s.data[0][3] = 'renamed_col'; invalidate_(); var r; try { rows_(TAB.TICKETS); r = 'no error'; } catch (e) { r = e.code + ' ' + e.message; } s.data[0][3] = old; invalidate_(); return r; })()`);
log(/SCHEMA_DRIFT/.test(hdr), 'Header renamed in the Sheet', hdr);

console.log(out.join('\n'));
