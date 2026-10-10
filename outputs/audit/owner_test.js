#!/usr/bin/env node
/** outputs/audit/owner_test.js — extra ownership checks (AUDIT, never deployed): pending_assign, SR Manager badge, notification channels. */
'use strict';
const { boot } = require('./audit_lib.js');
const A = boot();
const U = A.U;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const T = (id) => A.run(`ticketById_('${id}')`);
A.setSettings({ sales_manager_step: 'false', assign_by_group: 'true', min_suppliers: '1' });
const mk = (g) => A.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: 'Own', due_date: inDays(3), items: g.map((x) => ({ product_group_code: x, product_name: x, net_weight: '1', size: '1', packing_size: '1', qty: 1, uom: 'กก.', target_price: 0 })) }], U.salesFood1).data.ticket.ticket_id;
const badge = (e) => A.call('getPoll', [{}], e).data.inbox;
const acts = (e, id) => { const r = A.call('getTicket', [id], e); return r.ok ? r.data.permissions.actions.join('/') + (r.data.permissions.can_assign_items ? '/panel' : '') : r.code; };
// only Others → pending_assign
let id = mk(['FOOD-OTHERS']);
let b0 = { srm: badge(U.srManager), sr1: badge(U.sr1) };
A.call('transitionTicket', [id, 'gm_approve', '', { expected_version: T(id).version }], U.gm);
console.log('pending_assign (Others only): stage=' + T(id).stage + ' | SR1 buttons: ' + acts(U.sr1, id) + ' | SR2: ' + acts(U.sr2, id) + ' | SRMgr: ' + acts(U.srManager, id));
console.log('  badge delta → SRMgr ' + (badge(U.srManager) - b0.srm) + ' · SR1 ' + (badge(U.sr1) - b0.sr1) + '  (notified: ' + A.run(`stageAssignees_(ticketById_('${id}'))`).join(', ') + ')');
// mixed → doc_check with one unassigned item
b0 = { srm: badge(U.srManager) };
id = mk(['FOOD-SHRIMP', 'FOOD-OTHERS']);
A.call('transitionTicket', [id, 'gm_approve', '', { expected_version: T(id).version }], U.gm);
console.log('doc_check with Others unassigned: SRMgr badge delta = ' + (badge(U.srManager) - b0.srm) + ' (SR Manager must split, but is it in their “รอฉัน”?)');
// notification channels for one transition
const n0 = A.run(`rows_(TAB.NOTIFICATIONS).length`), c0 = A.run(`rows_(TAB.NOTIF_LOG).length`);
id = mk(['FOOD-SHRIMP']);
const n1 = A.run(`rows_(TAB.NOTIFICATIONS).length`), c1 = A.run(`rows_(TAB.NOTIF_LOG).length`);
console.log('one new request → in-app/Lark-DM rows: ' + (n1 - n0) + ' · group-card rows: ' + (c1 - c0) + ' (GM gets: bell + Lark DM (if Lark app set) + @mention in group card)');
// two SLA engines
const t = T(id);
A.run(`withLock_(function () { updateRow_(TAB.TICKETS, '${id}', { stage_entered_at: new Date(Date.now() - 30 * 3600000) }); })`);
const board = A.call('listTicketBoard', [], U.gm).data.rows.filter((r) => r.ticket_id === id)[0];
const page = A.call('getTicket', [id], U.gm).data.sla;
console.log('SLA after 30 calendar hours in GM_REVIEW → list/badge: ' + board.sla_status + ' (Settings sla_hours.pending_gm=' + A.run(`setting_('sla_hours',{}).pending_gm`) + ' h) · request page: overdue=' + page.overdue + ' due ' + page.due_text + ' (fpr_sla 4 working h)');
