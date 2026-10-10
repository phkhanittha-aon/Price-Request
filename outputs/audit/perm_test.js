#!/usr/bin/env node
/**
 * outputs/audit/perm_test.js — role × server action matrix (AUDIT, never deployed).
 * Every public function is called the way google.script.run would call it, as each role.
 * Allowed = { ok: true }, denied = FORBIDDEN / NOT_FOUND / NOT_REGISTERED / thrown guard.
 * Compares with the EXPECTED matrix and prints mismatches.  node outputs/audit/perm_test.js
 */
'use strict';
const { boot } = require('./audit_lib.js');
const A = boot();
const U = A.U;
const roles = ['sales', 'manager', 'gm', 'sr', 'sr_manager', 'admin'];
const who = { sales: U.salesFood1, manager: U.mgrFood, gm: U.gm, sr: U.sr1, sr_manager: U.srManager, admin: U.admin };
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const tk = (no) => A.run(`normTicket_(findOne_(TAB.TICKETS, 'ticket_no', '${no}'))`);

// fresh ticket owned by `sales` (pending_gm) for each probe
const newTicket = (email) => {
  const r = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Audit ' + Math.random().toString(36).slice(2, 6), due_date: inDays(3),
    items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง audit', net_weight: '80%', size: 'M', packing_size: '1 kg', qty: 10, uom: 'กก.', target_price: 0 }] }], email || U.salesFood1);
  return r.data.ticket;
};
const sourcing = tk('FPR-2610-0005');        // sales2 · sr2 · sourcing
const srmStage = tk('FPR-2610-0006');        // sales3 · sr1 · pending_sr_manager
const ack = tk('FPR-2610-0013');             // awaiting_sales_ack
const closed = tk('FPR-2610-0001');          // sales1 · closed

/** A fresh request pushed (as the real people) to `stage`, owned by `sales`. */
function toStage(stage, sales) {
  const t = newTicket(sales);
  const go = (e, a, x) => { const v = tk(t.ticket_no).version; const r = A.call('transitionTicket', [t.ticket_id, a, '', Object.assign({ expected_version: v }, x || {})], e); if (!r.ok) throw new Error(a + ' ' + JSON.stringify(r)); };
  go(U.gm, 'gm_approve');
  if (tk(t.ticket_no).stage === 'pending_assign') go(U.srManager, 'assign', { sr_email: U.sr1 });
  const owner = tk(t.ticket_no).sr_email;
  A.call('getTicket', [t.ticket_id], owner).data.checklist.filter((c) => c.is_required).forEach((c) => A.call('updateChecklist', [c.check_id, true, ''], owner));
  go(owner, 'doc_complete');
  const it = A.run(`activeItemsOf_('${t.ticket_id}')[0]`);
  const qs = [1, 2, 3].map((i) => ({ quote_id: A.run('Utilities.getUuid()'), vendor_name: 'V' + i, unit_price: 100 + i, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }));
  const sv = A.call('saveSourcingDraft', [t.ticket_id, [{ item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id }]], owner);
  if (!sv.ok) throw new Error('draft ' + JSON.stringify(sv));
  go(owner, 'submit_quote');
  if (stage === 'pending_sr_manager') return tk(t.ticket_no);
  go(U.srManager, 'srm_approve');
  if (stage === 'pending_gm_price') return tk(t.ticket_no);
  go(U.gm, 'gm_price_approve');
  return tk(t.ticket_no);
}

const denied = (r) => !r || r.ok === false;
const code = (r) => (r && r.ok === false ? r.code : r && r.ok ? 'ok' : 'thrown');

/** action → { expected: roles allowed, run(email) } */
const ACTIONS = [
  ['Bootstrap / menu', 'R', roles, (e) => A.call('getBootstrap', [], e)],
  ['List tickets (board)', 'R', roles, (e) => A.call('listTicketBoard', [], e)],
  ['Open OWN pending request (Sales1)', 'R', ['sales', 'manager', 'gm', 'admin'], (e) => A.call('getTicket', [newTicket().ticket_id], e)],
  ['Open OTHER Sales request (Sales2, sourcing)', 'R', ['manager', 'gm', 'sr', 'sr_manager', 'admin'], (e) => A.call('getTicket', [sourcing.ticket_id], e)],
  ['Create request', 'W', ['sales', 'admin'], (e) => A.call('createTicket', [{ requestor_email: U.salesFood1, customer_group: 'ร้านอาหาร', customer_name: 'Audit create', due_date: inDays(3),
    items: [{ product_group_code: 'FOOD-FISH', product_name: 'ปลา', net_weight: '100%', size: 'M', packing_size: '1 kg', qty: 1, uom: 'กก.', target_price: 0 }] }], e)],
  ['Edit request header (pending_gm, own)', 'W', ['sales', 'admin'], (e) => { const t = newTicket(); return A.call('updateTicketRequest', [t.ticket_id, { customer_name: 'แก้ชื่อ' }, t.version], e); }],
  ['GM approve (pending_gm)', 'W', ['gm', 'admin'], (e) => { const t = newTicket(); return A.call('transitionTicket', [t.ticket_id, 'gm_approve', '', { expected_version: t.version, sr_email: U.sr1 }], e); }],
  ['Cancel request (pending_gm, own)', 'W', ['sales', 'admin'], (e) => { const t = newTicket(); return A.call('transitionTicket', [t.ticket_id, e === U.admin ? 'admin_cancel' : 'cancel', 'x', { expected_version: t.version }], e); }],
  ['Save prices (sourcing, SR2 item)', 'W', ['admin'], (e) => { const t = tk('FPR-2610-0005'); const it = A.run(`activeItemsOf_('${t.ticket_id}')[0]`); return A.call('saveSourcingDraft', [t.ticket_id, [{ item_id: it.item_id, quotes: [] , gp_percent: '15' }]], e); }],
  ['SR Manager approve price', 'W', ['sr_manager', 'admin'], (e) => { const t = toStage('pending_sr_manager'); return A.call('transitionTicket', [t.ticket_id, 'srm_approve', '', { expected_version: t.version }], e); }],
  ['GM final approve price', 'W', ['gm', 'admin'], (e) => { const t = toStage('pending_gm_price'); return A.call('transitionTicket', [t.ticket_id, 'gm_price_approve', '', { expected_version: t.version }], e); }],
  ['Accept price on ANOTHER Sales request (Sales2)', 'W', ['admin'], (e) => { const t = toStage('awaiting_sales_ack', U.salesFood2); return A.call('transitionTicket', [t.ticket_id, 'accept', '', { expected_version: t.version }], e); }],
  ['Accept price on OWN request (Sales1)', 'W', ['sales', 'admin'], (e) => { const t = toStage('awaiting_sales_ack', U.salesFood1); return A.call('transitionTicket', [t.ticket_id, 'accept', '', { expected_version: t.version }], e); }],
  ['Delete request (soft)', 'W', ['admin'], (e) => { const t = newTicket(); return A.call('transitionTicket', [t.ticket_id, 'admin_delete', 'audit', { expected_version: t.version }], e); }],
  ['Supplier list', 'R', ['gm', 'sr', 'sr_manager', 'admin'], (e) => A.call('listSuppliers', [], e)],
  ['Supplier save', 'W', ['sr', 'sr_manager', 'admin'], (e) => A.call('saveSupplier', [{ name: 'Audit Supplier ' + e, supplier_type: 'import', default_currency: 'THB', default_vat_term: 'ex_vat' }], e)],
  ['Supplier hints (last prices)', 'R', ['gm', 'sr', 'sr_manager', 'admin'], (e) => A.call('supplierHints', [sourcing.ticket_id], e)],
  ['GP summary', 'R', ['gm', 'sr_manager', 'admin'], (e) => A.call('getGpSummary', [], e)],
  ['Deal follow-up list', 'R', roles, (e) => A.call('listDeals', [], e)],
  ['Reports dashboard (scoped: Sales/SR = own)', 'R', roles, (e) => A.call('getDashboard', [{}], e)],
  ['Sales history (form autofill; others get empty)', 'R', ['sales'], (e) => A.call('getSalesHistory', [], e)],
  ['Admin health', 'R', ['admin'], (e) => A.call('getAdminHealth', [], e)],
  ['Bot settings read', 'R', ['admin'], (e) => A.call('getBotSettings', [], e)],
  ['Bot settings write', 'W', ['admin'], (e) => A.call('saveBotSettings', ['fpr', { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/abcdefgh1234' }], e)],
  ['Verify audit chain', 'R', ['admin'], (e) => A.call('verifyLogChain', [], e)],
  ['setupDatabase (owner only)', 'W', [], (e) => A.call('setupDatabase', [], e)],
  ['seedDemoData (owner only)', 'W', [], (e) => A.call('seedDemoData', [], e)],
  ['installTriggers (owner only)', 'W', [], (e) => A.call('installTriggers', [], e)],
  ['Job: sendSlaReminders from browser', 'W', ['admin'], (e) => A.call('sendSlaReminders', [], e)],
  ['Job: runSelfTest from browser', 'W', ['admin'], (e) => A.call('runSelfTest', [], e)],
  ['testBots (sends to Lark group)', 'W', ['admin'], (e) => A.call('testBots', [], e)],
  ['buildMention (public helper, no auth)', 'R', [], (e) => A.call('buildMention', [U.gm], e)],
  ['Unregistered domain user → getTicket', 'R', [], () => A.call('getTicket', [sourcing.ticket_id], 'stranger@example.co.th')],
  ['Unregistered domain user → buildMention', 'R', [], () => A.call('buildMention', [U.gm], 'stranger@example.co.th')]
];

const rows = [];
let mismatches = 0;
ACTIONS.forEach(([name, rw, expected, fn]) => {
  const cells = roles.map((r) => {
    let res;
    try { res = fn(who[r]); } catch (err) { res = { ok: false, code: 'THROWN:' + String(err.message).slice(0, 40) }; }
    // functions that do not use api_ return a raw value (string / array) → "allowed"
    const allowed = res !== null && res !== undefined && (res.ok === true || res.ok === undefined) && !(res.ok === true && res.data && res.data.customers && !res.data.customers.length && !res.data.products.length && r !== 'sales');
    const exp = expected.indexOf(r) !== -1;
    const bad = allowed !== exp;
    if (bad) mismatches++;
    return (allowed ? rw : '–') + (bad ? ' ⚠' + (allowed ? '' : '(' + code(res) + ')') : '');
  });
  rows.push('| ' + name + ' | ' + expected.map((r) => r).join(', ') + ' | ' + cells.join(' | ') + ' |');
});
console.log('| Action | Expected | ' + roles.join(' | ') + ' |');
console.log('|---|---|' + roles.map(() => '---').join('|') + '|');
console.log(rows.join('\n'));
console.log('\nMismatches: ' + mismatches);
