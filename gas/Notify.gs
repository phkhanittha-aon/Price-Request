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
    default:
      return [];
  }
}

/** Supervisors to escalate to when an SLA is breached. */
function stageEscalation_(t) {
  if (t.stage === 'pending_manager') {
    return activeUsersByRole_('gm').map(function (u) { return u.email; });
  }
  if (['pending_assign', 'doc_check', 'sourcing'].indexOf(t.stage) !== -1) {
    return activeUsersByRole_('sr').filter(function (u) { return u.is_sr_lead; }).map(function (u) { return u.email; });
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

/** Web-app deep link to a ticket page. */
function ticketLink_(t, page) {
  const base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
  return base + '?page=' + (page || 'ticket') + '&id=' + encodeURIComponent(t.ticket_id);
}
