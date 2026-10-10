/**
 * File: Bots.gs
 * Lark Custom Bot webhooks for the group "Food Price Request" (FPR).
 *
 *   Bot A "FPR Bot"       every workflow step (card colour / icon per event)      FPR_BOT_URL + FPR_BOT_SECRET
 *   Bot B "FPR Reminder"  only work that is over its SLA (hourly trigger)         FPR_REMINDER_URL + FPR_REMINDER_SECRET
 *   → Script Properties only (never in code or in the sheet).
 *
 * Rules
 *   • Interactive cards (msg_type "interactive"), URL button to the web app (?page=ticket&id=FPR-YYMM-####).
 *     A custom bot cannot receive button callbacks: approving is done in the web app only.
 *   • Signed: sign = base64( HmacSHA256( key = timestamp + "\n" + secret, message = "" ) ).
 *   • Mentions by e-mail <at email=…></at> (or <at id=open_id> when Users › lark_open_id is filled) — see buildMention().
 *   • Group cards never carry a price, cost, GP or vendor name: only "มีราคาแล้ว" + the button.
 *   • A card is queued inside the business transaction and sent AFTER it is committed (api_ → flushBotQueue_),
 *     so a Lark outage can never block or roll back an approval. 3 attempts (1 s, 2 s back-off), every send in NotifLog.
 */

let TEST_BOTS_ = null;     // tests: { fpr: { url, secret }, reminder: { url, secret } }
let BOT_QUEUE_ = [];       // cards waiting for the current request to commit

const BOT_PROPS_ = {
  fpr: { url: 'FPR_BOT_URL', secret: 'FPR_BOT_SECRET', name: 'FPR Bot' },
  reminder: { url: 'FPR_REMINDER_URL', secret: 'FPR_REMINDER_SECRET', name: 'FPR Reminder' }
};

/**
 * Bot A events. mention(t) → e-mails to @mention. Colours = Lark card header templates.
 * Settings › fpr_bot_events_off (JSON list) switches events off.
 */
const FPR_EVENTS_ = {
  submitted:  { icon: '📥', title: 'คำขอราคาใหม่ รอ GM อนุมัติ', color: 'blue',   mention: function () { return roleEmails_('gm'); } },
  assigned:   { icon: '🔧', title: 'มอบหมายทำราคา', color: 'indigo',            mention: function (t) { return [t.sr_email]; } },
  queued:     { icon: '🧾', title: 'GM อนุมัติแล้ว — รอ Sourcing รับงาน', color: 'blue', mention: function () { return roleEmails_('sr'); } },
  sm_review:  { icon: '📊', title: 'รอ Sourcing Manager อนุมัติ', color: 'orange',  mention: function () { return roleEmails_('sr_manager'); } },
  gm_final:   { icon: '🏁', title: 'รอ GM อนุมัติราคาสุดท้าย', color: 'purple',    mention: function () { return roleEmails_('gm'); } },
  approved:   { icon: '🎉', title: 'อนุมัติราคาแล้ว', color: 'green',             mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  rejected:   { icon: '❌', title: 'ปฏิเสธ', color: 'red',                        mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  returned:   { icon: '↩️', title: 'ตีกลับแก้ไข', color: 'red',                    mention: function (t, x) { return x.fixer || [t.sr_email]; } },
  need_info:  { icon: '↩️', title: 'ตีกลับ — ขอข้อมูลเพิ่มจากผู้ขอ', color: 'red', mention: function (t) { return [t.requestor_email]; } },
  cancelled:  { icon: '🚫', title: 'ยกเลิกคำขอ', color: 'grey',                    mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  revision:   { icon: '✏️', title: 'ผู้ขอขอให้ปรับราคา', color: 'orange',          mention: function (t) { return [t.sr_email]; } },
  follow_up:  { icon: '📌', title: 'แยกรายการส่งราคาตามหลัง', color: 'wathet',     mention: function (t) { return [t.sr_email]; } },
  deal_won:   { icon: '🏆', title: 'ปิดการขายได้', color: 'green',                mention: function (t) { return [t.sr_email]; } }
};

/** Workflow stage → SLA key of Settings › fpr_sla. */
const SLA_KEY_OF_STAGE_ = { pending_gm: 'GM_REVIEW', doc_check: 'PRICING', sourcing: 'PRICING', pending_sr_manager: 'SM_REVIEW', pending_gm_price: 'GM_FINAL_REVIEW' };
const SLA_LABEL_ = { GM_REVIEW: 'GM_REVIEW (GM อนุมัติให้ทำราคา)', PRICING: 'PRICING (Sourcing ทำราคา)', SM_REVIEW: 'SM_REVIEW (Sourcing Manager)', GM_FINAL_REVIEW: 'GM_FINAL_REVIEW (GM อนุมัติราคา)' };

function botConfig_(bot) {
  if (TEST_BOTS_) return TEST_BOTS_[bot] || { url: '', secret: '' };
  const p = PropertiesService.getScriptProperties();
  return { url: p.getProperty(BOT_PROPS_[bot].url) || '', secret: p.getProperty(BOT_PROPS_[bot].secret) || '' };
}

function roleEmails_(role) {
  return activeUsersByRole_(role).map(function (u) { return u.email; });
}

/** @mention markup for a card (lark_md). Swap to open_id here if e-mail mentions do not work in your tenant. */
function buildMention(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const u = userByEmail_(e);
  if (u && u.lark_open_id) return '<at id=' + u.lark_open_id + '></at>';
  return '<at email=' + e + '></at>';
}

/** Lark signature: base64(HmacSHA256(key = timestamp + "\n" + secret, message = "")). */
function larkSign_(timestamp, secret) {
  const bytes = Utilities.computeHmacSha256Signature('', String(timestamp) + '\n' + secret);
  return Utilities.base64Encode(bytes);
}

/** Web-app link by FPR number (opens the request page). */
function fprLink_(t) {
  let base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
  if (!base) { try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; } }
  return base + '?page=ticket&id=' + encodeURIComponent(t.ticket_no);
}

// ---------------------------------------------------------------- working time (SLA)

function workHours_() {
  const w = setting_('work_hours', { start: '08:30', end: '17:30', days: [1, 2, 3, 4, 5] }) || {};
  const min = function (hhmm, d) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };
  const s = min(w.start, 510), e = min(w.end, 1050);
  return { start: s, end: e > s ? e : s + 540, days: Array.isArray(w.days) && w.days.length ? w.days.map(Number) : [1, 2, 3, 4, 5] };
}

function holidaySet_() {
  const out = {};
  try { rows_(TAB.HOLIDAYS).forEach(function (h) { const d = h.date ? fmtDate_(h.date) : ''; if (d) out[d] = String(h.name || 'วันหยุด'); }); } catch (e) { /* tab missing before setupDatabase */ }
  return out;
}

// Bangkok has no daylight saving: local = UTC + 7 h
function bkk_(ms) {
  const d = new Date(ms + 7 * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() || 7, min: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60,
    ymd: d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2) };
}
function bkkAt_(y, m, d, minuteOfDay) { return Date.UTC(y, m, d, 0, 0) - 7 * 3600000 + minuteOfDay * 60000; }
function isWorkDay_(p, wh, hol) { return wh.days.indexOf(p.dow) !== -1 && !hol[p.ymd]; }

/** start + `minutes` of working time → Date. */
function addWorkMinutes_(start, minutes, wh, hol) {
  let cur = new Date(start).getTime();
  let left = Math.max(0, minutes);
  for (let i = 0; i < 1000; i++) {
    const p = bkk_(cur);
    if (!isWorkDay_(p, wh, hol) || p.min >= wh.end) { cur = bkkAt_(p.y, p.m, p.d + 1, wh.start); continue; }
    if (p.min < wh.start) { cur = bkkAt_(p.y, p.m, p.d, wh.start); continue; }
    const avail = wh.end - p.min;
    if (left <= avail) return new Date(cur + left * 60000);
    left -= avail;
    cur = bkkAt_(p.y, p.m, p.d + 1, wh.start);
  }
  return new Date(cur);
}

/** Working minutes between two times. */
function workMinutesBetween_(a, b, wh, hol) {
  let cur = new Date(a).getTime();
  const end = new Date(b).getTime();
  let total = 0;
  for (let i = 0; i < 1000 && cur < end; i++) {
    const p = bkk_(cur);
    if (!isWorkDay_(p, wh, hol) || p.min >= wh.end) { cur = bkkAt_(p.y, p.m, p.d + 1, wh.start); continue; }
    if (p.min < wh.start) { cur = bkkAt_(p.y, p.m, p.d, wh.start); continue; }
    const dayEnd = bkkAt_(p.y, p.m, p.d, wh.end);
    total += (Math.min(dayEnd, end) - cur) / 60000;
    cur = bkkAt_(p.y, p.m, p.d + 1, wh.start);
  }
  return Math.round(total);
}

function slaMinutes_(rule, wh) {
  const r = rule || {};
  if (Number(r.days) > 0) return Number(r.days) * (wh.end - wh.start);
  return Math.round((Number(r.hours) || 0) * 60);
}

/** SLA deadline of the ticket's current FPR step, or null. */
function slaDue_(t, wh, hol) {
  const key = SLA_KEY_OF_STAGE_[t.stage];
  if (!key || OPEN_STATUSES.indexOf(t.status) === -1) return null;
  const rule = (setting_('fpr_sla', {}) || {})[key];
  const mins = slaMinutes_(rule, wh);
  const start = key === 'PRICING' ? (t.pricing_started_at || t.stage_entered_at) : t.stage_entered_at;
  if (!mins || !start) return null;
  return { key: key, start: new Date(start), due: addWorkMinutes_(start, mins, wh, hol), minutes: mins };
}

// ---------------------------------------------------------------- cards

/** Plain facts of a ticket for a card (no price, cost, GP or vendor). */
function cardFacts_(t) {
  const wh = workHours_(), hol = holidaySet_();
  const req = userByEmail_(t.requestor_email);
  const owners = stageAssignees_(t).map(function (e) { const u = userByEmail_(e); return u ? u.full_name : e; }).filter(String);
  const sla = slaDue_(t, wh, hol);
  const items = activeItemsOf_(t.ticket_id);
  const lines = items.slice(0, 8).map(function (it) {
    if (it.quote_status) return '• #' + it.line_no + ' ' + it.product_name + ' — ' + (it.quote_status === 'follow_up' ? 'ส่งราคาตามหลัง' : 'ไม่เสนอราคา');
    const spec = [it.size, it.net_weight ? 'NW ' + it.net_weight : '', it.packing_size].filter(Boolean).join(' · ');
    return '• #' + it.line_no + ' **' + it.product_name + '**' + (spec ? ' (' + spec + ')' : '') + ' — ' + fmtQty_(it.qty) + ' ' + it.uom + '/เดือน';
  });
  if (items.length > 8) lines.push('… และอีก ' + (items.length - 8) + ' รายการ');
  const priced = ['pending_sr_manager', 'pending_gm_price', 'awaiting_sales_ack', 'closed'].indexOf(t.stage) !== -1;
  return {
    no: String(t.ticket_no), customer: (t.customer_name || '-') + (t.customer_group ? ' · ' + t.customer_group : ''),
    requester: req ? req.full_name : t.requestor_email, status: STAGE_LABEL_TH[t.stage] || t.stage,
    owner: owners.length ? owners.join(', ') : '-', deadline: sla ? fmtDate_(sla.due, 'dd/MM/yyyy HH:mm') : '',
    items: lines, priced: priced
  };
}

/** Interactive card JSON. opt: { color, title, mentions:[emails], extra:[lines], facts, overdue } */
function buildCard_(opt) {
  const f = opt.facts;
  const field = function (label, value) { return { is_short: true, text: { tag: 'lark_md', content: '**' + label + '**\n' + value } }; };
  const fields = [field('เลขที่', f.no), field('ลูกค้า', f.customer), field('ผู้ขอ', f.requester), field('สถานะ', f.status),
    field('ผู้รับผิดชอบ', f.owner)];
  if (f.deadline) fields.push(field('ครบกำหนด (SLA)', f.deadline + ' น.'));
  const els = [{ tag: 'div', fields: fields }];
  if (f.items.length) els.push({ tag: 'div', text: { tag: 'lark_md', content: '**สินค้า**\n' + f.items.join('\n') } });
  if (f.priced) els.push({ tag: 'div', text: { tag: 'lark_md', content: '💰 **มีราคาแล้ว** — ดูราคาบนเว็บ (ต้นทุน / GP เฉพาะ Sourcing · Sourcing Manager · GM)' } });
  (opt.extra || []).filter(String).forEach(function (x) { els.push({ tag: 'div', text: { tag: 'lark_md', content: x } }); });
  const mentions = (opt.mentions || []).map(function (e) { return String(e || '').trim().toLowerCase(); })
    .filter(function (e, i, a) { return e && a.indexOf(e) === i; }).map(buildMention).filter(String);
  if (mentions.length) els.push({ tag: 'div', text: { tag: 'lark_md', content: '👉 ' + mentions.join(' ') } });
  if (/^https:\/\//.test(opt.link || '')) {
    els.push({ tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: 'เปิดรายการ ' + f.no }, url: opt.link }] });
  }
  return { config: { wide_screen_mode: true }, header: { template: opt.color, title: { tag: 'plain_text', content: opt.title.slice(0, 120) } }, elements: els };
}

/**
 * Queue a Bot A card for `event` (sent after the transaction commits).
 * extra: { lines: [...], reason: 'shown only for sales-side decisions', fixer: [emails] }
 */
function queueFprCard_(event, t, extra) {
  const ev = FPR_EVENTS_[event];
  if (!ev) return 0;
  const off = setting_('fpr_bot_events_off', []);
  if (Array.isArray(off) && off.indexOf(event) !== -1) return 0;
  const x = extra || {};
  const facts = cardFacts_(t);
  const lines = (x.lines || []).slice();
  if (x.reason) lines.unshift('**เหตุผล:** ' + String(x.reason).slice(0, 300));
  const title = ev.icon + ' ' + ev.title + ' — ' + facts.no;
  const card = buildCard_({ color: ev.color, title: title, facts: facts, extra: lines, mentions: ev.mention(t, x), link: fprLink_(t) });
  BOT_QUEUE_.push({ bot: 'fpr', event: event, ticket_id: t.ticket_id, ticket_no: facts.no, card: card, summary: cardText_(card) });
  return 1;
}

/** All text of a card (NotifLog summary — what the group saw). */
function cardText_(card) {
  const out = [card.header.title.content];
  card.elements.forEach(function (e) {
    if (e.text) out.push(e.text.content);
    (e.fields || []).forEach(function (f) { out.push(f.text.content.replace(/\*\*/g, '')); });
  });
  return out.join(' | ').replace(/\*\*/g, '');
}

/** Send every queued card (called by api_ after a successful request, and by jobs). Never throws. */
function flushBotQueue_() {
  const q = BOT_QUEUE_;
  BOT_QUEUE_ = [];
  const out = [];
  q.forEach(function (m) {
    try { out.push(sendBot_(m.bot, m.card, m)); } catch (e) { console.error('flushBotQueue_', e); }
  });
  return out;
}

/** POST one signed card; up to 3 attempts (1 s, 2 s back-off); logs to NotifLog. Returns { status, attempts }. */
function sendBot_(bot, card, meta) {
  const cfg = botConfig_(bot);
  const m = meta || {};
  let status = 'not_configured', code = '', response = 'ยังไม่ได้ตั้ง ' + BOT_PROPS_[bot].url + ' ใน Script Properties', attempts = 0;
  if (cfg.url) {
    for (attempts = 1; attempts <= 3; attempts++) {
      try {
        const body = { msg_type: 'interactive', card: card };
        if (cfg.secret) {
          body.timestamp = String(Math.floor(Date.now() / 1000));
          body.sign = larkSign_(body.timestamp, cfg.secret);
        }
        const res = http_().fetch(cfg.url, { method: 'post', contentType: 'application/json; charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true });
        code = res.getResponseCode();
        response = String(res.getContentText() || '').slice(0, 500);
        const j = parseJson_(response, {});
        if (code === 200 && (j.code === 0 || j.StatusCode === 0)) { status = 'sent'; break; }
        status = 'failed';
      } catch (e) {
        status = 'failed';
        response = String(e.message || e).slice(0, 500);
      }
      if (attempts < 3 && !TEST_HTTP_) Utilities.sleep(1000 * Math.pow(2, attempts - 1));
    }
    if (attempts > 3) attempts = 3;
  }
  try {
    withLock_(function () {
      insertRow_(TAB.NOTIF_LOG, { log_id: uuid_(), ts: new Date(), ticket_id: m.ticket_id || '', ticket_no: m.ticket_no || '', bot: BOT_PROPS_[bot].name,
        event: m.event || '', status: status, http_code: code, attempts: attempts, response: response, summary: String(m.summary || '').slice(0, 1000) });
    });
  } catch (e) { console.error('NotifLog write failed', e); }
  return { status: status, attempts: attempts, http_code: code, response: response };
}

// ---------------------------------------------------------------- Bot B: SLA reminders

/**
 * Hourly trigger (installReminderTrigger): one yellow card per request that is over its SLA,
 * at most once every reminder_repeat_work_hours (8) working hours per request and step.
 */
function sendSlaReminders() {
  requireJobContext_();
  const wh = workHours_(), hol = holidaySet_();
  const repeat = Math.max(1, Number(setting_('reminder_repeat_work_hours', 8)) || 8) * 60;
  const now = new Date();
  const sent = [];
  withLock_(function () {
    rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
      const sla = slaDue_(t, wh, hol);
      if (!sla || now < sla.due) return;
      const last = t.last_reminded_at ? new Date(t.last_reminded_at) : null;
      if (last && last >= sla.start && workMinutesBetween_(last, now, wh, hol) < repeat) return;
      const late = workMinutesBetween_(sla.due, now, wh, hol);
      const facts = cardFacts_(t);
      const who = stageAssignees_(t);
      const title = '⏰ งานค้างเกิน SLA — ' + facts.no;
      const card = buildCard_({ color: 'yellow', title: title, facts: facts, mentions: who, link: fprLink_(t),
        extra: ['**ขั้นที่ค้าง:** ' + SLA_LABEL_[sla.key] + ' · SLA ' + Math.round(sla.minutes / 60 * 10) / 10 + ' ชม.ทำงาน',
          '**เกินกำหนดมาแล้ว:** ' + Math.floor(late / 60) + ' ชม. ' + (late % 60) + ' นาที (นับเฉพาะเวลาทำงาน)'] });
      updateRow_(TAB.TICKETS, t.ticket_id, { last_reminded_at: now });
      BOT_QUEUE_.push({ bot: 'reminder', event: 'sla_' + sla.key, ticket_id: t.ticket_id, ticket_no: facts.no, card: card, summary: cardText_(card) });
      sent.push(facts.no);
    });
  });
  flushBotQueue_();
  return { reminded: sent };
}

// ---------------------------------------------------------------- Admin web screen: bot settings
// Webhook URL + Secret are written to Script Properties only (never to the Sheet, never sent back to the browser).

const LARK_HOOK_RE_ = /^https:\/\/open\.(larksuite\.com|feishu\.cn)\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{8,}$/;

function requireAdmin_(u) {
  if (u.role !== 'admin') throw appError_('FORBIDDEN', 'เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น');
}
function maskUrl_(url) {
  const m = /^(https:\/\/[^/]+)\/.*?([A-Za-z0-9_-]{4})$/.exec(String(url || ''));
  return m ? m[1] + '/…/hook/••••' + m[2] : '';
}

/** Status of both bots for the Admin screen (no secret, URL masked) + the last send of each. */
function getBotSettings() {
  return api_('getBotSettings', function () {
    const u = currentUser_();
    requireAdmin_(u);
    const p = PropertiesService.getScriptProperties();
    const log = rows_(TAB.NOTIF_LOG);
    const bots = Object.keys(BOT_PROPS_).map(function (k) {
      const c = BOT_PROPS_[k];
      const url = p.getProperty(c.url) || '';
      const last = log.filter(function (n) { return String(n.bot) === c.name && String(n.event) !== 'config_changed'; }).pop();
      return { key: k, name: c.name, url_prop: c.url, secret_prop: c.secret, url_set: !!url, url_masked: maskUrl_(url), url_valid: !url || LARK_HOOK_RE_.test(url),
        secret_set: !!p.getProperty(c.secret),
        last: last ? { ts: fmtDate_(last.ts, 'dd/MM/yyyy HH:mm'), event: String(last.event), status: String(last.status), http_code: String(last.http_code), response: String(last.response).slice(0, 200) } : null };
    });
    const failed24 = log.filter(function (n) { return String(n.status) === 'failed' && new Date(n.ts).getTime() > Date.now() - 86400000; }).length;
    return { bots: bots, webapp_url: p.getProperty(CFG.PROP.WEBAPP_URL) || '', failed_24h: failed24 };
  });
}

/**
 * Save one bot's Webhook URL / Secret into Script Properties.
 * p: { url?, secret?, clear? } — blank field = keep the current value · clear = remove both.
 */
function saveBotSettings(bot, p) {
  return api_('saveBotSettings', function () {
    const u = currentUser_();
    requireAdmin_(u);
    const c = BOT_PROPS_[bot];
    if (!c) throw appError_('VALIDATION', 'ไม่รู้จักบอท');
    const o = p || {};
    const props = PropertiesService.getScriptProperties();
    const changed = [];
    if (o.clear) {
      props.deleteProperty(c.url);
      props.deleteProperty(c.secret);
      changed.push('ลบ URL + Secret');
    } else {
      const url = String(o.url || '').trim();
      const secret = String(o.secret || '').trim();
      if (url) {
        if (!LARK_HOOK_RE_.test(url)) throw appError_('VALIDATION', 'Webhook URL ต้องเป็นลิงก์ Lark รูปแบบ https://open.larksuite.com/open-apis/bot/v2/hook/…');
        props.setProperty(c.url, url);
        changed.push('URL');
      }
      if (secret) {
        if (secret.length > 200 || /\s/.test(secret)) throw appError_('VALIDATION', 'Secret ไม่ถูกต้อง (คัดลอกจากหน้า Security settings ของบอท)');
        props.setProperty(c.secret, secret);
        changed.push('Secret');
      }
      if (!changed.length) throw appError_('VALIDATION', 'กรอก Webhook URL และ/หรือ Secret ที่ต้องการเปลี่ยน');
    }
    withLock_(function () {
      insertRow_(TAB.NOTIF_LOG, { log_id: uuid_(), ts: new Date(), ticket_id: '', ticket_no: '', bot: c.name, event: 'config_changed', status: 'ok',
        http_code: '', attempts: 0, response: '', summary: 'ตั้งค่า ' + changed.join(' + ') + ' โดย ' + u.email });
    });
    return { saved: changed };
  });
}

/** Web-app link used by the card button (?page=ticket&id=FPR-…). */
function saveWebappUrl(url) {
  return api_('saveWebappUrl', function () {
    const u = currentUser_();
    requireAdmin_(u);
    const v = String(url || '').trim();
    if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(v)) {
      throw appError_('VALIDATION', 'ลิงก์ต้องเป็น https://script.google.com/…/macros/s/…/exec (Deploy → Manage deployments → Web app URL)');
    }
    PropertiesService.getScriptProperties().setProperty(CFG.PROP.WEBAPP_URL, v);
    return { webapp_url: v };
  });
}

/** Send one test card through a bot, mentioning the Admin. */
function testBotSend(bot) {
  return api_('testBotSend', function () {
    const u = currentUser_();
    requireAdmin_(u);
    const c = BOT_PROPS_[bot];
    if (!c) throw appError_('VALIDATION', 'ไม่รู้จักบอท');
    const facts = { no: 'FPR-TEST-0001', customer: 'ทดสอบการเชื่อมต่อ', requester: u.full_name, status: 'ทดสอบ', owner: u.full_name,
      deadline: fmtDate_(new Date(), 'dd/MM/yyyy HH:mm'), items: ['• ทดสอบจากหน้า ⚙️ ตั้งค่า Lark Bot'], priced: false };
    const card = buildCard_({ color: bot === 'reminder' ? 'yellow' : 'blue', title: '[ทดสอบ] ' + c.name + ' เชื่อมต่อสำเร็จ', facts: facts,
      mentions: [u.email], link: fprLink_({ ticket_no: 'FPR-TEST-0001' }), extra: ['ถ้าชื่อคุณด้านล่างเป็นสีฟ้า = mention ทำงาน'] });
    const r = sendBot_(bot, card, { event: 'test', ticket_no: 'FPR-TEST-0001', summary: 'ทดสอบโดย ' + u.email });
    let hint = '';
    if (r.status === 'not_configured') hint = 'ยังไม่ได้ใส่ Webhook URL';
    else if (r.status === 'failed') {
      const j = parseJson_(r.response, {});
      hint = /sign/i.test(String(j.msg || '')) ? 'Secret ไม่ตรงกับบอท (หรือเวลาเครื่องคลาดเคลื่อน) — คัดลอก Secret ใหม่จาก Security settings'
        : /keyword/i.test(String(j.msg || '')) ? 'บอทตั้ง Custom keywords ไว้ — ปิด keywords หรือใช้ signature verification อย่างเดียว'
        : /ip/i.test(String(j.msg || '')) ? 'บอทจำกัด IP — ปิด IP whitelist' : 'ส่งไม่สำเร็จ: ' + String(j.msg || r.response || r.http_code).slice(0, 150);
    }
    return { status: r.status, attempts: r.attempts, http_code: r.http_code, hint: hint };
  });
}

/**
 * FPR one-click setup (run from the editor as the script owner):
 * builds / upgrades the database (tabs incl. NotifLog + Holidays, Settings, Drive folder "FPR Attachments")
 * and reports which bot Script Properties are set. Secrets are never printed.
 */
function setup() {
  requireOwner_();
  const db = setupDatabase();
  const p = PropertiesService.getScriptProperties();
  const lines = Object.keys(BOT_PROPS_).map(function (k) {
    const c = BOT_PROPS_[k];
    const url = p.getProperty(c.url) || '', sec = p.getProperty(c.secret) || '';
    return c.name + ': ' + c.url + ' ' + (url ? (/^https:\/\/open\.(larksuite|feishu)\.(com|cn)\/open-apis\/bot\/v2\/hook\//.test(url) ? '✓' : '⚠ ไม่ใช่ลิงก์ Lark webhook') : '✗ ยังไม่ได้ตั้ง') +
      ' · ' + c.secret + ' ' + (sec ? '✓' : '✗ ยังไม่ได้ตั้ง');
  });
  const msg = ['setupDatabase: OK'].concat(lines, ['ขั้นต่อไป: testBots → installTriggers → Deploy']).join('\n');
  console.log(msg);
  return { database: db, bots: lines };
}

/** Run once: hourly trigger for sendSlaReminders (replaces an old one). */
function installReminderTrigger() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sendSlaReminders') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('sendSlaReminders').timeBased().everyHours(1).create();
  console.log('Installed: sendSlaReminders every hour');
  return 'OK';
}

// ---------------------------------------------------------------- test

/**
 * Run from the editor: sends one sample card of every Bot A event and one Bot B reminder,
 * all mentioning you (check the mention turns blue = your Lark account matches your e-mail).
 */
function testBots() {
  requireAdminOrOwner_();
  const me = String(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const facts = { no: 'FPR-TEST-0001', customer: 'ลูกค้าทดสอบ · ร้านอาหาร', requester: me, status: 'ทดสอบ', owner: me,
    deadline: fmtDate_(new Date(Date.now() + 4 * 3600000), 'dd/MM/yyyy HH:mm'),
    items: ['• #1 **กุ้งขาว Vannamei HLSO** (31/40 · NW 80% · 1 kg/pack) — 500 กก./เดือน', '• #2 **หมึกกล้วย IQF** (U/10) — 300 กก./เดือน'], priced: false };
  const link = fprLink_({ ticket_no: 'FPR-TEST-0001' });
  const out = [];
  Object.keys(FPR_EVENTS_).forEach(function (k) {
    const ev = FPR_EVENTS_[k];
    const f = Object.assign({}, facts, { priced: ['sm_review', 'gm_final', 'approved'].indexOf(k) !== -1 });
    const card = buildCard_({ color: ev.color, title: '[ทดสอบ] ' + ev.icon + ' ' + ev.title + ' — ' + f.no, facts: f, mentions: [me], link: link,
      extra: k === 'rejected' || k === 'returned' ? ['**เหตุผล:** (ข้อความทดสอบ)'] : [] });
    out.push(k + ': ' + sendBot_('fpr', card, { event: 'test_' + k, ticket_no: f.no, summary: 'testBots ' + k }).status);
  });
  const rem = buildCard_({ color: 'yellow', title: '[ทดสอบ] ⏰ งานค้างเกิน SLA — FPR-TEST-0001', facts: facts, mentions: [me], link: link,
    extra: ['**ขั้นที่ค้าง:** ' + SLA_LABEL_.GM_REVIEW + ' · SLA 4 ชม.ทำงาน', '**เกินกำหนดมาแล้ว:** 1 ชม. 20 นาที (นับเฉพาะเวลาทำงาน)'] });
  out.push('reminder: ' + sendBot_('reminder', rem, { event: 'test_reminder', ticket_no: 'FPR-TEST-0001', summary: 'testBots reminder' }).status);
  console.log(out.join('\n'));
  return out;
}
