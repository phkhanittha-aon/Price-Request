/**
 * File: Portal.gs
 * หน้ารวมผู้บริหาร (?page=portal): one screen with the pricing work of BOTH systems,
 * then a button into each pricing web app (Food = this app · Mech = MGS Project Pricing).
 *
 *   Food : read from this database (tickets, deal follow-up, GP).
 *   Mech : read-only from the MGS Project Pricing spreadsheet, tab "Quotations"
 *          (Script Properties MECH_SHEET_ID + MECH_WEBAPP_URL; the owner of this script needs view access).
 *          Only the summary columns are read (never the Detail JSON), cached 5 minutes.
 *
 * Who: GM, Admin, SR Manager and role "viewer" (ผู้บริหาร — sees this page only).
 * The portal shows cost / GP of both systems → never Sales / Sales Manager / SR.
 */

const PORTAL_ROLES_ = ['gm', 'admin', 'sr_manager', 'viewer'];
let TEST_MECH_ = null;   // tests: { headers: [...], rows: [[...]] }

/** Mech statuses → portal stage (same wording as the MGS Sales app). */
const MECH_STAGE_ = {
  SR: { Draft: null, Submitted: 'req', '': 'req', Accepted: 'wip', Quoted: null, Cancelled: null },
  QT: { Requested: 'wip', 'In Progress': 'wip', Draft: 'wip', Submitted: 'approval', 'Partial Approved': 'approval', Approved: 'approved',
        Pending: 'ready', Won: 'won', Closed: 'closed', Lost: 'closed' }
};
const PORTAL_STAGE_LABEL_ = {
  req: 'คำขอราคา รอรับงาน', wip: 'กำลังทำราคา', approval: 'รอผู้บริหารอนุมัติราคา', approved: 'อนุมัติแล้ว รอส่งราคาให้ Sales',
  ready: 'ราคาถึง Sales · ติดตามลูกค้า', won: 'ปิดการขายได้', closed: 'ปิดงาน / ไม่ได้งาน'
};

function getPortal() {
  return api_('getPortal', function () {
    const u = currentUser_();
    requireRole_(u, PORTAL_ROLES_, 'หน้ารวมดูได้เฉพาะผู้บริหาร (GM, SR Manager, Admin)');
    const p = PropertiesService.getScriptProperties();
    let mech;
    try { mech = mechSummary_(); } catch (e) { logError_('getPortal.mech', e); mech = { configured: true, error: 'อ่านข้อมูลระบบ Mech ไม่สำเร็จ: ' + String(e.message).slice(0, 200) }; }
    return {
      food: foodSummary_(u),
      mech: mech,
      links: { food: ticketLink_({ ticket_id: '' }, 'home').replace(/&id=$/, ''), mech: p.getProperty(CFG.PROP.MECH_WEBAPP_URL) || '' },
      months: portalMonths_(6),
      generated_at: new Date().toISOString(),
      can_open_food: u.role !== 'viewer'
    };
  });
}

function portalMonths_(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(fmtDate_(new Date(d.getFullYear(), d.getMonth() - i, 15), 'yyyy-MM'));
  return out;
}

/** Food: stage counts, waiting-for-management list, deal outcome + GP (monthly values = selling price × volume / month). */
function foodSummary_(u) {
  const tickets = rows_(TAB.TICKETS).map(normTicket_);
  const sla = setting_('sla_hours', {});
  const now = new Date();
  const STAGE_OF = {
    pending_manager: 'req', returned: 'req', pending_gm: 'req', pending_assign: 'wip', doc_check: 'wip', need_info: 'wip', sourcing: 'wip',
    pending_sr_manager: 'approval', pending_gm_price: 'approval', awaiting_sales_ack: 'ready'
  };
  const stages = { req: 0, wip: 0, approval: 0, ready: 0 };
  let breach = 0;
  const waiting = [];
  tickets.forEach(function (t) {
    const k = STAGE_OF[t.stage];
    if (!k) return;
    stages[k]++;
    const h = Number(sla[t.stage] || 0);
    if (h > 0 && t.stage_entered_at && hoursBetween_(new Date(t.stage_entered_at), now) >= h) breach++;
    if (t.stage === 'pending_gm' || t.stage === 'pending_gm_price' || t.stage === 'pending_sr_manager') {
      waiting.push({ ticket_id: t.ticket_id, doc_no: String(t.ticket_no), title: String(t.customer_name || t.title), stage: t.stage,
        label: STAGE_LABEL_TH[t.stage], age_hours: t.stage_entered_at ? round_(hoursBetween_(new Date(t.stage_entered_at), now), 1) : 0 });
    }
  });
  waiting.sort(function (a, b) { return b.age_hours - a.age_hours; });
  const deals = dealRows_(Object.assign({}, u, { role: 'admin' }), true);   // read as Admin: the portal needs every line
  const months = portalMonths_(6);
  const trend = months.map(function (m) { return { month: m, quoted: 0, won: 0 }; });
  const sum = { open: 0, won: 0, lost: 0, open_value: 0, won_value: 0, sell: 0, profit: 0, won_sell: 0, won_profit: 0 };
  deals.forEach(function (r) {
    const sell = r.sell_price_thb * r.qty, profit = r.profit_thb * r.qty;
    sum.sell += sell; sum.profit += profit;
    if (r.deal_status === 'won') { sum.won++; sum.won_value += sell; sum.won_sell += sell; sum.won_profit += profit; }
    else if (r.deal_status === 'lost') sum.lost++;
    else { sum.open++; sum.open_value += sell; }
    const i = months.indexOf(r.quoted_month);
    if (i !== -1) { trend[i].quoted++; if (r.deal_status === 'won') trend[i].won++; }
  });
  return {
    configured: true,
    stages: stages, breach: breach, waiting: waiting.slice(0, 6), waiting_total: waiting.length,
    quoted: deals.length, open: sum.open, won: sum.won, lost: sum.lost,
    open_value_month: round_(sum.open_value, 0), won_value_month: round_(sum.won_value, 0),
    gp_percent: sum.sell ? round_(sum.profit / sum.sell * 100, 1) : null,
    won_gp_percent: sum.won_sell ? round_(sum.won_profit / sum.won_sell * 100, 1) : null,
    close_rate: deals.length ? round_(sum.won / deals.length * 100, 1) : null,
    trend: trend, value_unit: 'month'
  };
}

/** Header + summary columns of the Mech "Quotations" tab (never the Detail JSON). */
function mechSheetValues_() {
  if (TEST_MECH_) return TEST_MECH_;
  const id = PropertiesService.getScriptProperties().getProperty(CFG.PROP.MECH_SHEET_ID);
  if (!id) return null;
  const sh = SpreadsheetApp.openById(id).getSheetByName('Quotations');
  if (!sh) throw new Error('ไม่พบแท็บ Quotations ในไฟล์ของระบบ Mech');
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const want = ['Id', 'DocType', 'DocNo', 'Title', 'Customer', 'Sales', 'Currency', 'Exrate', 'OfferDate', 'Status', 'Total', 'Cost', 'Profit', 'GP', 'UpdatedAt', 'Deleted'];
  const cols = want.map(function (h) { return headers.indexOf(h); });
  const n = Math.max(0, lastRow - 1);
  const columns = cols.map(function (c) { return c === -1 || !n ? [] : sh.getRange(2, c + 1, n, 1).getValues(); });
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(columns.map(function (col) { return col.length ? col[i][0] : ''; }));
  return { headers: want, rows: rows };
}

function mechSummary_() {
  const cache = CacheService.getScriptCache();
  const hit = TEST_MECH_ ? null : cache.get('portal_mech');
  if (hit) return JSON.parse(hit);
  const v = mechSheetValues_();
  if (!v) return { configured: false };
  const ix = {};
  v.headers.forEach(function (h, i) { ix[h] = i; });
  const get = function (r, h) { return ix[h] === undefined ? '' : r[ix[h]]; };
  const months = portalMonths_(6);
  const trend = months.map(function (m) { return { month: m, quoted: 0, won: 0 }; });
  const stages = { req: 0, wip: 0, approval: 0, approved: 0, ready: 0, won: 0, closed: 0 };
  const waiting = [];
  const sum = { ready_value: 0, won_value: 0, total: 0, profit: 0, won_total: 0, won_profit: 0, quoted: 0, unconverted: 0 };
  v.rows.forEach(function (r) {
    if (/^(true|1|yes)$/i.test(String(get(r, 'Deleted')))) return;
    const type = String(get(r, 'DocType') || 'QT') === 'SR' ? 'SR' : 'QT';
    const status = String(get(r, 'Status') || '').trim();
    const k = MECH_STAGE_[type][status];
    if (k === undefined || k === null) return;
    stages[k]++;
    if (type === 'SR') return;
    const cur = String(get(r, 'Currency') || 'THB').toUpperCase();
    const rate = cur === 'THB' || !cur ? 1 : cur === 'USD' ? (Number(get(r, 'Exrate')) > 0 ? Number(get(r, 'Exrate')) : 35) : 0;
    const total = Number(get(r, 'Total')) || 0;
    const thb = rate ? total * rate : 0;
    if (!rate && total) sum.unconverted++;
    const profit = (Number(get(r, 'Profit')) || 0) * (rate || 0);
    if (['approved', 'ready', 'won', 'closed'].indexOf(k) !== -1) { sum.quoted++; sum.total += thb; sum.profit += profit; }
    if (k === 'ready') sum.ready_value += thb;
    if (k === 'won') { sum.won_value += thb; sum.won_total += thb; sum.won_profit += profit; }
    if (k === 'approval') {
      waiting.push({ doc_no: String(get(r, 'DocNo') || ''), title: String(get(r, 'Title') || get(r, 'Customer') || ''), customer: String(get(r, 'Customer') || ''),
        label: status === 'Partial Approved' ? 'อนุมัติแล้ว 1 ฝ่าย' : 'รออนุมัติ', value_thb: round_(thb, 0), gp: Number(get(r, 'GP')) || null });
    }
    const when = get(r, 'OfferDate') || get(r, 'UpdatedAt');
    const m = when ? fmtDate_(when instanceof Date ? when : new Date(String(when).length === 10 ? String(when) + 'T12:00:00+07:00' : when), 'yyyy-MM') : '';
    const i = months.indexOf(m);
    if (i !== -1 && ['approved', 'ready', 'won', 'closed'].indexOf(k) !== -1) { trend[i].quoted++; if (k === 'won') trend[i].won++; }
  });
  waiting.sort(function (a, b) { return b.value_thb - a.value_thb; });
  const out = {
    configured: true, stages: stages, waiting: waiting.slice(0, 6), waiting_total: waiting.length,
    quoted: sum.quoted, won: stages.won, closed: stages.closed, open: stages.ready + stages.approved,
    ready_value: round_(sum.ready_value, 0), won_value: round_(sum.won_value, 0),
    gp_percent: sum.total ? round_(sum.profit / sum.total * 100, 1) : null,
    won_gp_percent: sum.won_total ? round_(sum.won_profit / sum.won_total * 100, 1) : null,
    close_rate: sum.quoted ? round_(stages.won / sum.quoted * 100, 1) : null,
    unconverted: sum.unconverted, trend: trend, value_unit: 'project'
  };
  if (!TEST_MECH_) cache.put('portal_mech', JSON.stringify(out), 300);
  return out;
}
