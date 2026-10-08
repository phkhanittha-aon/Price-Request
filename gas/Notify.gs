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
      return activeUsersByRole_('sr').map(function (u) { return u.email; });
    case 'doc_check':
    case 'sourcing':
      return [t.sr_email];
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
 * Automatic Lark group messages. Each event goes to ONE group:
 *   sales = LARK_PRICE_GROUP_CHAT_ID (blank → LARK_GROUP_CHAT_ID) — the group with every Sales
 *   mgmt  = LARK_MGMT_GROUP_CHAT_ID  (blank → not sent)            — SR, SR Manager, GM
 * Which events are sent: Settings › lark_group_events (JSON list of keys; default = all).
 * RULE: a group message NEVER carries a price, cost, vendor name, GP or a free-text comment
 * (comments may talk about cost). It says what happened, to which request, and links to the app,
 * where each person sees only what their role allows.
 */
const GROUP_EVENTS_ = {
  new_request:    { group: 'sales', icon: '🆕', color: 'blue',      label: 'คำขอราคาใหม่' },
  sales_approved: { group: 'sales', icon: '🛒', color: 'turquoise', label: 'GM อนุมัติฝั่งขายแล้ว — เข้าคิว SR' },
  sr_claimed:     { group: 'sales', icon: '🙋', color: 'turquoise', label: 'SR รับงานแล้ว' },
  queue_return:   { group: 'sales', icon: '↩️', color: 'orange',    label: 'SR ตีกลับ — ข้อมูลไม่ครบ' },
  need_info:      { group: 'sales', icon: '❓', color: 'orange',    label: 'SR ขอข้อมูลเพิ่ม' },
  rejected:       { group: 'sales', icon: '⛔', color: 'red',       label: 'ไม่อนุมัติคำขอราคา' },
  price_done:     { group: 'sales', icon: '✅', color: 'green',     label: 'ทำราคาเสร็จแล้ว' },
  follow_up:      { group: 'sales', icon: '📌', color: 'orange',    label: 'แยกรายการส่งราคาตามหลัง' },
  deal_won:       { group: 'sales', icon: '🎉', color: 'green',     label: 'ปิดการขายได้' },
  price_review:   { group: 'mgmt',  icon: '🧾', color: 'purple',    label: 'ราคารอ SR Manager ตรวจ' },
  gm_buy:         { group: 'mgmt',  icon: '📦', color: 'purple',    label: 'ราคารอ GM อนุมัติฝั่งซื้อ' },
  price_returned: { group: 'mgmt',  icon: '🔁', color: 'orange',    label: 'ตีกลับให้ SR แก้ราคา' },
  revision:       { group: 'mgmt',  icon: '✏️', color: 'orange',    label: 'Sales ขอให้ปรับราคา' }
};
const GROUP_KEY_OF_ = { sales: PRICE_GROUP_KEY_, mgmt: MGMT_GROUP_KEY_ };

/** transition → group event (null = no group message). */
function groupEventOfTransition_(action, saved) {
  if (saved.stage === 'rejected' && (action === 'manager_reject' || action === 'gm_reject')) return 'rejected';
  return {
    gm_approve: 'sales_approved', claim: 'sr_claimed', queue_return: 'queue_return', request_info: 'need_info',
    submit_quote: 'price_review', srm_approve: 'gm_buy', srm_return: 'price_returned', gm_price_return: 'price_returned',
    gm_price_approve: 'price_done', request_revision: 'revision'
  }[action] || null;
}

function groupEventsEnabled_() {
  const v = setting_('lark_group_events', null);
  return Array.isArray(v) ? v : Object.keys(GROUP_EVENTS_);
}

/** Item lines for a group message: product + spec only (no price, no vendor). */
function groupItemLines_(t) {
  return activeItemsOf_(t.ticket_id).map(function (it) {
    if (it.quote_status) return '• ' + itemStatusLine_(it).replace(/\*\*/g, '');
    const spec = [it.size, it.packing_size].filter(Boolean).join(' · ');
    return '• #' + it.line_no + ' ' + it.product_name + (spec ? ' (' + spec + ')' : '') + ' — ' + fmtQty_(it.qty) + ' ' + it.uom + '/เดือน';
  });
}

function fmtQty_(n) {
  const v = Number(n);
  return isFinite(v) ? String(Math.round(v * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-';
}

/**
 * Queue one group message for `event` (skipped when the event is switched off in Settings).
 * extra: { lines: [...] } — structured, price-free facts only.
 */
function enqueueGroupEvent_(event, t, extra) {
  const ev = GROUP_EVENTS_[event];
  if (!ev || groupEventsEnabled_().indexOf(event) === -1) return 0;
  const x = extra || {};
  const req = userByEmail_(t.requestor_email);
  const sr = t.sr_email ? userByEmail_(t.sr_email) : null;
  const actor = safeEmail_() ? userByEmail_(safeEmail_()) : null;
  const head = [
    'ลูกค้า: **' + (t.customer_name || '-') + '**' + (t.customer_group ? ' · ' + t.customer_group : '') +
      (t.destination_country && t.destination_country !== 'ไทย' ? ' · ปลายทาง ' + t.destination_country : ''),
    'Sales: ' + (req ? req.full_name : t.requestor_email) + (sr ? ' · SR: ' + sr.full_name : '') +
      (actor && event !== 'new_request' ? ' · โดย ' + actor.full_name : '')
  ];
  if (event === 'new_request' && t.due_date) head.push('ต้องการราคาภายใน ' + fmtDate_(t.due_date, 'dd/MM/yyyy') + (t.priority === 'urgent' || t.priority === 'high' ? ' · ⚡ ด่วน' : ''));
  const body = head.join('\n') + '\n\n' + (x.items === false ? '' : groupItemLines_(t).join('\n')) +
    ((x.lines || []).length ? '\n\n' + x.lines.join('\n') : '') +
    (event === 'price_done' ? '\n\nราคาขายส่งถึง Sales ผู้ขอทาง Lark ส่วนตัวแล้ว · ดูรายละเอียดในระบบ' : '');
  insertRows_(TAB.NOTIFICATIONS, [{
    notif_id: uuid_(), user_email: GROUP_KEY_OF_[ev.group], ticket_id: t.ticket_id, type: 'group_' + event,
    title: ev.icon + ' [' + t.ticket_no + '] ' + ev.label + ' — ' + (t.customer_name || t.title),
    body: body.slice(0, 1500), link: ticketLink_(t, 'ticket'), is_read: false, read_at: '', created_at: new Date(),
    lark_status: 'pending', lark_attempts: 0, lark_error: '', lark_sent_at: ''
  }]);
  return 1;
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

/** "Price finished" group message — status only, NO prices (kept as a named helper for callers / tests). */
function enqueuePriceDoneGroup_(t) {
  return enqueueGroupEvent_('price_done', t);
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
