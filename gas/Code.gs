/**
 * File: Code.gs
 * Web app entry point.
 *
 * HANDOVER
 *   What it does : Price request workflow Sales → Manager → GM → SR → Sales (see docs/).
 *   Database     : spreadsheet in Script Property DB_SPREADSHEET_ID (created by setupDatabase()).
 *   Files        : Drive folder in Script Property DRIVE_ROOT_FOLDER_ID.
 *   Lark         : Script Properties LARK_APP_ID, LARK_APP_SECRET, (LARK_HOST, LARK_GROUP_CHAT_ID,
 *                  LARK_PRICE_GROUP_CHAT_ID, LARK_MGMT_GROUP_CHAT_ID) — group events: Notify.gs GROUP_EVENTS_.
 *   Portal       : the management overview (Food + Mech) is a SEPARATE web app — see portal/ (not part of this app).
 *   Roles        : tab "Users" (Admin edits). Department approvers: tab "Departments".manager_email.
 *   Deploy       : Deploy → Manage deployments → ✏️ → Version: New version → Deploy.
 *                  Saving the script does NOT update the live /exec URL.
 *   Backup       : weekly copy in Drive folder "Backups" (installTriggers()).
 *
 * Deployment settings: Execute as = Me (owner), Who has access = Anyone within <company domain>.
 */

const PAGES_ = ['home', 'dashboard', 'gp', 'deals', 'tickets', 'ticket', 'new', 'edit', 'pricing', 'suppliers'];
const PARTIALS_ = ['App', 'PageHome', 'PageDashboard', 'PageGp', 'PageDeals', 'PageTickets', 'PageTicket', 'PageForm', 'PageSuppliers', 'PagePricing', 'PageAdmin'];

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

/**
 * Module menu (left sidebar) — at most 5 items per role. Status views (รอฉัน, ของฉัน, คิว, ส่งตามหลัง …)
 * are tabs on the ใบเสนอราคา page, not menu items; statistics live under รายงาน (managers only), which has
 * its own tabs: ภาพรวม · ติดตามการขาย · สรุป GP (GP: GM / SR Manager / Admin — cost data).
 */
function menuFor_(u) {
  const MAIN = 'เมนูหลัก';
  const m = [{ key: 'home', group: MAIN, icon: '🏠', label: 'หน้าแรก', route: { page: 'home' } }];
  m.push({ key: 'tickets', group: MAIN, icon: '📄', label: 'ใบเสนอราคา', route: { page: 'tickets' }, badge: 'inbox' });
  if (u.role === 'sales') m.push({ key: 'new', group: MAIN, icon: '➕', label: 'สร้างใบขอราคา', route: { page: 'new' }, primary: true });
  if (u.role === 'admin') m.push({ key: 'new', group: MAIN, icon: '➕', label: 'สร้างใบขอราคา', hint: 'แทน Sales', route: { page: 'new' } });
  if (u.role === 'sales') m.push({ key: 'deals', group: MAIN, icon: '🎯', label: 'ติดตามการขาย', hint: 'ลูกค้าซื้อหรือยัง', route: { page: 'deals' }, badge: 'deals_due' });
  if (u.role === 'gm') {
    // two separate GM approvals: sales side (the request) and purchasing side (vendor price + selling price)
    m.push({ key: 'gm_sales', group: MAIN, icon: '🛒', label: 'อนุมัติฝั่งขาย', hint: 'คำขอราคาจาก Sales',
      route: { page: 'tickets', scope: 'inbox', stage: 'pending_gm' }, badge: 'gm_sales' });
    m.push({ key: 'gm_buy', group: MAIN, icon: '📦', label: 'อนุมัติฝั่งซื้อ', hint: 'ราคาซื้อ + ราคาขาย จาก SR',
      route: { page: 'tickets', scope: 'inbox', stage: 'pending_gm_price' }, badge: 'gm_buy' });
  }
  if (['sr', 'sr_manager', 'admin'].indexOf(u.role) !== -1) {
    m.push({ key: 'suppliers', group: MAIN, icon: '🏭', label: 'Supplier', route: { page: 'suppliers' } });
  }
  // SR: follow up with Sales on the prices they made (weekly meeting) — Sales-side data only, no cost / GP
  if (u.role === 'sr') m.push({ key: 'deals', group: MAIN, icon: '🎯', label: 'ติดตามงานขาย', hint: 'ราคาที่ฉันทำ · ประชุมประจำสัปดาห์', route: { page: 'deals' } });
  if (u.role === 'admin') m.push({ key: 'deals', group: MAIN, icon: '🎯', label: 'ติดตามการขาย', route: { page: 'deals' } });
  if (['manager', 'sr_manager', 'gm', 'admin'].indexOf(u.role) !== -1) {
    m.push({ key: 'reports', group: MAIN, icon: '📊', label: 'รายงาน', route: { page: 'dashboard' } });
  }
  if (u.role === 'admin') m.push({ key: 'admin', group: MAIN, icon: '⚙️', label: 'ตั้งค่า Lark Bot', route: { page: 'admin' } });
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
    customer_groups: setting_('customer_groups', []),
    supplier_types: SUPPLIER_TYPES.map(function (k) { return { key: k, label: SUPPLIER_TYPE_LABEL[k] }; }),
    default_gp_percent: defaultGp_(),
    min_gp_percent: minGpPercent_(),
    min_suppliers: Math.max(1, Number(setting_('min_suppliers', 3)) || 1),
    max_vendors_per_item: CFG.MAX_VENDORS_PER_ITEM,
    gm_assigns_sr: toBool_(setting_('gm_assigns_sr', true)),
    deal_statuses: [''].concat(DEAL_STATUSES).map(function (k) { return { key: k, label: DEAL_STATUS_LABEL_TH[k] }; }),
    deal_lost_reasons: setting_('deal_lost_reasons', []),
    can_view_gp: !!me && GP_ROLES_.indexOf(me.role) !== -1,
    vat_terms: VAT_TERMS.map(function (k) { return { key: k, label: VAT_TERM_LABEL[k] }; }),
    incoterms: INCOTERMS.map(function (k) { return { key: k, label: INCOTERM_LABEL[k] }; }),
    priorities: PRIORITIES,
    units: UNITS,
    stage_labels: STAGE_LABEL_TH,
    status_labels: STATUS_LABEL_TH,
    action_labels: ACTION_LABEL_TH,
    sla_hours: setting_('sla_hours', {}),
    max_upload_mb: Number(setting_('max_upload_mb', 20)),
    max_photos_per_quote: maxPhotosPerQuote_(),
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
