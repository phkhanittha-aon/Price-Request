/**
 * File: Deals.gs
 * After the price — did the customer buy?  (New Item follow-up + GP / close-rate summary)
 *
 * Every item that got a GM-approved selling price becomes one "deal" line:
 *   product the customer is interested in · volume per month (qty) · price the customer expects (target_price)
 *   · selling price we quoted · deal status (follow / sample / won / lost) · next follow-up date.
 *
 *   listDeals()        Sales side view (no cost) — Sales: own · Sales Manager / GM / Admin / SR Manager / SR: everyone they can see
 *   updateDeal()       Sales (owner), the department's Sales Manager or Admin record the outcome
 *   getGpSummary()     GM / SR Manager / Admin only: + landed cost, GP %, profit — trend of quoted vs closed
 *
 * Nothing here changes the ticket workflow or its version: the deal is Sales' follow-up after the price.
 */

const DEAL_STAGES_ = ['awaiting_sales_ack', 'closed'];
const GP_ROLES_ = ['gm', 'sr_manager', 'admin'];

function dealFollowDays_() {
  const n = Number(setting_('deal_follow_days', 7));
  return isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 90) : 7;
}

/** Quoted lines (items with a GM-approved selling price) of tickets `u` may see. Cost fields only for GP_ROLES_. */
function dealRows_(u, withCost) {
  const ctx = listContext_();
  const tickets = {};
  rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
    if (DEAL_STAGES_.indexOf(t.stage) !== -1 && t.gm_price_approved_at && canSeeTicket_(u, t)) tickets[t.ticket_id] = t;
  });
  const winners = {};
  rows_(TAB.QUOTATIONS).forEach(function (q) {
    if (toBool_(q.is_selected) && !toBool_(q.is_deleted) && tickets[String(q.ticket_id)]) winners[String(q.item_id)] = normQuote_(q);
  });
  const today = todayBkk_();
  const followDays = dealFollowDays_();
  const out = [];
  Object.keys(tickets).forEach(function (id) {
    const t = tickets[id];
    activeItemsOf_(id).forEach(function (it) {
      if (it.quote_status) return;
      const win = winners[it.item_id];
      if (!win) return;
      const p = itemPricing_(it, win);
      const quotedAt = new Date(t.gm_price_approved_at);
      const quotedYmd = fmtDate_(quotedAt);
      const open = it.deal_status !== 'won' && it.deal_status !== 'lost';
      const due = open && (it.deal_next_date ? it.deal_next_date <= today
        : !it.deal_status && fmtDate_(new Date(quotedAt.getTime() + followDays * 86400000)) <= today);
      const row = {
        ticket_id: t.ticket_id, ticket_no: String(t.ticket_no), item_id: it.item_id, line_no: it.line_no,
        customer_name: String(t.customer_name || ''), customer_group: String(t.customer_group || ''),
        destination_country: String(t.destination_country || ''),
        requestor_email: t.requestor_email, requestor_name: ctx.names[t.requestor_email] || t.requestor_email,
        department_code: String(t.department_code || ''), sr_name: t.sr_email ? (ctx.names[t.sr_email] || t.sr_email) : '',
        product_name: it.product_name, product_group_code: it.product_group_code, size: it.size, packing_size: it.packing_size,
        net_weight: it.net_weight, spec: it.spec,
        qty: it.qty, uom: it.uom, target_price: it.target_price || 0,
        sell_price_thb: p.sell_price_thb, target_diff_pct: p.target_diff_pct,
        valid_until: win.valid_until || '', quoted_at: quotedAt.toISOString(), quoted_ymd: quotedYmd, quoted_month: quotedYmd.slice(0, 7),
        ticket_stage: t.stage, ticket_stage_label: STAGE_LABEL_TH[t.stage],
        deal_status: it.deal_status, deal_status_label: DEAL_STATUS_LABEL_TH[it.deal_status] || it.deal_status,
        deal_reason: it.deal_reason, deal_note: it.deal_note, deal_next_date: it.deal_next_date,
        deal_updated_at: it.deal_updated_at, deal_updated_by: it.deal_updated_by ? (ctx.names[it.deal_updated_by] || it.deal_updated_by) : '',
        deal_closed_at: it.deal_closed_at, is_open: open, is_due: due,
        can_edit: canEditDeal_(u, t)
      };
      if (withCost) {
        row.vendor_name = p.vendor_name;
        row.landed_cost_thb = p.landed_cost_thb;
        row.gp_percent = p.gp_percent;
        row.profit_thb = p.profit_thb;
      }
      out.push(row);
    });
  });
  out.sort(function (a, b) { return a.quoted_at < b.quoted_at ? 1 : a.quoted_at > b.quoted_at ? -1 : a.line_no - b.line_no; });
  return out;
}

/** Sales (owner), the Sales Manager of that department, or Admin. */
function canEditDeal_(u, t) {
  if (DEAL_STAGES_.indexOf(t.stage) === -1) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'sales') return t.requestor_email === u.email;
  if (u.role === 'manager') {
    const d = departmentByCode_(t.department_code);
    return !!d && d.manager_email === u.email;
  }
  return false;
}

/** Follow-up list (no cost data for anyone — the GP view is getGpSummary). */
function listDeals() {
  return api_('listDeals', function () {
    const u = currentUser_();
    return {
      rows: dealRows_(u, false),
      today: todayBkk_(),
      follow_days: dealFollowDays_(),
      lost_reasons: setting_('deal_lost_reasons', []),
      statuses: [''].concat(DEAL_STATUSES).map(function (k) { return { key: k, label: DEAL_STATUS_LABEL_TH[k] }; }),
      can_see_everyone: u.role !== 'sales'
    };
  });
}

/**
 * patch: { status: 'follow'|'sample'|'won'|'lost', reason? (required for lost), note?, next_date? (yyyy-MM-dd) }
 * follow / sample without a date → next follow-up = today + deal_follow_days.
 */
function updateDeal(itemId, patch) {
  return api_('updateDeal', function () {
    return withLock_(function () {
      const u = currentUser_();
      const p = patch || {};
      const row = findOne_(TAB.ITEMS, 'item_id', cleanText_(itemId, 64));
      if (!row || toBool_(row.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้า');
      const t = ticketForUser_(u, row.ticket_id);
      if (!canEditDeal_(u, t)) {
        throw appError_('FORBIDDEN', DEAL_STAGES_.indexOf(t.stage) === -1
          ? 'อัปเดตผลการขายได้หลัง GM อนุมัติราคาและส่งถึง Sales แล้ว'
          : 'อัปเดตผลการขายได้เฉพาะ Sales เจ้าของคำขอ, Sales Manager ของแผนก หรือผู้ดูแลระบบ');
      }
      if (String(row.quote_status || '')) throw appError_('INVALID_STATE', 'รายการนี้ไม่ได้เสนอราคา จึงไม่มีผลการขาย');
      const status = oneOf_(p.status, DEAL_STATUSES, 'สถานะการขาย');
      const reasons = setting_('deal_lost_reasons', []);
      let reason = cleanText_(p.reason, 200);
      const note = cleanText_(p.note, CFG.MAX_TEXT);
      if (status === 'lost') {
        if (!reason) throw appError_('VALIDATION', 'กรุณาเลือกเหตุผลที่ไม่ได้งาน');
        if (reasons.length && reasons.indexOf(reason) === -1) throw appError_('VALIDATION', 'เหตุผลไม่อยู่ในรายการ');
        if (reason === 'อื่นๆ' && !note) throw appError_('VALIDATION', 'เลือก “อื่นๆ” กรุณาระบุรายละเอียดในหมายเหตุ');
      } else {
        reason = '';
      }
      let next = '';
      if (status === 'follow' || status === 'sample') {
        next = p.next_date ? parseYmd_(p.next_date, 'วันที่ติดตามครั้งถัดไป') : new Date(Date.now() + dealFollowDays_() * 86400000);
        if (fmtDate_(next) < todayBkk_()) throw appError_('VALIDATION', 'วันที่ติดตามครั้งถัดไปต้องไม่เป็นวันที่ผ่านมาแล้ว');
      }
      const before = { status: String(row.deal_status || ''), reason: String(row.deal_reason || '') };
      const now = new Date();
      updateRow_(TAB.ITEMS, String(row.item_id), {
        deal_status: status, deal_reason: reason, deal_note: note, deal_next_date: next,
        deal_updated_by: u.email, deal_updated_at: now,
        deal_closed_at: status === 'won' || status === 'lost' ? (before.status === status && row.deal_closed_at ? row.deal_closed_at : now) : '',
        updated_at: now
      });
      appendLog_({ ticket_id: t.ticket_id, action: 'deal_update', actor_email: u.email, actor_role: u.role, comment: note,
        metadata: { item_id: String(row.item_id), line_no: Number(row.line_no), product_name: String(row.product_name),
          from: before.status, to: status, reason: reason, next_date: next ? fmtDate_(next) : '' } });
      if (status === 'won' && before.status !== 'won') {
        const qty = Number(row.qty);
        enqueueGroupEvent_('deal_won', t, { items: false, lines: ['• #' + row.line_no + ' ' + row.product_name +
          ' — ลูกค้าใช้ประมาณ ' + fmtQty_(qty) + ' ' + row.uom + '/เดือน'] });
        // SR + SR Manager learn which of their prices sold (in-app + Lark DM, no price in the text)
        const srs = [t.sr_email].concat(activeUsersByRole_('sr_manager').map(function (x) { return x.email; }));
        enqueueNotifications_(srs, t, 'deal_won', '🎉 [' + t.ticket_no + '] ปิดการขายได้: ' + row.product_name,
          (t.customer_name || '') + ' — ' + u.full_name + ' อัปเดตว่าลูกค้าตกลงซื้อ', ticketLink_(t, 'ticket'));
      }
      const fresh = dealRows_(u, false).filter(function (r) { return r.item_id === String(row.item_id); })[0];
      return { deal: fresh || null };
    });
  });
}

/**
 * GP & close-rate summary (GM / SR Manager / Admin): every quoted line with its cost, GP and deal status.
 * The browser groups by month / customer group / Sales so filters never call the server again.
 */
function getGpSummary() {
  return api_('getGpSummary', function () {
    const u = currentUser_();
    requireRole_(u, GP_ROLES_, 'สรุป GP ดูได้เฉพาะ GM, SR Manager และผู้ดูแลระบบ');
    return {
      rows: dealRows_(u, true),
      today: todayBkk_(),
      lost_reasons: setting_('deal_lost_reasons', []),
      customer_groups: setting_('customer_groups', []),
      default_gp_percent: defaultGp_()
    };
  });
}
