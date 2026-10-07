/**
 * File: Code.gs
 * Web app entry point.
 *
 * HANDOVER
 *   What it does : Price request workflow Sales → Manager → GM → SR → Sales (see docs/).
 *   Database     : spreadsheet in Script Property DB_SPREADSHEET_ID (created by setupDatabase()).
 *   Files        : Drive folder in Script Property DRIVE_ROOT_FOLDER_ID.
 *   Lark         : Script Properties LARK_APP_ID, LARK_APP_SECRET, (LARK_HOST, LARK_GROUP_CHAT_ID).
 *   Roles        : tab "Users" (Admin edits). Department approvers: tab "Departments".manager_email.
 *   Deploy       : Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *                  Saving the script does NOT update the live /exec URL.
 *   Backup       : weekly copy in Drive folder "Backups" (installTriggers()).
 *
 * Deployment settings: Execute as = Me (owner), Who has access = Anyone within <company domain>.
 */

const PAGES_ = ['dashboard', 'tickets', 'ticket', 'new', 'edit', 'pricing'];
const PARTIALS_ = ['App', 'PageDashboard', 'PageTickets', 'PageTicket', 'PageForm', 'PagePricing'];

function doGet(e) {
  const t = HtmlService.createTemplateFromFile('Index');
  t.appVersion = APP_VERSION;
  return t.evaluate()
    .setTitle(CFG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Template helper: <?!= include_('App') ?> — whitelisted file names only. */
function include_(name) {
  if (PARTIALS_.indexOf(name) === -1) throw new Error('include_: not allowed ' + name);
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * First call of the page: who am I, what menu do I get, reference data.
 * Unregistered users get ok:false with code NOT_REGISTERED (UI shows a friendly page).
 */
function getBootstrap() {
  return api_('getBootstrap', function () {
    const u = currentUser_();
    return {
      me: { email: u.email, full_name: u.full_name, role: u.role, role_label: ROLE_LABEL_TH[u.role], department_code: u.department_code },
      menu: menuFor_(u),
      ref: referenceData_(),
      poll: pollData_(u),
      approval_route: approvalRouteNote_(u),
      app_version: APP_VERSION,
      pages: PAGES_
    };
  });
}

function menuFor_(u) {
  const m = [{ key: 'dashboard', label: 'ภาพรวม', route: { page: 'dashboard' } }];
  m.push({ key: 'inbox', label: 'งานรอฉัน', route: { page: 'tickets', scope: 'inbox' }, badge: 'inbox' });
  if (u.role === 'sales') {
    m.push({ key: 'mine', label: 'ใบขอราคาของฉัน', route: { page: 'tickets', scope: 'mine' } });
    m.push({ key: 'new', label: '+ สร้างใบขอราคา', route: { page: 'new' }, primary: true });
  }
  if (u.role === 'sr' || u.role === 'sr_manager') {
    m.push({ key: 'queue', label: 'คิวรอรับงาน', route: { page: 'tickets', scope: 'queue' } });
  }
  if (u.role === 'sr') m.push({ key: 'mine', label: 'งานของฉัน', route: { page: 'tickets', scope: 'mine' } });
  if (u.role !== 'sales') m.push({ key: 'all', label: 'ใบขอราคาทั้งหมด', route: { page: 'tickets', scope: 'all' } });
  return m;
}

function referenceData_() {
  const groups = rows_(TAB.PRODUCT_GROUPS)
    .filter(function (g) { return toBool_(g.is_active); })
    .map(function (g) {
      return { code: String(g.code), name: String(g.name), parent_code: String(g.parent_code || ''), sort_order: Number(g.sort_order || 0) };
    })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
  const srs = activeUsersByRole_('sr').map(function (u) { return { email: u.email, full_name: u.full_name }; });
  const salesUsers = activeUsersByRole_('sales').map(function (u) { return { email: u.email, full_name: u.full_name }; });
  const vendors = rows_(TAB.VENDORS)
    .filter(function (v) { return toBool_(v.is_active); })
    .map(function (v) {
      return { vendor_id: String(v.vendor_id), name: String(v.name), default_currency: String(v.default_currency || 'THB'),
        default_vat_term: String(v.default_vat_term || '') };
    });
  return {
    product_groups: groups,
    sr_users: srs,
    sales_users: salesUsers,
    vendors: vendors,
    currencies: setting_('currencies', ['THB']),
    vat_rate: vatRate_(),
    default_gp_percent: defaultGp_(),
    vat_terms: VAT_TERMS.map(function (k) { return { key: k, label: VAT_TERM_LABEL[k] }; }),
    incoterms: INCOTERMS.map(function (k) { return { key: k, label: INCOTERM_LABEL[k] }; }),
    priorities: PRIORITIES,
    units: UNITS,
    stage_labels: STAGE_LABEL_TH,
    status_labels: STATUS_LABEL_TH,
    action_labels: ACTION_LABEL_TH,
    sla_hours: setting_('sla_hours', {}),
    max_upload_mb: Number(setting_('max_upload_mb', 20)),
    allowed_mime_types: setting_('allowed_mime_types', []),
    upload_chunk_bytes: UPLOAD_CHUNK_BYTES
  };
}

/** Plain-language approval route for the request form (Sales Manager step is skipped when none is set). */
function approvalRouteNote_(u) {
  if (u.role !== 'sales') return '';
  const d = departmentByCode_(u.department_code);
  const first = firstApprovalStage_(d);
  const mgr = first === 'pending_manager' ? userByEmail_(d.manager_email) : null;
  return first === 'pending_manager'
    ? 'ส่งถึง Sales Manager (' + mgr.full_name + ') → GM → SR หาราคา → SR Manager → GM อนุมัติราคา → กลับถึงคุณ'
    : 'ส่งตรงถึง GM (ยังไม่มี Sales Manager) → SR หาราคา → SR Manager → GM อนุมัติราคา → กลับถึงคุณ';
}
