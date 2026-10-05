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
// Dashboard (aggregated on the server, scoped to what the user can see)
// =============================================================================

/** range: { from?: 'yyyy-MM-dd', to?: 'yyyy-MM-dd' } — default last 90 days. */
function getDashboard(range) {
  return api_('getDashboard', function () {
    const u = currentUser_();
    const r = range || {};
    const now = new Date();
    const from = r.from ? parseYmd_(r.from, 'วันที่เริ่ม') : parseYmd_(fmtDate_(new Date(now.getTime() - 89 * 86400000)), 'from');
    const to = r.to ? parseYmd_(r.to, 'วันที่สิ้นสุด') : parseYmd_(todayBkk_(), 'to');
    if (to < from) throw appError_('VALIDATION', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
    const toEnd = new Date(to.getTime() + 86400000);
    const inRange = function (d) { if (!d) return false; const x = new Date(d); return x >= from && x < toEnd; };

    const ctx = listContext_();
    const tickets = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); });
    const visible = {};
    tickets.forEach(function (t) { visible[t.ticket_id] = t; });
    const open = tickets.filter(function (t) { return OPEN_STATUSES.indexOf(t.status) !== -1; });

    // 1. Status / stage cards (current state, all time)
    const byStatus = {};
    STATUS.forEach(function (s) { byStatus[s] = 0; });
    const byStage = {};
    tickets.forEach(function (t) { byStatus[t.status]++; byStage[t.stage] = (byStage[t.stage] || 0) + 1; });

    // 2. Requests per Sales (created in range)
    const bySales = {};
    tickets.filter(function (t) { return inRange(t.created_at); }).forEach(function (t) {
      const k = t.requestor_email;
      bySales[k] = bySales[k] || { email: k, name: ctx.names[k] || k, total: 0, open: 0, closed: 0, rejected: 0 };
      bySales[k].total++;
      if (OPEN_STATUSES.indexOf(t.status) !== -1) bySales[k].open++;
      else if (t.status === 'closed') bySales[k].closed++;
      else bySales[k].rejected++;
    });

    // 3. SR workload
    const srRows = activeUsersByRole_('sr').map(function (s) {
      const mine = tickets.filter(function (t) { return t.sr_email === s.email; });
      const done = mine.filter(function (t) {
        return (t.status === 'completed' || t.status === 'closed') && inRange(t.completed_at) && t.assigned_at;
      });
      const hours = done.map(function (t) { return hoursBetween_(new Date(t.assigned_at), new Date(t.completed_at)); });
      return {
        email: s.email, name: s.full_name,
        in_progress: mine.filter(function (t) { return t.stage === 'doc_check' || t.stage === 'sourcing'; }).length,
        need_info: mine.filter(function (t) { return t.stage === 'need_info'; }).length,
        awaiting_ack: mine.filter(function (t) { return t.stage === 'awaiting_sales_ack'; }).length,
        completed: done.length,
        avg_hours: hours.length ? round_(hours.reduce(function (a, b) { return a + b; }, 0) / hours.length, 1) : null
      };
    });

    // 4. Cycle time per stage (transition logs in range) → bottlenecks
    const durations = {};
    rows_(TAB.LOGS).forEach(function (l) {
      if (l.log_type !== 'transition' || !l.from_stage || l.stage_duration_sec === '' || !visible[String(l.ticket_id)]) return;
      if (!inRange(l.ts)) return;
      (durations[l.from_stage] = durations[l.from_stage] || []).push(Number(l.stage_duration_sec) / 3600);
    });
    const ownerOf = { pending_manager: 'Manager', pending_gm: 'GM', returned: 'Sales', need_info: 'Sales', awaiting_sales_ack: 'Sales' };
    const cycle = Object.keys(STAGE_LABEL_TH).filter(function (s) { return durations[s]; }).map(function (s) {
      const arr = durations[s].slice().sort(function (a, b) { return a - b; });
      const sla = Number(ctx.sla[s] || 0);
      return {
        stage: s, stage_label: STAGE_LABEL_TH[s], owner: ownerOf[s] || 'SR', count: arr.length,
        avg_hours: round_(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length, 1),
        median_hours: round_(percentile_(arr, 0.5), 1),
        p90_hours: round_(percentile_(arr, 0.9), 1),
        sla_hours: sla || null,
        breach_count: sla ? arr.filter(function (h) { return h > sla; }).length : 0
      };
    });

    // 5. SLA now + aging buckets (open tickets)
    const slaByStage = {};
    let breachNow = 0;
    let warnNow = 0;
    open.forEach(function (t) {
      const s = slaInfo_(t, ctx, now);
      slaByStage[t.stage] = slaByStage[t.stage] || { stage: t.stage, stage_label: STAGE_LABEL_TH[t.stage], open: 0, warning: 0, breach: 0, sla_hours: s.sla_hours };
      slaByStage[t.stage].open++;
      if (s.sla_status === 'warning') { slaByStage[t.stage].warning++; warnNow++; }
      if (s.sla_status === 'breach') { slaByStage[t.stage].breach++; breachNow++; }
    });
    const aging = AGING_BUCKETS_.map(function (b) {
      return {
        key: b.key, label: b.label,
        count: open.filter(function (t) {
          const d = Math.floor(hoursBetween_(new Date(t.created_at), now) / 24);
          return d >= b.min && d <= b.max;
        }).length
      };
    });

    // 6. Top winning vendors + product group share (tickets in range)
    const vendors = {};
    const qtyOf = {};
    rows_(TAB.ITEMS).forEach(function (i) { qtyOf[String(i.item_id)] = Number(i.qty) || 0; });
    rows_(TAB.QUOTATIONS).forEach(function (q) {
      const t = visible[String(q.ticket_id)];
      if (!t || !toBool_(q.is_selected) || toBool_(q.is_deleted)) return;
      if (!(t.status === 'completed' || t.status === 'closed') || !inRange(t.completed_at)) return;
      if (u.role === 'sales' || u.role === 'manager') { if (!canViewQuotes_(u, t)) return; }
      const key = String(q.vendor_id || String(q.vendor_name).trim().toLowerCase());
      vendors[key] = vendors[key] || { name: String(q.vendor_name), wins: 0, tickets: {}, total_cost_thb: 0 };
      vendors[key].wins++;
      vendors[key].tickets[t.ticket_id] = true;
      vendors[key].total_cost_thb += Number(q.net_unit_cost_thb) * (qtyOf[String(q.item_id)] || 0);
    });
    const topVendors = Object.keys(vendors).map(function (k) {
      const v = vendors[k];
      return { name: v.name, wins: v.wins, ticket_count: Object.keys(v.tickets).length, total_cost_thb: round_(v.total_cost_thb, 2) };
    }).sort(function (a, b) { return b.wins - a.wins || b.total_cost_thb - a.total_cost_thb; }).slice(0, 10);

    const share = {};
    tickets.filter(function (t) { return inRange(t.created_at); }).forEach(function (t) {
      (ctx.itemsByTicket[t.ticket_id] || []).forEach(function (i) {
        const root = rootGroup_(String(i.product_group_code), ctx.groups);
        share[root] = share[root] || { code: root, name: ctx.groups[root] ? String(ctx.groups[root].name) : root, items: 0, tickets: {} };
        share[root].items++;
        share[root].tickets[t.ticket_id] = true;
      });
    });
    const groupShare = Object.keys(share).map(function (k) {
      return { code: share[k].code, name: share[k].name, items: share[k].items, tickets: Object.keys(share[k].tickets).length };
    }).sort(function (a, b) { return b.items - a.items; });

    return {
      range: { from: fmtDate_(from), to: fmtDate_(to) },
      scope_note: u.role === 'sales' ? 'แสดงเฉพาะใบของคุณ' : u.role === 'manager' ? 'แสดงเฉพาะใบในแผนกของคุณ' : u.role === 'sr' ? 'แสดงใบที่ GM อนุมัติแล้ว' : 'แสดงทุกใบ',
      kpi: {
        open: open.length,
        created_in_range: tickets.filter(function (t) { return inRange(t.created_at); }).length,
        closed_in_range: tickets.filter(function (t) { return t.status === 'closed' && inRange(t.closed_at); }).length,
        breach_now: breachNow,
        warning_now: warnNow
      },
      by_status: STATUS.map(function (s) { return { status: s, label: STATUS_LABEL_TH[s], count: byStatus[s] }; }),
      by_stage: Object.keys(STAGE_LABEL_TH).filter(function (s) { return byStage[s] && OPEN_STATUSES.indexOf(STAGE_STATUS[s]) !== -1; })
        .map(function (s) { return { stage: s, label: STAGE_LABEL_TH[s], count: byStage[s] }; }),
      by_sales: Object.keys(bySales).map(function (k) { return bySales[k]; }).sort(function (a, b) { return b.total - a.total; }),
      sr_workload: srRows,
      cycle_time: cycle,
      sla_by_stage: Object.keys(slaByStage).map(function (k) { return slaByStage[k]; }),
      aging: aging,
      top_vendors: topVendors,
      group_share: groupShare
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
