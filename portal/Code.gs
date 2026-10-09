/**
 * File: portal/Code.gs
 * MGS Price Request Portal — a SEPARATE Apps Script web app (its own project, its own /exec URL).
 * The entry page for management: the pricing work of BOTH systems on one screen, then a button
 * into each pricing web app:
 *   Food = MGS Food Price Request          (FOOD_WEBAPP_URL)
 *   Mech = MGS Project Pricing (Solar/Mech) (MECH_WEBAPP_URL)
 * It is not part of either system and never writes to them: it only READS the summary columns
 * of both spreadsheets (read-only scope), so nothing in Food or Mech changes.
 *
 * Setup (once)
 *   1. New Apps Script project "MGS Price Request Portal" → paste Code.gs, Portal.html, appsscript.json
 *   2. Project Settings → Script properties:
 *        FOOD_SHEET_ID     ID of the Food database spreadsheet   (the Food app's DB_SPREADSHEET_ID)
 *        FOOD_WEBAPP_URL   /exec link of MGS Food Price Request
 *        MECH_SHEET_ID     ID of the MGS Project Pricing spreadsheet
 *        MECH_WEBAPP_URL   /exec link of MGS Project Pricing
 *        PORTAL_ALLOWED_EMAILS  (optional) comma-separated e-mails that may open the portal, e.g. BD / Procurement managers
 *      The account that deploys this project needs VIEW access to both spreadsheets.
 *   3. Run checkPortalSetup() → fix what it reports
 *   4. Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone within the company domain
 *
 * Who may open it: e-mails in PORTAL_ALLOWED_EMAILS, or active Food users with role gm / admin / sr_manager.
 * The page shows cost / GP of both systems → management only.
 */

const PORTAL_VERSION = '2026.10.09-2';
const PORTAL_PROP = {
  FOOD_SHEET_ID: 'FOOD_SHEET_ID', FOOD_WEBAPP_URL: 'FOOD_WEBAPP_URL',
  MECH_SHEET_ID: 'MECH_SHEET_ID', MECH_WEBAPP_URL: 'MECH_WEBAPP_URL', ALLOWED: 'PORTAL_ALLOWED_EMAILS'
};
const PORTAL_FOOD_ROLES = ['gm', 'admin', 'sr_manager'];
const PORTAL_CACHE_SEC = 300;

function doGet() {
  const t = HtmlService.createTemplateFromFile('Portal');
  t.version = PORTAL_VERSION;
  return t.evaluate()
    .setTitle('MGS Price Request — หน้ารวม')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Called by the page. Returns { ok, data } or { ok:false, code, error } (never throws to the browser). */
function getPortalData(forceRefresh) {
  try {
    const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
    if (!email) return { ok: false, code: 'NO_EMAIL', error: 'ระบบอ่านอีเมลผู้ใช้ไม่ได้ — ต้องเปิดด้วยบัญชีบริษัท (Google Workspace)' };
    const p = PropertiesService.getScriptProperties();
    const access = portalAccess_(email, p);
    if (!access.ok) return { ok: false, code: 'FORBIDDEN', error: 'หน้ารวมเปิดได้เฉพาะผู้บริหาร — แจ้งผู้ดูแลระบบให้เพิ่มอีเมล ' + email };
    const cache = CacheService.getScriptCache();
    const read = function (key, fn) {
      const hit = forceRefresh ? null : cache.get(key);
      if (hit) return JSON.parse(hit);
      let v;
      try { v = fn(); } catch (e) { console.error(key, e); v = { configured: true, error: 'อ่านข้อมูลไม่สำเร็จ: ' + String(e.message).slice(0, 200) }; }
      try { cache.put(key, JSON.stringify(v), PORTAL_CACHE_SEC); } catch (e) { /* too big for cache: fine */ }
      return v;
    };
    const food = read('portal_food', function () {
      const id = p.getProperty(PORTAL_PROP.FOOD_SHEET_ID);
      return id ? summarizeFood_(readFoodTables_(SpreadsheetApp.openById(id)), new Date()) : { configured: false };
    });
    const mech = read('portal_mech', function () {
      const id = p.getProperty(PORTAL_PROP.MECH_SHEET_ID);
      return id ? summarizeMech_(readTable_(SpreadsheetApp.openById(id), 'Quotations', MECH_COLS_), new Date()) : { configured: false };
    });
    return { ok: true, data: {
      food: food, mech: mech, months: portalMonths_(new Date(), 6),
      links: { food: p.getProperty(PORTAL_PROP.FOOD_WEBAPP_URL) || '', mech: p.getProperty(PORTAL_PROP.MECH_WEBAPP_URL) || '' },
      me: { email: email, name: access.name || email },
      generated_at: new Date().toISOString(), version: PORTAL_VERSION
    } };
  } catch (e) {
    console.error('getPortalData', e);
    return { ok: false, code: 'SERVER_ERROR', error: 'ระบบขัดข้อง: ' + String(e.message).slice(0, 200) };
  }
}

/** Allowed list in Script Properties, or an active Food user with a management role. */
function portalAccess_(email, p) {
  const list = String(p.getProperty(PORTAL_PROP.ALLOWED) || '').toLowerCase().split(/[\s,;]+/).filter(String);
  if (list.indexOf(email) !== -1) return { ok: true };
  const id = p.getProperty(PORTAL_PROP.FOOD_SHEET_ID);
  if (!id) return { ok: false };
  const users = readTable_(SpreadsheetApp.openById(id), 'Users', ['email', 'full_name', 'role', 'is_active']);
  const u = users.filter(function (r) { return String(r.email).trim().toLowerCase() === email; })[0];
  const active = u && String(u.is_active).toUpperCase() !== 'FALSE';
  return active && PORTAL_FOOD_ROLES.indexOf(String(u.role).trim()) !== -1 ? { ok: true, name: String(u.full_name || '') } : { ok: false };
}

/** Run from the editor: tells what is missing. */
function checkPortalSetup() {
  const p = PropertiesService.getScriptProperties();
  const out = [];
  [['FOOD_SHEET_ID', 'Food'], ['MECH_SHEET_ID', 'Mech']].forEach(function (x) {
    const id = p.getProperty(x[0]);
    if (!id) { out.push('⚠ ' + x[0] + ' ยังไม่ได้ตั้ง (' + x[1] + ' จะแสดงว่า “ยังไม่ได้เชื่อม”)'); return; }
    try {
      const ss = SpreadsheetApp.openById(id);
      const tab = x[1] === 'Food' ? 'Tickets' : 'Quotations';
      out.push(ss.getSheetByName(tab) ? '✓ ' + x[1] + ': ' + ss.getName() : '⚠ ' + x[1] + ': ไม่พบแท็บ ' + tab + ' ในไฟล์ ' + ss.getName());
    } catch (e) { out.push('✕ ' + x[1] + ': เปิดไฟล์ไม่ได้ — ให้สิทธิ์ Viewer กับบัญชีที่ deploy (' + e.message + ')'); }
  });
  ['FOOD_WEBAPP_URL', 'MECH_WEBAPP_URL'].forEach(function (k) { out.push((p.getProperty(k) ? '✓ ' : '⚠ ') + k + (p.getProperty(k) ? '' : ' ยังไม่ได้ตั้ง (ปุ่มเข้าระบบจะไม่แสดง)')); });
  out.push('ผู้มีสิทธิ์: Food role ' + PORTAL_FOOD_ROLES.join(' / ') + (p.getProperty(PORTAL_PROP.ALLOWED) ? ' + ' + p.getProperty(PORTAL_PROP.ALLOWED) : ''));
  console.log(out.join('\n'));
  return out.join('\n');
}

// ============================================================ readers (summary columns only)

const MECH_COLS_ = ['Id', 'DocType', 'DocNo', 'Title', 'Customer', 'Sales', 'Currency', 'Exrate', 'OfferDate', 'Status',
  'Total', 'Cost', 'Profit', 'GP', 'UpdatedAt', 'Deleted'];

/** Rows of `tab` as objects with only `cols` (one range read per column — the big JSON columns are never read). */
function readTable_(ss, tab, cols) {
  const sh = ss.getSheetByName(tab);
  if (!sh) throw new Error('ไม่พบแท็บ ' + tab);
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || !lastCol) return [];
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  const n = lastRow - 1;
  const data = cols.map(function (c) { const i = headers.indexOf(c); return i === -1 ? null : sh.getRange(2, i + 1, n, 1).getValues(); });
  const out = [];
  for (let r = 0; r < n; r++) {
    const o = {};
    cols.forEach(function (c, k) { o[c] = data[k] ? data[k][r][0] : ''; });
    out.push(o);
  }
  return out;
}

function readFoodTables_(ss) {
  return {
    tickets: readTable_(ss, 'Tickets', ['ticket_id', 'ticket_no', 'title', 'customer_name', 'stage', 'stage_entered_at', 'gm_price_approved_at']),
    items: readTable_(ss, 'TicketItems', ['item_id', 'ticket_id', 'qty', 'sell_price_thb', 'quote_status', 'deal_status', 'is_deleted']),
    quotes: readTable_(ss, 'Quotations', ['item_id', 'is_selected', 'is_deleted', 'landed_unit_cost_thb', 'net_unit_cost_thb', 'clearance_thb']),
    settings: readTable_(ss, 'Settings', ['key', 'value'])
  };
}

// ============================================================ summaries (pure functions — tested in dev/portal-test.js)

const PORTAL_TZ = 'Asia/Bangkok';
function ym_(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return '';
  const b = new Date(x.getTime() + 7 * 3600000);   // Bangkok, no DST
  return b.getUTCFullYear() + '-' + ('0' + (b.getUTCMonth() + 1)).slice(-2);
}
function portalMonths_(now, n) {
  const out = [];
  const b = new Date(now.getTime() + 7 * 3600000);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() - i, 15));
    out.push(d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2));
  }
  return out;
}
const truthy_ = function (v) { return v === true || /^(true|1|yes)$/i.test(String(v)); };
const num_ = function (v) { const n = Number(v); return isFinite(n) ? n : 0; };
const r1_ = function (v) { return Math.round(v * 10) / 10; };

/**
 * Food: stage counts, waiting-for-management list, priced lines (selling price stored at submit,
 * landed cost of the selected offer) with the deal status Sales recorded. Values per month = price × volume / month.
 */
function summarizeFood_(t, now) {
  const STAGE_OF = {
    pending_manager: 'req', returned: 'req', pending_gm: 'req', pending_assign: 'wip', doc_check: 'wip', need_info: 'wip', sourcing: 'wip',
    pending_sr_manager: 'approval', pending_gm_price: 'approval', awaiting_sales_ack: 'ready'
  };
  const WAIT = { pending_gm: 'รอ GM อนุมัติฝั่งขาย', pending_sr_manager: 'รอ SR Manager ตรวจราคา', pending_gm_price: 'รอ GM อนุมัติฝั่งซื้อ' };
  const setting = {};
  (t.settings || []).forEach(function (s) { setting[String(s.key)] = s.value; });
  let sla = {};
  try { sla = JSON.parse(setting.sla_hours || '{}'); } catch (e) { sla = {}; }
  const stages = { req: 0, wip: 0, approval: 0, ready: 0 };
  const priced = {};
  let breach = 0;
  const waiting = [];
  t.tickets.forEach(function (x) {
    const st = String(x.stage);
    if ((st === 'awaiting_sales_ack' || st === 'closed') && x.gm_price_approved_at) priced[String(x.ticket_id)] = x;
    const k = STAGE_OF[st];
    if (!k) return;
    stages[k]++;
    const entered = x.stage_entered_at ? new Date(x.stage_entered_at) : null;
    const ageH = entered && !isNaN(entered.getTime()) ? (now - entered) / 3600000 : 0;
    if (num_(sla[st]) > 0 && ageH >= num_(sla[st])) breach++;
    if (WAIT[st]) waiting.push({ doc_no: String(x.ticket_no), title: String(x.customer_name || x.title || ''), stage: st, label: WAIT[st], age_hours: r1_(ageH) });
  });
  waiting.sort(function (a, b) { return b.age_hours - a.age_hours; });
  const landed = {};
  t.quotes.forEach(function (q) {
    if (!truthy_(q.is_selected) || truthy_(q.is_deleted)) return;
    landed[String(q.item_id)] = q.landed_unit_cost_thb === '' || q.landed_unit_cost_thb == null
      ? num_(q.net_unit_cost_thb) + num_(q.clearance_thb) : num_(q.landed_unit_cost_thb);
  });
  const months = portalMonths_(now, 6);
  const trend = months.map(function (m) { return { month: m, quoted: 0, won: 0 }; });
  const s = { quoted: 0, open: 0, won: 0, lost: 0, open_value: 0, won_value: 0, sell: 0, profit: 0, won_sell: 0, won_profit: 0 };
  t.items.forEach(function (it) {
    const tk = priced[String(it.ticket_id)];
    if (!tk || truthy_(it.is_deleted) || String(it.quote_status || '') || !(String(it.item_id) in landed)) return;
    const qty = num_(it.qty), sellU = num_(it.sell_price_thb);
    if (!(sellU > 0)) return;
    const sell = sellU * qty, profit = (sellU - landed[String(it.item_id)]) * qty;
    const ds = String(it.deal_status || '');
    s.quoted++; s.sell += sell; s.profit += profit;
    if (ds === 'won') { s.won++; s.won_value += sell; s.won_sell += sell; s.won_profit += profit; }
    else if (ds === 'lost') s.lost++;
    else { s.open++; s.open_value += sell; }
    const i = months.indexOf(ym_(tk.gm_price_approved_at));
    if (i !== -1) { trend[i].quoted++; if (ds === 'won') trend[i].won++; }
  });
  return {
    configured: true, stages: stages, breach: breach, waiting: waiting.slice(0, 6), waiting_total: waiting.length,
    quoted: s.quoted, open: s.open, won: s.won, lost: s.lost,
    open_value: Math.round(s.open_value), won_value: Math.round(s.won_value),
    gp_percent: s.sell ? r1_(s.profit / s.sell * 100) : null, won_gp_percent: s.won_sell ? r1_(s.won_profit / s.won_sell * 100) : null,
    close_rate: s.quoted ? r1_(s.won / s.quoted * 100) : null, trend: trend, value_unit: 'month'
  };
}

/** Mech (MGS Project Pricing) statuses → portal stage (same wording as the MGS Sales app). */
const MECH_STAGE_ = {
  SR: { Draft: null, Submitted: 'req', '': 'req', Accepted: 'wip', Quoted: null, Cancelled: null },
  QT: { Requested: 'wip', 'In Progress': 'wip', Draft: 'wip', Submitted: 'approval', 'Partial Approved': 'approval', Approved: 'approved',
        Pending: 'ready', Won: 'won', Closed: 'closed', Lost: 'closed' }
};

function summarizeMech_(rows, now) {
  const months = portalMonths_(now, 6);
  const trend = months.map(function (m) { return { month: m, quoted: 0, won: 0 }; });
  const stages = { req: 0, wip: 0, approval: 0, approved: 0, ready: 0, won: 0, closed: 0 };
  const waiting = [];
  const s = { ready_value: 0, won_value: 0, total: 0, profit: 0, won_total: 0, won_profit: 0, quoted: 0, unconverted: 0 };
  rows.forEach(function (r) {
    if (truthy_(r.Deleted)) return;
    const type = String(r.DocType || 'QT') === 'SR' ? 'SR' : 'QT';
    const status = String(r.Status || '').trim();
    const k = MECH_STAGE_[type][status];
    if (k === undefined || k === null) return;
    stages[k]++;
    if (type === 'SR') return;
    const cur = String(r.Currency || 'THB').toUpperCase();
    const rate = cur === 'THB' ? 1 : cur === 'USD' ? (num_(r.Exrate) > 0 ? num_(r.Exrate) : 35) : 0;
    const thb = num_(r.Total) * rate;
    if (!rate && num_(r.Total)) s.unconverted++;
    const profit = num_(r.Profit) * rate;
    const offered = ['approved', 'ready', 'won', 'closed'].indexOf(k) !== -1;
    if (offered) { s.quoted++; s.total += thb; s.profit += profit; }
    if (k === 'ready') s.ready_value += thb;
    if (k === 'won') { s.won_value += thb; s.won_total += thb; s.won_profit += profit; }
    if (k === 'approval') {
      waiting.push({ doc_no: String(r.DocNo || ''), title: String(r.Title || r.Customer || ''), customer: String(r.Customer || ''),
        label: status === 'Partial Approved' ? 'อนุมัติแล้ว 1 ฝ่าย' : 'รออนุมัติ', value_thb: Math.round(thb), gp: num_(r.GP) || null });
    }
    const when = r.OfferDate || r.UpdatedAt;
    const m = when ? ym_(when instanceof Date ? when : new Date(String(when).length === 10 ? String(when) + 'T12:00:00+07:00' : when)) : '';
    const i = months.indexOf(m);
    if (i !== -1 && offered) { trend[i].quoted++; if (k === 'won') trend[i].won++; }
  });
  waiting.sort(function (a, b) { return b.value_thb - a.value_thb; });
  return {
    configured: true, stages: stages, waiting: waiting.slice(0, 6), waiting_total: waiting.length,
    quoted: s.quoted, won: stages.won, closed: stages.closed,
    ready_value: Math.round(s.ready_value), won_value: Math.round(s.won_value),
    gp_percent: s.total ? r1_(s.profit / s.total * 100) : null, won_gp_percent: s.won_total ? r1_(s.won_profit / s.won_total * 100) : null,
    close_rate: s.quoted ? r1_(stages.won / s.quoted * 100) : null, unconverted: s.unconverted, trend: trend, value_unit: 'project'
  };
}
