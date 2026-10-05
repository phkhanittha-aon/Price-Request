/**
 * File: Audit.gs
 * Append-only audit trail (TicketLogs) with a SHA-256 hash chain.
 *
 * Sheets cannot technically forbid the spreadsheet OWNER from editing a cell, so
 * integrity is protected in three layers:
 *   1. Staff never get access to the spreadsheet (web app runs "as me").
 *   2. No API function updates or deletes a log row; the tab is protected.
 *   3. Each row stores hash = SHA256(prev_hash + row content). verifyLogChain()
 *      detects any edited, inserted or deleted row.
 */

const LOG_HASH_FIELDS_ = ['log_id', 'ts', 'ticket_id', 'log_type', 'actor_email', 'actor_role', 'action',
  'from_status', 'to_status', 'from_stage', 'to_stage', 'comment', 'metadata_json', 'stage_duration_sec',
  'app_version', 'prev_hash'];

/** Canonical text of a log row — every value as string so sheet type coercion cannot break the hash. */
function logCanonical_(row) {
  return JSON.stringify(LOG_HASH_FIELDS_.map(function (f) {
    const v = row[f];
    if (v instanceof Date) return v.toISOString();
    if (v === null || v === undefined) return '';
    return String(v);
  }));
}

/**
 * Append one log row. Must be called inside withLock_ (log_id + chain need serial order).
 * entry: { ticket_id, log_type, action, from_status?, to_status?, from_stage?, to_stage?,
 *          comment?, metadata?, stage_duration_sec?, actor_email?, actor_role? }
 */
function appendLog_(entry) {
  if (LOCK_DEPTH_ === 0) throw new Error('appendLog_ must run inside withLock_');
  const meta = headers_(TAB.LOGS);
  const sh = meta.sheet;
  const last = sh.getLastRow();
  let prevHash = 'GENESIS';
  let nextId = 1;
  if (last >= 2) {
    const lastRow = sh.getRange(last, 1, 1, meta.headers.length).getValues()[0];
    prevHash = String(lastRow[meta.idx.hash] || 'GENESIS');
    nextId = Number(lastRow[meta.idx.log_id] || 0) + 1;
  }

  let actorEmail = entry.actor_email;
  let actorRole = entry.actor_role;
  if (actorEmail === undefined) {
    actorEmail = safeEmail_() || 'system';
    const u = actorEmail === 'system' ? null : userByEmail_(actorEmail);
    actorRole = u ? u.role : '';
  }

  const ts = new Date(Math.floor(Date.now() / 1000) * 1000);   // whole seconds survive the sheet round-trip
  const row = {
    log_id: nextId,
    ts: ts,
    ticket_id: entry.ticket_id || '',
    log_type: entry.log_type || 'data_change',
    actor_email: actorEmail,
    actor_role: actorRole || '',
    action: entry.action,
    from_status: entry.from_status || '',
    to_status: entry.to_status || '',
    from_stage: entry.from_stage || '',
    to_stage: entry.to_stage || '',
    comment: entry.comment || '',
    metadata_json: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 45000) : '',
    stage_duration_sec: entry.stage_duration_sec === undefined || entry.stage_duration_sec === null ? '' : Math.round(entry.stage_duration_sec),
    app_version: APP_VERSION,
    prev_hash: prevHash
  };
  row.hash = sha256Hex_(logCanonical_(row));
  insertRow_(TAB.LOGS, row);
  return row;
}

/** Field-level diff {field: {old, new}} for the listed fields. */
function diff_(before, after, fields) {
  const out = {};
  fields.forEach(function (f) {
    const a = normForDiff_(before ? before[f] : '');
    const b = normForDiff_(after ? after[f] : '');
    if (a !== b) out[f] = { old: a, 'new': b };
  });
  return out;
}

function normForDiff_(v) {
  if (v instanceof Date) {
    // Date-only values (00:00 Bangkok) compare as yyyy-MM-dd so they match form input strings
    return fmtDate_(v, 'HH:mm:ss') === '00:00:00' ? fmtDate_(v) : fmtDate_(v, 'yyyy-MM-dd HH:mm:ss');
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v;
  return typeof v === 'number' ? v : String(v);
}

/**
 * Admin / owner tool: recompute the whole chain. Run from the editor.
 * Returns { ok, data: { valid, rows, brokenAt?, reason? } }.
 */
function verifyLogChain() {
  return api_('verifyLogChain', function () {
    requireAdminOrOwner_();
    return verifyLogChainCore_();
  });
}

function verifyLogChainCore_() {
  const list = rows_(TAB.LOGS).slice().sort(function (a, b) { return Number(a.log_id) - Number(b.log_id); });
  let prev = 'GENESIS';
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (Number(r.log_id) !== i + 1) {
      return { valid: false, rows: list.length, brokenAt: r.log_id, reason: 'log_id ไม่ต่อเนื่อง (มีการลบหรือแทรกแถว)' };
    }
    if (String(r.prev_hash) !== prev) {
      return { valid: false, rows: list.length, brokenAt: r.log_id, reason: 'prev_hash ไม่ตรงกับแถวก่อนหน้า' };
    }
    if (sha256Hex_(logCanonical_(r)) !== String(r.hash)) {
      return { valid: false, rows: list.length, brokenAt: r.log_id, reason: 'ข้อมูลในแถวถูกแก้ไข (hash ไม่ตรง)' };
    }
    prev = String(r.hash);
  }
  return { valid: true, rows: list.length };
}
