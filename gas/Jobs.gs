/**
 * File: Jobs.gs
 * Scheduled jobs and maintenance.
 *
 *   installTriggers()  — (re)creates all time triggers. Run once after deploying, and again
 *                        if you change schedules. Deletes this project's old triggers first.
 *   dispatchNotifications  every 1 min   (Lark.gs)
 *   checkSlaAlerts         every hour    SLA warning (80%) / breach notifications
 *   runSelfTest            daily 07:00   schema, config, orphan tickets, log chain → Lark group on failure
 *   weeklyBackup           Monday 06:00  copy of the database spreadsheet, keeps the newest 12
 *   sendSlaReminders       every hour    FPR Reminder bot: one card per late request — only when Settings reminder_mode = hourly
 *   sendDailyDigest        daily 09:00   FPR Reminder bot: ONE summary of all open work (late / nearly late / in progress) — working days
 *
 * Time triggers run as the owner: there is no "current user", so actions are stamped 'system'.
 */

const JOB_HANDLERS_ = ['dispatchNotifications', 'checkSlaAlerts', 'runSelfTest', 'weeklyBackup', 'sendSlaReminders', 'sendDealFollowUps', 'runRetention', 'sendDailyDigest'];
const BACKUP_KEEP_ = 12;

function installTriggers() {
  requireOwner_();
  return installTriggersCore_();
}

/** Admin › “⚙️ ติดตั้ง / ซ่อม Trigger” from the web page (the web app runs as the owner, so the triggers are the owner's). */
function installTriggersFromWeb() {
  return api_('installTriggersFromWeb', function () {
    requireAdmin_(currentUser_());
    return { message: installTriggersCore_(), triggers: triggerStatus_() };
  });
}

/** Expected scheduled jobs → installed? + last run (Script Properties JOB_LAST_<name>). */
function triggerStatus_() {
  const have = {};
  try { ScriptApp.getProjectTriggers().forEach(function (tr) { have[tr.getHandlerFunction()] = true; }); } catch (e) { /* no permission */ }
  const p = PropertiesService.getScriptProperties();
  const LABEL = { dispatchNotifications: 'ส่งแจ้งเตือน (ทุก 1 นาที)', checkSlaAlerts: 'ตรวจ SLA (ทุกชั่วโมง)', sendDailyDigest: 'สรุปงานค้าง 09:00',
    sendSlaReminders: 'การ์ดงานเกิน SLA รายชั่วโมง', sendDealFollowUps: 'ติดตามลูกค้า 08:45', runSelfTest: 'ตรวจระบบ 07:00', weeklyBackup: 'สำรองข้อมูลวันจันทร์', runRetention: 'ล้างข้อมูลรายเดือน' };
  // the hourly per-request card job runs every hour but only sends when Settings reminder_mode = hourly
  LABEL.sendSlaReminders += reminderMode_() === 'hourly' ? ' (เปิดอยู่)' : ' (ปิดอยู่ — ใช้สรุปงานค้าง 09:00 แทน · เปิดได้ที่ Settings reminder_mode = hourly)';
  return JOB_HANDLERS_.map(function (h) {
    const last = p.getProperty('JOB_LAST_' + h);
    return { handler: h, label: LABEL[h] || h, installed: !!have[h], last_run: last ? fmtDate_(new Date(last), 'dd/MM/yyyy HH:mm') : '' };
  });
}

function installTriggersCore_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (JOB_HANDLERS_.indexOf(tr.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('dispatchNotifications').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkSlaAlerts').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendSlaReminders').timeBased().everyHours(1).create();   // FPR Reminder bot (Bots.gs)
  ScriptApp.newTrigger('runSelfTest').timeBased().everyDays(1).atHour(7).inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('sendDealFollowUps').timeBased().everyDays(1).atHour(8).nearMinute(45).inTimezone(CFG.TZ).create();   // Lark DM: deals to follow up
  ScriptApp.newTrigger('runRetention').timeBased().onMonthDay(1).atHour(3).inTimezone(CFG.TZ).create();                      // monthly clean-up (Retention.gs)
  ScriptApp.newTrigger('sendDailyDigest').timeBased().everyDays(1).atHour(9).nearMinute(0).inTimezone(CFG.TZ).create();      // 09:00 summary of open work (Bots.gs)
  const msg = 'Installed triggers: ' + JOB_HANDLERS_.join(', ');
  console.log(msg);
  return msg;
}

/** Hourly: queue one warning and one breach notification per ticket per stage visit. */
function checkSlaAlerts() {
  requireJobContext_();
  markJobRun_('checkSlaAlerts');
  try {
    const result = withLock_(function () {
      const warn = Number(setting_('sla_warning_ratio', 0.8));
      const wh = workHours_(), hol = holidaySet_();
      const now = new Date();
      const existing = {};
      rows_(TAB.SLA_ALERTS).forEach(function (a) { existing[String(a.alert_key)] = true; });
      const breaches = [];
      let queued = 0;
      rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
        // same SLA as the list / request page / FPR Reminder (calendar hours, Sat–Sun + Holidays not counted)
        const s = stageSla_(t, wh, hol);
        if (!s) return;
        const entered = s.start;
        const ageH = workMinutesBetween_(s.start, now, wh, hol) / 60;
        const slaH = round_(s.minutes / 60, 1);
        const level = now >= s.due ? 'breach' : ageH >= slaH * warn ? 'warning' : '';
        if (!level) return;
        const key = t.ticket_id + '|' + t.stage + '|' + entered.toISOString() + '|' + level;
        if (existing[key]) return;
        insertRow_(TAB.SLA_ALERTS, { alert_key: key, ticket_id: t.ticket_id, stage: t.stage, stage_entered_at: entered, level: level, created_at: now });
        existing[key] = true;
        const recipients = stageAssignees_(t).concat(level === 'breach' ? stageEscalation_(t) : []);
        enqueueNotifications_(recipients, t, 'sla_' + level,
          '[' + t.ticket_no + '] ' + (level === 'breach' ? '⛔ เกิน SLA' : '⚠️ ใกล้ครบ SLA') + ': ' + STAGE_LABEL_TH[t.stage],
          t.title + '\nค้างในขั้นนี้ ' + round_(ageH, 1) + ' ชม. (SLA ' + slaH + ' ชม. ' + slaBasisText_() + ')', ticketLink_(t));
        queued++;
        if (level === 'breach') breaches.push(t.ticket_no + ' — ' + STAGE_LABEL_TH[t.stage] + ' (' + round_(ageH, 0) + '/' + slaH + ' ชม.)');
      });
      return { queued: queued, breaches: breaches };
    });
    // the group hears about overdue jobs from the FPR Reminder bot (sendSlaReminders) — this job only DMs the people concerned
    return result;
  } catch (e) {
    logError_('checkSlaAlerts', e);
    larkGroupText_('⚠️ checkSlaAlerts ล้มเหลว: ' + e.message);
    throw e;
  }
}

/**
 * Daily (Mon–Fri): one Lark DM per Sales who has deals waiting for a customer follow-up (ติดตามการขาย).
 * At most one per person per day; the list is the same as the "⏳ งานค้าง" view.
 */
function sendDealFollowUps() {
  requireJobContext_();
  markJobRun_('sendDealFollowUps');
  const p = bkk_(Date.now());
  if (workHours_().days.indexOf(p.dow) === -1 || holidaySet_()[p.ymd]) return { sent: 0, skipped: 'not a working day' };
  const today = todayBkk_();
  return withLock_(function () {
    const already = {};
    rows_(TAB.NOTIFICATIONS).forEach(function (n) { if (String(n.type) === 'deal_due' && fmtDate_(n.created_at) === today) already[String(n.user_email).toLowerCase()] = true; });
    let sent = 0;
    activeUsersByRole_('sales').forEach(function (u) {
      if (already[u.email]) return;
      const due = dealRows_(u, false).filter(function (r) { return r.is_due && r.can_edit && r.requestor_email === u.email; });
      if (!due.length) return;
      const lines = due.slice(0, 5).map(function (r) { return '• ' + r.customer_name + ' — ' + r.product_name + (r.deal_next_step ? ' (' + r.deal_next_step + ')' : ''); });
      if (due.length > 5) lines.push('… และอีก ' + (due.length - 5) + ' รายการ');
      let base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
      if (!base) { try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; } }
      sent += enqueueNotifications_([u.email], null, 'deal_due', '🎯 ติดตามลูกค้า ' + due.length + ' รายการวันนี้', lines.join('\n'), base + '?page=deals&view=pending');
    });
    return { sent: sent };
  });
}

/** Weekly copy of the database spreadsheet into <attachments root>/Backups. */
function weeklyBackup() {
  requireJobContext_();
  try {
    const props = PropertiesService.getScriptProperties();
    const dbId = props.getProperty(CFG.PROP.DB_ID);
    const root = DriveApp.getFolderById(props.getProperty(CFG.PROP.DRIVE_ROOT_ID));
    const it = root.getFoldersByName('Backups');
    const folder = it.hasNext() ? it.next() : root.createFolder('Backups');
    const copy = DriveApp.getFileById(dbId).makeCopy('MGS Food Price Request DB backup ' + fmtDate_(new Date(), 'yyyy-MM-dd HHmm'), folder);

    const files = [];
    const fit = folder.getFiles();
    while (fit.hasNext()) files.push(fit.next());
    files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
    files.slice(BACKUP_KEEP_).forEach(function (f) { f.setTrashed(true); });
    console.log('Backup created: ' + copy.getId());
    return copy.getId();
  } catch (e) {
    logError_('weeklyBackup', e);
    larkGroupText_('⚠️ Backup รายสัปดาห์ล้มเหลว: ' + e.message);
    throw e;
  }
}

/**
 * Health check. Run from the editor before/after each deploy; also runs daily.
 * Returns an array of PASS/FAIL lines.
 */
function runSelfTest() {
  requireJobContext_();
  markJobRun_('runSelfTest');
  const out = [];
  const t = function (name, fn) {
    try {
      const detail = fn();
      out.push('PASS ' + name + (detail ? ' — ' + detail : ''));
    } catch (e) {
      out.push('FAIL ' + name + ' — ' + e.message);
    }
  };
  const props = PropertiesService.getScriptProperties();

  t('database configured', function () { db_(); return db_().getName ? db_().getName() : ''; });
  t('all tabs + headers match schema', function () {
    Object.keys(SCHEMA).forEach(function (tab) { headers_(tab); });
    return Object.keys(SCHEMA).length + ' tabs';
  });
  t('drive folder configured', function () {
    if (!props.getProperty(CFG.PROP.DRIVE_ROOT_ID)) throw new Error('DRIVE_ROOT_FOLDER_ID missing');
  });
  t('database + attachment folder are NOT shared with Sales (cost data lives there)', function () {
    // The web app runs as the owner; nobody else needs the spreadsheet or Drive folder.
    // A Sales user with access to the sheet would see every vendor price, cost and GP.
    const ids = [props.getProperty(CFG.PROP.DB_ID), props.getProperty(CFG.PROP.DRIVE_ROOT_ID)].filter(String);
    const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    const problems = [];
    ids.forEach(function (id, i) {
      const f = i === 0 ? DriveApp.getFileById(id) : DriveApp.getFolderById(id);
      const what = i === 0 ? 'Spreadsheet' : 'โฟลเดอร์ไฟล์แนบ';
      if (String(f.getSharingAccess()) !== String(DriveApp.Access.PRIVATE)) problems.push(what + ' แชร์แบบลิงก์/ทั้งโดเมน');
      f.getEditors().concat(f.getViewers()).forEach(function (p) {
        const e = String(p.getEmail() || '').toLowerCase();
        if (!e || e === owner) return;
        const pu = userByEmail_(e);
        if (!pu || pu.role !== 'admin') problems.push(what + ' แชร์ให้ ' + e);
      });
    });
    if (problems.length) throw new Error(problems.join(' · ') + ' — ยกเลิกการแชร์ (ให้เข้าผ่านเว็บแอปเท่านั้น)');
    return 'private';
  });
  t('vat_rate valid', function () { return String(vatRate_()); });
  t('every department with sales has a manager', function () {
    const bad = rows_(TAB.USERS).map(normUser_).filter(function (u) { return u.is_active && u.role === 'sales'; })
      .map(function (u) { return u.department_code; })
      .filter(function (c, i, a) { return a.indexOf(c) === i; })
      .filter(function (c) { const d = departmentByCode_(c); return !d || !d.manager_email || !userByEmail_(d.manager_email); });
    if (bad.length) throw new Error('แผนกไม่มี Manager ที่ใช้งานได้: ' + bad.join(', '));
  });
  t('every ticket has a create log (no half-written ticket)', function () {
    const withLog = {};
    rows_(TAB.LOGS).forEach(function (l) { if (l.action === 'create') withLog[String(l.ticket_id)] = true; });
    const anchor = logAnchor_();
    const archivedUntil = anchor ? new Date(anchor.last_ts).getTime() : 0;   // create logs of older requests are in the archive
    const orphans = rows_(TAB.TICKETS).filter(function (r) { return !withLog[String(r.ticket_id)] && !(Math.floor(new Date(r.created_at).getTime() / 1000) * 1000 <= archivedUntil); })
      .map(function (r) { return r.ticket_no; });
    if (orphans.length) throw new Error('ใบที่ไม่มี log การสร้าง: ' + orphans.join(', '));
  });
  t('status matches stage on every ticket', function () {
    const bad = rows_(TAB.TICKETS).filter(function (r) { return STAGE_STATUS[r.stage] !== r.status; }).map(function (r) { return r.ticket_no; });
    if (bad.length) throw new Error(bad.join(', '));
  });
  t('audit log hash chain intact', function () {
    const res = verifyLogChainCore_();
    if (!res.valid) throw new Error('log_id ' + res.brokenAt + ': ' + res.reason);
    return res.rows + ' rows';
  });
  t('no Lark messages failed permanently in 24 h', function () {
    const since = Date.now() - 86400000;
    const failed = rows_(TAB.NOTIFICATIONS).filter(function (n) {
      return String(n.lark_status) === 'failed' && new Date(n.created_at).getTime() > since;
    }).length;
    if (failed) throw new Error(failed + ' failed');
  });
  t('FPR Bot + FPR Reminder webhooks configured', function () {
    const p = PropertiesService.getScriptProperties();
    const miss = [];
    Object.keys(BOT_PROPS_).forEach(function (k) { [BOT_PROPS_[k].url, BOT_PROPS_[k].secret].forEach(function (n) { if (!p.getProperty(n)) miss.push(n); }); });
    if (miss.length) throw new Error(miss.join(', ') + ' not set (Admin › ⚙️ ตั้งค่า Lark Bot)');
  });
  t('Lark DM for follow-up reminders', function () {
    const types = setting_('lark_dm_types', []);
    if (!Array.isArray(types) || !types.length) return 'off';
    if (!larkConfigured_()) throw new Error('lark_dm_types is on but LARK_APP_ID / LARK_APP_SECRET not set — DMs are skipped (bell only)');
    return 'on';
  });

  const failedLines = out.filter(function (l) { return l.indexOf('FAIL') === 0; });
  console.log(out.join('\n'));
  if (failedLines.length) larkGroupText_('⚠️ MGS Food Price Request self-test พบปัญหา ' + failedLines.length + ' ข้อ\n' + failedLines.join('\n'));
  return out;
}

// =============================================================================
// Retention (monthly trigger, runRetention) — keeps the Sheet and Drive from growing forever
// without losing anything needed for an audit. Durations: Settings › retention.
//   Tickets / items / quotations / suppliers / users: kept forever.
//   TicketLogs: rows older than log_archive_months whose request is closed move (oldest first, in log order)
//     to the archive spreadsheet; the last archived hash is kept as the chain anchor (verifyLogChain still proves
//     nothing was changed) and old timelines read the archive.
// =============================================================================
const RETENTION_DEFAULTS_ = { notifications_read_days: 180, notif_log_days: 180, sla_alerts_days: 90, usage_raw_days: 90,
  error_log_days: 180, log_archive_months: 18, loser_photo_days: 180 };
const LOG_ANCHOR_PROP_ = 'LOG_ARCHIVE_ANCHOR';

function runRetention() {
  requireJobContext_();
  const cfg = Object.assign({}, RETENTION_DEFAULTS_, setting_('retention', {}) || {});
  const now = Date.now();
  const before = function (days) { return now - Number(days) * 86400000; };
  const out = withLock_(function () {
    const r = {};
    const oldNotif = function (n) { return toBool_(n.is_read) && n.read_at && new Date(n.read_at).getTime() < before(cfg.notifications_read_days); };
    const oldCard = function (n) { return n.ts && new Date(n.ts).getTime() < before(cfg.notif_log_days); };
    const oldErr = function (n) { return n.ts && new Date(n.ts).getTime() < before(cfg.error_log_days); };
    // 1) keep an Excel copy of everything about to be deleted (Drive › Exports)
    const d = function (v) { return v ? new Date(v) : ''; };
    r.export_file = saveRetentionExport_([
      { name: 'แจ้งเตือน (อ่านแล้ว)', header: ['เวลา', 'ถึง', 'ประเภท', 'หัวข้อ', 'ข้อความ', 'อ่านเมื่อ'],
        rows: rows_(TAB.NOTIFICATIONS).filter(oldNotif).map(function (n) { return [d(n.created_at), String(n.user_email), String(n.type), String(n.title), String(n.body), d(n.read_at)]; }) },
      { name: 'การ์ด Lark กลุ่ม', header: ['เวลา', 'เลขที่', 'บอท', 'เหตุการณ์', 'ผล', 'ข้อความ'],
        rows: rows_(TAB.NOTIF_LOG).filter(oldCard).map(function (n) { return [d(n.ts), String(n.ticket_no), String(n.bot), String(n.event), String(n.status), String(n.summary)]; }) },
      { name: 'ErrorLog', header: ['เวลา', 'ฟังก์ชัน', 'ผู้ใช้', 'code', 'ข้อความ'],
        rows: rows_(TAB.ERRORS).filter(oldErr).map(function (n) { return [d(n.ts), String(n.fn), String(n.user_email), String(n.code), String(n.message)]; }) },
      { name: 'รูป Supplier ที่จะลบ', header: ['เลขที่ใบ (ticket_id)', 'ชื่อไฟล์', 'Supplier (quote_id)', 'แนบโดย', 'วันที่แนบ', 'ลิงก์ Drive (อยู่ในถังขยะ 30 วัน)'],
        rows: findLoserPhotos_(before(cfg.loser_photo_days)).map(function (a) { return [String(a.ticket_id), String(a.file_name), String(a.quote_id), String(a.uploaded_by), d(a.uploaded_at), 'https://drive.google.com/file/d/' + String(a.drive_file_id) + '/view']; }) }
    ]);
    // 2) clean up
    r.notifications = deleteRowsWhere_(TAB.NOTIFICATIONS, oldNotif);
    r.notif_log = deleteRowsWhere_(TAB.NOTIF_LOG, oldCard);
    r.error_log = deleteRowsWhere_(TAB.ERRORS, oldErr);
    const open = {};
    rows_(TAB.TICKETS).forEach(function (t) { if (OPEN_STATUSES.indexOf(String(t.status)) !== -1) open[String(t.ticket_id)] = true; });
    r.sla_alerts = deleteRowsWhere_(TAB.SLA_ALERTS, function (a) {
      return !open[String(a.ticket_id)] && a.created_at && new Date(a.created_at).getTime() < before(cfg.sla_alerts_days);
    });
    r.usage = rollUpUsage_(before(cfg.usage_raw_days));
    r.loser_photos = purgeLoserPhotos_(before(cfg.loser_photo_days));
    r.logs_archived = archiveLogs_(now - Number(cfg.log_archive_months) * 30.44 * 86400000, open);
    return r;
  });
  console.log('runRetention: ' + JSON.stringify(out));
  return out;
}

/** UsageLog: daily rows older than the cut-off → one row per month / person / page (day = yyyy-MM). */
function rollUpUsage_(cutoff) {
  const sum = {};
  const old = rows_(TAB.USAGE_LOG).filter(function (u) {
    const d = String(u.day || '');
    return d.length === 10 && new Date(d + 'T00:00:00+07:00').getTime() < cutoff;
  });
  if (!old.length) return 0;
  old.forEach(function (u) {
    const k = [String(u.day).slice(0, 7), String(u.email), String(u.role), String(u.page)].join('|');
    sum[k] = (sum[k] || 0) + (Number(u.views) || 0);
  });
  const monthly = {};
  rows_(TAB.USAGE_LOG).forEach(function (u) { if (String(u.day).length === 7) monthly[[u.day, u.email, u.role, u.page].join('|')] = u; });
  const ids = {};
  old.forEach(function (u) { ids[String(u.log_id)] = true; });
  const add = [];
  Object.keys(sum).forEach(function (k) {
    const m = monthly[k];
    if (m) updateRow_(TAB.USAGE_LOG, m.log_id, { views: Number(m.views || 0) + sum[k] });
    else { const p = k.split('|'); add.push({ log_id: uuid_(), day: p[0], email: p[1], role: p[2], page: p[3], views: sum[k] }); }
  });
  insertRows_(TAB.USAGE_LOG, add);
  return deleteRowsWhere_(TAB.USAGE_LOG, function (u) { return ids[String(u.log_id)]; });
}

/** Supplier photos of offers that did NOT win, of requests closed before the cut-off. */
function findLoserPhotos_(cutoff) {
  const tickets = {};
  rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
    if (OPEN_STATUSES.indexOf(t.status) !== -1) return;
    const end = t.closed_at || t.rejected_at || t.cancelled_at || t.updated_at;
    if (end && new Date(end).getTime() < cutoff) tickets[t.ticket_id] = true;
  });
  const winners = {};
  rows_(TAB.QUOTATIONS).forEach(function (q) { if (toBool_(q.is_selected) && !toBool_(q.is_deleted)) winners[String(q.quote_id)] = true; });
  return rows_(TAB.ATTACHMENTS).filter(function (a) {
    return String(a.category) === 'quote_photo' && !toBool_(a.is_deleted) && tickets[String(a.ticket_id)] && !winners[String(a.quote_id)];
  });
}

/** → Drive trash + attachment marked deleted (logged per request). */
function purgeLoserPhotos_(cutoff) {
  const byTicket = {};
  const now = new Date();
  findLoserPhotos_(cutoff).forEach(function (a) {
    try { drive_().getFileById(String(a.drive_file_id)).setTrashed(true); } catch (e) { console.warn('retention: trash failed', a.drive_file_id, e); }
    updateRow_(TAB.ATTACHMENTS, a.attachment_id, { is_deleted: true, deleted_by: 'retention', deleted_at: now });
    byTicket[String(a.ticket_id)] = (byTicket[String(a.ticket_id)] || 0) + 1;
  });
  let n = 0;
  Object.keys(byTicket).forEach(function (id) {
    n += byTicket[id];
    appendLog_({ ticket_id: id, action: 'retention_photos', actor_email: 'system', actor_role: 'system',
      metadata: { removed_supplier_photos: byTicket[id], rule: 'รูป supplier ที่ไม่ได้รับเลือก หลังปิดงาน' } });
  });
  return n;
}

function logAnchor_() {
  return parseJson_(PropertiesService.getScriptProperties().getProperty(LOG_ANCHOR_PROP_), null);
}

/**
 * Move the oldest TicketLogs rows (log order) to the archive spreadsheet while they are older than the cut-off
 * AND their request is closed; stops at the first row that must stay, so the remaining chain starts right after
 * the anchor (last archived log_id + hash).
 */
function archiveLogs_(cutoff, open) {
  const list = rows_(TAB.LOGS).slice().sort(function (a, b) { return Number(a.log_id) - Number(b.log_id); });
  const move = [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l.ts || new Date(l.ts).getTime() >= cutoff || (l.ticket_id && open[String(l.ticket_id)])) break;
    move.push(l);
  }
  if (!move.length) return 0;
  const props = PropertiesService.getScriptProperties();
  const anchor = logAnchor_() || {};
  let ss;
  if (anchor.spreadsheet_id) ss = SpreadsheetApp.openById(anchor.spreadsheet_id);
  else ss = SpreadsheetApp.create('MGS Food Price Request — LOG ARCHIVE (do not edit)');
  const cols = SCHEMA.TicketLogs.cols;
  let sh = ss.getSheetByName(TAB.LOGS);
  if (!sh) { sh = ss.insertSheet(TAB.LOGS); sh.getRange(1, 1, 1, cols.length).setValues([cols]); }
  sh.getRange(sh.getLastRow() + 1, 1, move.length, cols.length).setValues(move.map(function (l) {
    return cols.map(function (c) { return toCell_(l[c]); });
  }));
  const ids = {};
  move.forEach(function (l) { ids[String(l.log_id)] = true; });
  deleteRowsWhere_(TAB.LOGS, function (l) { return ids[String(l.log_id)]; });
  const last = move[move.length - 1];
  props.setProperty(LOG_ANCHOR_PROP_, JSON.stringify({ spreadsheet_id: ss.getId(), last_log_id: Number(last.log_id), last_hash: String(last.hash),
    last_ts: new Date(last.ts).toISOString(), rows: (Number(anchor.rows) || 0) + move.length, updated_at: new Date().toISOString() }));
  return move.length;
}

/** Archived timeline rows of one ticket (only opened for requests older than the anchor). */
function archivedLogsOf_(ticketId) {
  const a = logAnchor_();
  if (!a || !a.spreadsheet_id) return [];
  try {
    const sh = SpreadsheetApp.openById(a.spreadsheet_id).getSheetByName(TAB.LOGS);
    if (!sh || sh.getLastRow() < 2) return [];
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const ti = head.indexOf('ticket_id');
    return sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues()
      .filter(function (r) { return String(r[ti]) === String(ticketId); })
      .map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = cellUnsafe_(r[i]); }); return o; });
  } catch (e) { console.warn('archivedLogsOf_', e); return []; }
}

// =============================================================================
// History export (Excel) — fixed template so the history can be kept outside the system:
//   Admin page › "📥 ดาวน์โหลดประวัติ (Excel)" (Admin / GM / SR Manager), and an automatic copy in
//   Drive (<attachments root>/Exports) of everything runRetention is about to delete.
// =============================================================================
const EXPORT_ROLES_ = ['admin', 'gm', 'sr_manager'];

/** range: { from: 'yyyy-MM-dd', to: 'yyyy-MM-dd' } on the request date → { file_name, mime, base64, counts } */
function exportHistory(range) {
  return api_('exportHistory', function () {
    const u = currentUser_();
    if (EXPORT_ROLES_.indexOf(u.role) === -1) throw appError_('FORBIDDEN', 'ดาวน์โหลดประวัติได้เฉพาะ Admin, GM และ SR Manager (มีต้นทุน)');
    const r = range || {};
    const from = r.from ? parseYmd_(r.from, 'วันที่เริ่ม', true) : new Date(Date.now() - 365 * 86400000);
    const to = r.to ? parseYmd_(r.to, 'วันที่สิ้นสุด', true) : new Date();
    if (to < from) throw appError_('VALIDATION', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
    const sheets = historySheets_(from.getTime(), to.getTime() + 86400000, u);
    // ASCII file name: some phones / browsers drop non-ASCII download names
    const name = 'MGS-FPR-history_' + fmtDate_(from) + '_to_' + fmtDate_(to) + '.xlsx';
    const bytes = xlsxBytes_('MGS FPR ประวัติ ' + fmtDate_(from) + ' ถึง ' + fmtDate_(to), sheets);
    return { file_name: name, mime: XLSX_MIME_, base64: Utilities.base64Encode(bytes),
      counts: sheets.reduce(function (o, s) { o[s.name] = s.rows.length; return o; }, {}) };
  });
}

const XLSX_MIME_ = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The template: one tab per subject, Thai headers, one row per record. */
function historySheets_(fromMs, toMs, u) {
  const tickets = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) {
    const c = new Date(t.created_at).getTime();
    return c >= fromMs && c < toMs && t.stage !== 'deleted';
  });
  const ids = {};
  tickets.forEach(function (t) { ids[t.ticket_id] = t; });
  const names = {};
  rows_(TAB.USERS).forEach(function (x) { names[String(x.email).toLowerCase()] = String(x.full_name); });
  const nm = function (e) { return names[String(e || '').toLowerCase()] || String(e || ''); };
  const d = function (v) { return v ? new Date(v) : ''; };
  const quotes = rows_(TAB.QUOTATIONS).filter(function (q) { return ids[String(q.ticket_id)]; }).map(normQuote_);
  const winner = {};
  quotes.forEach(function (q) { if (q.is_selected && !q.is_deleted) winner[q.item_id] = q; });
  const items = [];
  tickets.forEach(function (t) { activeItemsOf_(t.ticket_id).forEach(function (it) { items.push({ t: t, it: it }); }); });

  const req = { name: 'ใบขอราคา', header: ['เลขที่', 'วันที่ขอ', 'สถานะ', 'ขั้นตอน', 'ลูกค้า', 'กลุ่มลูกค้า', 'ผู้ขอ (Sales)', 'ลำดับ', 'กลุ่มสินค้า', 'สินค้า',
    '% NW', 'ขนาด', 'แพค', 'ปริมาณ/เดือน', 'หน่วย', 'ราคาที่ลูกค้าคาดหวัง', 'SR ผู้ทำราคา', 'Supplier ผู้ชนะ', 'สกุลเงิน', 'ราคา/หน่วย', 'อัตราแลกเปลี่ยน',
    'ต้นทุนถึงคลัง (บาท/หน่วย)', 'GP %', 'ราคาขาย (บาท/หน่วย)', 'ผลรายการ', 'ผลการขาย', 'หมายเหตุการขาย', 'GM อนุมัติราคา', 'ปิดงาน'], rows: [] };
  items.forEach(function (x) {
    const t = x.t, it = x.it, w = winner[it.item_id];
    req.rows.push([t.ticket_no, d(t.created_at), STATUS_LABEL_TH[t.status] || t.status, STAGE_LABEL_TH[t.stage] || t.stage, t.customer_name, t.customer_group,
      nm(t.requestor_email), it.line_no, groupName_(it.product_group_code), it.product_name, it.net_weight, it.size, it.packing_size, it.qty, it.uom,
      it.target_price || '', nm(itemOwner_(t, it)), w ? w.vendor_name : '', w ? w.currency : '', w ? w.unit_price : '', w ? w.fx_rate : '',
      w ? round_(w.landed_unit_cost_thb, 4) : '', it.gp_percent == null ? '' : it.gp_percent, it.sell_price_thb == null ? '' : it.sell_price_thb,
      it.quote_status === 'not_offered' ? 'ไม่เสนอราคา' : it.quote_status === 'follow_up' ? 'ส่งตามหลัง' : '',
      DEAL_STATUS_LABEL_TH[it.deal_status] || '', it.deal_note, d(t.gm_price_approved_at), d(t.closed_at)]);
  });
  const itemOf = {};
  items.forEach(function (x) { itemOf[x.it.item_id] = x; });
  const sup = { name: 'ราคา Supplier ทั้งหมด', header: ['เลขที่', 'ลำดับ', 'สินค้า', 'Supplier', 'ผู้ชนะ', 'เหตุผลที่เลือก', 'สกุลเงิน', 'ราคา/หน่วย', 'อัตราแลกเปลี่ยน', 'วันที่อัตรา',
    'VAT', 'ต้นทุนสินค้า (บาท)', 'ค่าขนส่ง', 'ค่าประกัน', 'อากร %', 'อากร (บาท)', 'ค่าธรรมเนียม', 'ห้องเย็น', 'ขนส่งในประเทศ', 'อื่นๆ', 'ค่าเคลียร์ของรวม',
    'ต้นทุนถึงคลัง (บาท/หน่วย)', 'MOQ', 'Lead time (วัน)', 'เงื่อนไขชำระ', 'ยืนราคาถึง', 'แบรนด์', 'ประเทศต้นทาง', 'ถูกลบ'], rows: [] };
  quotes.forEach(function (q) {
    const x = itemOf[q.item_id];
    const b = q.cost_breakdown || {};
    sup.rows.push([ids[q.ticket_id].ticket_no, x ? x.it.line_no : '', x ? x.it.product_name : '', q.vendor_name, q.is_selected ? '✔' : '', q.selection_reason,
      q.currency, q.unit_price, q.fx_rate, q.fx_date || '', VAT_TERM_LABEL[q.vat_term] || q.vat_term, round_(q.net_unit_cost_thb, 4), b.freight || '', b.insurance || '',
      b.duty_pct || '', b.duty_thb || '', b.fees || '', b.cold || '', b.inland || '', b.other || '', q.clearance_thb || 0, round_(q.landed_unit_cost_thb, 4),
      q.moq == null ? '' : q.moq, q.lead_time_days == null ? '' : q.lead_time_days, q.payment_term, q.valid_until || '', q.brand, q.origin_country, q.is_deleted ? 'ลบแล้ว' : '']);
  });
  const log = { name: 'ประวัติการทำงาน', header: ['เวลา', 'เลขที่', 'รายการ', 'ผู้ทำ', 'บทบาท', 'จากขั้นตอน', 'ไปขั้นตอน', 'หมายเหตุ'], rows: [] };
  tickets.forEach(function (t) {
    timelineOf_(t.ticket_id).forEach(function (l) {
      log.rows.push([d(l.ts), t.ticket_no, l.action_label + (l.on_behalf_name ? ' (แทน ' + l.on_behalf_name + ')' : ''), l.actor_name, l.actor_role,
        STAGE_LABEL_TH[l.from_stage] || l.from_stage, STAGE_LABEL_TH[l.to_stage] || l.to_stage, l.comment]);
    });
  });
  const photos = { name: 'ไฟล์และรูป', header: ['เลขที่', 'ประเภท', 'ชื่อไฟล์', 'สินค้า', 'Supplier', 'แนบโดย', 'วันที่แนบ', 'ลิงก์ Drive', 'สถานะ'], rows: [] };
  const qById = {};
  quotes.forEach(function (q) { qById[q.quote_id] = q; });
  rows_(TAB.ATTACHMENTS).filter(function (a) { return ids[String(a.ticket_id)]; }).forEach(function (a) {
    const x = itemOf[String(a.item_id)];
    photos.rows.push([ids[String(a.ticket_id)].ticket_no, String(a.category), String(a.file_name), x ? x.it.product_name : '',
      qById[String(a.quote_id)] ? qById[String(a.quote_id)].vendor_name : '', nm(a.uploaded_by), d(a.uploaded_at),
      'https://drive.google.com/file/d/' + String(a.drive_file_id) + '/view', toBool_(a.is_deleted) ? 'ลบแล้ว (' + String(a.deleted_by || '') + ')' : '']);
  });
  const info = { name: 'อ่านก่อน', header: ['หัวข้อ', 'ค่า'], rows: [
    ['ระบบ', 'MGS Food Price Request ' + APP_VERSION], ['ช่วงวันที่ขอราคา', fmtDate_(new Date(fromMs)) + ' ถึง ' + fmtDate_(new Date(toMs - 86400000))],
    ['ดาวน์โหลดโดย', u ? u.full_name + ' (' + u.email + ')' : 'ระบบ (อัตโนมัติ)'], ['เวลา', new Date()],
    ['ใบขอราคา', tickets.length], ['รายการสินค้า', req.rows.length], ['ราคา Supplier', sup.rows.length], ['ประวัติการทำงาน', log.rows.length], ['ไฟล์และรูป', photos.rows.length],
    ['หมายเหตุ', 'ไฟล์นี้มีต้นทุน / GP / Supplier — ห้ามส่งต่อให้ฝ่ายขายหรือภายนอก']] };
  return [info, req, sup, log, photos];
}

/** Sheets → .xlsx bytes (temporary spreadsheet, exported, then trashed). */
function xlsxBytes_(title, sheets) {
  const ss = SpreadsheetApp.create(title);
  const id = ss.getId();
  try {
    sheets.forEach(function (s, i) {
      const sh = i === 0 ? ss.getSheets()[0].setName(s.name) : ss.insertSheet(s.name);
      const data = [s.header].concat(s.rows.map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : toCell_(v); }); }));
      sh.getRange(1, 1, data.length, s.header.length).setValues(data);
      try { sh.setFrozenRows(1); sh.getRange(1, 1, 1, s.header.length).setFontWeight('bold').setBackground('#E2F4EE'); } catch (e) { /* formatting is cosmetic */ }
    });
    SpreadsheetApp.flush();
    const res = http_().fetch('https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw appError_('EXPORT_FAILED', 'สร้างไฟล์ Excel ไม่สำเร็จ (HTTP ' + res.getResponseCode() + ') กรุณาลองใหม่');
    return res.getContent();
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { console.warn('temp export not trashed', e); }
  }
}

/** Automatic copy (runRetention): the rows about to be deleted → <root>/Exports/*.xlsx in Drive. Never blocks the clean-up. */
function saveRetentionExport_(sheets) {
  try {
    if (!sheets.some(function (s) { return s.rows.length; })) return '';
    const rootId = TEST_DRIVE_ ? 'test-root' : PropertiesService.getScriptProperties().getProperty(CFG.PROP.DRIVE_ROOT_ID);
    if (!rootId) return '';
    const root = drive_().getFolderById(rootId);
    const it = root.getFoldersByName('Exports');
    const folder = it.hasNext() ? it.next() : root.createFolder('Exports');
    const name = 'MGS FPR ก่อนล้างข้อมูล ' + fmtDate_(new Date(), 'yyyy-MM-dd');
    const bytes = xlsxBytes_(name, sheets);
    const f = folder.createFile(Utilities.newBlob(bytes, XLSX_MIME_, name + '.xlsx'));
    return f.getId();
  } catch (e) {
    console.warn('saveRetentionExport_', e);
    return 'failed: ' + (e && e.message);
  }
}
