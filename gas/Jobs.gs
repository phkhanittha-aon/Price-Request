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
 *   sendSlaReminders       every hour    FPR Reminder bot: requests over their SLA (Bots.gs)
 *
 * Time triggers run as the owner: there is no "current user", so actions are stamped 'system'.
 */

const JOB_HANDLERS_ = ['dispatchNotifications', 'checkSlaAlerts', 'runSelfTest', 'weeklyBackup', 'sendSlaReminders'];
const BACKUP_KEEP_ = 12;

function installTriggers() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (tr) {
    if (JOB_HANDLERS_.indexOf(tr.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(tr);
  });
  ScriptApp.newTrigger('dispatchNotifications').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('checkSlaAlerts').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendSlaReminders').timeBased().everyHours(1).create();   // FPR Reminder bot (Bots.gs)
  ScriptApp.newTrigger('runSelfTest').timeBased().everyDays(1).atHour(7).inTimezone(CFG.TZ).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).inTimezone(CFG.TZ).create();
  const msg = 'Installed triggers: ' + JOB_HANDLERS_.join(', ');
  console.log(msg);
  return msg;
}

/** Hourly: queue one warning and one breach notification per ticket per stage visit. */
function checkSlaAlerts() {
  requireJobContext_();
  try {
    const result = withLock_(function () {
      const sla = setting_('sla_hours', {});
      const warn = Number(setting_('sla_warning_ratio', 0.8));
      const now = new Date();
      const existing = {};
      rows_(TAB.SLA_ALERTS).forEach(function (a) { existing[String(a.alert_key)] = true; });
      const breaches = [];
      let queued = 0;
      rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
        if (OPEN_STATUSES.indexOf(t.status) === -1) return;
        const slaH = Number(sla[t.stage] || 0);
        if (!(slaH > 0) || !t.stage_entered_at) return;
        const entered = new Date(t.stage_entered_at);
        const ageH = hoursBetween_(entered, now);
        const level = ageH >= slaH ? 'breach' : ageH >= slaH * warn ? 'warning' : '';
        if (!level) return;
        const key = t.ticket_id + '|' + t.stage + '|' + entered.toISOString() + '|' + level;
        if (existing[key]) return;
        insertRow_(TAB.SLA_ALERTS, { alert_key: key, ticket_id: t.ticket_id, stage: t.stage, stage_entered_at: entered, level: level, created_at: now });
        existing[key] = true;
        const recipients = stageAssignees_(t).concat(level === 'breach' ? stageEscalation_(t) : []);
        enqueueNotifications_(recipients, t, 'sla_' + level,
          '[' + t.ticket_no + '] ' + (level === 'breach' ? '⛔ เกิน SLA' : '⚠️ ใกล้ครบ SLA') + ': ' + STAGE_LABEL_TH[t.stage],
          t.title + '\nค้างใน stage นี้ ' + round_(ageH, 1) + ' ชม. (SLA ' + slaH + ' ชม.)', ticketLink_(t));
        queued++;
        if (level === 'breach') breaches.push(t.ticket_no + ' — ' + STAGE_LABEL_TH[t.stage] + ' (' + round_(ageH, 0) + '/' + slaH + ' ชม.)');
      });
      return { queued: queued, breaches: breaches };
    });
    if (result.breaches.length) {
      larkGroupText_('⛔ ใบขอราคาเกิน SLA ' + result.breaches.length + ' ใบ\n' + result.breaches.slice(0, 20).join('\n'));
    }
    return result;
  } catch (e) {
    logError_('checkSlaAlerts', e);
    larkGroupText_('⚠️ checkSlaAlerts ล้มเหลว: ' + e.message);
    throw e;
  }
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
    const orphans = rows_(TAB.TICKETS).filter(function (r) { return !withLog[String(r.ticket_id)]; }).map(function (r) { return r.ticket_no; });
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
  t('lark configured', function () { if (!larkConfigured_()) throw new Error('LARK_APP_ID / LARK_APP_SECRET not set'); });

  const failedLines = out.filter(function (l) { return l.indexOf('FAIL') === 0; });
  console.log(out.join('\n'));
  if (failedLines.length) larkGroupText_('⚠️ MGS Food Price Request self-test พบปัญหา ' + failedLines.length + ' ข้อ\n' + failedLines.join('\n'));
  return out;
}
