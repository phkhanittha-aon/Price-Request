/**
 * File: Auth.gs
 * Identity and permissions. Identity ALWAYS comes from the Google session on the server
 * (web app: Execute as = Me, Access = anyone in the company domain).
 * A role or email sent from the browser is never trusted.
 *
 * The can*_ functions below are the single source of truth for "who may see / do what"
 * (equivalent of row-level security). Every public API calls them.
 */

let TEST_IDENTITY_ = null;   // set only by server-side test/seed code via withIdentity_()

function currentEmail_() {
  if (TEST_IDENTITY_) return TEST_IDENTITY_;
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw appError_('UNAUTHENTICATED', 'ไม่พบบัญชีผู้ใช้ กรุณาเปิดแอปด้วยบัญชี Google ของบริษัท');
  }
  return email;
}

/** Run fn as another user. Private: callable only from server code (seed / tests). */
function withIdentity_(email, fn) {
  const prev = TEST_IDENTITY_;
  TEST_IDENTITY_ = String(email).toLowerCase();
  try {
    return fn();
  } finally {
    TEST_IDENTITY_ = prev;
  }
}

function normUser_(r) {
  if (!r) return null;
  return {
    email: String(r.email).trim().toLowerCase(),
    full_name: String(r.full_name || r.email),
    role: String(r.role || '').trim().toLowerCase(),
    department_code: String(r.department_code || '').trim(),
    is_sr_lead: toBool_(r.is_sr_lead),
    is_active: toBool_(r.is_active),
    lark_open_id: String(r.lark_open_id || '')
  };
}

function userByEmail_(email) {
  const target = String(email || '').trim().toLowerCase();
  const list = rows_(TAB.USERS);
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].email).trim().toLowerCase() === target) return normUser_(list[i]);
  }
  return null;
}

function activeUsersByRole_(role) {
  return rows_(TAB.USERS).map(normUser_).filter(function (u) { return u.is_active && u.role === role; });
}

/** The signed-in, registered, active user. */
function currentUser_() {
  const email = currentEmail_();
  const u = userByEmail_(email);
  if (!u) {
    throw appError_('NOT_REGISTERED', 'บัญชี ' + email + ' ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (!u.is_active) {
    throw appError_('INACTIVE_USER', 'บัญชีของคุณถูกปิดการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  if (ROLES.indexOf(u.role) === -1) {
    throw appError_('INVALID_ROLE', 'สิทธิ์ผู้ใช้ไม่ถูกต้อง กรุณาติดต่อผู้ดูแลระบบ');
  }
  return u;
}

function requireRole_(user, roles, message) {
  if (roles.indexOf(user.role) === -1) {
    throw appError_('FORBIDDEN', message || 'คุณไม่มีสิทธิ์ทำรายการนี้');
  }
}

/**
 * Setup / test / maintenance functions are public (so they appear in the editor's Run menu)
 * and therefore callable from a browser too — this guard limits them to the script owner
 * or an active Admin.
 */
function requireAdminOrOwner_() {
  if (TEST_IDENTITY_) {
    const tu = userByEmail_(TEST_IDENTITY_);
    if (tu && tu.is_active && tu.role === 'admin') return;
    throw appError_('FORBIDDEN', 'เฉพาะผู้ดูแลระบบเท่านั้น');
  }
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (active && active === owner) return;
  const u = userByEmail_(active);
  if (u && u.is_active && u.role === 'admin') return;
  throw appError_('FORBIDDEN', 'เฉพาะผู้ดูแลระบบเท่านั้น');
}

/** Owner only (database creation, destructive maintenance). */
function requireOwner_() {
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!active || active !== owner) throw appError_('FORBIDDEN', 'เฉพาะเจ้าของสคริปต์เท่านั้น');
}

function departmentByCode_(code) {
  const r = findOne_(TAB.DEPARTMENTS, 'code', code);
  if (!r) return null;
  return {
    code: String(r.code),
    name: String(r.name),
    manager_email: String(r.manager_email || '').trim().toLowerCase(),
    is_active: toBool_(r.is_active)
  };
}

// ---------------------------------------------------------------- Ticket-level permissions

function canSeeTicket_(u, t) {
  switch (u.role) {
    case 'admin':
    case 'gm':
      return true;
    case 'sales':
      return t.requestor_email === u.email;
    case 'manager': {
      if (t.manager_email === u.email) return true;
      const d = departmentByCode_(t.department_code);
      return !!d && d.manager_email === u.email;
    }
    case 'sr':
      return !!t.gm_approved_at;
    default:
      return false;
  }
}

/** Vendor prices: SR / GM / Admin always; Sales & Manager only after SR submitted. */
function canViewQuotes_(u, t) {
  if (!canSeeTicket_(u, t)) return false;
  if (['admin', 'gm', 'sr'].indexOf(u.role) !== -1) return true;
  return t.status === 'completed' || t.status === 'closed';
}

/** Sales may edit header/items only before Manager approval (or after Manager returned it). */
function canEditRequest_(u, t) {
  return u.role === 'sales' && t.requestor_email === u.email &&
    (t.stage === 'pending_manager' || t.stage === 'returned');
}

function canEditQuotes_(u, t) {
  return u.role === 'sr' && t.sr_email === u.email && t.stage === 'sourcing';
}

function canEditChecklist_(u, t) {
  return u.role === 'sr' && t.sr_email === u.email && t.stage === 'doc_check';
}

function canUpload_(u, t) {
  if (u.role === 'sales' && t.requestor_email === u.email) {
    return ['pending_manager', 'returned', 'need_info'].indexOf(t.stage) !== -1;
  }
  return u.role === 'sr' && t.sr_email === u.email && t.status === 'on_process';
}

// ---------------------------------------------------------------- Ticket loading

function normTicket_(r) {
  if (!r) return null;
  const t = {};
  SCHEMA.Tickets.cols.forEach(function (c) { t[c] = r[c] === undefined ? '' : r[c]; });
  ['requestor_email', 'manager_email', 'gm_email', 'sr_email'].forEach(function (c) {
    t[c] = String(t[c] || '').trim().toLowerCase();
  });
  t.version = Number(t.version || 0);
  t.revision_count = Number(t.revision_count || 0);
  t.info_request = parseJson_(t.info_request_json, null);
  return t;
}

function ticketById_(ticketId) {
  return normTicket_(findOne_(TAB.TICKETS, 'ticket_id', ticketId));
}

/** Load a ticket the user is allowed to see; otherwise NOT_FOUND (do not reveal existence). */
function ticketForUser_(u, ticketId) {
  const t = ticketById_(cleanText_(ticketId));
  if (!t || !canSeeTicket_(u, t)) {
    throw appError_('NOT_FOUND', 'ไม่พบใบขอราคา หรือคุณไม่มีสิทธิ์เข้าถึง');
  }
  return t;
}

function requireVersion_(t, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') {
    throw appError_('VERSION_REQUIRED', 'ข้อมูลไม่ครบ กรุณารีเฟรชหน้าจอแล้วลองใหม่');
  }
  if (Number(expectedVersion) !== t.version) {
    throw appError_('VERSION_CONFLICT', 'ใบขอราคานี้ถูกอัปเดตโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชหน้าจอแล้วลองใหม่');
  }
}
