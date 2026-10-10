#!/usr/bin/env node
/**
 * outputs/audit/flow_test.js — full loop + "who owns the job in each status" + absence (AUDIT, never deployed).
 * Production defaults (assign_by_group, min 3 suppliers, no Sales Manager step). One request with
 * 3 product groups (shrimp→SR1, fish→SR2, Others→nobody) walked from SUBMITTED to closed. At every
 * status: inbox badge (isAssignee_ = "งานค้างของฉัน"), who is notified (stageAssignees_), who has buttons.
 *   node outputs/audit/flow_test.js
 */
'use strict';
const { boot } = require('./audit_lib.js');
const A = boot();
const U = A.U;
const people = { Sales1: U.salesFood1, SalesMgr: U.mgrFood, GM: U.gm, SR1: U.sr1, SR2: U.sr2, SRMgr: U.srManager, Admin: U.admin };
const name = (e) => Object.keys(people).filter((k) => people[k] === e)[0] || e;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = (id) => A.run(`ticketById_('${id}')`);
const out = [];
let clicks = 0;
const go = (who, id, action, comment, extra) => {
  const r = A.call('transitionTicket', [id, action, comment || '', Object.assign({ expected_version: T(id).version }, extra || {})], who);
  if (!r.ok) throw new Error(action + ' as ' + name(who) + ' → ' + JSON.stringify(r));
  return r;
};
const snapshot = (id, label) => {
  const t = T(id);
  const ctx = A.run('listContext_()');
  const inbox = Object.keys(people).filter((k) => A.run(`(function(){ var u = userByEmail_('${people[k]}'); return isAssignee_(u, ticketById_('${id}'), listContext_()); })()`));
  const notified = A.run(`stageAssignees_(ticketById_('${id}'))`).map(name);
  const buttons = Object.keys(people).map((k) => {
    const r = A.call('getTicket', [id], people[k]);
    if (!r.ok) return null;
    const a = r.data.permissions.actions;
    const extra = [];
    if (r.data.permissions.can_assign_items) extra.push('panel แบ่งงาน');
    if (r.data.items.some((i) => i.can_transfer)) extra.push('โยกงาน');
    if (r.data.items.some((i) => i.can_edit_quotes)) extra.push('กรอกราคา');
    return a.length || extra.length ? k + ': ' + a.concat(extra).join('/') : null;
  }).filter(Boolean);
  const badges = Object.keys(people).map((k) => { const p = A.call('getPoll', [{}], people[k]); return p.ok && p.data.inbox ? k + '=' + p.data.inbox : null; }).filter(Boolean);
  out.push('| ' + label + ' | `' + t.stage + '` | ' + (inbox.join(', ') || '—') + ' | ' + (notified.join(', ') || '—') + ' | ' + (buttons.join('<br>') || '—') + ' |');
  return { inbox: inbox, badges: badges };
};

A.setSettings({ sales_manager_step: 'false', assign_by_group: 'true', min_suppliers: '3' });
const t0 = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Audit loop', due_date: inDays(3), client_key: 'audit-loop', items: [
  { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', net_weight: '80%', size: '31/40', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 },
  { product_group_code: 'FOOD-FISH', product_name: 'แซลมอน', net_weight: '100%', size: '1-2kg', packing_size: 'IVP', qty: 50, uom: 'กก.', target_price: 0 },
  { product_group_code: 'FOOD-OTHERS', product_name: 'ซอส', net_weight: '100%', size: '1.8L', packing_size: '6/ลัง', qty: 20, uom: 'ขวด', target_price: 0 }] }], U.salesFood1).data.ticket;
const id = t0.ticket_id; clicks += 1;
out.push('| Status | stage | งานค้างของ (inbox) | แจ้งเตือน (stageAssignees_) | มีปุ่ม/สิทธิ์ทำ |');
out.push('|---|---|---|---|---|');
snapshot(id, 'SUBMITTED → GM_REVIEW');
go(U.gm, id, 'gm_return', 'ขอขนาดชัดเจน'); snapshot(id, 'GM ตีกลับให้ผู้ขอ');
go(U.salesFood1, id, 'resubmit'); clicks += 2;
go(U.gm, id, 'gm_approve'); clicks += 2;
snapshot(id, 'ASSIGNED (SR1 กุ้ง, SR2 ปลา, Others ไม่มี SR)');
const items = A.run(`activeItemsOf_('${id}')`);
go(U.srManager, id, 'assign_items', '', { assignments: [{ item_id: items[2].item_id, sr_email: U.sr2 }] }); clicks += 3;
snapshot(id, 'doc_check หลัง SRM แบ่ง Others');
const ck = A.call('getTicket', [id], U.sr1).data.checklist.filter((c) => c.is_required);
ck.forEach((c) => A.call('updateChecklist', [c.check_id, true, ''], U.sr1)); clicks += ck.length;
go(U.sr1, id, 'request_info', 'ขอ % glaze', { missing_items: ['glazing'] }); snapshot(id, 'SR ขอข้อมูลเพิ่ม (need_info)');
go(U.salesFood1, id, 'respond_info', 'glaze 10%'); clicks += 2;
go(U.sr1, id, 'doc_complete'); clicks += 1;
snapshot(id, 'PRICING (ยังไม่มีใครส่ง)');
const q = (n, p) => ({ quote_id: A.run('Utilities.getUuid()'), vendor_name: n, unit_price: p, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) });
const draft = (who, it) => { const qs = [q('Sup A', 100), q('Sup B', 105), q('Sup C', 110)]; const r = A.call('saveSourcingDraft', [id, [{ item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id }]], who); if (!r.ok) throw new Error(JSON.stringify(r)); };
draft(U.sr1, items[0]); clicks += 3 * 6 + 2;   // 3 suppliers × ~6 fields + pick winner + save
go(U.sr1, id, 'submit_quote'); clicks += 2;
snapshot(id, 'PRICING — SR1 ส่งแล้ว, SR2 ยังไม่ส่ง');
draft(U.sr2, items[1]); draft(U.sr2, items[2]); clicks += 2 * (3 * 6 + 2);
go(U.sr2, id, 'submit_quote'); clicks += 2;
snapshot(id, 'SM_REVIEW');
go(U.srManager, id, 'srm_approve'); clicks += 2;
snapshot(id, 'GM_FINAL_REVIEW');
go(U.gm, id, 'gm_price_approve'); clicks += 2;
snapshot(id, 'APPROVED (รอ Sales รับทราบ)');
go(U.salesFood1, id, 'accept'); clicks += 2;
snapshot(id, 'ปิดงาน (closed)');
console.log(out.join('\n'));
console.log('\nLoop completed: ' + T(id).stage + ' · approx. clicks for the whole loop (all roles): ~' + clicks);

// duplicate submit (same client_key) → one record?
const dup = A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Audit loop', due_date: inDays(3), client_key: 'audit-loop', items: [
  { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', net_weight: '80%', size: '31/40', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 }] }], U.salesFood1);
console.log('Double submit same client_key → duplicate=' + dup.data.duplicate + ' same id=' + (dup.data.ticket.ticket_id === id));

// ---------------------------------------------------------------- absence (someone on leave)
console.log('\n### Absence / delegation');
const absent = (label, email, stage, actionWho) => {
  A.run(`withLock_(function () { updateRow_(TAB.USERS, '${email}', { is_active: false }); })`);
  const r = actionWho();
  A.run(`withLock_(function () { updateRow_(TAB.USERS, '${email}', { is_active: true }); })`);
  console.log('- ' + label + ' → ' + r);
};
const fresh = (groups) => A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Audit leave', due_date: inDays(3), items: groups.map((g) => (
  { product_group_code: g, product_name: 'x ' + g, net_weight: '1', size: '1', packing_size: '1', qty: 1, uom: 'กก.', target_price: 0 })) }], U.salesFood1).data.ticket.ticket_id;
let x = fresh(['FOOD-SHRIMP']);
absent('GM ลา (GM คนเดียว) ใบรอ GM_REVIEW', U.gm, 'pending_gm', () => {
  const others = A.run(`activeUsersByRole_('gm').length`);
  const adm = A.call('transitionTicket', [x, 'gm_approve', '', { expected_version: T(x).version }], U.admin);
  return 'GM ที่ active เหลือ ' + others + ' คน · Admin อนุมัติแทน: ' + (adm.ok ? 'ได้ (proxy GM: ' + (A.run(`(proxyUserFor_(ticketById_('${x}'), 'gm_approve', {}) || {}).email`) || 'ไม่มี') + ')' : adm.code + ' ' + adm.error);
});
x = fresh(['FOOD-SHRIMP']); go(U.gm, x, 'gm_approve');
absent('SR1 ลา มีรายการกุ้งค้างอยู่ (doc_check)', U.sr1, 'doc_check', () => {
  const tr = A.call('transitionTicket', [x, 'transfer_item', '', { expected_version: T(x).version, item_id: A.run(`activeItemsOf_('${x}')[0].item_id`), sr_email: U.sr2 }], U.srManager);
  return 'SR Manager โยกให้ SR2: ' + (tr.ok ? 'ได้' : tr.code) + ' · ใหม่ใน ProductGroups ยังชี้ SR1 → ใบใหม่กุ้งจะไปหา ' + (A.run(`groupSrOf_('FOOD-SHRIMP')`) || 'SR Manager (SR1 inactive)');
});
x = fresh(['FOOD-SHRIMP']);
absent('Sales1 ลา ใบอยู่ need_info / awaiting_sales_ack', U.salesFood1, 'need_info', () => {
  const r = A.call('getTicket', [x], U.salesFood2);
  return 'Sales คนอื่นเปิดใบ: ' + (r.ok ? 'ได้' : r.code) + ' · Sales Manager ตอบแทน: ' + (A.run(`allowedActions_(userByEmail_('${U.mgrFood}'), ticketById_('${x}')).join()`) || 'ไม่มีปุ่ม') + ' · เหลือ Admin ทำแทนเท่านั้น';
});
absent('SR Manager ลา ใบรอ SM_REVIEW', U.srManager, 'pending_sr_manager', () => 'SR Manager active เหลือ ' + A.run(`activeUsersByRole_('sr_manager').length`) + ' คน → Admin เท่านั้นที่อนุมัติแทนได้ (proxyUserFor_ หา SR Manager ที่ active ไม่เจอ = NO_PROXY)');
