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

/** Users › role: our keys, plus the FPR names (Requester / Sourcing / SourcingManager / GM / Admin). */
const ROLE_ALIAS_ = { requester: 'sales', sourcing: 'sr', sourcingmanager: 'sr_manager', 'sourcing manager': 'sr_manager', 'sourcing_manager': 'sr_manager',
  'sales manager': 'manager', salesmanager: 'manager', 'sr manager': 'sr_manager' };
function roleOf_(raw) {
  const k = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ROLE_ALIAS_[k] || ROLE_ALIAS_[k.replace(/ /g, '')] || k;
}

function normUser_(r) {
  if (!r) return null;
  return {
    email: String(r.email).trim().toLowerCase(),
    full_name: String(r.full_name || r.email),
    role: roleOf_(r.role),
    department_code: String(r.department_code || '').trim(),
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

/**
 * Scheduled-job handlers are public functions too. Allow them from a time trigger
 * (no active user) or when the owner / an Admin runs them from the editor.
 */
function requireJobContext_() {
  if (TEST_IDENTITY_) return requireAdminOrOwner_();
  const active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!active) return;
  requireAdminOrOwner_();
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
  if (t.stage === 'deleted') return u.role === 'admin';   // deleted by Admin: hidden from everyone else
  switch (u.role) {
    case 'admin':
    case 'gm':
    case 'manager':          // Sales Manager sees every request
      return true;
    case 'sales':
      return t.requestor_email === u.email;
    case 'sr':
    case 'sr_manager':
      return !!t.gm_approved_at;
    default:
      return false;
  }
}

/** Roles that may see cost: vendor prices, clearance, landed cost, GP and quotation files. */
const COST_ROLES_ = ['admin', 'gm', 'sr', 'sr_manager'];

/**
 * Cost view (vendor quotations, clearance, landed cost, GP, profit, quotation files).
 * Sales side (Sales, Sales Manager) NEVER sees cost — only the selling price, see canViewSellPrice_.
 */
function canViewQuotes_(u, t) {
  return canSeeTicket_(u, t) && COST_ROLES_.indexOf(u.role) !== -1;
}

/** Selling price per unit: cost roles always; Sales side once GM approved the price (completed / closed). */
function canViewSellPrice_(u, t) {
  if (!canSeeTicket_(u, t)) return false;
  if (canViewQuotes_(u, t)) return true;
  return t.status === 'completed' || t.status === 'closed';
}

/** Sales may edit header/items only before Manager approval (or after Manager returned it). */
function canEditRequest_(u, t) {
  if (u.role === 'admin') return ['pending_manager', 'returned', 'pending_gm'].indexOf(t.stage) !== -1;   // Admin fixes it for Sales until GM approves
  return u.role === 'sales' && t.requestor_email === u.email &&
    (t.stage === 'pending_manager' || t.stage === 'returned');
}

/**
 * Vendor prices / winner / GP: the assigned SR while sourcing, and the reviewer of the current
 * approval step — SR Manager while "รอ SR Manager ตรวจราคา", GM while "รอ GM อนุมัติฝั่งซื้อ" —
 * so a reviewer can fix the price and approve, instead of sending it back to the SR.
 */
function canEditQuotes_(u, t) {
  if (u.role === 'admin') return ['sourcing', 'pending_sr_manager', 'pending_gm_price'].indexOf(t.stage) !== -1;
  if (u.role === 'sr') return isSr_(t, u.email) && t.stage === 'sourcing';
  if (u.role === 'sr_manager') return t.stage === 'pending_sr_manager' && !isSr_(t, u.email);
  if (u.role === 'gm') return t.stage === 'pending_gm_price';
  return false;
}

function canEditChecklist_(u, t) {
  if (u.role === 'admin') return t.stage === 'doc_check';
  return u.role === 'sr' && isSr_(t, u.email) && t.stage === 'doc_check';
}

function canUpload_(u, t) {
  if (u.role === 'admin') return OPEN_STATUSES.indexOf(t.status) !== -1;
  if (u.role === 'sales' && t.requestor_email === u.email) {
    // until GM approves (pending_gm included: the Sales Manager step may be skipped right after submit)
    return ['pending_manager', 'returned', 'pending_gm', 'need_info'].indexOf(t.stage) !== -1;
  }
  return u.role === 'sr' && isSr_(t, u.email) && t.status === 'on_process';
}

// ---------------------------------------------------------------- SR per item (one request may have several SRs)

/** Is `email` one of the SRs working on this request? */
function isSr_(t, email) {
  const e = String(email || '').toLowerCase();
  return !!e && (t.srs || []).indexOf(e) !== -1;
}

/** SR who prices this item: the item's own SR; old single-SR tickets fall back to the ticket SR. */
function itemOwner_(t, it) {
  const e = String((it && it.sr_email) || '').trim().toLowerCase();
  if (e) return e;
  return String(t.sr_emails || '').trim() ? '' : t.sr_email;
}

/** Vendor prices / winner / GP of ONE item: an SR only on their own item (until they sent it); reviewers / Admin any item. */
function canEditItem_(u, t, it) {
  if (!canEditQuotes_(u, t)) return false;
  if (u.role === 'sr') return itemOwner_(t, it) === u.email && !it.sr_submitted_at;
  return true;
}

/** Move an item to another SR: its SR (before sending the price), SR Manager or Admin. */
function canTransferItem_(u, t, it) {
  if (it.quote_status) return false;
  const st = ['doc_check', 'need_info', 'sourcing'];
  if (u.role === 'admin' || u.role === 'sr_manager') return st.concat(['pending_assign']).indexOf(t.stage) !== -1;
  return u.role === 'sr' && st.indexOf(t.stage) !== -1 && itemOwner_(t, it) === u.email && !it.sr_submitted_at;
}

// ---------------------------------------------------------------- Admin acting on behalf of others

/** Actions Admin does as Admin (not on behalf of anyone). */
const ADMIN_OWN_ACTIONS_ = ['assign', 'assign_items', 'transfer_item', 'admin_cancel', 'admin_delete', 'admin_restore'];
const SALES_ACTIONS_ = ['resubmit', 'cancel', 'respond_info', 'accept', 'request_revision'];
const SR_ACTIONS_ = ['request_info', 'doc_complete', 'submit_quote'];

function asUser_(email, role) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const x = userByEmail_(e);
  if (x) return x;
  return { email: e, full_name: e, role: role, department_code: '', is_active: false };
}
function firstActive_(role, notEmail) {
  return activeUsersByRole_(role).filter(function (x) { return x.email !== notEmail; })[0] || null;
}

/**
 * Admin may do every step of the workflow. The step runs with the identity of the person who is
 * responsible for it (requester, Sales Manager, GM, assigned SR, SR Manager) so every business rule
 * still applies; the log records Admin as the actor and that person as "on behalf of".
 * Returns null when no such person exists.
 */
function proxyUserFor_(t, action, payload) {
  if (SALES_ACTIONS_.indexOf(action) !== -1) return asUser_(t.requestor_email, 'sales');
  if (/^manager_/.test(action)) {
    const d = departmentByCode_(t.department_code);
    return asUser_((d && d.manager_email) || t.manager_email, 'manager');
  }
  if (/^gm_/.test(action)) {
    const g = t.gm_email ? userByEmail_(t.gm_email) : null;
    return g && g.is_active && g.role === 'gm' ? g : firstActive_('gm', '');
  }
  if (action === 'claim') {
    const s = userByEmail_(payload && payload.sr_email);
    return s && s.is_active && s.role === 'sr' ? s : null;
  }
  if (action === 'queue_return') return firstActive_('sr_manager', '') || firstActive_('sr', '');
  if (/^srm_/.test(action)) return firstActive_('sr_manager', t.sr_email);
  if (SR_ACTIONS_.indexOf(action) !== -1) return asUser_(t.sr_email, 'sr');
  return null;
}

/** Everyone whose buttons Admin also gets on this ticket (UI hint; doTransition_ re-checks). */
function proxyCandidates_(t) {
  const d = departmentByCode_(t.department_code);
  return [asUser_(t.requestor_email, 'sales'), asUser_((d && d.manager_email) || t.manager_email, 'manager'),
    firstActive_('gm', ''), asUser_(t.sr_email, 'sr'), firstActive_('sr_manager', t.sr_email), firstActive_('sr', '')]
    .filter(function (x) { return x && x.role !== 'admin'; });
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
  // every SR on the request (items can go to different SRs); old tickets: the one sr_email
  t.srs = String(t.sr_emails || '').split(',').map(function (e) { return e.trim().toLowerCase(); }).filter(String);
  if (!t.srs.length && t.sr_email) t.srs = [t.sr_email];
  return t;
}

function ticketById_(ticketId) {
  return normTicket_(findOne_(TAB.TICKETS, 'ticket_id', ticketId));
}

/** Load a ticket the user is allowed to see; otherwise NOT_FOUND (do not reveal existence). */
function ticketForUser_(u, ticketId) {
  const key = cleanText_(ticketId);
  // links from Lark cards use the FPR number (?id=FPR-2610-0001); the app uses the ticket_id
  const t = /^(FPR|PR)-/i.test(key) ? (function () { const r = findOne_(TAB.TICKETS, 'ticket_no', key.toUpperCase()); return r ? normTicket_(r) : null; })() : ticketById_(key);
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
