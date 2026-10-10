/**
 * File: Notify.gs
 * Notification queue. Business functions only INSERT rows into the Notifications tab
 * (inside the same lock as the business write). Delivery to Lark is done afterwards by
 * a dispatcher (Phase 2), so a Lark outage can never block or roll back an approval.
 */

/** Users who must act on the ticket in its current stage. */
function stageAssignees_(t) {
  switch (t.stage) {
    case 'pending_manager': {
      const d = departmentByCode_(t.department_code);
      return [(d && d.manager_email) || t.manager_email];
    }
    case 'returned':
    case 'need_info':
    case 'awaiting_sales_ack':
      return [t.requestor_email];
    case 'pending_gm':
      return activeUsersByRole_('gm').map(function (u) { return u.email; });
    case 'pending_assign':
      // by product group: nothing matched an SR → the SR Manager splits the work · queue mode: any SR claims it
      return activeUsersByRole_(toBool_(setting_('assign_by_group', true)) ? 'sr_manager' : 'sr').map(function (u) { return u.email; });
    case 'doc_check':
    case 'sourcing': {
      const out = (t.srs || []).slice();
      // items nobody prices yet → the SR Manager has to give them to an SR
      if (activeItemsOf_(t.ticket_id).some(function (it) { return !it.quote_status && !itemOwner_(t, it); })) out.push.apply(out, roleEmails_('sr_manager'));
      return out;
    }
    case 'pending_sr_manager':
      return activeUsersByRole_('sr_manager').map(function (u) { return u.email; });
    case 'pending_gm_price':
      return activeUsersByRole_('gm').map(function (u) { return u.email; });
    default:
      return [];
  }
}

/** Supervisors to escalate to when an SLA is breached. */
function stageEscalation_(t) {
  if (t.stage === 'pending_manager' || t.stage === 'pending_sr_manager') {
    return activeUsersByRole_('gm').map(function (u) { return u.email; });
  }
  if (['pending_assign', 'doc_check', 'sourcing'].indexOf(t.stage) !== -1) {
    return activeUsersByRole_('sr_manager').map(function (u) { return u.email; });
  }
  if (['returned', 'need_info', 'awaiting_sales_ack'].indexOf(t.stage) !== -1) {
    const d = departmentByCode_(t.department_code);
    return d && d.manager_email ? [d.manager_email] : [];
  }
  return [];
}

/** Queue in-app (+ Lark) notifications. Skips blanks, duplicates, inactive users and the actor. */
function enqueueNotifications_(emails, t, type, title, body, link) {
  const actor = safeEmail_();
  const seen = {};
  const rowsToInsert = [];
  const now = new Date();
  (emails || []).forEach(function (raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || seen[email] || email === actor) return;
    seen[email] = true;
    const u = userByEmail_(email);
    if (!u || !u.is_active) return;
    rowsToInsert.push({
      notif_id: uuid_(),
      user_email: email,
      ticket_id: t ? t.ticket_id : '',
      type: type,
      title: title,
      body: body || '',
      link: link || '',
      is_read: false,
      read_at: '',
      created_at: now,
      lark_status: 'pending',
      lark_attempts: 0,
      lark_error: '',
      lark_sent_at: ''
    });
  });
  insertRows_(TAB.NOTIFICATIONS, rowsToInsert);
  return rowsToInsert.length;
}

/** Web-app deep link to a ticket page (deployed /exec URL, or Script Property WEBAPP_URL). */
function ticketLink_(t, page) {
  let base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
  if (!base) {
    try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; }
  }
  return base + '?page=' + (page || 'ticket') + '&id=' + encodeURIComponent(t.ticket_id);
}

/** Pseudo-recipient for the Lark group that is told when a price is finished (GM approved). */
const PRICE_GROUP_KEY_ = '#price_group';
/** Pseudo-recipient for the management Lark group (SR / SR Manager / GM — purchasing-side approvals). */
const MGMT_GROUP_KEY_ = '#mgmt_group';

/**
 * Group messages now go to ONE Lark group ("Food Price Request") through the custom bot "FPR Bot" — see Bots.gs.
 * RULE (unchanged): a group card NEVER carries a price, cost, vendor name or GP; free-text comments only for
 * sales-side decisions (request rejected / returned / cancelled), never for price reviews.
 */

/** transition → { event, extra } for the FPR Bot (null = no card). */
function groupEventOfTransition_(action, saved, note, meta) {
  const sales = [saved.requestor_email];
  const sr = (saved.srs || []).slice();
  switch (action) {
    case 'resubmit':
    case 'manager_approve': return saved.stage === 'pending_gm' ? { event: 'submitted', extra: {} } : null;
    case 'gm_approve':
      if (saved.stage === 'doc_check') return { event: 'assigned', extra: assignExtra_(saved, null) };
      return { event: 'queued', extra: meta && meta.unassigned ? { srs: roleEmails_('sr_manager'), lines: ['ยังไม่มี SR ประจำกลุ่มสินค้า — **SR Manager แบ่งงาน** ให้ SR'] } : {} };
    case 'claim':
    case 'assign': return { event: 'assigned', extra: assignExtra_(saved, null) };
    case 'assign_items':
    case 'transfer_item': return { event: 'assigned', extra: assignExtra_(saved, meta && meta.moves) };
    case 'queue_return':
    case 'request_info': return { event: 'need_info', extra: { lines: meta && meta.missing_items && meta.missing_items.length ? ['**ข้อมูลที่ต้องเพิ่ม:** ' + meta.missing_items.join(', ')] : [] } };
    case 'submit_quote': return saved.stage === 'pending_sr_manager' ? { event: 'sm_review', extra: { lines: reviewFacts_(saved) } } : null;   // partial: wait for the other SRs
    case 'srm_approve': return { event: 'gm_final', extra: { lines: reviewFacts_(saved) } };
    case 'gm_price_approve': return { event: 'approved', extra: { lines: ['ราคาขายส่งถึงผู้ขอในระบบแล้ว · ผู้ขอกด “รับทราบราคา” หรือ “ขอปรับราคา” ได้ในหน้ารายการ'] } };
    case 'srm_return':
    case 'gm_price_return': return { event: 'returned', extra: { fixer: sr, lines: ['ตีกลับให้ Sourcing แก้ราคา — ดูเหตุผลในระบบ'] } };
    case 'gm_return':
    case 'manager_return': return { event: 'returned', extra: { fixer: sales, reason: note, lines: ['ตีกลับให้ผู้ขอแก้ไขคำขอ แล้วส่งใหม่'] } };
    case 'manager_reject':
    case 'gm_reject': return { event: 'rejected', extra: { reason: note } };
    case 'srm_reject':
    case 'gm_price_reject': return { event: 'rejected', extra: { lines: ['ปฏิเสธในขั้นอนุมัติราคา — ดูเหตุผลในระบบ'] } };
    case 'cancel':
    case 'admin_cancel': return { event: 'cancelled', extra: { reason: note } };
    case 'request_revision': return { event: 'revision', extra: { lines: ['ผู้ขอขอให้ปรับราคา — ดูรายละเอียดในระบบ'] } };
    default: return null;
  }
}

/**
 * Who prices what (card lines + @mentions): "• คุณบอย SR — #1 กุ้ง, #3 หมึก" · items without an SR → SR Manager.
 * moves (assign_items / transfer_item): only the SRs who just received items are tagged.
 */
function assignExtra_(t, moves) {
  const names = {};
  const by = {}, order = [], none = [];
  activeItemsOf_(t.ticket_id).forEach(function (it) {
    if (it.quote_status) return;
    const o = itemOwner_(t, it);
    if (!o) { none.push('#' + it.line_no + ' ' + it.product_name); return; }
    if (!by[o]) { by[o] = []; order.push(o); }
    by[o].push('#' + it.line_no + ' ' + it.product_name);
  });
  const nm = function (e) { if (!names[e]) { const u = userByEmail_(e); names[e] = u ? u.full_name : e; } return names[e]; };
  const lines = order.map(function (e) { return '• **' + nm(e) + '** — ' + by[e].join(', '); });
  if (moves && moves.length) {
    lines.unshift('**โยกงาน:** ' + moves.map(function (m) { return '#' + m.line_no + ' ' + (m.from ? nm(m.from) : 'ยังไม่มี SR') + ' → ' + nm(m.to); }).join(' · '));
  }
  if (none.length) lines.push('⚠ **รอ SR Manager แบ่งงาน:** ' + none.join(', '));
  let srs = moves && moves.length ? moves.map(function (m) { return m.to; }) : order.slice();
  if (none.length) srs = srs.concat(roleEmails_('sr_manager'));
  return { srs: srs, lines: lines.length ? ['**SR ผู้ทำราคา**'].concat(lines) : [] };
}

function fmtQty_(n) {
  const v = Number(n);
  return isFinite(v) ? String(Math.round(v * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-';
}

/** Queue one FPR Bot card (sent after the request commits). Kept for callers: deal_won, follow_up, submitted … */
function enqueueGroupEvent_(event, t, extra) {
  return queueFprCard_(event, t, extra || {});
}

/** Facts for the management group when a price goes to review: how many offers / photos (never vendor names or prices). */
function reviewFacts_(t) {
  const items = activeItemsOf_(t.ticket_id).filter(function (it) { return !it.quote_status; });
  let offers = 0;
  let photos = 0;
  items.forEach(function (it) {
    activeQuotesOfItem_(it.item_id).forEach(function (q) { offers++; photos += quotePhotos_(q.quote_id).length; });
  });
  return ['Supplier ที่เสนอ: ' + offers + ' ราย · รูปสินค้า ' + photos + ' รูป — เปิดในระบบเพื่อดูราคาและรูปก่อนอนุมัติ'];
}

/**
 * Selling price lines of ONE ticket (winning offer only) — for the requesting Sales' own DM.
 * Never contains vendor, cost, clearance or GP.
 */
function sellPriceLines_(t) {
  return activeItemsOf_(t.ticket_id).map(function (it) {
    if (it.quote_status) return itemStatusLine_(it);
    const win = compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)).filter(function (q) { return q.is_selected; })[0];
    const sp = salesPricing_(it, win);
    const spec = [it.size, it.packing_size].filter(Boolean).join(' · ');
    return '**#' + it.line_no + ' ' + it.product_name + '**' + (spec ? ' (' + spec + ')' : '') + '\n' +
      'ราคาขาย **' + (sp ? money2_(sp.sell_price_thb) : '-') + ' บาท/' + it.uom + '**' +
      (sp && sp.valid_until ? ' · ยืนราคาถึง ' + sp.valid_until : '');
  });
}

/** "Price approved" group card — status only, NO prices. */
function enqueuePriceDoneGroup_(t) {
  return queueFprCard_('approved', t, {});
}

/** 1234.5 → "1,234.50" (Lark message text). */
function money2_(n) {
  const v = Number(n);
  if (!isFinite(v)) return '-';
  const parts = v.toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}

/** "#2 ปลาซาบะ — ไม่เสนอ (เหตุผล)" / "— ส่งราคาตามหลัง (PR-2026-0012)" */
function itemStatusLine_(it) {
  if (it.quote_status === 'follow_up') {
    const fu = it.follow_up_ticket_id ? ticketById_(it.follow_up_ticket_id) : null;
    return '**#' + it.line_no + ' ' + it.product_name + '** — ส่งราคาตามหลัง' + (fu ? ' (' + fu.ticket_no + ')' : '');
  }
  return '**#' + it.line_no + ' ' + it.product_name + '** — ไม่เสนอราคา' + (it.quote_status_reason ? ' (' + it.quote_status_reason + ')' : '');
}
