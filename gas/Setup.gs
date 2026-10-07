/**
 * File: Setup.gs
 * One-time / maintenance functions. Run from the Apps Script editor (Run menu).
 *
 *   setupDatabase()  — creates (or repairs) the database spreadsheet, every tab and header,
 *                      column formats, dropdowns, sheet protection, default Settings and
 *                      the Drive folder for attachments. Safe to run again any time:
 *                      it only ADDS missing tabs/columns, never deletes or reorders.
 *   seedMasterData() — departments, Food product groups + checklist templates, vendors.
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
const BOOL_COLS_ = ['is_active', 'is_selected', 'is_deleted', 'is_checked', 'is_required', 'is_read'];

/** Create / repair the database. Owner only. */
function setupDatabase() {
  requireOwner_();
  const props = PropertiesService.getScriptProperties();
  let ss;
  const id = props.getProperty(CFG.PROP.DB_ID);
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('MGS Food Price Request — DATABASE (do not share)');
    props.setProperty(CFG.PROP.DB_ID, ss.getId());
  }
  useDatabase_(ss);
  const report = setupSchema_(ss, { protect: true });

  if (!props.getProperty(CFG.PROP.DRIVE_ROOT_ID)) {
    const folder = DriveApp.createFolder('MGS Food Price Request — Attachments (do not share)');
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

  // Existing databases: add SLA hours for stages introduced later (never overwrite values Admin changed)
  const slaRow = findOne_(TAB.SETTINGS, 'key', 'sla_hours');
  const defaults = JSON.parse(DEFAULT_SETTINGS.filter(function (x) { return x[0] === 'sla_hours'; })[0][1]);
  const current = parseJson_(slaRow && slaRow.value, {});
  const missingSla = Object.keys(defaults).filter(function (k) { return current[k] === undefined; });
  if (slaRow && missingSla.length) {
    missingSla.forEach(function (k) { current[k] = defaults[k]; });
    updateRow_(TAB.SETTINGS, 'sla_hours', { value: JSON.stringify(current), updated_at: now, updated_by: 'setup' });
    report.push('Settings: sla_hours added ' + missingSla.join(', '));
  }
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
  p.setDescription('MGS Food Price Request — ' + tab + ' (แก้ไขผ่านแอปเท่านั้น)');
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

  // SALES-FOOD has no Sales Manager yet → requests go straight to GM.
  // To add the step later: put the Sales Manager's e-mail in Departments.manager_email.
  const depts = [
    ['SALES-FOOD', 'ฝ่ายขาย Frozen Seafood & Food'],
    ['SOURCING', 'ฝ่ายจัดหา (Sourcing)'],
    ['MGMT', 'ผู้บริหาร / Admin']
  ].filter(function (d) { return !findOne_(TAB.DEPARTMENTS, 'code', d[0]); })
    .map(function (d) { return { code: d[0], name: d[1], manager_email: '', is_active: true, created_at: now, updated_at: now }; });
  insertRows_(TAB.DEPARTMENTS, depts);
  out.push('departments +' + depts.length);

  // Scope: Food only.
  const tpl = function (list) { return JSON.stringify(list.map(function (x) { return { key: x[0], label: x[1], required: x[2] !== false }; })); };
  const groups = [
    ['FOOD', 'อาหารทะเลแช่แข็ง & อาหาร', 'Frozen Seafood & Food', '', 100, tpl([
      ['spec', 'Spec สินค้า (ชนิด/สายพันธุ์)'], ['size_grade', 'ขนาด / เกรด'],
      ['packing', 'รูปแบบบรรจุ (Packing / น้ำหนักต่อแพ็ค)'], ['net_weight', '% Net Weight (ไม่รวมน้ำแข็ง)'],
      ['origin', 'ประเทศต้นทาง', false], ['shelf_life', 'อายุสินค้า / เงื่อนไขการเก็บรักษา', false]])],
    ['FOOD-SHRIMP', 'กุ้ง', 'Shrimp', 'FOOD', 101, tpl([['glazing', '% Glazing']])],
    ['FOOD-FISH', 'ปลา (แซลมอน / ซาบะ / อื่นๆ)', 'Fish', 'FOOD', 102, tpl([['cut_type', 'รูปแบบการตัดแต่ง (Fillet / Steak / Whole)']])],
    ['FOOD-CEPHALOPOD', 'หมึก / ปลาหมึก', 'Squid & Octopus', 'FOOD', 103, '[]'],
    ['FOOD-PROCESSED', 'อาหารแปรรูป / Global Food', 'Processed & Global Food', 'FOOD', 104, tpl([['ingredients', 'ส่วนประกอบ / ฉลาก']])]
  ].filter(function (g) { return !findOne_(TAB.PRODUCT_GROUPS, 'code', g[0]); })
    .map(function (g) {
      return { code: g[0], name: g[1], name_en: g[2], parent_code: g[3], sort_order: g[4], checklist_json: g[5],
        is_active: true, created_at: now, updated_at: now };
    });
  insertRows_(TAB.PRODUCT_GROUPS, groups);
  out.push('product groups +' + groups.length);

  const vendors = [
    ['V-0001', 'Andaman Seafood Co., Ltd.', 'TH', 'THB', 'include_vat'],
    ['V-0002', 'Nordic Salmon AS', 'NO', 'EUR', 'no_vat'],
    ['V-0003', 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', 'TH', 'THB', 'ex_vat'],
    ['V-0004', 'Ocean Pride Vietnam Co., Ltd.', 'VN', 'USD', 'no_vat'],
    ['V-0005', 'India Marine Exports Pvt. Ltd.', 'IN', 'USD', 'no_vat'],
    ['V-0006', 'Global Food Import Pte. Ltd.', 'SG', 'USD', 'no_vat']
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
    admin: 'admin' + d, gm: 'gm' + d, mgrFood: 'mgr.food' + d,
    salesFood1: 'sales.food1' + d, salesFood2: 'sales.food2' + d, salesFood3: 'sales.food3' + d,
    srManager: 'sr.manager' + d, sr1: 'sr1' + d, sr2: 'sr2' + d
  };
}

function seedUsers_() {
  const U = demoUsers_();
  const now = new Date();
  const list = [
    [U.admin, 'ผู้ดูแลระบบ (Admin)', 'admin', 'MGMT'],
    [U.gm, 'คุณสมชาย GM', 'gm', 'MGMT'],
    [U.mgrFood, 'คุณวิภา Sales Manager', 'manager', 'SALES-FOOD'],
    [U.salesFood1, 'คุณกานต์ Sales', 'sales', 'SALES-FOOD'],
    [U.salesFood2, 'คุณปอ Sales', 'sales', 'SALES-FOOD'],
    [U.salesFood3, 'คุณภูมิ Sales', 'sales', 'SALES-FOOD'],
    [U.srManager, 'คุณอร SR Manager', 'sr_manager', 'SOURCING'],
    [U.sr1, 'คุณบอย SR', 'sr', 'SOURCING'],
    [U.sr2, 'คุณนุ่น SR', 'sr', 'SOURCING']
  ].filter(function (u) { return !userByEmail_(u[0]); })
    .map(function (u) {
      return { email: u[0], full_name: u[1], role: u[2], department_code: u[3], is_active: true,
        lark_open_id: '', phone: '', created_at: now, updated_at: now, updated_by: 'seed' };
    });
  insertRows_(TAB.USERS, list);
  return list.length;
}

/** DEV/UAT: master data + demo users + demo tickets in different stages. */
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
  const req = function (email, key, header, items) {
    return as(email, function () {
      return must(createTicket(Object.assign({ client_key: key, due_date: inDays(7) }, header, { items: items }))).ticket;
    });
  };

  // (A) Salmon — full cycle: GM → SR → SR Manager → GM price → Sales accepts (Closed)
  let t = req(U.salesFood1, 'seed-A', { customer_name: 'บจก. ซูชิ ดีไลท์', documents_needed: 'Health Certificate, COA', description: 'ลูกค้าต้องการแบรนด์นอร์เวย์', priority: 'high' }, [
    { product_group_code: 'FOOD-FISH', product_name: 'Salmon Fillet Trim D (Skin-on)', net_weight: '100%', size: '1.0–1.5 kg/pc', packing_size: 'IVP 1 pc/bag, 10 kg/ctn', qty: 300, uom: 'กก.', target_price: 450 }
  ]);
  go(U.gm, t.ticket_id, 'gm_approve', 'อนุมัติ');
  go(U.sr1, t.ticket_id, 'claim');
  as(U.sr1, function () { checklistOf_(t.ticket_id).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
  go(U.sr1, t.ticket_id, 'doc_complete');
  as(U.sr1, function () {
    const items = activeItemsOf_(t.ticket_id);
    // Net THB/kg: Nordic 11.50 EUR × 39.50 = 454.25 | Andaman 485 ÷ 1.07 = 453.27 | Seafood Trading 440 ex VAT = 440 (cheapest)
    const q1 = must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0002', vendor_name: 'Nordic Salmon AS',
      unit_price: 11.5, currency: 'EUR', fx_rate: 39.5, vat_term: 'no_vat', moq: 200, lead_time_days: 21, payment_term: 'T/T 30% deposit',
      valid_until: inDays(30), brand: 'Nordic Fresh', origin_country: 'นอร์เวย์', packing: 'IVP 10 kg/ctn', incoterm: 'CIF', shelf_life: '24 เดือน (-18°C)' })).quote;
    must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0001', vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 485,
      currency: 'THB', fx_rate: 1, vat_term: 'include_vat', moq: 50, lead_time_days: 5, payment_term: 'Credit 30 วัน', valid_until: inDays(15),
      brand: 'Andaman', origin_country: 'ชิลี', packing: '5 kg/ctn', incoterm: 'DELIVERED', shelf_life: '18 เดือน (-18°C)' }));
    must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0003', vendor_name: 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', unit_price: 440,
      currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', moq: 100, lead_time_days: 7, payment_term: 'เงินสด', valid_until: inDays(10),
      origin_country: 'ชิลี', packing: 'Bulk 20 kg/ctn', incoterm: 'DELIVERED', shelf_life: '12 เดือน (-18°C)' }));
    must(selectQuotation(q1.quote_id, 'ลูกค้าระบุแบรนด์ Norway และมี Health Certificate ครบ'));
  });
  go(U.sr1, t.ticket_id, 'submit_quote');
  go(U.srManager, t.ticket_id, 'srm_approve', 'ราคาสมเหตุสมผล');
  go(U.gm, t.ticket_id, 'gm_price_approve');
  go(U.salesFood1, t.ticket_id, 'accept', 'ตกลงตามราคานี้');

  // (B) Shrimp — SR asked for more info
  t = req(U.salesFood1, 'seed-B', { customer_name: 'ร้านซูชิ ABC' }, [
    { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว Vannamei HLSO', net_weight: '80%', size: '31/40', packing_size: '1 kg/pack', qty: 500, uom: 'กก.', target_price: 0 }
  ]);
  go(U.gm, t.ticket_id, 'gm_approve');
  go(U.srManager, t.ticket_id, 'assign', '', { sr_email: U.sr1 });
  go(U.sr1, t.ticket_id, 'request_info', 'ขอ % glazing และรูปแบบ packing ของกุ้ง', { missing_items: ['glazing', 'packing'] });

  // (C) Squid — waiting for GM (no Sales Manager → step skipped)
  req(U.salesFood3, 'seed-C', { customer_name: 'โรงแรม ซีวิว', documents_needed: 'Spec sheet', priority: 'urgent' }, [
    { product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', net_weight: '90%', size: 'U/10', packing_size: '1 kg/bag', qty: 1000, uom: 'กก.', target_price: 165 }
  ]);

  // (D) Processed food — waiting for GM
  req(U.salesFood2, 'seed-D', { customer_name: 'ร้านราเมง โทริ' }, [
    { product_group_code: 'FOOD-PROCESSED', product_name: 'Teriyaki Sauce 1.8 L', net_weight: '100%', size: '1.8 ลิตร', packing_size: '6 ขวด/ลัง', qty: 600, uom: 'ขวด', target_price: 0 }
  ]);

  // (E) Shrimp + mackerel — SR still entering prices (pricing page demo for sr2)
  t = req(U.salesFood2, 'seed-E', { customer_name: 'โรงแรม ริเวอร์ไซด์', due_date: inDays(5), documents_needed: 'COA, ใบรับรองฮาลาล' }, [
    { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว Vannamei PD', net_weight: '90%', size: '41/50', packing_size: '1 kg/pack', qty: 400, uom: 'กก.', target_price: 270 },
    { product_group_code: 'FOOD-FISH', product_name: 'ปลาซาบะนอร์เวย์ Fillet', net_weight: '100%', size: '150–200 g', packing_size: '10 kg/ctn', qty: 150, uom: 'กก.', target_price: 0 }
  ]);
  go(U.gm, t.ticket_id, 'gm_approve');
  go(U.sr2, t.ticket_id, 'claim');
  as(U.sr2, function () {
    checklistOf_(t.ticket_id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); });
  });
  go(U.sr2, t.ticket_id, 'doc_complete');
  as(U.sr2, function () {
    const items = activeItemsOf_(t.ticket_id);
    must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0004', vendor_name: 'Ocean Pride Vietnam Co., Ltd.', unit_price: 7.2,
      currency: 'USD', fx_rate: 36.5, vat_term: 'no_vat', moq: 1000, lead_time_days: 30, payment_term: 'L/C at sight', valid_until: inDays(14),
      origin_country: 'เวียดนาม', packing: '1 kg × 10/ctn', incoterm: 'CIF', shelf_life: '24 เดือน (-18°C)' }));
    must(saveQuotation({ item_id: items[0].item_id, vendor_id: 'V-0001', vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 289,
      currency: 'THB', fx_rate: 1, vat_term: 'include_vat', moq: 100, lead_time_days: 4, payment_term: 'Credit 30 วัน', valid_until: inDays(10),
      origin_country: 'ไทย', packing: '1 kg × 10/ctn', incoterm: 'DELIVERED', shelf_life: '18 เดือน (-18°C)' }));
  });

  // (F) Shrimp — waiting for SR Manager to check prices
  t = req(U.salesFood3, 'seed-F', { customer_name: 'ภัตตาคาร ทะเลทอง' }, [
    { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งแชบ๊วย HOSO', net_weight: '85%', size: '26/30', packing_size: '2 kg/box', qty: 200, uom: 'กก.', target_price: 380 }
  ]);
  go(U.gm, t.ticket_id, 'gm_approve');
  go(U.sr1, t.ticket_id, 'claim');
  as(U.sr1, function () { checklistOf_(t.ticket_id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
  go(U.sr1, t.ticket_id, 'doc_complete');
  as(U.sr1, function () {
    const it = activeItemsOf_(t.ticket_id)[0];
    const q = must(saveQuotation({ item_id: it.item_id, vendor_id: 'V-0005', vendor_name: 'India Marine Exports Pvt. Ltd.', unit_price: 9.6,
      currency: 'USD', fx_rate: 36.5, vat_term: 'no_vat', moq: 500, lead_time_days: 35, payment_term: 'T/T 30% deposit', valid_until: inDays(20),
      origin_country: 'อินเดีย', packing: '2 kg × 6/ctn', incoterm: 'CFR', shelf_life: '24 เดือน (-18°C)' })).quote;
    must(saveQuotation({ item_id: it.item_id, vendor_id: 'V-0003', vendor_name: 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', unit_price: 375,
      currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', moq: 50, lead_time_days: 3, payment_term: 'Credit 30 วัน', valid_until: inDays(7),
      origin_country: 'ไทย', packing: '2 kg/box', incoterm: 'DELIVERED' }));
    must(selectQuotation(q.quote_id, ''));
  });
  go(U.sr1, t.ticket_id, 'submit_quote');
  return 'demo tickets +6';
}
