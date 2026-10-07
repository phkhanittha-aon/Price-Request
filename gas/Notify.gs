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

/**
 * Queue one Lark group message: "price finished" with the SELLING price per unit only
 * (the group includes Sales — no vendor, cost, clearance or GP). Sent by dispatchNotifications().
 */
function enqueuePriceDoneGroup_(t) {
  const items = activeItemsOf_(t.ticket_id);
  const lines = items.map(function (it) {
    const win = compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)).filter(function (q) { return q.is_selected; })[0];
    const sp = salesPricing_(it, win);
    const spec = [it.size, it.packing_size].filter(Boolean).join(' · ');
    return '**#' + it.line_no + ' ' + it.product_name + '**' + (spec ? ' (' + spec + ')' : '') + '\n' +
      'ราคาขาย **' + (sp ? money2_(sp.sell_price_thb) : '-') + ' บาท/' + it.uom + '**' +
      (sp && sp.valid_until ? ' · ยืนราคาถึง ' + sp.valid_until : '');
  });
  const req = userByEmail_(t.requestor_email);
  const sr = userByEmail_(t.sr_email);
  insertRows_(TAB.NOTIFICATIONS, [{
    notif_id: uuid_(), user_email: PRICE_GROUP_KEY_, ticket_id: t.ticket_id, type: 'price_done_group',
    title: '✅ [' + t.ticket_no + '] ทำราคาเสร็จแล้ว — ' + (t.customer_name || t.title),
    body: 'ลูกค้า: ' + (t.customer_name || '-') + ' · Sales: ' + (req ? req.full_name : t.requestor_email) +
      ' · SR: ' + (sr ? sr.full_name : (t.sr_email || '-')) + '\n\n' + lines.join('\n'),
    link: ticketLink_(t, 'ticket'), is_read: false, read_at: '', created_at: new Date(),
    lark_status: 'pending', lark_attempts: 0, lark_error: '', lark_sent_at: ''
  }]);
}

/** 1234.5 → "1,234.50" (Lark message text). */
function money2_(n) {
  const v = Number(n);
  if (!isFinite(v)) return '-';
  const parts = v.toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}
