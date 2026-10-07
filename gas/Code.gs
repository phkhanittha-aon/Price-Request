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

const PAGES_ = ['dashboard', 'tickets', 'ticket', 'new', 'edit', 'pricing', 'suppliers'];
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
      ref: referenceData_(u),
      poll: pollData_(u),
      approval_route: approvalRouteNote_(u),
      app_version: APP_VERSION,
      pages: PAGES_
    };
  });
}

/** ERP module menu (right-hand sidebar). Grouped by module; the browser renders `group` headings in order. */
function menuFor_(u) {
  const G_OVERVIEW = 'ภาพรวม';
  const G_WORK = 'งานของฉัน';
  const G_REQ = 'ใบขอราคา';
  const G_SRC = 'จัดหาราคา (Sourcing)';
  const G_GM = 'อนุมัติ (GM)';
  const m = [{ key: 'dashboard', group: G_OVERVIEW, icon: '📊', label: 'Dashboard', route: { page: 'dashboard' } }];
  m.push({ key: 'inbox', group: G_WORK, icon: '📥', label: 'งานรอฉัน', route: { page: 'tickets', scope: 'inbox' }, badge: 'inbox' });
  if (u.role === 'gm') {
    // two separate GM approvals: sales side (the request) and purchasing side (vendor price + selling price)
    m.push({ key: 'gm_sales', group: G_GM, icon: '🛒', label: 'อนุมัติฝั่งขาย', hint: 'คำขอราคาจาก Sales',
      route: { page: 'tickets', scope: 'inbox', stage: 'pending_gm' }, badge: 'gm_sales' });
    m.push({ key: 'gm_buy', group: G_GM, icon: '📦', label: 'อนุมัติฝั่งซื้อ', hint: 'ราคาซื้อ + ราคาขาย จาก SR',
      route: { page: 'tickets', scope: 'inbox', stage: 'pending_gm_price' }, badge: 'gm_buy' });
  }
  if (u.role === 'sales') {
    m.push({ key: 'new', group: G_REQ, icon: '➕', label: 'สร้างใบขอราคา', route: { page: 'new' }, primary: true });
    m.push({ key: 'mine', group: G_REQ, icon: '📄', label: 'ใบขอราคาของฉัน', route: { page: 'tickets', scope: 'mine' } });
  }
  if (u.role === 'sr' || u.role === 'sr_manager') {
    m.push({ key: 'queue', group: G_SRC, icon: '🧾', label: 'คิวรอรับงาน', route: { page: 'tickets', scope: 'queue' } });
  }
  if (u.role === 'sr') m.push({ key: 'mine', group: G_SRC, icon: '💼', label: 'งานของฉัน (SR)', route: { page: 'tickets', scope: 'mine' } });
  m.push({ key: 'follow', group: G_WORK, icon: '📌', label: 'ส่งตามหลัง (ค้าง)', hint: 'รายการที่ SR แยกไปหาราคาต่อ',
    route: { page: 'tickets', scope: u.role === 'sales' || u.role === 'sr' ? 'mine' : 'all', follow: '1', outcome: 'open' }, badge: 'follow_up' });
  if (COST_ROLES_.indexOf(u.role) !== -1) {
    m.push({ key: 'suppliers', group: G_SRC, icon: '🏭', label: 'Supplier', hint: 'ฐานข้อมูลผู้ขาย', route: { page: 'suppliers' } });
  }
  if (u.role !== 'sales') m.push({ key: 'all', group: G_REQ, icon: '📚', label: 'ใบขอราคาทั้งหมด', route: { page: 'tickets', scope: 'all' } });
  return m;
}

function referenceData_(me) {
  const groups = rows_(TAB.PRODUCT_GROUPS)
    .filter(function (g) { return toBool_(g.is_active); })
    .map(function (g) {
      return { code: String(g.code), name: String(g.name), parent_code: String(g.parent_code || ''), sort_order: Number(g.sort_order || 0) };
    })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
  const srs = activeUsersByRole_('sr').map(function (u) { return { email: u.email, full_name: u.full_name }; });
  const salesUsers = activeUsersByRole_('sales').map(function (u) { return { email: u.email, full_name: u.full_name }; });
  // Suppliers are purchasing-side data: only cost roles receive them (never Sales / Sales Manager)
  const vendors = me && COST_ROLES_.indexOf(me.role) !== -1
    ? rows_(TAB.VENDORS).map(normSupplier_).filter(function (v) { return v.is_active; }).map(function (v) {
      v.cert_warnings = certWarnings_(v);
      return v;
    })
    : [];
  return {
    product_groups: groups,
    sr_users: srs,
    sales_users: salesUsers,
    vendors: vendors,
    currencies: setting_('currencies', ['THB']),
    vat_rate: vatRate_(),
    fx_defaults: setting_('fx_defaults', { USD: 35 }),
    default_validity_days: Number(setting_('default_validity_days', 30)),
    default_due_working_days: Number(setting_('default_due_working_days', 3)),
    document_options: setting_('document_options', []),
    supplier_types: SUPPLIER_TYPES.map(function (k) { return { key: k, label: SUPPLIER_TYPE_LABEL[k] }; }),
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
    ? 'ส่งถึง Sales Manager (' + mgr.full_name + ') → GM อนุมัติฝั่งขาย → SR หาราคา → SR Manager → GM อนุมัติฝั่งซื้อ → กลับถึงคุณ'
    : 'ส่งตรงถึง GM อนุมัติฝั่งขาย (ยังไม่มี Sales Manager) → SR หาราคา → SR Manager → GM อนุมัติฝั่งซื้อ → กลับถึงคุณ';
}
