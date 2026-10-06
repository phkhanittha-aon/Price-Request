/**
 * File: Api.gs
 * Read APIs for the web app: ticket list (filters + aging/SLA), inbox, notifications, dashboard.
 * Every function filters rows on the SERVER by canSeeTicket_() before returning anything.
 */

const AGING_BUCKETS_ = [
  { key: 'd0_2', label: '0–2 วัน', min: 0, max: 2 },
  { key: 'd3_5', label: '3–5 วัน', min: 3, max: 5 },
  { key: 'd6_10', label: '6–10 วัน', min: 6, max: 10 },
  { key: 'd10p', label: '>10 วัน', min: 11, max: Infinity }
];

// =============================================================================
// Ticket list
// =============================================================================

/**
 * query: { scope: 'all'|'mine'|'inbox'|'queue', status?: string[], stage?: string[], group_code?, requestor?, sr?,
 *          priority?, date_from?, date_to? (yyyy-MM-dd, created date), q?, sort?, page?, page_size? }
 */
function listTickets(query) {
  return api_('listTickets', function () {
    const u = currentUser_();
    const q = query || {};
    const scope = ['all', 'mine', 'inbox', 'queue'].indexOf(q.scope) !== -1 ? q.scope : 'all';
    const now = new Date();
    const ctx = listContext_();
    const statuses = Array.isArray(q.status) ? q.status.filter(function (s) { return STATUS.indexOf(s) !== -1; }) : [];
    const stages = Array.isArray(q.stage) ? q.stage.filter(function (s) { return STAGE_STATUS[s]; }) : [];
    const from = q.date_from ? parseYmd_(q.date_from, 'วันที่เริ่ม', true) : '';
    const to = q.date_to ? parseYmd_(q.date_to, 'วันที่สิ้นสุด', true) : '';
    const toEnd = to ? new Date(to.getTime() + 86400000) : '';
    const text = cleanText_(q.q, 100).toLowerCase();
    const groupCode = cleanText_(q.group_code, 50);

    let list = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); });
    if (scope === 'mine') {
      list = list.filter(function (t) { return u.role === 'sr' ? t.sr_email === u.email : t.requestor_email === u.email; });
    } else if (scope === 'inbox') {
      list = list.filter(function (t) { return isAssignee_(u, t, ctx); });
    } else if (scope === 'queue') {
      list = list.filter(function (t) { return t.stage === 'pending_assign'; });
    }
    if (statuses.length) list = list.filter(function (t) { return statuses.indexOf(t.status) !== -1; });
    if (stages.length) list = list.filter(function (t) { return stages.indexOf(t.stage) !== -1; });
    if (['done', 'open', 'rejected'].indexOf(q.outcome) !== -1) list = list.filter(function (t) { return outcome_(t) === q.outcome; });
    if (q.priority) list = list.filter(function (t) { return t.priority === q.priority; });
    if (q.requestor) list = list.filter(function (t) { return t.requestor_email === String(q.requestor).toLowerCase(); });
    if (q.sr) list = list.filter(function (t) { return t.sr_email === String(q.sr).toLowerCase(); });
    if (from) list = list.filter(function (t) { return new Date(t.created_at) >= from; });
    if (toEnd) list = list.filter(function (t) { return new Date(t.created_at) < toEnd; });

    let rows = list.map(function (t) { return summaryRow_(t, ctx, now); });
    if (groupCode) {
      rows = rows.filter(function (r) { return r.group_codes.indexOf(groupCode) !== -1 || r.root_codes.indexOf(groupCode) !== -1; });
    }
    if (text) {
      rows = rows.filter(function (r) {
        return (r.ticket_no + ' ' + r.title + ' ' + r.customer_name + ' ' + r.item_names + ' ' + r.requestor_name)
          .toLowerCase().indexOf(text) !== -1;
      });
    }

    const slaCounts = { ok: 0, warning: 0, breach: 0 };
    rows.forEach(function (r) { if (slaCounts[r.sla_status] !== undefined) slaCounts[r.sla_status]++; });

    const sorters = {
      updated_desc: function (a, b) { return b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : 0; },
      created_desc: function (a, b) { return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0; },
      // worst first: breach → warning → ok, then the longest waiting
      urgency: function (a, b) {
        const rank = { breach: 0, warning: 1, ok: 2, none: 3, done: 4 };
        return (rank[a.sla_status] - rank[b.sla_status]) || (b.stage_age_hours - a.stage_age_hours);
      },
      due_asc: function (a, b) { return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1; }
    };
    rows.sort(sorters[q.sort] || (scope === 'inbox' || scope === 'queue' ? sorters.urgency : sorters.updated_desc));

    const pageSize = Math.min(Math.max(Number(q.page_size) || 50, 10), 200);
    const page = Math.max(Number(q.page) || 1, 1);
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page: page,
      page_size: pageSize,
      sla_counts: slaCounts
    };
  });
}

/** Data loaded once per request and shared by every row. */
function listContext_() {
  const itemsByTicket = {};
  rows_(TAB.ITEMS).forEach(function (r) {
    if (toBool_(r.is_deleted)) return;
    const k = String(r.ticket_id);
    (itemsByTicket[k] = itemsByTicket[k] || []).push(r);
  });
  const groups = {};
  rows_(TAB.PRODUCT_GROUPS).forEach(function (g) { groups[String(g.code)] = g; });
  const names = {};
  rows_(TAB.USERS).forEach(function (r) { names[String(r.email).toLowerCase()] = String(r.full_name); });
  const deptMgr = {};
  rows_(TAB.DEPARTMENTS).forEach(function (d) { deptMgr[String(d.code)] = String(d.manager_email || '').toLowerCase(); });
  return {
    itemsByTicket: itemsByTicket, groups: groups, names: names, deptMgr: deptMgr,
    sla: setting_('sla_hours', {}), warn: Number(setting_('sla_warning_ratio', 0.8))
  };
}

function rootGroup_(code, groups) {
  let c = code;
  let guard = 0;
  while (groups[c] && groups[c].parent_code && guard++ < 10) c = String(groups[c].parent_code);
  return c;
}

/** Is this user the one who must act now? (no per-row sheet reads) */
function isAssignee_(u, t, ctx) {
  switch (t.stage) {
    case 'pending_manager': return u.role === 'manager' && (ctx.deptMgr[t.department_code] || t.manager_email) === u.email;
    case 'returned':
    case 'need_info':
    case 'awaiting_sales_ack': return t.requestor_email === u.email;
    case 'pending_gm': return u.role === 'gm' && t.manager_email !== u.email;
    case 'pending_assign': return u.role === 'sr';
    case 'doc_check':
    case 'sourcing': return t.sr_email === u.email;
    case 'pending_sr_manager': return u.role === 'sr_manager' && t.sr_email !== u.email;
    case 'pending_gm_price': return u.role === 'gm';
    default: return false;
  }
}

function slaInfo_(t, ctx, now) {
  const open = OPEN_STATUSES.indexOf(t.status) !== -1;
  const entered = t.stage_entered_at ? new Date(t.stage_entered_at) : new Date(t.created_at);
  const ageH = hoursBetween_(entered, now);
  const slaH = Number(ctx.sla[t.stage] || 0);
  let status = 'none';
  if (!open) status = 'done';
  else if (slaH > 0 && ageH >= slaH) status = 'breach';
  else if (slaH > 0 && ageH >= slaH * ctx.warn) status = 'warning';
  else if (slaH > 0) status = 'ok';
  return { stage_age_hours: round_(ageH, 1), sla_hours: slaH || null, sla_status: status };
}

function summaryRow_(t, ctx, now) {
  const items = (ctx.itemsByTicket[t.ticket_id] || []).slice().sort(function (a, b) { return Number(a.line_no) - Number(b.line_no); });
  const groupCodes = [];
  const rootCodes = [];
  items.forEach(function (i) {
    const c = String(i.product_group_code);
    if (groupCodes.indexOf(c) === -1) groupCodes.push(c);
    const r = rootGroup_(c, ctx.groups);
    if (rootCodes.indexOf(r) === -1) rootCodes.push(r);
  });
  const end = t.closed_at || t.rejected_at || t.cancelled_at;
  const sla = slaInfo_(t, ctx, now);
  return {
    ticket_id: t.ticket_id,
    ticket_no: String(t.ticket_no),
    title: String(t.title),
    customer_name: String(t.customer_name || ''),
    priority: String(t.priority),
    status: t.status,
    status_label: STATUS_LABEL_TH[t.status],
    stage: t.stage,
    stage_label: STAGE_LABEL_TH[t.stage],
    requestor_email: t.requestor_email,
    requestor_name: ctx.names[t.requestor_email] || t.requestor_email,
    sr_email: t.sr_email,
    sr_name: t.sr_email ? (ctx.names[t.sr_email] || t.sr_email) : '',
    department_code: String(t.department_code),
    due_date: t.due_date ? fmtDate_(t.due_date) : '',
    revision_count: t.revision_count,
    item_count: items.length,
    item_names: items.map(function (i) { return String(i.product_name); }).join(' | '),
    group_codes: groupCodes,
    root_codes: rootCodes,
    age_days: Math.floor(hoursBetween_(new Date(t.created_at), end ? new Date(end) : now) / 24),
    stage_age_hours: sla.stage_age_hours,
    sla_hours: sla.sla_hours,
    sla_status: sla.sla_status,
    created_at: isoOrBlank_(t.created_at),
    updated_at: isoOrBlank_(t.updated_at)
  };
}

// =============================================================================
// Polling (badge counts) and notifications
// =============================================================================

function pollData_(u) {
  const ctx = listContext_();
  const inbox = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) {
    return canSeeTicket_(u, t) && isAssignee_(u, t, ctx);
  }).length;
  const unread = rows_(TAB.NOTIFICATIONS).filter(function (n) {
    return String(n.user_email).toLowerCase() === u.email && !toBool_(n.is_read);
  }).length;
  return { inbox: inbox, unread: unread, server_time: new Date().toISOString() };
}

/** Called every ~60 s by the page while it is visible. */
function getPoll() {
  return api_('getPoll', function () { return pollData_(currentUser_()); });
}

function getNotifications(limit) {
  return api_('getNotifications', function () {
    const u = currentUser_();
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const mine = rows_(TAB.NOTIFICATIONS)
      .filter(function (r) { return String(r.user_email).toLowerCase() === u.email; })
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return {
      unread: mine.filter(function (r) { return !toBool_(r.is_read); }).length,
      items: mine.slice(0, n).map(function (r) {
        return { notif_id: String(r.notif_id), ticket_id: String(r.ticket_id), type: String(r.type), title: String(r.title),
          body: String(r.body || ''), is_read: toBool_(r.is_read), created_at: isoOrBlank_(r.created_at),
          created_bkk: fmtDate_(r.created_at, 'dd/MM HH:mm') };
      })
    };
  });
}

/** ids: array of notif_id, or null/empty = mark all as read. */
function markNotificationsRead(ids) {
  return api_('markNotificationsRead', function () {
    return withLock_(function () {
      const u = currentUser_();
      const wanted = Array.isArray(ids) && ids.length ? ids.map(String) : null;
      const now = new Date();
      let count = 0;
      rows_(TAB.NOTIFICATIONS).filter(function (r) {
        return String(r.user_email).toLowerCase() === u.email && !toBool_(r.is_read) &&
          (!wanted || wanted.indexOf(String(r.notif_id)) !== -1);
      }).slice(0, 200).forEach(function (r) {
        updateRow_(TAB.NOTIFICATIONS, r.notif_id, { is_read: true, read_at: now });
        count++;
      });
      return { marked: count };
    });
  });
}

// =============================================================================
// Dashboard — simple summary: quoted (done) / not done / rejected, status list, per person
// Scope: Sales → own requests · SR → own jobs · Sales Manager, SR Manager, GM, Admin → everyone (they can see)
// =============================================================================

const DONE_STATUSES_ = ['completed', 'closed'];
const STAGE_ORDER_ = ['pending_manager', 'returned', 'pending_gm', 'pending_assign', 'doc_check', 'need_info', 'sourcing',
  'pending_sr_manager', 'pending_gm_price', 'awaiting_sales_ack', 'closed', 'rejected', 'cancelled'];

function outcome_(t) {
  if (DONE_STATUSES_.indexOf(t.status) !== -1) return 'done';
  if (t.status === 'rejected') return 'rejected';
  return 'open';
}

/** range: { from?: 'yyyy-MM-dd', to?: 'yyyy-MM-dd' } on created date — default: everything. */
function getDashboard(range) {
  return api_('getDashboard', function () {
    const u = currentUser_();
    const r = range || {};
    const from = r.from ? parseYmd_(r.from, 'วันที่เริ่ม') : null;
    const to = r.to ? parseYmd_(r.to, 'วันที่สิ้นสุด') : null;
    if (from && to && to < from) throw appError_('VALIDATION', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
    const toEnd = to ? new Date(to.getTime() + 86400000) : null;
    const now = new Date();
    const ctx = listContext_();

    let tickets = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); });
    let scope = 'ทุกคน';
    if (u.role === 'sales') { tickets = tickets.filter(function (t) { return t.requestor_email === u.email; }); scope = 'ใบขอราคาของคุณ'; }
    if (u.role === 'sr') { tickets = tickets.filter(function (t) { return t.sr_email === u.email; }); scope = 'งานที่คุณรับผิดชอบ'; }
    if (from) tickets = tickets.filter(function (t) { return new Date(t.created_at) >= from; });
    if (toEnd) tickets = tickets.filter(function (t) { return new Date(t.created_at) < toEnd; });

    const kpi = { total: tickets.length, done: 0, open: 0, rejected: 0, breach: 0 };
    const byStage = {};
    const sales = {};
    const srs = {};
    tickets.forEach(function (t) {
      const o = outcome_(t);
      kpi[o]++;
      if (o === 'open' && slaInfo_(t, ctx, now).sla_status === 'breach') kpi.breach++;
      byStage[t.stage] = (byStage[t.stage] || 0) + 1;
      const k = t.requestor_email;
      sales[k] = sales[k] || { email: k, name: ctx.names[k] || k, total: 0, done: 0, open: 0, rejected: 0 };
      sales[k].total++;
      sales[k][o]++;
      if (t.sr_email) {
        const s = t.sr_email;
        srs[s] = srs[s] || { email: s, name: ctx.names[s] || s, total: 0, done: 0, open: 0, rejected: 0 };
        srs[s].total++;
        srs[s][o]++;
      }
    });
    const pct = function (n) { return kpi.total ? Math.round(n / kpi.total * 100) : 0; };
    const sortPeople = function (obj) {
      return Object.keys(obj).map(function (k) { return obj[k]; }).sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name, 'th'); });
    };

    const recent = tickets.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 10)
      .map(function (t) { return summaryRow_(t, ctx, now); });

    return {
      scope_note: scope,
      range: { from: from ? fmtDate_(from) : '', to: to ? fmtDate_(to) : '' },
      kpi: {
        total: kpi.total,
        done: kpi.done, done_pct: pct(kpi.done),
        open: kpi.open, open_pct: pct(kpi.open),
        rejected: kpi.rejected, rejected_pct: pct(kpi.rejected),
        breach: kpi.breach
      },
      by_stage: STAGE_ORDER_.filter(function (s) { return byStage[s]; }).map(function (s) {
        return { stage: s, label: STAGE_LABEL_TH[s], status: STAGE_STATUS[s], outcome: outcome_({ status: STAGE_STATUS[s] }), count: byStage[s] };
      }),
      by_sales: sortPeople(sales),
      by_sr: sortPeople(srs),
      recent: recent,
      can_see_everyone: ['manager', 'gm', 'admin', 'sr_manager'].indexOf(u.role) !== -1
    };
  });
}

function percentile_(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
