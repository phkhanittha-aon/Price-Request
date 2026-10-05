/**
 * File: Setup.gs
 * One-time / maintenance functions. Run from the Apps Script editor (Run menu).
 *
 *   setupDatabase()  — creates (or repairs) the database spreadsheet, every tab and header,
 *                      column formats, dropdowns, sheet protection, default Settings and
 *                      the Drive folder for attachments. Safe to run again any time:
 *                      it only ADDS missing tabs/columns, never deletes or reorders.
 *   seedMasterData() — departments, product groups + checklist templates, vendors.
 *   seedDemoData()   — demo users (all roles) + 4 demo tickets driven through the real workflow.
 *                      DEV / UAT ONLY — edit DEMO_DOMAIN first.
 */

const DEMO_DOMAIN = 'example.co.th';   // ← change to your company domain before seedDemoData()

const DATE_COLS_ = ['created_at', 'updated_at', 'ts', 'stage_entered_at', 'submitted_at', 'manager_approved_at',
  'gm_approved_at', 'assigned_at', 'doc_checked_at', 'completed_at', 'closed_at', 'rejected_at', 'cancelled_at',
  'checked_at', 'uploaded_at', 'deleted_at', 'read_at', 'lark_sent_at'];
const DAY_COLS_ = ['due_date', 'valid_until'];
const NUMBER_COLS_ = ['qty', 'target_price', 'unit_price', 'fx_rate', 'vat_rate', 'moq', 'lead_time_days',
  'net_unit_cost', 'net_unit_cost_thb', 'gross_unit_price_thb', 'line_no', 'version', 'revision_count',
  'sort_order', 'size_bytes', 'log_id', 'stage_duration_sec', 'last_no', 'lark_attempts'];
const BOOL_COLS_ = ['is_sr_lead', 'is_active', 'is_selected', 'is_deleted', 'is_checked', 'is_required', 'is_read'];

/** Create / repair the database. Owner only. */
function setupDatabase() {
  requireOwner_();
  const props = PropertiesService.getScriptProperties();
  let ss;
  const id = props.getProperty(CFG.PROP.DB_ID);
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('MGS Price Request — DATABASE (do not share)');
    props.setProperty(CFG.PROP.DB_ID, ss.getId());
  }
  useDatabase_(ss);
  const report = setupSchema_(ss, { protect: true });

  if (!props.getProperty(CFG.PROP.DRIVE_ROOT_ID)) {
    const folder = DriveApp.createFolder('MGS Price Request — Attachments (do not share)');
    props.setProperty(CFG.PROP.DRIVE_ROOT_ID, folder.getId());
    report.push('Created Drive folder ' + folder.getId());
  }
  console.log(report.join('\n'));
  console.log('Database URL: ' + ss.getUrl());
  return report;
}

/** Tabs, headers, formats, validation, protection, default settings. */
function setupSchema_(ss, opts) {
  const o = opts || {};
  const report = [];
  ss.setSpreadsheetTimeZone(CFG.TZ);

  Object.keys(SCHEMA).forEach(function (tab) {
    const cols = SCHEMA[tab].cols;
    let sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      report.push('Created tab ' + tab);
    }
    const lastCol = sh.getLastColumn();
    const existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    const missing = cols.filter(function (c) { return existing.indexOf(c) === -1; });
    if (missing.length) {
      if (sh.getMaxColumns() < existing.length + missing.length) {
        sh.insertColumnsAfter(Math.max(sh.getMaxColumns(), 1), existing.length + missing.length - sh.getMaxColumns());
      }
      sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      report.push(tab + ': added columns ' + missing.join(', '));
    }
    const headers = existing.concat(missing);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1f3a5f').setFontColor('#ffffff');

    // Column formats: text columns as plain text so "0012" / "2026-01" stay strings
    const maxRows = Math.max(sh.getMaxRows() - 1, 1);
    headers.forEach(function (h, i) {
      const range = sh.getRange(2, i + 1, maxRows, 1);
      if (DATE_COLS_.indexOf(h) !== -1) range.setNumberFormat('yyyy-mm-dd hh:mm:ss');
      else if (DAY_COLS_.indexOf(h) !== -1) range.setNumberFormat('yyyy-mm-dd');
      else if (NUMBER_COLS_.indexOf(h) !== -1) range.setNumberFormat('#,##0.######');
      else if (BOOL_COLS_.indexOf(h) === -1) range.setNumberFormat('@');
    });

    if (o.protect) protectSheet_(sh, tab);
  });

  // Dropdowns where Admin edits master data directly in the sheet
  setListValidation_(ss, TAB.USERS, 'role', ROLES);
  setListValidation_(ss, TAB.USERS, 'is_active', ['TRUE', 'FALSE']);
  setListValidation_(ss, TAB.USERS, 'is_sr_lead', ['TRUE', 'FALSE']);
  setListValidation_(ss, TAB.DEPARTMENTS, 'is_active', ['TRUE', 'FALSE']);
  setListValidation_(ss, TAB.PRODUCT_GROUPS, 'is_active', ['TRUE', 'FALSE']);
  setListValidation_(ss, TAB.VENDORS, 'default_vat_term', VAT_TERMS);

  // Default sheet created by SpreadsheetApp.create
  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('ชีต1');
  if (sheet1 && ss.getSheets().length > 1 && sheet1.getLastRow() === 0) ss.deleteSheet(sheet1);

  // Default settings (only keys that do not exist yet)
  invalidate_();
  const now = new Date();
  const toAdd = DEFAULT_SETTINGS.filter(function (s) { return !findOne_(TAB.SETTINGS, 'key', s[0]); })
    .map(function (s) { return { key: s[0], value: s[1], description: s[2], updated_at: now, updated_by: 'setup' }; });
  insertRows_(TAB.SETTINGS, toAdd);
  if (toAdd.length) report.push('Settings: added ' + toAdd.map(function (s) { return s.key; }).join(', '));
  return report;
}

function setListValidation_(ss, tab, col, list) {
  const sh = ss.getSheetByName(tab);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const i = headers.indexOf(col);
  if (i === -1) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  sh.getRange(2, i + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

/**
 * Only the owner may edit any tab. Master-data tabs (Users, Departments, ProductGroups,
 * Vendors, Settings) can be opened up to named Admin editors later if desired.
 */
function protectSheet_(sh, tab) {
  const existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  const p = existing.length ? existing[0] : sh.protect();
  p.setDescription('MGS Price Request — ' + tab + ' (แก้ไขผ่านแอปเท่านั้น)');
  p.setWarningOnly(false);
  const me = Session.getEffectiveUser();
  p.addEditor(me);
  const others = p.getEditors().filter(function (e) { return e.getEmail() !== me.getEmail(); });
  if (others.length) p.removeEditors(others);
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

// =============================================================================
// Seed data
// =============================================================================

function seedMasterData() {
  requireOwner_();
  return withLock_(function () { return seedMaster_(); });
}

function seedMaster_() {
  const now = new Date();
  const out = [];

  const depts = [
    ['SALES-FOOD', 'ฝ่ายขาย Frozen Seafood & Food'],
    ['SALES-SOLAR', 'ฝ่ายขาย Solar & Mechanical'],
    ['SALES-SUPP', 'ฝ่ายขาย Dietary Supplements'],
    ['SOURCING', 'ฝ่ายจัดหา (Sourcing)'],
    ['MGMT', 'ผู้บริหาร / Admin']
  ].filter(function (d) { return !findOne_(TAB.DEPARTMENTS, 'code', d[0]); })
    .map(function (d) { return { code: d[0], name: d[1], manager_email: '', is_active: true, created_at: now, updated_at: now }; });
  insertRows_(TAB.DEPARTMENTS, depts);
  out.push('departments +' + depts.length);

  const tpl = function (list) { return JSON.stringify(list.map(function (x) { return { key: x[0], label: x[1], required: x[2] !== false }; })); };
  const groups = [
    // Frozen Seafood & Food
    ['FOOD', 'อาหารทะเลแช่แข็ง & อาหาร', 'Frozen Seafood & Food', '', 100, tpl([
      ['spec', 'Spec สินค้า (ชนิด/สายพันธุ์)'], ['size_grade', 'ขนาด / เกรด'],
      ['packing', 'รูปแบบบรรจุ (Packing / น้ำหนักต่อแพ็ค)'], ['origin', 'ประเทศต้นทาง', false],
      ['shelf_life', 'อายุสินค้า / เงื่อนไขการเก็บรักษา', false]])],
    ['FOOD-SHRIMP', 'กุ้ง', 'Shrimp', 'FOOD', 101, tpl([['glazing', '% Glazing / น้ำหนักสุทธิ (NW)']])],
    ['FOOD-FISH', 'ปลา (แซลมอน / ซาบะ / อื่นๆ)', 'Fish', 'FOOD', 102, tpl([['cut_type', 'รูปแบบการตัดแต่ง (Fillet / Steak / Whole)']])],
    ['FOOD-CEPHALOPOD', 'หมึก / ปลาหมึก', 'Squid & Octopus', 'FOOD', 103, '[]'],
    ['FOOD-PROCESSED', 'อาหารแปรรูป / Global Food', 'Processed & Global Food', 'FOOD', 104, tpl([['ingredients', 'ส่วนประกอบ / ฉลาก']])],
    // Solar & Mechanical
    ['SOLAR', 'Solar & Mechanical', 'Solar & Mechanical', '', 200, tpl([
      ['datasheet', 'Datasheet / Catalogue'], ['model_rating', 'รุ่น / พิกัด (kW, V, A)'],
      ['qty_confirmed', 'ยืนยันจำนวนและหน่วย'], ['site_info', 'ข้อมูลหน้างาน / Single line diagram', false]])],
    ['SOLAR-INVERTER', 'Inverter', 'Inverter', 'SOLAR', 201, tpl([['grid_phase', 'ระบบไฟ 1 เฟส / 3 เฟส, On-grid / Hybrid']])],
    ['SOLAR-PV', 'แผงโซลาร์ (PV Module)', 'PV Module', 'SOLAR', 202, '[]'],
    ['SOLAR-MOUNTING', 'Mounting System', 'Mounting System', 'SOLAR', 203, tpl([['roof_type', 'ประเภทหลังคา / แบบติดตั้ง (Drawing)']])],
    ['SOLAR-CABLE', 'สายไฟ / Cable', 'Cable', 'SOLAR', 204, tpl([['cable_spec', 'ขนาดสาย (sq.mm) / ความยาว / มาตรฐาน']])],
    ['SOLAR-EV', 'EV Charger', 'EV Charger', 'SOLAR', 205, tpl([['connector', 'กำลังไฟ (kW) / หัวชาร์จ (Type 2 / CCS2)']])],
    ['SOLAR-ESS', 'ESS / Battery', 'Energy Storage', 'SOLAR', 206, tpl([['capacity', 'ความจุ (kWh) / Compatible inverter']])],
    // Dietary Supplements
    ['SUPP', 'ผลิตภัณฑ์เสริมอาหาร', 'Dietary Supplements', '', 300, tpl([
      ['formula', 'สูตร / ส่วนประกอบ'], ['fda_reg', 'เลข อย. / ทะเบียนผลิตภัณฑ์'], ['coa', 'COA / Specification'],
      ['packaging', 'รูปแบบบรรจุภัณฑ์ (แคปซูล/ซอง/ขวด)', false]])],
    ['SUPP-PROBIOTIC', 'โพรไบโอติก', 'Probiotics', 'SUPP', 301, tpl([['strain_cfu', 'สายพันธุ์ (Strain) / ปริมาณ CFU']])],
    ['SUPP-VITAMIN', 'วิตามิน / แร่ธาตุ', 'Vitamins & Minerals', 'SUPP', 302, '[]']
  ].filter(function (g) { return !findOne_(TAB.PRODUCT_GROUPS, 'code', g[0]); })
    .map(function (g) {
      return { code: g[0], name: g[1], name_en: g[2], parent_code: g[3], sort_order: g[4], checklist_json: g[5],
        is_active: true, created_at: now, updated_at: now };
    });
  insertRows_(TAB.PRODUCT_GROUPS, groups);
  out.push('product groups +' + groups.length);

  const vendors = [
    ['V-0001', 'Sungrow Power Supply (Thailand)', 'TH', 'THB', 'ex_vat'],
    ['V-0002', 'Hefei Solar Trading Co., Ltd.', 'CN', 'USD', 'no_vat'],
    ['V-0003', 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด', 'TH', 'THB', 'include_vat'],
    ['V-0004', 'Andaman Seafood Co., Ltd.', 'TH', 'THB', 'no_vat'],
    ['V-0005', 'Nordic Salmon AS', 'NO', 'EUR', 'no_vat'],
    ['V-0006', 'BioCulture Ingredients Ltd.', 'CN', 'CNY', 'no_vat']
  ].filter(function (v) { return !findOne_(TAB.VENDORS, 'vendor_id', v[0]); })
    .map(function (v) {
      return { vendor_id: v[0], name: v[1], country: v[2], default_currency: v[3], default_vat_term: v[4],
        is_active: true, created_by: 'seed', created_at: now, updated_at: now };
    });
  insertRows_(TAB.VENDORS, vendors);
  out.push('vendors +' + vendors.length);
  return out;
}

/** Demo users for every role (emails use DEMO_DOMAIN). */
function demoUsers_() {
  const d = '@' + DEMO_DOMAIN;
  return {
    admin: 'admin' + d, gm: 'gm' + d,
    mgrFood: 'mgr.food' + d, mgrSolar: 'mgr.solar' + d, mgrSupp: 'mgr.supp' + d,
    salesFood1: 'sales.food1' + d, salesFood2: 'sales.food2' + d, salesSolar: 'sales.solar1' + d, salesSupp: 'sales.supp1' + d,
    srLead: 'sr.lead' + d, sr1: 'sr1' + d, sr2: 'sr2' + d
  };
}

function seedUsers_() {
  const U = demoUsers_();
  const now = new Date();
  const list = [
    [U.admin, 'ผู้ดูแลระบบ (Admin)', 'admin', 'MGMT', false],
    [U.gm, 'คุณสมชาย GM', 'gm', 'MGMT', false],
    [U.mgrFood, 'คุณวิภา Manager Food', 'manager', 'SALES-FOOD', false],
    [U.mgrSolar, 'คุณธนา Manager Solar', 'manager', 'SALES-SOLAR', false],
    [U.mgrSupp, 'คุณมาลี Manager Supplement', 'manager', 'SALES-SUPP', false],
    [U.salesFood1, 'คุณกานต์ Sales Food', 'sales', 'SALES-FOOD', false],
    [U.salesFood2, 'คุณปอ Sales Food', 'sales', 'SALES-FOOD', false],
    [U.salesSolar, 'คุณภูมิ Sales Solar', 'sales', 'SALES-SOLAR', false],
    [U.salesSupp, 'คุณแพร Sales Supplement', 'sales', 'SALES-SUPP', false],
    [U.srLead, 'คุณอร SR Lead', 'sr', 'SOURCING', true],
    [U.sr1, 'คุณบอย SR', 'sr', 'SOURCING', false],
    [U.sr2, 'คุณนุ่น SR', 'sr', 'SOURCING', false]
  ].filter(function (u) { return !userByEmail_(u[0]); })
    .map(function (u) {
      return { email: u[0], full_name: u[1], role: u[2], department_code: u[3], is_sr_lead: u[4], is_active: true,
        lark_open_id: '', phone: '', created_at: now, updated_at: now, updated_by: 'seed' };
    });
  insertRows_(TAB.USERS, list);

  [['SALES-FOOD', U.mgrFood], ['SALES-SOLAR', U.mgrSolar], ['SALES-SUPP', U.mgrSupp]].forEach(function (x) {
    const d = departmentByCode_(x[0]);
    if (d && !d.manager_email) updateRow_(TAB.DEPARTMENTS, x[0], { manager_email: x[1], updated_at: now });
  });
  return list.length;
}

/** DEV/UAT: master data + demo users + 4 demo tickets in different stages. */
function seedDemoData() {
  requireOwner_();
  const result = withLock_(function () {
    const out = seedMaster_();
    out.push('users +' + seedUsers_());
    out.push(seedDemoTickets_());
    return out;
  });
  console.log(result.join('\n'));
  return result;
}

function seedDemoTickets_() {
  if (rows_(TAB.TICKETS).length) return 'tickets already exist — demo tickets skipped';
  const U = demoUsers_();
  const must = function (res) {
    if (!res.ok) throw new Error('seed failed: ' + res.code + ' ' + res.error);
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () {
      const v = ticketById_(id).version;
      return must(transitionTicket(id, action, comment || '', Object.assign({ expected_version: v }, extra || {}))).ticket;
    });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };

  // (A) Solar — full cycle → Closed
  let t = as(U.salesSolar, function () {
    return must(createTicket({
      client_key: 'seed-A', title: 'Inverter + Mounting โครงการหลังคาโรงงาน 500kW', customer_name: 'บจก. ไทยแพ็คเกจจิ้ง', priority: 'high',
      items: [
        { product_group_code: 'SOLAR-INVERTER', product_name: 'Sungrow SG110CX', spec: '110kW 3-phase On-grid', qty: 4, uom: 'เครื่อง' },
        { product_group_code: 'SOLAR-MOUNTING', product_name: 'Mounting Metal Sheet', spec: 'สำหรับหลังคา Metal sheet', qty: 1000, uom: 'ชุด' }
      ]
    })).ticket;
  });
  go(U.mgrSolar, t.ticket_id, 'manager_approve', 'อนุมัติ');
  go(U.gm, t.ticket_id, 'gm_approve');
  go(U.sr1, t.ticket_id, 'claim');
  as(U.sr1, function () {
    checklistOf_(t.ticket_id).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); });
  });
  go(U.sr1, t.ticket_id, 'doc_complete');
  as(U.sr1, function () {
    const items = activeItemsOf_(t.ticket_id);
    // Net THB: Sungrow 98,000 | Hefei 2,650 × 36.20 = 95,930 (cheapest) | Thai Solar 104,000 / 1.07 = 97,196
    const q1 = must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0001', vendor_name: 'Sungrow Power Supply (Thailand)',
      unit_price: 98000, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', moq: 1, lead_time_days: 14,
      payment_term: 'Credit 30 วัน', valid_until: inDays(30) })).quote;
    must(saveQuotation({ item_id: items[0].item_id, vendor_name: 'Hefei Solar Trading Co., Ltd.', unit_price: 2650, currency: 'USD',
      fx_rate: 36.2, vat_term: 'no_vat', moq: 10, lead_time_days: 45, payment_term: 'T/T 30% deposit', valid_until: inDays(20) }));
    must(saveQuotation({ item_id: items[0].item_id, vendor_name: 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด', unit_price: 104000, currency: 'THB',
      fx_rate: 1, vat_term: 'include_vat', moq: 1, lead_time_days: 7, payment_term: 'เงินสด', valid_until: inDays(15) }));
    must(selectQuotation(q1.quote_id, 'ตัวแทนจำหน่ายอย่างเป็นทางการ รับประกันศูนย์ 10 ปี'));
    const q4 = must(saveQuotation({ item_id: items[1].item_id, vendor_name: 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด', unit_price: 850,
      currency: 'THB', fx_rate: 1, vat_term: 'include_vat', lead_time_days: 10, payment_term: 'Credit 30 วัน', valid_until: inDays(30) })).quote;
    must(selectQuotation(q4.quote_id, ''));
  });
  go(U.sr1, t.ticket_id, 'submit_quote');
  go(U.salesSolar, t.ticket_id, 'accept', 'ตกลงตามราคานี้');

  // (B) Seafood — SR asked for more info
  t = as(U.salesFood1, function () {
    return must(createTicket({
      client_key: 'seed-B', title: 'กุ้งขาวแช่แข็ง + แซลมอนฟิเล่ สำหรับร้านอาหารญี่ปุ่น', customer_name: 'ร้านซูชิ ABC',
      items: [
        { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว Vannamei HLSO', spec: 'Size 31/40', qty: 500, uom: 'กก.' },
        { product_group_code: 'FOOD-FISH', product_name: 'Salmon Fillet Trim D', qty: 300, uom: 'กก.' }
      ]
    })).ticket;
  });
  go(U.mgrFood, t.ticket_id, 'manager_approve');
  go(U.gm, t.ticket_id, 'gm_approve');
  go(U.srLead, t.ticket_id, 'assign', '', { sr_email: U.sr1 });
  go(U.sr1, t.ticket_id, 'request_info', 'ขอ % glazing และรูปแบบ packing ของกุ้ง', { missing_items: ['glazing', 'packing'] });

  // (C) Supplement — waiting for GM
  t = as(U.salesSupp, function () {
    return must(createTicket({
      client_key: 'seed-C', title: 'Probiotic powder สำหรับผลิตภัณฑ์ใหม่', priority: 'urgent',
      items: [{ product_group_code: 'SUPP-PROBIOTIC', product_name: 'Lactobacillus plantarum', spec: '100B CFU/g', qty: 25, uom: 'กก.' }]
    })).ticket;
  });
  go(U.mgrSupp, t.ticket_id, 'manager_approve');

  // (D) Seafood — waiting for Manager
  as(U.salesFood1, function () {
    return must(createTicket({
      client_key: 'seed-D', title: 'หมึกกล้วยแช่แข็ง ล็อตเดือนหน้า', priority: 'low',
      items: [{ product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', spec: 'U/10', qty: 1000, uom: 'กก.' }]
    }));
  });
  return 'demo tickets +4';
}
