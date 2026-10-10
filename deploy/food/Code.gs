/**
 * MGS Food Price Request — Code.gs (ALL server code in one file) · version 2026.10.10-4
 * Built from the repository gas/*.gs by dev/build-deploy.js — do not edit here, edit gas/ and rebuild.
 *
 * Apps Script project needs exactly 3 files:  Code.gs (this) · Index.html · appsscript.json
 * First install: Run setupDatabase → Run runAcceptanceTests → Deploy (see the end of docs/ or the README).
 */

// ============================================================================
// Config.gs
// ============================================================================
/**
 * File: Config.gs
 * MGS Food Price Request & Sourcing System — configuration and the sheet "schema".
 *
 * The header row of every tab is the contract between code and data.
 * Columns are always addressed by header name, never by position.
 * Secrets (Lark app secret, etc.) live in Script Properties, never here.
 */

const APP_VERSION = '2026.10.10-4';

const CFG = {
  APP_NAME: 'MGS Food Price Request',
  TZ: 'Asia/Bangkok',
  LOCK_TIMEOUT_MS: 25000,
  MAX_ITEMS_PER_TICKET: 100,
  MAX_VENDORS_PER_ITEM: 5,
  MAX_TEXT: 2000,
  MAX_COMMENT: 2000,
  // Script Properties keys
  PROP: {
    DB_ID: 'DB_SPREADSHEET_ID',
    DRIVE_ROOT_ID: 'DRIVE_ROOT_FOLDER_ID',
    LARK_APP_ID: 'LARK_APP_ID',
    LARK_APP_SECRET: 'LARK_APP_SECRET',
    LARK_HOST: 'LARK_HOST',
    LARK_GROUP_CHAT_ID: 'LARK_GROUP_CHAT_ID',
    LARK_PRICE_GROUP_CHAT_ID: 'LARK_PRICE_GROUP_CHAT_ID',
    LARK_MGMT_GROUP_CHAT_ID: 'LARK_MGMT_GROUP_CHAT_ID',
    // Lark Custom Bot webhooks (group "Food Price Request") — Script Properties only, never in the sheet
    FPR_BOT_URL: 'FPR_BOT_URL', FPR_BOT_SECRET: 'FPR_BOT_SECRET',
    FPR_REMINDER_URL: 'FPR_REMINDER_URL', FPR_REMINDER_SECRET: 'FPR_REMINDER_SECRET',
    WEBAPP_URL: 'WEBAPP_URL'
  }
};

const TAB = {
  USERS: 'Users',
  DEPARTMENTS: 'Departments',
  PRODUCT_GROUPS: 'ProductGroups',
  VENDORS: 'Vendors',
  SUPPLIER_LOGS: 'SupplierLogs',
  USAGE_LOG: 'UsageLog',
  SETTINGS: 'Settings',
  COUNTERS: 'Counters',
  TICKETS: 'Tickets',
  ITEMS: 'TicketItems',
  QUOTATIONS: 'Quotations',
  CHECKLIST: 'Checklist',
  ATTACHMENTS: 'Attachments',
  LOGS: 'TicketLogs',
  NOTIFICATIONS: 'Notifications',
  SLA_ALERTS: 'SlaAlerts',
  NOTIF_LOG: 'NotifLog',
  HOLIDAYS: 'Holidays',
  ERRORS: 'ErrorLog'
};

/**
 * Header contract per tab. Order = order of columns created by setupDatabase().
 * Adding a column: append it to the END of the list and run setupDatabase() again
 * (it only appends missing columns, never reorders or deletes).
 * key = immutable primary key column used for every lookup.
 */
const SCHEMA = {
  Users: {
    key: 'email',
    cols: ['email', 'full_name', 'role', 'department_code', 'is_active',
           'lark_open_id', 'phone', 'created_at', 'updated_at', 'updated_by']
  },
  Departments: {
    key: 'code',
    cols: ['code', 'name', 'manager_email', 'is_active', 'created_at', 'updated_at']
  },
  ProductGroups: {
    key: 'code',
    cols: ['code', 'name', 'name_en', 'parent_code', 'checklist_json', 'sort_order', 'is_active',
           'created_at', 'updated_at']
  },
  Vendors: {
    key: 'vendor_id',
    cols: ['vendor_id', 'name', 'tax_id', 'country', 'default_currency', 'default_vat_term',
           'contact_name', 'phone', 'email', 'note', 'is_active', 'created_by', 'created_at', 'updated_at',
           // Supplier master (appended v2026.10.08-2): search names, trade terms used to pre-fill quotations, QC info
           'short_name', 'supplier_type', 'payment_term', 'incoterm', 'lead_time_days', 'moq', 'validity_days',
           'clearance_per_kg', 'brands', 'product_groups', 'chat_id', 'certs_json', 'quality_note', 'updated_by', 'version']
  },
  UsageLog: {
    key: 'log_id',
    cols: ['log_id', 'day', 'email', 'role', 'page', 'views']
  },
  SupplierLogs: {
    key: 'log_id',
    cols: ['log_id', 'ts', 'vendor_id', 'actor_email', 'actor_role', 'action', 'diff_json']
  },
  Settings: {
    key: 'key',
    cols: ['key', 'value', 'description', 'updated_at', 'updated_by']
  },
  Counters: {
    key: 'name',
    cols: ['name', 'last_no', 'updated_at']
  },
  Tickets: {
    key: 'ticket_id',
    cols: ['ticket_id', 'ticket_no', 'title', 'description', 'customer_name', 'priority',
           'status', 'stage', 'requestor_email', 'department_code', 'manager_email', 'gm_email', 'sr_email',
           'due_date', 'revision_count', 'version', 'info_request_json', 'rejection_reason',
           'stage_entered_at', 'submitted_at', 'manager_approved_at', 'gm_approved_at', 'assigned_at',
           'doc_checked_at', 'completed_at', 'closed_at', 'rejected_at', 'cancelled_at',
           'client_key', 'created_at', 'updated_at',
           // appended in v2026.10.06-3 (Food form + SR Manager / GM price approval)
           'documents_needed', 'quote_submitted_at', 'sr_manager_email', 'sr_manager_approved_at', 'gm_price_approved_at',
           // appended in v2026.10.08-1: a "send later" ticket split out of another one
           'parent_ticket_id',
           // appended v2026.10.08-3: where the goods go and who the customer is
           'destination_country', 'customer_group',
           // appended v2026.10.10-3 (FPR): start of the current pricing round (SLA) · last SLA reminder sent
           'pricing_started_at', 'last_reminded_at']
  },
  TicketItems: {
    key: 'item_id',
    cols: ['item_id', 'ticket_id', 'line_no', 'product_group_code', 'product_name', 'spec', 'description',
           'qty', 'uom', 'target_price', 'target_currency', 'is_deleted', 'created_at', 'updated_at',
           // Food request form fields (appended): % net weight (excl. ice glaze), size, retail pack size
           'net_weight', 'size', 'packing_size',
           // Selling price set by SR (appended): GP % of selling price, selling price per unit (stored at submit)
           'gp_percent', 'sell_price_thb',
           // SR decision per item (appended): '' = quote · 'not_offered' = will not quote · 'follow_up' = split to a new ticket
           'quote_status', 'quote_status_reason', 'follow_up_ticket_id',
           // Sales follow-up after the price (appended v2026.10.08-4): did the customer buy? (see Deals.gs)
           'deal_status', 'deal_reason', 'deal_note', 'deal_next_date', 'deal_updated_by', 'deal_updated_at', 'deal_closed_at',
           // follow-up v2 (appended v2026.10.09-1, same structure as the MGS Sales app): where the customer is + what Sales does next
           'deal_stage', 'deal_next_step',
           // appended v2026.10.10-3 (FPR): why this item has fewer suppliers than Settings › min_suppliers
           'supplier_shortfall_reason']
  },
  Quotations: {
    key: 'quote_id',
    cols: ['quote_id', 'item_id', 'ticket_id', 'vendor_id', 'vendor_name', 'unit_price', 'currency', 'fx_rate',
           'vat_term', 'vat_rate', 'moq', 'lead_time_days', 'payment_term', 'valid_until', 'remark',
           'attachment_file_id', 'is_selected', 'selection_reason',
           'net_unit_cost', 'net_unit_cost_thb', 'gross_unit_price_thb',
           'is_deleted', 'created_by', 'created_at', 'updated_at',
           // Food-specific (optional) — appended later, keep at the end
           'brand', 'origin_country', 'packing', 'incoterm', 'shelf_life',
           // Selling price (appended): clearance cost per unit and landed cost = net cost + clearance
           'clearance_thb', 'landed_unit_cost_thb',
           // appended v2026.10.10-3 (FPR): landed-cost breakdown per unit (THB) behind clearance_thb · date of the FX rate
           'cost_breakdown_json', 'fx_date']
  },
  Checklist: {
    key: 'check_id',
    cols: ['check_id', 'ticket_id', 'product_group_code', 'item_key', 'label', 'is_required', 'sort_order',
           'is_checked', 'checked_by', 'checked_at', 'note', 'updated_at']
  },
  Attachments: {
    key: 'attachment_id',
    cols: ['attachment_id', 'ticket_id', 'item_id', 'quote_id', 'category', 'file_name', 'drive_file_id',
           'mime_type', 'size_bytes', 'uploaded_by', 'uploaded_at', 'is_deleted', 'deleted_by', 'deleted_at']
  },
  TicketLogs: {
    key: 'log_id',
    cols: ['log_id', 'ts', 'ticket_id', 'log_type', 'actor_email', 'actor_role', 'action',
           'from_status', 'to_status', 'from_stage', 'to_stage', 'comment', 'metadata_json',
           'stage_duration_sec', 'app_version', 'prev_hash', 'hash']
  },
  Notifications: {
    key: 'notif_id',
    cols: ['notif_id', 'user_email', 'ticket_id', 'type', 'title', 'body', 'link', 'is_read', 'read_at',
           'created_at', 'lark_status', 'lark_attempts', 'lark_error', 'lark_sent_at']
  },
  SlaAlerts: {
    key: 'alert_key',
    cols: ['alert_key', 'ticket_id', 'stage', 'stage_entered_at', 'level', 'created_at']
  },
  NotifLog: {
    key: 'log_id',
    cols: ['log_id', 'ts', 'ticket_id', 'ticket_no', 'bot', 'event', 'status', 'http_code', 'attempts', 'response', 'summary']
  },
  Holidays: {
    key: 'date',
    cols: ['date', 'name']
  },
  ErrorLog: {
    key: 'ts',
    cols: ['ts', 'fn', 'user_email', 'code', 'message', 'stack', 'context_json', 'app_version']
  }
};

// ---------------------------------------------------------------- Enumerations
/**
 * Organisation
 *   Sales → Sales Manager (manager) → GM          (Sales Manager step is skipped when the department has none)
 *   SR    → SR Manager (sr_manager) → GM          (price approval — never skipped)
 */
const ROLES = ['sales', 'manager', 'gm', 'sr', 'sr_manager', 'admin'];
const ROLE_LABEL_TH = { sales: 'Sales', manager: 'Sales Manager', gm: 'GM', sr: 'SR (Sourcing)', sr_manager: 'SR Manager', admin: 'Admin' };

const STATUS = ['requested', 'on_process', 'completed', 'closed', 'rejected'];
const STATUS_LABEL_TH = {
  requested: 'Requested', on_process: 'On Process', completed: 'Completed', closed: 'Closed', rejected: 'Rejected'
};

/** stage → main status. Stage tells WHO the ticket is waiting for. */
const STAGE_STATUS = {
  pending_manager: 'requested',
  returned: 'requested',
  pending_gm: 'requested',
  pending_assign: 'on_process',
  doc_check: 'on_process',
  need_info: 'on_process',
  sourcing: 'on_process',
  pending_sr_manager: 'on_process',
  pending_gm_price: 'on_process',
  awaiting_sales_ack: 'completed',
  closed: 'closed',
  rejected: 'rejected',
  cancelled: 'rejected'
};

const STAGE_LABEL_TH = {
  pending_manager: 'รอ Sales Manager อนุมัติ',
  returned: 'ส่งกลับให้ Sales แก้ไข',
  pending_gm: 'รอ GM อนุมัติฝั่งขาย',
  pending_assign: 'รอ SR รับงาน',
  doc_check: 'SR ตรวจเอกสาร',
  need_info: 'รอ Sales ส่งข้อมูลเพิ่ม',
  sourcing: 'SR กำลังหาราคา',
  pending_sr_manager: 'รอ SR Manager ตรวจราคา',
  pending_gm_price: 'รอ GM อนุมัติฝั่งซื้อ',
  awaiting_sales_ack: 'รอ Sales รับทราบราคา',
  closed: 'ปิดงาน',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก'
};

const OPEN_STATUSES = ['requested', 'on_process', 'completed'];
/**
 * Sales outcome of ONE quoted item (New Item follow-up). '' = not updated yet.
 * follow / sample are still open; won / lost are decided.
 */
const DEAL_STATUSES = ['follow', 'sample', 'won', 'lost'];
const DEAL_STATUS_LABEL_TH = { '': 'ยังไม่อัปเดต', follow: 'กำลังติดตาม', sample: 'ส่งตัวอย่าง / ทดลองสินค้า', won: 'ปิดการขายได้', lost: 'ไม่ได้งาน' };
const VAT_TERMS = ['ex_vat', 'no_vat', 'include_vat'];
const VAT_TERM_LABEL = { ex_vat: 'Ex VAT', no_vat: 'No VAT', include_vat: 'Include VAT' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Units on the Food request form. */
const UNITS = ['กก.', 'ตัน', 'กล่อง', 'แพ็ค', 'ถุง', 'ชิ้น', 'ตัว', 'ขวด', 'ลิตร'];
/** Delivery terms on a vendor quotation (food imports are usually CIF / CFR; local suppliers deliver). */
const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'DELIVERED'];
const INCOTERM_LABEL = { EXW: 'EXW', FCA: 'FCA', FOB: 'FOB', CFR: 'CFR (C&F)', CIF: 'CIF', DAP: 'DAP', DDP: 'DDP', DELIVERED: 'ส่งถึงคลัง MGS' };
/** Drive folder for attachments (created by setupDatabase): <root>/FPR-YYMM-#### */
const DRIVE_ROOT_NAME = 'FPR Attachments';
const ATTACHMENT_CATEGORIES = ['request', 'info_response', 'quotation', 'quote_photo', 'other'];
/** Purchasing-side files (vendor quotation documents + supplier product photos): cost roles only, never Sales. */
const COST_FILE_CATEGORIES_ = ['quotation', 'quote_photo'];
/** Supplier product photos: images only, at most `max_photos_per_quote` (default 10) per supplier offer. */
const PHOTO_MIME_TYPES_ = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** Default rows for the Settings tab (value column stores JSON text). */
const DEFAULT_SETTINGS = [
  ['vat_rate', '0.07', 'อัตรา VAT (0.07 = 7%) — snapshot ลงแต่ละใบเสนอราคาตอนบันทึก'],
  ['sla_hours', JSON.stringify({
    pending_manager: 24, returned: 48, pending_gm: 24, pending_assign: 8,
    doc_check: 16, need_info: 48, sourcing: 72, pending_sr_manager: 8, pending_gm_price: 8, awaiting_sales_ack: 48
  }), 'SLA เป็นชั่วโมงปฏิทินของแต่ละ stage'],
  ['sla_warning_ratio', '0.8', 'เตือนเมื่อใช้เวลาเกินสัดส่วนนี้ของ SLA'],
  ['currencies', JSON.stringify(['THB', 'USD', 'CNY', 'EUR', 'JPY', 'SGD']), 'สกุลเงินใน dropdown'],
  ['max_upload_mb', '20', 'ขนาดไฟล์แนบสูงสุดต่อไฟล์ (MB)'],
  ['lark_group_events', JSON.stringify(['new_request', 'sales_approved', 'sr_claimed', 'queue_return', 'need_info', 'rejected', 'price_done',
    'follow_up', 'deal_won', 'price_review', 'gm_buy', 'price_returned', 'revision']),
    'เหตุการณ์ที่ส่งเข้ากลุ่ม Lark อัตโนมัติ (ลบคีย์ออกเพื่อปิด) · กลุ่ม Sales: new_request, sales_approved, sr_claimed, queue_return, need_info, rejected, price_done, follow_up, deal_won · ' +
    'กลุ่มผู้บริหาร: price_review, gm_buy, price_returned, revision · ข้อความกลุ่มไม่มีราคา/ต้นทุน/ชื่อ Supplier'],
  ['deal_lost_reasons', JSON.stringify(['ราคาสูงกว่าคู่แข่ง', 'ราคาสูงกว่าที่ลูกค้าคาดหวัง', 'สเปก / คุณภาพไม่ตรง', 'MOQ สูงเกินไป',
    'Lead time ไม่ทัน', 'ลูกค้าเลื่อน / ยกเลิกโครงการ', 'ลูกค้าไม่ตอบกลับ', 'อื่นๆ']), 'เหตุผลที่ไม่ได้งาน (dropdown ในหน้าติดตามการขาย)'],
  ['deal_follow_days', '7', 'Sales ต้องอัปเดตความคืบหน้ากับลูกค้าอย่างน้อยทุกกี่วัน (นับจากวันที่ได้ราคา / อัปเดตครั้งล่าสุด) · ไม่ระบุวันนัด = วันนี้ + จำนวนวันนี้'],
  ['deal_customer_stages', JSON.stringify(['เพิ่งส่งราคาให้ลูกค้า', 'ลูกค้ากำลังเทียบราคา', 'อยู่ระหว่างต่อรองราคา', 'ส่งตัวอย่าง / ลูกค้าทดลองสินค้า',
    'รออนุมัติภายในของลูกค้า', 'ใกล้ปิดการขาย', 'ลูกค้าเลื่อนโครงการ']), 'สถานะกับลูกค้าตอนนี้ (dropdown ในการอัปเดตความคืบหน้า)'],
  ['deal_next_steps', JSON.stringify(['โทรติดตาม', 'นัดเข้าพบลูกค้า', 'ส่งตัวอย่างสินค้า', 'ส่งเอกสาร / ข้อมูลเพิ่มเติม', 'ขอปรับราคาจาก SR', 'รอ PO',
    'ปิดการขาย', 'ยุติการติดตาม']), 'ขั้นตอนถัดไปของ Sales (dropdown ในการอัปเดตความคืบหน้า)'],
  ['sales_manager_step', 'false', 'true = คำขอผ่าน Sales Manager ก่อน GM · false (FPR) = ส่งตรงถึง GM'],
  ['gm_assigns_sr', 'true', 'true (FPR) = GM เลือก Sourcing ผู้ทำราคาตอนอนุมัติ · false = เข้าคิวให้ SR กดรับงานเอง'],
  ['min_suppliers', '3', 'จำนวน supplier ขั้นต่ำต่อรายการก่อนส่งราคา (น้อยกว่านี้ต้องกรอกเหตุผล)'],
  ['min_gp_percent', '10', 'GP % ขั้นต่ำ — ต่ำกว่านี้แสดงเตือนสีแดงในหน้าทำราคาและหน้าอนุมัติ'],
  ['fpr_sla', JSON.stringify({ GM_REVIEW: { hours: 4 }, PRICING: { days: 2 }, SM_REVIEW: { hours: 4 }, GM_FINAL_REVIEW: { hours: 4 } }),
    'SLA ของ FPR นับเฉพาะเวลาทำงาน (work_hours) ไม่นับเสาร์-อาทิตย์และวันในแท็บ Holidays · hours = ชั่วโมงทำงาน, days = วันทำการ'],
  ['work_hours', JSON.stringify({ start: '08:30', end: '17:30', days: [1, 2, 3, 4, 5] }), 'เวลาทำงานสำหรับนับ SLA (days: 1 = จันทร์ … 6 = เสาร์, 7 = อาทิตย์)'],
  ['reminder_repeat_work_hours', '8', 'FPR Reminder แจ้งซ้ำรายการเดิมได้ไม่เกิน 1 ครั้งต่อกี่ชั่วโมงทำงาน'],
  ['max_photos_per_quote', '10', 'จำนวนรูปสินค้าสูงสุดต่อ Supplier 1 เจ้า (ต่อใบเสนอราคา 1 รายการ)'],
  ['default_gp_percent', '15', 'GP % เริ่มต้นที่ SR เห็นในหน้าใบเสนอราคา (คิดเป็น % ของราคาขาย)'],
  ['fx_defaults', JSON.stringify({ USD: 35 }), 'อัตราแลกเปลี่ยนเริ่มต้น (บาทต่อ 1 หน่วย) ที่เติมให้ในหน้าใบเสนอราคา · SR แก้ได้ทุกใบ · สกุลที่ไม่มีในนี้ SR กรอกเอง'],
  ['default_validity_days', '30', 'จำนวนวันยืนราคาเริ่มต้น เมื่อ Supplier ไม่ได้ระบุ'],
  ['customer_groups', JSON.stringify(['ร้านอาหาร', 'โรงแรม / จัดเลี้ยง', 'ค้าปลีก / Modern Trade', 'ค้าส่ง / ตัวแทนจำหน่าย', 'โรงงานแปรรูปอาหาร', 'ส่งออก', 'อื่นๆ']),
    'กลุ่มลูกค้าในฟอร์มขอราคา (dropdown) · “ส่งออก” ต้องระบุประเทศปลายทางที่ไม่ใช่ไทย'],
  ['default_due_working_days', '3', 'วันที่ต้องการราคาเริ่มต้นในฟอร์ม Sales = วันนี้ + วันทำการ'],
  ['document_options', JSON.stringify(['COA', 'Health Certificate', 'Halal', 'Spec sheet', 'ผลเทสต์ / Test report (Micro, Heavy metal, Chemical)', 'Food Safety Cert (GMP / HACCP / BRC / FSSC 22000)']), 'ตัวเลือกเอกสารในฟอร์มขอราคา'],
  ['allowed_mime_types', JSON.stringify([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'
  ]), 'ชนิดไฟล์ที่อนุญาต']
];


// ============================================================================
// Util.gs
// ============================================================================
/**
 * File: Util.gs
 * Shared helpers: structured results, business errors, parsing, dates, hashing.
 * Every function ending with "_" is private — google.script.run cannot call it.
 */

// ---------------------------------------------------------------- Service seams (tests swap these; production uses the real services)

let TEST_HTTP_ = null;     // fake UrlFetchApp
let TEST_DRIVE_ = null;    // fake DriveApp
let TEST_LARK_ = null;     // fake Lark config { app_id, app_secret, host, group_chat_id }

function http_() { return TEST_HTTP_ || UrlFetchApp; }
function drive_() { return TEST_DRIVE_ || DriveApp; }

// ---------------------------------------------------------------- Errors & results

/** Business error: `message` is Thai text safe to show users, `code` is for the UI logic. */
function appError_(code, message, details) {
  const e = new Error(message);
  e.name = 'AppError';
  e.code = code;
  e.isApp = true;
  if (details !== undefined) e.details = details;
  return e;
}

/**
 * Wraps every public API function: never throws to the client, always returns
 * { ok: true, data } or { ok: false, code, error, details? }.
 */
function api_(fnName, fn) {
  try {
    const data = fn();
    // Lark cards queued during the request are sent only now, after everything is committed (Bots.gs)
    if (BOT_QUEUE_.length) { try { flushBotQueue_(); } catch (e) { console.error('flushBotQueue_', e); } }
    return { ok: true, data: data };
  } catch (err) {
    BOT_QUEUE_ = [];   // nothing was approved → nothing is announced
    if (err && err.isApp) {
      return { ok: false, code: err.code, error: err.message, details: err.details || null };
    }
    logError_(fnName, err);
    return { ok: false, code: 'SYSTEM_ERROR', error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ หรือแจ้งผู้ดูแลระบบ (' + fnName + ')' };
  }
}

function logError_(fnName, err, context) {
  const message = err && err.message ? err.message : String(err);
  console.error(fnName, message, err && err.stack);
  try {
    const sh = db_().getSheetByName(TAB.ERRORS);
    if (sh) {
      sh.appendRow([
        new Date(), fnName, safeEmail_(), (err && err.code) || '', message.slice(0, 1000),
        String((err && err.stack) || '').slice(0, 3000), JSON.stringify(context || {}).slice(0, 2000), APP_VERSION
      ]);
    }
  } catch (e) {
    console.error('logError_ failed', e);
  }
}

function safeEmail_() {
  try { return currentEmail_(); } catch (e) { return ''; }
}

// ---------------------------------------------------------------- Ids & hashing

function uuid_() {
  return Utilities.getUuid();
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// ---------------------------------------------------------------- Text & numbers

function cleanText_(v, maxLen) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/ /g, ' ').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function requireText_(v, field, maxLen) {
  const s = cleanText_(v, maxLen || CFG.MAX_TEXT);
  if (!s) throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  return s;
}

/**
 * Strict number parser. Blank → null when allowBlank, otherwise error.
 * Never turns garbage into 0 (a silent 0 on a price is a commercial error).
 * opts: { allowBlank, min, gt, max, integer }
 */
function toNumber_(v, field, opts) {
  const o = opts || {};
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
    if (o.allowBlank) return null;
    throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  }
  let n;
  if (typeof v === 'number') {
    n = v;
  } else {
    const s = String(v).replace(/ /g, '').replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw appError_('VALIDATION', field + ' ต้องเป็นตัวเลข');
    n = Number(s);
  }
  if (!isFinite(n)) throw appError_('VALIDATION', field + ' ต้องเป็นตัวเลข');
  if (o.integer && Math.floor(n) !== n) throw appError_('VALIDATION', field + ' ต้องเป็นจำนวนเต็ม');
  if (o.gt !== undefined && !(n > o.gt)) throw appError_('VALIDATION', field + ' ต้องมากกว่า ' + o.gt);
  if (o.min !== undefined && n < o.min) throw appError_('VALIDATION', field + ' ต้องไม่น้อยกว่า ' + o.min);
  if (o.max !== undefined && n > o.max) throw appError_('VALIDATION', field + ' ต้องไม่เกิน ' + o.max);
  return n;
}

function round_(n, digits) {
  const f = Math.pow(10, digits);
  return Math.round((n + Number.EPSILON) * f) / f;
}

function toBool_(v) {
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

function oneOf_(v, allowed, field) {
  const s = cleanText_(v);
  if (allowed.indexOf(s) === -1) throw appError_('VALIDATION', field + ' ไม่ถูกต้อง');
  return s;
}

function parseJson_(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  if (typeof text === 'object') return text;
  try { return JSON.parse(String(text)); } catch (e) { return fallback; }
}

/** Prevent formula injection for user text written into cells. */
function cellSafe_(v) {
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

/** Undo cellSafe_ prefix when reading back. */
function cellUnsafe_(v) {
  if (typeof v === 'string' && /^'[=+\-@]/.test(v)) return v.slice(1);
  return v;
}

// ---------------------------------------------------------------- Dates (Asia/Bangkok)

function fmtDate_(d, pattern) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CFG.TZ, pattern || 'yyyy-MM-dd');
}

function todayBkk_() {
  return fmtDate_(new Date(), 'yyyy-MM-dd');
}

/** Parse 'yyyy-MM-dd' explicitly (never new Date(ambiguousString)). Returns Date at 00:00 Bangkok. */
function parseYmd_(v, field, allowBlank) {
  if (v instanceof Date) return v;
  const s = cleanText_(v);
  if (!s) {
    if (allowBlank) return '';
    throw appError_('VALIDATION', 'กรุณากรอก ' + field);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw appError_('VALIDATION', field + ' ต้องอยู่ในรูปแบบ ปปปป-ดด-วว');
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  // 00:00 Asia/Bangkok = 17:00 UTC of the previous day
  const date = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0) - 7 * 3600 * 1000);
  if (fmtDate_(date) !== s) throw appError_('VALIDATION', field + ' ไม่ใช่วันที่ที่ถูกต้อง');
  return date;
}

function isoOrBlank_(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function hoursBetween_(a, b) {
  return (b.getTime() - a.getTime()) / 3600000;
}


// ============================================================================
// Db.gs
// ============================================================================
/**
 * File: Db.gs
 * Google Sheets as a database.
 *  - Columns are resolved by header name (SCHEMA in Config.gs is the contract).
 *  - Rows are located by their immutable key at write time, never by a cached row number.
 *  - Whole rows are written in one setValues() call.
 *  - Business data is never deleted (soft delete via is_deleted / status).
 *  - All writes run inside withLock_() (script-wide lock → no lost updates / duplicate numbers).
 */

let DB_SS_ = null;          // Spreadsheet handle for this execution
let TABLE_CACHE_ = {};      // tab → parsed table, valid only inside one execution
let LOCK_DEPTH_ = 0;        // allows nested withLock_ calls in the same execution

function db_() {
  if (DB_SS_) return DB_SS_;
  const id = PropertiesService.getScriptProperties().getProperty(CFG.PROP.DB_ID);
  if (!id) {
    throw appError_('NOT_CONFIGURED', 'ระบบยังไม่ได้ตั้งค่าฐานข้อมูล กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  }
  DB_SS_ = SpreadsheetApp.openById(id);
  return DB_SS_;
}

/** Point this execution at another spreadsheet (used by tests). */
function useDatabase_(ss) {
  DB_SS_ = ss;
  TABLE_CACHE_ = {};
}

function sheet_(tab) {
  const sh = db_().getSheetByName(tab);
  if (!sh) throw appError_('SCHEMA_DRIFT', 'ไม่พบแท็บ "' + tab + '" ในฐานข้อมูล กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  return sh;
}

function invalidate_(tab) {
  if (tab) delete TABLE_CACHE_[tab];
  else TABLE_CACHE_ = {};
}

/** Header row + name→index map; verifies every schema column exists. */
function headers_(tab) {
  const cached = TABLE_CACHE_[tab];
  if (cached) return cached;
  const sh = sheet_(tab);
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  const idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i; });
  const missing = SCHEMA[tab].cols.filter(function (c) { return idx[c] === undefined; });
  if (missing.length) {
    throw appError_('SCHEMA_DRIFT', 'แท็บ "' + tab + '" ขาดคอลัมน์: ' + missing.join(', ') + ' — กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  }
  const meta = { sheet: sh, headers: headers, idx: idx, rows: null };
  TABLE_CACHE_[tab] = meta;
  return meta;
}

/** All rows of a tab as objects (read once per execution, batched). Do not mutate the result. */
function rows_(tab) {
  const meta = headers_(tab);
  if (meta.rows) return meta.rows;
  const sh = meta.sheet;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) {
    meta.rows = [];
    return meta.rows;
  }
  const values = sh.getRange(2, 1, lastRow - 1, meta.headers.length).getValues();
  const keyCol = meta.idx[SCHEMA[tab].key];
  meta.rows = [];
  values.forEach(function (r, i) {
    if (r[keyCol] === '' || r[keyCol] === null) return;   // skip blank rows
    const o = { _row: i + 2 };
    meta.headers.forEach(function (h, c) { if (h) o[h] = cellUnsafe_(r[c]); });
    meta.rows.push(o);
  });
  return meta.rows;
}

function findOne_(tab, field, value) {
  const list = rows_(tab);
  for (let i = 0; i < list.length; i++) {
    if (String(list[i][field]) === String(value)) return list[i];
  }
  return null;
}

function findAll_(tab, field, value) {
  return rows_(tab).filter(function (r) { return String(r[field]) === String(value); });
}

function toCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return cellSafe_(v);
  return v;
}

/** Append objects as rows (one setValues call). Returns the objects. */
/** Tabs whose change makes cached ticket lists stale (see listTicketBoard). */
const BOARD_TABS_ = ['Tickets', 'TicketItems', 'Users', 'Departments', 'ProductGroups', 'Settings'];
let DATA_DIRTY_ = false;
function markDataChanged_(tab) {
  if (BOARD_TABS_.indexOf(tab) === -1) return;
  if (LOCK_DEPTH_ > 0) DATA_DIRTY_ = true;   // bumped once when the lock is released
  else bumpDataVersion_();
}
/** A new data version = every cached ticket list is ignored from now on. */
function bumpDataVersion_() {
  DATA_DIRTY_ = false;
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', String(Date.now()) + '-' + Math.floor(Math.random() * 1e6));
}
function dataVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '0';
}

function insertRows_(tab, objs) {
  if (!objs.length) return objs;
  markDataChanged_(tab);
  const meta = headers_(tab);
  const width = meta.headers.length;
  const data = objs.map(function (o) {
    const row = new Array(width).fill('');
    meta.headers.forEach(function (h, c) {
      if (h && Object.prototype.hasOwnProperty.call(o, h)) row[c] = toCell_(o[h]);
    });
    return row;
  });
  const sh = meta.sheet;
  sh.getRange(sh.getLastRow() + 1, 1, data.length, width).setValues(data);
  meta.rows = null;
  return objs;
}

function insertRow_(tab, obj) {
  insertRows_(tab, [obj]);
  return obj;
}

/**
 * Update one row located by its primary key (looked up fresh, not from cache).
 * Returns the merged row object.
 */
function updateRow_(tab, keyValue, patch) {
  markDataChanged_(tab);
  const meta = headers_(tab);
  const sh = meta.sheet;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');
  const keyCol = meta.idx[SCHEMA[tab].key] + 1;
  const keys = sh.getRange(2, keyCol, lastRow - 1, 1).getValues();
  let rowNo = -1;
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === String(keyValue)) { rowNo = i + 2; break; }
  }
  if (rowNo === -1) throw appError_('NOT_FOUND', 'ไม่พบข้อมูลที่ต้องการแก้ไข');

  const width = meta.headers.length;
  const current = sh.getRange(rowNo, 1, 1, width).getValues()[0];
  const merged = { _row: rowNo };
  meta.headers.forEach(function (h, c) { if (h) merged[h] = cellUnsafe_(current[c]); });
  Object.keys(patch).forEach(function (k) {
    if (meta.idx[k] === undefined) throw new Error('updateRow_: unknown column ' + tab + '.' + k);
    merged[k] = patch[k];
  });
  const out = meta.headers.map(function (h) { return h ? toCell_(merged[h]) : ''; });
  sh.getRange(rowNo, 1, 1, width).setValues([out]);
  meta.rows = null;
  return merged;
}

/**
 * Run fn while holding the script-wide lock. Cache is dropped on entry so that
 * every read inside the lock sees the latest committed data.
 */
function withLock_(fn) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CFG.LOCK_TIMEOUT_MS)) {
    throw appError_('BUSY', 'ระบบกำลังบันทึกรายการอื่นอยู่ กรุณาลองใหม่อีกครั้งในไม่กี่วินาที');
  }
  LOCK_DEPTH_++;
  try {
    invalidate_();
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    LOCK_DEPTH_--;
    invalidate_();
    if (DATA_DIRTY_) bumpDataVersion_();
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- Settings

function setting_(key, fallback) {
  const row = findOne_(TAB.SETTINGS, 'key', key);
  if (!row || row.value === '' || row.value === null) return fallback;
  return parseJson_(row.value, fallback);
}

function vatRate_() {
  const v = Number(setting_('vat_rate', 0.07));
  if (!isFinite(v) || v < 0 || v >= 1) throw appError_('INVALID_SETTING', 'ค่า vat_rate ในแท็บ Settings ไม่ถูกต้อง (ต้องอยู่ระหว่าง 0–1)');
  return v;
}

// ---------------------------------------------------------------- Counters

/** Next running number for a counter name. Must be called inside withLock_. */
function nextCounter_(name) {
  if (LOCK_DEPTH_ === 0) throw new Error('nextCounter_ must run inside withLock_');
  const row = findOne_(TAB.COUNTERS, 'name', name);
  if (!row) {
    insertRow_(TAB.COUNTERS, { name: name, last_no: 1, updated_at: new Date() });
    return 1;
  }
  const next = Number(row.last_no || 0) + 1;
  updateRow_(TAB.COUNTERS, name, { last_no: next, updated_at: new Date() });
  return next;
}


// ============================================================================
// Audit.gs
// ============================================================================
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


// ============================================================================
// Auth.gs
// ============================================================================
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
  return u.role === 'sales' && t.requestor_email === u.email &&
    (t.stage === 'pending_manager' || t.stage === 'returned');
}

/**
 * Vendor prices / winner / GP: the assigned SR while sourcing, and the reviewer of the current
 * approval step — SR Manager while "รอ SR Manager ตรวจราคา", GM while "รอ GM อนุมัติฝั่งซื้อ" —
 * so a reviewer can fix the price and approve, instead of sending it back to the SR.
 */
function canEditQuotes_(u, t) {
  if (u.role === 'sr') return t.sr_email === u.email && t.stage === 'sourcing';
  if (u.role === 'sr_manager') return t.stage === 'pending_sr_manager' && t.sr_email !== u.email;
  if (u.role === 'gm') return t.stage === 'pending_gm_price';
  return false;
}

function canEditChecklist_(u, t) {
  return u.role === 'sr' && t.sr_email === u.email && t.stage === 'doc_check';
}

function canUpload_(u, t) {
  if (u.role === 'sales' && t.requestor_email === u.email) {
    // until GM approves (pending_gm included: the Sales Manager step may be skipped right after submit)
    return ['pending_manager', 'returned', 'pending_gm', 'need_info'].indexOf(t.stage) !== -1;
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


// ============================================================================
// Pricing.gs
// ============================================================================
/**
 * File: Pricing.gs
 * VAT & FX normalisation so quotations with different terms can be compared fairly.
 *
 *   vat_term     net unit cost (what MGS really pays after VAT reclaim)   gross unit price (cash out)
 *   ex_vat       price                     (7% input VAT reclaimable)      price × (1 + vat)
 *   include_vat  price ÷ (1 + vat)                                         price
 *   no_vat       price                     (vendor not VAT registered)     price
 *   → both × fx_rate to THB.
 *
 * vat_rate is a snapshot stored on each quotation when it is first saved, so changing
 * the VAT rate in Settings never changes historical comparisons.
 *
 * Selling price (per unit, THB):
 *   landed cost   = net unit cost THB + clearance (ค่าเคลียร์ของ, THB per unit, entered per vendor)
 *   selling price = landed cost ÷ (1 − GP%)          GP% is a margin on the selling price
 *   profit        = selling price − landed cost
 * Vendors are ranked by landed cost, so a CIF import is compared fairly with a delivered local offer.
 */

function quoteCosts_(unitPrice, fxRate, vatTerm, vatRate, clearance) {
  const net = vatTerm === 'include_vat' ? unitPrice / (1 + vatRate) : unitPrice;
  const gross = vatTerm === 'ex_vat' ? unitPrice * (1 + vatRate) : unitPrice;
  return {
    net_unit_cost: round_(net, 6),
    net_unit_cost_thb: round_(net * fxRate, 6),
    gross_unit_price_thb: round_(gross * fxRate, 6),
    landed_unit_cost_thb: round_(net * fxRate + (clearance || 0), 6)
  };
}

/**
 * Landed-cost breakdown per unit (THB) → total import cost (stored as clearance_thb):
 *   CIF   = net unit cost THB + freight + insurance
 *   duty  = CIF × duty %
 *   total = freight + insurance + duty + import fees (อย. / กรมประมง) + cold storage + inland transport + other
 * bd: { freight, insurance, duty_pct, fees, cold, inland, other } — returns a copy with duty_thb + total_thb.
 */
const COST_PARTS_ = ['freight', 'insurance', 'fees', 'cold', 'inland', 'other'];
function costBreakdown_(netUnitCostThb, bd) {
  const out = {};
  COST_PARTS_.forEach(function (k) { out[k] = Number(bd[k]) || 0; });
  out.duty_pct = Number(bd.duty_pct) || 0;
  out.duty_thb = round_((netUnitCostThb + out.freight + out.insurance) * out.duty_pct / 100, 4);
  out.total_thb = round_(out.freight + out.insurance + out.duty_thb + out.fees + out.cold + out.inland + out.other, 4);
  return out;
}

function minGpPercent_() {
  const v = Number(setting_('min_gp_percent', 10));
  return isFinite(v) && v >= 0 && v < 100 ? v : 10;
}

function defaultGp_() {
  const v = Number(setting_('default_gp_percent', 15));
  return isFinite(v) && v >= 0 && v < 100 ? v : 15;
}

/** Selling price breakdown for one item from its winning quotation. */
function itemPricing_(it, winner) {
  const gp = it.gp_percent === null || it.gp_percent === undefined || it.gp_percent === '' ? defaultGp_() : Number(it.gp_percent);
  if (!winner) return { gp_percent: gp, gp_is_default: it.gp_percent === null || it.gp_percent === '' };
  const sell = round_(winner.landed_unit_cost_thb / (1 - gp / 100), 2);
  const out = {
    vendor_name: winner.vendor_name,
    product_cost_thb: round_(winner.net_unit_cost_thb, 2),
    clearance_thb: round_(winner.clearance_thb, 2),
    landed_cost_thb: round_(winner.landed_unit_cost_thb, 2),
    gp_percent: gp,
    gp_is_default: it.gp_percent === null || it.gp_percent === '',
    gp_below_min: gp < minGpPercent_(),
    min_gp_percent: minGpPercent_(),
    profit_thb: round_(sell - round_(winner.landed_unit_cost_thb, 2), 2),   // table rows add up: landed + profit = selling
    sell_price_thb: sell,
    target_price: it.target_price || 0,
    target_diff_pct: it.target_price ? round_((sell - it.target_price) / it.target_price * 100, 1) : null
  };
  return out;
}

/**
 * Sales-side view of the price: selling price per unit + the offer terms Sales needs to quote the customer.
 * Deliberately leaves out vendor name, vendor price, currency/FX, VAT, clearance, landed cost, GP and profit.
 */
function salesPricing_(it, winner) {
  if (!winner) return null;
  const p = itemPricing_(it, winner);
  return {
    sell_price_thb: p.sell_price_thb,
    target_price: p.target_price,
    target_diff_pct: p.target_diff_pct,
    brand: winner.brand || '', origin_country: winner.origin_country || '', packing: winner.packing || '',
    shelf_life: winner.shelf_life || '', moq: winner.moq, lead_time_days: winner.lead_time_days,
    valid_until: winner.valid_until || ''
  };
}

function normQuote_(r) {
  return {
    quote_id: String(r.quote_id),
    item_id: String(r.item_id),
    ticket_id: String(r.ticket_id),
    vendor_id: String(r.vendor_id || ''),
    vendor_name: String(r.vendor_name || ''),
    unit_price: Number(r.unit_price),
    currency: String(r.currency || 'THB'),
    fx_rate: Number(r.fx_rate || 1),
    vat_term: String(r.vat_term),
    vat_rate: Number(r.vat_rate),
    moq: r.moq === '' ? null : Number(r.moq),
    lead_time_days: r.lead_time_days === '' ? null : Number(r.lead_time_days),
    payment_term: String(r.payment_term || ''),
    valid_until: r.valid_until ? fmtDate_(r.valid_until) : '',
    remark: String(r.remark || ''),
    attachment_file_id: String(r.attachment_file_id || ''),
    is_selected: toBool_(r.is_selected),
    selection_reason: String(r.selection_reason || ''),
    net_unit_cost: Number(r.net_unit_cost),
    net_unit_cost_thb: Number(r.net_unit_cost_thb),
    gross_unit_price_thb: Number(r.gross_unit_price_thb),
    brand: String(r.brand || ''),
    origin_country: String(r.origin_country || ''),
    packing: String(r.packing || ''),
    incoterm: String(r.incoterm || ''),
    shelf_life: String(r.shelf_life || ''),
    clearance_thb: r.clearance_thb === '' || r.clearance_thb === undefined ? 0 : Number(r.clearance_thb),
    cost_breakdown: r.cost_breakdown_json ? parseJson_(r.cost_breakdown_json, null) : null,
    cost_breakdown_json: String(r.cost_breakdown_json || ''),
    fx_date: r.fx_date ? fmtDate_(r.fx_date) : '',
    landed_unit_cost_thb: r.landed_unit_cost_thb === '' || r.landed_unit_cost_thb === undefined
      ? Number(r.net_unit_cost_thb) + (r.clearance_thb === '' || r.clearance_thb === undefined ? 0 : Number(r.clearance_thb))
      : Number(r.landed_unit_cost_thb),
    created_by: String(r.created_by || ''),
    created_at: isoOrBlank_(r.created_at),
    updated_at: isoOrBlank_(r.updated_at)
  };
}

/** Active (not soft-deleted) quotations of one item. */
function activeQuotesOfItem_(itemId) {
  return findAll_(TAB.QUOTATIONS, 'item_id', itemId)
    .filter(function (r) { return !toBool_(r.is_deleted); })
    .map(normQuote_);
}

/**
 * Comparison view for one item: adds totals, rank and the "cheapest" flag
 * (ties are all cheapest). Equivalent of a SQL view, computed on the server.
 */
function compareQuotes_(qty, quotes) {
  const EPS = 0.000001;
  const min = quotes.reduce(function (m, q) { return Math.min(m, q.landed_unit_cost_thb); }, Infinity);
  const sorted = quotes.slice().sort(function (a, b) { return a.landed_unit_cost_thb - b.landed_unit_cost_thb; });
  return quotes.map(function (q) {
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].landed_unit_cost_thb < q.landed_unit_cost_thb - EPS) rank++;
    }
    const out = Object.assign({}, q);
    out.total_cost_thb = round_(q.net_unit_cost_thb * qty, 2);
    out.total_gross_thb = round_(q.gross_unit_price_thb * qty, 2);
    out.cost_rank = rank;
    out.is_cheapest = Math.abs(q.landed_unit_cost_thb - min) < EPS;
    return out;
  });
}


// ============================================================================
// Notify.gs
// ============================================================================
/**
 * File: Notify.gs
 * Notification queue. Business functions only INSERT rows into the Notifications tab
 * (inside the same lock as the business write). Delivery to Lark is done afterwards by
 * a dispatcher (Phase 2), so a Lark outage can never block or roll back an approval.
 */

/** Users who must act on the ticket in its current stage. */
function stageAssignees_(t) {
  switch (t.stage) {
    case 'pending_manager': {
      const d = departmentByCode_(t.department_code);
      return [(d && d.manager_email) || t.manager_email];
    }
    case 'returned':
    case 'need_info':
    case 'awaiting_sales_ack':
      return [t.requestor_email];
    case 'pending_gm':
      return activeUsersByRole_('gm').map(function (u) { return u.email; });
    case 'pending_assign':
      return activeUsersByRole_('sr').map(function (u) { return u.email; });
    case 'doc_check':
    case 'sourcing':
      return [t.sr_email];
    case 'pending_sr_manager':
      return activeUsersByRole_('sr_manager').map(function (u) { return u.email; });
    case 'pending_gm_price':
      return activeUsersByRole_('gm').map(function (u) { return u.email; });
    default:
      return [];
  }
}

/** Supervisors to escalate to when an SLA is breached. */
function stageEscalation_(t) {
  if (t.stage === 'pending_manager' || t.stage === 'pending_sr_manager') {
    return activeUsersByRole_('gm').map(function (u) { return u.email; });
  }
  if (['pending_assign', 'doc_check', 'sourcing'].indexOf(t.stage) !== -1) {
    return activeUsersByRole_('sr_manager').map(function (u) { return u.email; });
  }
  if (['returned', 'need_info', 'awaiting_sales_ack'].indexOf(t.stage) !== -1) {
    const d = departmentByCode_(t.department_code);
    return d && d.manager_email ? [d.manager_email] : [];
  }
  return [];
}

/** Queue in-app (+ Lark) notifications. Skips blanks, duplicates, inactive users and the actor. */
function enqueueNotifications_(emails, t, type, title, body, link) {
  const actor = safeEmail_();
  const seen = {};
  const rowsToInsert = [];
  const now = new Date();
  (emails || []).forEach(function (raw) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || seen[email] || email === actor) return;
    seen[email] = true;
    const u = userByEmail_(email);
    if (!u || !u.is_active) return;
    rowsToInsert.push({
      notif_id: uuid_(),
      user_email: email,
      ticket_id: t ? t.ticket_id : '',
      type: type,
      title: title,
      body: body || '',
      link: link || '',
      is_read: false,
      read_at: '',
      created_at: now,
      lark_status: 'pending',
      lark_attempts: 0,
      lark_error: '',
      lark_sent_at: ''
    });
  });
  insertRows_(TAB.NOTIFICATIONS, rowsToInsert);
  return rowsToInsert.length;
}

/** Web-app deep link to a ticket page (deployed /exec URL, or Script Property WEBAPP_URL). */
function ticketLink_(t, page) {
  let base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
  if (!base) {
    try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; }
  }
  return base + '?page=' + (page || 'ticket') + '&id=' + encodeURIComponent(t.ticket_id);
}

/** Pseudo-recipient for the Lark group that is told when a price is finished (GM approved). */
const PRICE_GROUP_KEY_ = '#price_group';
/** Pseudo-recipient for the management Lark group (SR / SR Manager / GM — purchasing-side approvals). */
const MGMT_GROUP_KEY_ = '#mgmt_group';

/**
 * Group messages now go to ONE Lark group ("Food Price Request") through the custom bot "FPR Bot" — see Bots.gs.
 * RULE (unchanged): a group card NEVER carries a price, cost, vendor name or GP; free-text comments only for
 * sales-side decisions (request rejected / returned / cancelled), never for price reviews.
 */

/** transition → { event, extra } for the FPR Bot (null = no card). */
function groupEventOfTransition_(action, saved, note, meta) {
  const sales = [saved.requestor_email];
  const sr = [saved.sr_email];
  switch (action) {
    case 'resubmit':
    case 'manager_approve': return saved.stage === 'pending_gm' ? { event: 'submitted', extra: {} } : null;
    case 'gm_approve': return { event: saved.stage === 'doc_check' ? 'assigned' : 'queued', extra: {} };
    case 'claim':
    case 'assign': return { event: 'assigned', extra: {} };
    case 'queue_return':
    case 'request_info': return { event: 'need_info', extra: { lines: meta && meta.missing_items && meta.missing_items.length ? ['**ข้อมูลที่ต้องเพิ่ม:** ' + meta.missing_items.join(', ')] : [] } };
    case 'submit_quote': return { event: 'sm_review', extra: { lines: reviewFacts_(saved) } };
    case 'srm_approve': return { event: 'gm_final', extra: { lines: reviewFacts_(saved) } };
    case 'gm_price_approve': return { event: 'approved', extra: { lines: ['ราคาขายส่งถึงผู้ขอในระบบแล้ว · ผู้ขอกด “รับทราบราคา” หรือ “ขอปรับราคา” ได้ในหน้ารายการ'] } };
    case 'srm_return':
    case 'gm_price_return': return { event: 'returned', extra: { fixer: sr, lines: ['ตีกลับให้ Sourcing แก้ราคา — ดูเหตุผลในระบบ'] } };
    case 'gm_return':
    case 'manager_return': return { event: 'returned', extra: { fixer: sales, reason: note, lines: ['ตีกลับให้ผู้ขอแก้ไขคำขอ แล้วส่งใหม่'] } };
    case 'manager_reject':
    case 'gm_reject': return { event: 'rejected', extra: { reason: note } };
    case 'srm_reject':
    case 'gm_price_reject': return { event: 'rejected', extra: { lines: ['ปฏิเสธในขั้นอนุมัติราคา — ดูเหตุผลในระบบ'] } };
    case 'cancel':
    case 'admin_cancel': return { event: 'cancelled', extra: { reason: note } };
    case 'request_revision': return { event: 'revision', extra: { lines: ['ผู้ขอขอให้ปรับราคา — ดูรายละเอียดในระบบ'] } };
    default: return null;
  }
}

function fmtQty_(n) {
  const v = Number(n);
  return isFinite(v) ? String(Math.round(v * 100) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '-';
}

/** Queue one FPR Bot card (sent after the request commits). Kept for callers: deal_won, follow_up, submitted … */
function enqueueGroupEvent_(event, t, extra) {
  return queueFprCard_(event, t, extra || {});
}

/** Facts for the management group when a price goes to review: how many offers / photos (never vendor names or prices). */
function reviewFacts_(t) {
  const items = activeItemsOf_(t.ticket_id).filter(function (it) { return !it.quote_status; });
  let offers = 0;
  let photos = 0;
  items.forEach(function (it) {
    activeQuotesOfItem_(it.item_id).forEach(function (q) { offers++; photos += quotePhotos_(q.quote_id).length; });
  });
  return ['Supplier ที่เสนอ: ' + offers + ' ราย · รูปสินค้า ' + photos + ' รูป — เปิดในระบบเพื่อดูราคาและรูปก่อนอนุมัติ'];
}

/**
 * Selling price lines of ONE ticket (winning offer only) — for the requesting Sales' own DM.
 * Never contains vendor, cost, clearance or GP.
 */
function sellPriceLines_(t) {
  return activeItemsOf_(t.ticket_id).map(function (it) {
    if (it.quote_status) return itemStatusLine_(it);
    const win = compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)).filter(function (q) { return q.is_selected; })[0];
    const sp = salesPricing_(it, win);
    const spec = [it.size, it.packing_size].filter(Boolean).join(' · ');
    return '**#' + it.line_no + ' ' + it.product_name + '**' + (spec ? ' (' + spec + ')' : '') + '\n' +
      'ราคาขาย **' + (sp ? money2_(sp.sell_price_thb) : '-') + ' บาท/' + it.uom + '**' +
      (sp && sp.valid_until ? ' · ยืนราคาถึง ' + sp.valid_until : '');
  });
}

/** "Price approved" group card — status only, NO prices. */
function enqueuePriceDoneGroup_(t) {
  return queueFprCard_('approved', t, {});
}

/** 1234.5 → "1,234.50" (Lark message text). */
function money2_(n) {
  const v = Number(n);
  if (!isFinite(v)) return '-';
  const parts = v.toFixed(2).split('.');
  return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}

/** "#2 ปลาซาบะ — ไม่เสนอ (เหตุผล)" / "— ส่งราคาตามหลัง (PR-2026-0012)" */
function itemStatusLine_(it) {
  if (it.quote_status === 'follow_up') {
    const fu = it.follow_up_ticket_id ? ticketById_(it.follow_up_ticket_id) : null;
    return '**#' + it.line_no + ' ' + it.product_name + '** — ส่งราคาตามหลัง' + (fu ? ' (' + fu.ticket_no + ')' : '');
  }
  return '**#' + it.line_no + ' ' + it.product_name + '** — ไม่เสนอราคา' + (it.quote_status_reason ? ' (' + it.quote_status_reason + ')' : '');
}


// ============================================================================
// Workflow.gs
// ============================================================================
/**
 * File: Workflow.gs
 * Ticket creation and the state machine.
 *
 * transitionTicket() is the ONLY function that changes status / stage / assignee.
 * No other code path writes those columns, and staff have no access to the sheet.
 *
 * Actions (role → from stage → to stage):
 *   create            sales            —                                     → pending_manager, or pending_gm when the
 *                                                                               department has no Sales Manager (step skipped)
 *   resubmit          sales (owner)    returned                              → pending_manager | pending_gm (same rule)
 *   cancel            sales (owner)    pending_manager | returned | pending_gm → cancelled
 *   manager_approve   manager (dept)   pending_manager                       → pending_gm
 *   manager_reject    manager (dept)   pending_manager                       → rejected     (comment required)
 *   manager_return    manager (dept)   pending_manager                       → returned     (comment required)
 *   gm_approve        gm               pending_gm                            → pending_assign
 *   gm_reject         gm               pending_gm                            → rejected     (comment required)
 *   claim             sr               pending_assign                        → doc_check
 *   assign            sr_manager|admin pending_assign | doc_check | need_info | sourcing → doc_check | same
 *   request_info      sr (assigned)    doc_check | sourcing                  → need_info    (comment required)
 *   respond_info      sales (owner)    need_info                             → stage SR asked from (comment required)
 *   doc_complete      sr (assigned)    doc_check                             → sourcing (required checklist ticked)
 *   submit_quote      sr (assigned)    sourcing                              → pending_sr_manager
 *   srm_approve       sr_manager       pending_sr_manager                    → pending_gm_price
 *   srm_return        sr_manager       pending_sr_manager                    → sourcing     (comment required)
 *   gm_price_approve  gm               pending_gm_price                      → awaiting_sales_ack
 *   gm_price_return   gm               pending_gm_price                      → sourcing     (comment required)
 *   (price approval SR → SR Manager → GM is never skipped)
 *   accept            sales (owner)    awaiting_sales_ack                    → closed
 *   request_revision  sales (owner)    awaiting_sales_ack                    → sourcing     (comment required)
 */

const TRANSITION_ACTIONS = ['resubmit', 'cancel', 'manager_approve', 'manager_reject', 'manager_return',
  'gm_approve', 'gm_reject', 'claim', 'queue_return', 'assign', 'request_info', 'respond_info', 'doc_complete',
  'submit_quote', 'srm_approve', 'srm_return', 'gm_price_approve', 'gm_price_return', 'accept', 'request_revision',
  'gm_price_reject', 'admin_cancel', 'srm_reject', 'gm_return'];

const ACTION_LABEL_TH = {
  create: 'สร้างใบขอราคา', resubmit: 'ส่งใบขอราคาอีกครั้ง', cancel: 'ยกเลิกใบขอราคา',
  manager_approve: 'Sales Manager อนุมัติ', manager_reject: 'Sales Manager ไม่อนุมัติ', manager_return: 'Sales Manager ส่งกลับแก้ไข',
  deal_update: 'อัปเดตผลการขาย', gm_price_reject: 'GM ปฏิเสธราคา', srm_reject: 'SR Manager ปฏิเสธ', gm_return: 'GM ตีกลับให้ผู้ขอแก้ไข', admin_cancel: 'ผู้ดูแลระบบยกเลิกใบ', gm_approve: 'GM อนุมัติฝั่งขาย (คำขอราคา)', gm_reject: 'GM ไม่อนุมัติฝั่งขาย', claim: 'SR รับงาน', queue_return: 'SR ตีกลับ — ข้อมูลไม่ครบ', assign: 'มอบหมายงาน SR',
  request_info: 'SR ขอข้อมูลเพิ่ม', respond_info: 'Sales ส่งข้อมูลเพิ่ม', doc_complete: 'SR ตรวจเอกสารครบ',
  submit_quote: 'SR ส่งราคาให้ SR Manager ตรวจ', srm_approve: 'SR Manager อนุมัติราคา', srm_return: 'SR Manager ส่งกลับให้แก้ราคา',
  gm_price_approve: 'GM อนุมัติฝั่งซื้อ (ราคา → ส่งถึง Sales)', gm_price_return: 'GM ฝั่งซื้อ ส่งกลับให้แก้ราคา', accept: 'Sales รับทราบราคา / ปิดงาน', request_revision: 'Sales ขอให้ปรับราคา',
  // data changes (not status changes)
  ticket_updated: 'แก้ไขข้อมูลใบขอราคา', item_added: 'เพิ่มรายการสินค้า', item_updated: 'แก้ไขรายการสินค้า', item_deleted: 'ลบรายการสินค้า',
  checklist_updated: 'ตรวจเอกสาร', quotation_added: 'เพิ่มราคา vendor', quotation_updated: 'แก้ไขราคา vendor',
  quotation_deleted: 'ลบราคา vendor', quotation_selected: 'เลือกผู้ชนะ', pricing_updated: 'กำหนด GP %', item_not_offered: 'SR ตั้งรายการเป็น “ไม่เสนอราคา”', item_follow_up: 'SR แยกรายการไปส่งราคาตามหลัง', item_quote_restored: 'SR กลับมาเสนอราคารายการ', attachment_added: 'แนบไฟล์', attachment_removed: 'ลบไฟล์แนบ'
};

// =============================================================================
// createTicket — public API
// Food request form.
// payload: { client_key, customer_name, due_date (yyyy-MM-dd), documents_needed?, description? (= remark), priority?, title? (auto),
//            items: [{ item_id?, product_name, net_weight, size, packing_size, qty (per month), uom,
//                      target_price (THB/kg, 0 = none), product_group_code? (default FOOD), spec? }] }
// =============================================================================
function createTicket(payload) {
  return api_('createTicket', function () {
    const p = payload || {};
    return withLock_(function () {
      const u = currentUser_();
      requireRole_(u, ['sales'], 'เฉพาะ Sales เท่านั้นที่สร้างใบขอราคาได้');

      const clientKey = cleanText_(p.client_key, 64);
      if (clientKey) {
        const dup = rows_(TAB.TICKETS).filter(function (r) {
          return String(r.client_key) === clientKey && String(r.requestor_email).toLowerCase() === u.email;
        })[0];
        if (dup) return { ticket: publicTicket_(normTicket_(dup)), duplicate: true };
      }

      if (!u.department_code) {
        throw appError_('NO_DEPARTMENT', 'บัญชีของคุณยังไม่ได้ผูกกับแผนก กรุณาติดต่อผู้ดูแลระบบ');
      }
      const dept = departmentByCode_(u.department_code);
      if (!dept || !dept.is_active) {
        throw appError_('NO_DEPARTMENT', 'แผนกของคุณไม่ถูกต้องหรือถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
      }
      const firstStage = firstApprovalStage_(dept);

      const customer = requireText_(p.customer_name, 'ชื่อลูกค้า (Customer)', 200);
      const market = cleanMarket_(p.customer_group, p.destination_country);
      const priority = p.priority ? oneOf_(p.priority, PRIORITIES, 'ความเร่งด่วน') : 'normal';
      const dueDate = parseYmd_(p.due_date, 'วันที่ต้องการให้ตอบกลับราคา (Expected Date)');
      if (fmtDate_(dueDate) < todayBkk_()) throw appError_('VALIDATION', 'วันที่ต้องการให้ตอบกลับราคา ต้องไม่เป็นวันที่ผ่านมาแล้ว');

      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length) throw appError_('NO_ITEMS', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
      if (items.length > CFG.MAX_ITEMS_PER_TICKET) {
        throw appError_('TOO_MANY_ITEMS', 'ใบขอราคา 1 ใบมีได้ไม่เกิน ' + CFG.MAX_ITEMS_PER_TICKET + ' รายการ');
      }
      const groups = activeGroupMap_();
      const now = new Date();
      const ticketId = uuid_();
      const cleanItems = items.map(function (raw, i) {
        const it = validateItem_(raw, groups, i + 1);
        it.item_id = isUuid_(raw && raw.item_id) && !findOne_(TAB.ITEMS, 'item_id', raw.item_id) ? String(raw.item_id) : uuid_();
        it.ticket_id = ticketId;
        it.line_no = i + 1;
        it.is_deleted = false;
        it.created_at = now;
        it.updated_at = now;
        return it;
      });

      const title = cleanText_(p.title, 200) || autoTitle_(customer, cleanItems);
      const ticket = {
        ticket_id: ticketId,
        ticket_no: nextTicketNo_(now),
        title: title,
        description: cleanText_(p.description, CFG.MAX_TEXT),
        customer_name: customer,
        documents_needed: cleanText_(p.documents_needed, CFG.MAX_TEXT),
        customer_group: market.customer_group,
        destination_country: market.destination_country,
        priority: priority,
        status: 'requested',
        stage: firstStage,
        requestor_email: u.email,
        department_code: dept.code,
        manager_email: dept.manager_email,
        gm_email: '', sr_email: '',
        due_date: dueDate,
        revision_count: 0,
        version: 1,
        info_request_json: '',
        rejection_reason: '',
        stage_entered_at: now,
        submitted_at: now,
        manager_approved_at: '', gm_approved_at: '', assigned_at: '', doc_checked_at: '',
        completed_at: '', closed_at: '', rejected_at: '', cancelled_at: '',
        client_key: clientKey,
        created_at: now,
        updated_at: now
      };

      insertRow_(TAB.TICKETS, ticket);
      insertRows_(TAB.ITEMS, cleanItems);
      appendLog_({
        ticket_id: ticketId, log_type: 'transition', action: 'create',
        actor_email: u.email, actor_role: u.role,
        to_status: 'requested', to_stage: firstStage,
        metadata: { ticket_no: ticket.ticket_no, item_count: cleanItems.length,
          sales_manager_skipped: firstStage === 'pending_gm' }
      });

      const t = normTicket_(ticket);
      enqueueNotifications_(stageAssignees_(t), t, 'approval_required',
        '[' + t.ticket_no + '] ใบขอราคาใหม่รออนุมัติ', t.title + ' — ' + u.full_name, ticketLink_(t));
      if (t.stage === 'pending_gm') queueFprCard_('submitted', t, {});
      return { ticket: publicTicket_(t), duplicate: false };
    });
  });
}

// =============================================================================
// transitionTicket — public API, the only way to change status / stage / assignee
// payload: { expected_version (required), sr_email? (assign), missing_items? (request_info) }
// =============================================================================
function transitionTicket(ticketId, action, comment, payload) {
  return api_('transitionTicket', function () {
    return withLock_(function () {
      return doTransition_(ticketId, action, comment, payload || {});
    });
  });
}

function doTransition_(ticketId, action, comment, payload) {
  const u = currentUser_();
  const t = ticketForUser_(u, ticketId);
  requireVersion_(t, payload.expected_version);
  const note = cleanText_(comment, CFG.MAX_COMMENT);
  if (TRANSITION_ACTIONS.indexOf(action) === -1) {
    throw appError_('INVALID_ACTION', 'ไม่รู้จักคำสั่ง "' + cleanText_(action, 50) + '"');
  }

  const now = new Date();
  const patch = {};
  let meta = {};
  let notifyType = 'status_changed';
  let extraRecipients = [];

  function forbid(msg) { throw appError_('FORBIDDEN', msg); }
  function badState(msg) {
    throw appError_('INVALID_STATE', msg || ('ทำรายการไม่ได้ในสถานะ "' + STAGE_LABEL_TH[t.stage] + '"'));
  }
  function needComment(msg) { if (!note) throw appError_('COMMENT_REQUIRED', msg); }
  function isOwner() { return u.role === 'sales' && t.requestor_email === u.email; }
  function isAssignedSr() { return u.role === 'sr' && t.sr_email === u.email; }

  switch (action) {
    // ------------------------------------------------------------ Sales
    case 'resubmit': {
      if (!isOwner()) forbid('เฉพาะ Sales เจ้าของใบเท่านั้นที่ส่งใบขอราคาใหม่ได้');
      if (t.stage !== 'returned') badState();
      if (!activeItemsOf_(t.ticket_id).length) throw appError_('NO_ITEMS', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
      const d = departmentByCode_(t.department_code);
      patch.manager_email = d ? d.manager_email : '';
      patch.stage = firstApprovalStage_(d);
      meta = { sales_manager_skipped: patch.stage === 'pending_gm' };
      patch.submitted_at = now;
      notifyType = 'approval_required';
      break;
    }
    case 'cancel': {
      if (!isOwner()) forbid('เฉพาะ Sales เจ้าของใบเท่านั้นที่ยกเลิกได้');
      if (['pending_manager', 'returned', 'pending_gm'].indexOf(t.stage) === -1) {
        badState('ยกเลิกได้เฉพาะก่อน GM อนุมัติเท่านั้น');
      }
      extraRecipients = stageAssignees_(t);
      patch.stage = 'cancelled';
      patch.cancelled_at = now;
      patch.rejection_reason = note;
      break;
    }
    // ------------------------------------------------------------ Manager
    case 'manager_approve':
    case 'manager_reject':
    case 'manager_return': {
      if (u.role !== 'manager') forbid('เฉพาะ Sales Manager เท่านั้นที่ทำรายการนี้ได้');
      const d = departmentByCode_(t.department_code);
      if (!d || d.manager_email !== u.email) forbid('คุณไม่ใช่ Sales Manager ของแผนกผู้ขอราคา');
      if (t.requestor_email === u.email) throw appError_('SELF_APPROVAL', 'ไม่สามารถอนุมัติใบขอราคาของตัวเองได้');
      if (t.stage !== 'pending_manager') badState();
      patch.manager_email = u.email;
      if (action === 'manager_approve') {
        patch.stage = 'pending_gm';
        patch.manager_approved_at = now;
        notifyType = 'approval_required';
      } else if (action === 'manager_reject') {
        needComment('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
        patch.stage = 'rejected';
        patch.rejected_at = now;
        patch.rejection_reason = note;
      } else {
        needComment('กรุณาระบุสิ่งที่ต้องการให้ Sales แก้ไข');
        patch.stage = 'returned';
      }
      break;
    }
    // ------------------------------------------------------------ GM
    case 'gm_approve':
    case 'gm_reject': {
      if (u.role !== 'gm') forbid('เฉพาะ GM เท่านั้นที่ทำรายการนี้ได้');
      if (t.requestor_email === u.email || t.manager_email === u.email) {
        throw appError_('SELF_APPROVAL', 'ไม่สามารถอนุมัติซ้ำหรืออนุมัติใบของตัวเองได้');
      }
      if (t.stage !== 'pending_gm') badState();
      patch.gm_email = u.email;
      if (action === 'gm_approve') {
        patch.gm_approved_at = now;
        if (toBool_(setting_('gm_assigns_sr', true))) {
          // FPR: GM picks the Sourcing person who prices it → straight to ASSIGNED (document check + pricing)
          const target = userByEmail_(payload.sr_email);
          if (!target || !target.is_active || target.role !== 'sr') {
            throw appError_('INVALID_ASSIGNEE', 'กรุณาเลือก Sourcing ผู้ทำราคา (ต้องเป็น SR ที่ใช้งานอยู่)');
          }
          patch.sr_email = target.email;
          patch.stage = 'doc_check';
          patch.assigned_at = now;
          patch.pricing_started_at = now;
          meta = { assigned_to: target.email };
          extraRecipients = [target.email];
          notifyType = 'job_assigned';
        } else {
          patch.stage = 'pending_assign';
          notifyType = 'job_available';
        }
      } else {
        needComment('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
        patch.stage = 'rejected';
        patch.rejected_at = now;
        patch.rejection_reason = note;
      }
      break;
    }
    // ------------------------------------------------------------ SR
    case 'claim': {
      if (u.role !== 'sr') forbid('เฉพาะ SR เท่านั้นที่รับงานได้');
      if (t.stage !== 'pending_assign') throw appError_('ALREADY_CLAIMED', 'งานนี้ถูกรับไปแล้วหรือไม่อยู่ในคิวรอรับงาน');
      patch.sr_email = u.email;
      patch.stage = 'doc_check';
      patch.assigned_at = now;
      patch.pricing_started_at = now;
      break;
    }
    case 'queue_return': {
      // SR looks at a new job and finds the request incomplete → back to Sales; the answer returns it to the queue
      if (u.role !== 'sr' && u.role !== 'sr_manager') forbid('เฉพาะ SR / SR Manager เท่านั้นที่ตีกลับงานในคิวได้');
      if (t.stage !== 'pending_assign') badState('ตีกลับได้เฉพาะงานที่ยังอยู่ในคิวรอรับงาน');
      needComment('กรุณาระบุว่าข้อมูลส่วนไหนไม่ครบ');
      const missing = Array.isArray(payload.missing_items)
        ? payload.missing_items.map(function (x) { return cleanText_(x, 200); }).filter(String).slice(0, 50)
        : [];
      patch.info_request_json = JSON.stringify({
        items: missing, comment: note, requested_by: u.email,
        requested_at: now.toISOString(), return_stage: 'pending_assign'
      });
      patch.stage = 'need_info';
      notifyType = 'info_requested';
      meta = { missing_items: missing, from_queue: true };
      break;
    }
    case 'assign': {
      if (!(u.role === 'admin' || u.role === 'sr_manager')) {
        forbid('เฉพาะ SR Manager หรือ Admin เท่านั้นที่มอบหมายงานได้');
      }
      if (['pending_assign', 'doc_check', 'need_info', 'sourcing'].indexOf(t.stage) === -1) badState();
      const target = userByEmail_(payload.sr_email);
      if (!target || !target.is_active || target.role !== 'sr') {
        throw appError_('INVALID_ASSIGNEE', 'ผู้รับงานต้องเป็น SR ที่ใช้งานอยู่');
      }
      if (target.email === t.sr_email) throw appError_('SAME_ASSIGNEE', 'งานนี้มอบหมายให้ SR คนนี้อยู่แล้ว');
      meta = { from_sr: t.sr_email, to_sr: target.email };
      extraRecipients = [target.email, t.sr_email];
      notifyType = 'job_assigned';
      patch.sr_email = target.email;
      patch.assigned_at = now;
      patch.pricing_started_at = now;
      if (t.stage === 'pending_assign') patch.stage = 'doc_check';
      break;
    }
    case 'request_info': {
      if (!isAssignedSr()) forbid('เฉพาะ SR ผู้รับงานเท่านั้นที่ขอข้อมูลเพิ่มได้');
      if (t.stage !== 'doc_check' && t.stage !== 'sourcing') badState();
      needComment('กรุณาระบุข้อมูล/เอกสารที่ต้องการเพิ่ม');
      const missing = Array.isArray(payload.missing_items)
        ? payload.missing_items.map(function (x) { return cleanText_(x, 200); }).filter(String).slice(0, 50)
        : [];
      patch.info_request_json = JSON.stringify({
        items: missing, comment: note, requested_by: u.email,
        requested_at: now.toISOString(), return_stage: t.stage
      });
      patch.stage = 'need_info';
      notifyType = 'info_requested';
      meta = { missing_items: missing };
      break;
    }
    case 'respond_info': {
      if (!isOwner()) forbid('เฉพาะ Sales เจ้าของใบเท่านั้นที่ตอบกลับได้');
      if (t.stage !== 'need_info') badState('ใบนี้ไม่ได้อยู่ในสถานะรอข้อมูลเพิ่ม');
      needComment('กรุณาระบุคำตอบหรือรายละเอียดที่ส่งเพิ่ม');
      const rs = t.info_request && t.info_request.return_stage;
      const back = rs === 'sourcing' || rs === 'pending_assign' ? rs : 'doc_check';
      meta = { info_request: t.info_request };
      patch.stage = back;
      patch.info_request_json = '';
      notifyType = 'info_provided';
      break;
    }
    case 'doc_complete': {
      if (!isAssignedSr()) forbid('เฉพาะ SR ผู้รับงานเท่านั้นที่ยืนยันเอกสารได้');
      if (t.stage !== 'doc_check') badState();
      const missing = checklistOf_(t.ticket_id).filter(function (c) { return c.is_required && !c.is_checked; });
      if (missing.length) {
        throw appError_('CHECKLIST_INCOMPLETE', 'ยังตรวจเอกสารไม่ครบ: ' + missing.map(function (c) { return c.label; }).join(', '),
          { missing: missing.map(function (c) { return c.check_id; }) });
      }
      patch.stage = 'sourcing';
      patch.doc_checked_at = now;
      break;
    }
    case 'submit_quote': {
      if (!isAssignedSr()) forbid('เฉพาะ SR ผู้รับงานเท่านั้นที่ส่งราคาได้');
      if (t.stage !== 'sourcing') badState();
      meta = validateQuotesForSubmit_(t);
      // record the effective GP % and selling price per unit that this submission proposes
      meta.winners.forEach(function (w) {
        updateRow_(TAB.ITEMS, w.item_id, { gp_percent: w.gp_percent, sell_price_thb: w.sell_price_thb, updated_at: now });
      });
      patch.stage = 'pending_sr_manager';
      patch.quote_submitted_at = now;
      notifyType = 'approval_required';
      break;
    }
    // ------------------------------------------------------------ Price approval: SR Manager → GM (no skipping)
    case 'srm_approve':
    case 'srm_return': {
      if (u.role !== 'sr_manager') forbid('เฉพาะ SR Manager เท่านั้นที่ตรวจราคาได้');
      if (t.sr_email === u.email) throw appError_('SELF_APPROVAL', 'ไม่สามารถอนุมัติราคาที่ตัวเองเป็นผู้หาได้');
      if (t.stage !== 'pending_sr_manager') badState();
      if (action === 'srm_approve') {
        meta = validateQuotesForSubmit_(t);
        reviewerEdits_(u, t, meta, now, extraRecipients);
        patch.stage = 'pending_gm_price';
        patch.sr_manager_email = u.email;
        patch.sr_manager_approved_at = now;
        notifyType = 'approval_required';
      } else {
        needComment('กรุณาระบุสิ่งที่ต้องการให้ SR แก้ไขราคา');
        patch.stage = 'sourcing';
        patch.pricing_started_at = now;
        notifyType = 'price_returned';
      }
      break;
    }
    case 'srm_reject': {
      // FPR: Sourcing Manager may end the request at the price review (reason required)
      if (u.role !== 'sr_manager') forbid('เฉพาะ SR Manager เท่านั้นที่ปฏิเสธได้');
      if (t.sr_email === u.email) throw appError_('SELF_APPROVAL', 'ไม่สามารถตัดสินราคาที่ตัวเองเป็นผู้หาได้');
      if (t.stage !== 'pending_sr_manager') badState();
      needComment('กรุณาระบุเหตุผลที่ปฏิเสธ');
      patch.stage = 'rejected';
      patch.rejected_at = now;
      patch.rejection_reason = note;
      extraRecipients = [t.requestor_email, t.sr_email];
      break;
    }
    case 'gm_return': {
      // FPR GM_REVIEW: send the request back to the requester to fix (resubmit → GM again)
      if (u.role !== 'gm') forbid('เฉพาะ GM เท่านั้นที่ตีกลับคำขอได้');
      if (t.stage !== 'pending_gm') badState();
      needComment('กรุณาระบุสิ่งที่ต้องการให้ผู้ขอแก้ไข');
      patch.gm_email = u.email;
      patch.stage = 'returned';
      break;
    }
    case 'gm_price_reject': {
      // FPR: GM may end the request at the final price review (reason required)
      if (u.role !== 'gm') forbid('เฉพาะ GM เท่านั้นที่ปฏิเสธราคาได้');
      if (t.stage !== 'pending_gm_price') badState();
      needComment('กรุณาระบุเหตุผลที่ปฏิเสธ');
      patch.stage = 'rejected';
      patch.rejected_at = now;
      patch.rejection_reason = note;
      extraRecipients = [t.requestor_email, t.sr_email];
      break;
    }
    case 'admin_cancel': {
      if (u.role !== 'admin') forbid('เฉพาะผู้ดูแลระบบเท่านั้น');
      if (OPEN_STATUSES.indexOf(t.status) === -1) badState('ใบนี้ปิดไปแล้ว');
      needComment('กรุณาระบุเหตุผลที่ยกเลิก');
      patch.stage = 'cancelled';
      patch.cancelled_at = now;
      patch.rejection_reason = note;
      extraRecipients = [t.requestor_email, t.sr_email];
      break;
    }
    case 'gm_price_approve':
    case 'gm_price_return': {
      if (u.role !== 'gm') forbid('เฉพาะ GM เท่านั้นที่อนุมัติราคาได้');
      if (t.stage !== 'pending_gm_price') badState();
      if (action === 'gm_price_approve') {
        meta = validateQuotesForSubmit_(t);
        reviewerEdits_(u, t, meta, now, extraRecipients);
        patch.stage = 'awaiting_sales_ack';
        patch.gm_price_approved_at = now;
        patch.completed_at = now;
        notifyType = 'quote_ready';
        extraRecipients.push(t.sr_email);
      } else {
        needComment('กรุณาระบุสิ่งที่ต้องการให้ SR แก้ไขราคา');
        patch.stage = 'sourcing';
        notifyType = 'price_returned';
      }
      break;
    }
    // ------------------------------------------------------------ Sales acknowledgement
    case 'accept': {
      if (!isOwner()) forbid('เฉพาะ Sales เจ้าของใบเท่านั้นที่รับทราบราคาได้');
      if (t.stage !== 'awaiting_sales_ack') badState('ใบนี้ไม่ได้อยู่ในสถานะรอรับทราบราคา');
      extraRecipients = [t.sr_email];
      patch.stage = 'closed';
      patch.closed_at = now;
      break;
    }
    case 'request_revision': {
      if (!isOwner()) forbid('เฉพาะ Sales เจ้าของใบเท่านั้นที่ขอแก้ไขราคาได้');
      if (t.stage !== 'awaiting_sales_ack') badState('ใบนี้ไม่ได้อยู่ในสถานะรอรับทราบราคา');
      needComment('กรุณาระบุสิ่งที่ต้องการให้ SR ปรับราคา');
      patch.stage = 'sourcing';
      patch.revision_count = t.revision_count + 1;
      notifyType = 'revision_requested';
      meta = { revision_no: t.revision_count + 1 };
      break;
    }
  }

  const newStage = patch.stage || t.stage;
  patch.status = STAGE_STATUS[newStage];
  const stageChanged = newStage !== t.stage;
  if (stageChanged) patch.stage_entered_at = now;
  patch.version = t.version + 1;
  patch.updated_at = now;

  const saved = normTicket_(updateRow_(TAB.TICKETS, t.ticket_id, patch));

  if ((t.stage === 'pending_assign' || t.stage === 'pending_gm') && saved.stage === 'doc_check') {
    generateChecklist_(saved.ticket_id);
  }

  appendLog_({
    ticket_id: t.ticket_id, log_type: 'transition', action: action,
    actor_email: u.email, actor_role: u.role,
    from_status: t.status, to_status: saved.status,
    from_stage: t.stage, to_stage: saved.stage,
    comment: note, metadata: meta,
    stage_duration_sec: stageChanged && t.stage_entered_at ? (now.getTime() - new Date(t.stage_entered_at).getTime()) / 1000 : null
  });

  let recipients = stageAssignees_(saved).concat(extraRecipients);
  if (saved.stage === 'rejected' || saved.stage === 'closed') recipients.push(saved.requestor_email);
  const page = ['doc_check', 'sourcing'].indexOf(saved.stage) !== -1 ? 'pricing' : 'ticket';
  if (saved.stage === 'sourcing' && (action === 'srm_return' || action === 'gm_price_return')) recipients.push(saved.sr_email);
  const nTitle = '[' + saved.ticket_no + '] ' + STAGE_LABEL_TH[saved.stage];
  const nBody = ACTION_LABEL_TH[action] + ' โดย ' + u.full_name + ' — ' + saved.title;
  if (PRICE_REVIEW_ACTIONS_.indexOf(action) !== -1) {
    // reviewer comments may discuss cost / GP → only cost roles get them; Sales side gets the status line
    const isCost = function (e) { const x = userByEmail_(e); return !!x && COST_ROLES_.indexOf(x.role) !== -1; };
    const edited = meta && meta.reviewer_changes ? '\n✏️ ' + u.full_name + ' แก้ไขราคา ' + meta.reviewer_changes + ' ครั้งก่อนอนุมัติ (ดูใน Timeline)' : '';
    enqueueNotifications_(recipients.filter(isCost), saved, notifyType, nTitle, nBody + edited + (note ? '\n' + note : ''), ticketLink_(saved, page));
    const salesSide = recipients.filter(function (e) { return !isCost(e); });
    // the requesting Sales gets the selling price of THEIR OWN request (winning offer only) in the DM
    const own = action === 'gm_price_approve' ? '\n\n' + sellPriceLines_(saved).join('\n') : '';
    enqueueNotifications_(salesSide.filter(function (e) { return e === saved.requestor_email; }), saved, notifyType, nTitle, nBody + own, ticketLink_(saved, page));
    enqueueNotifications_(salesSide.filter(function (e) { return e !== saved.requestor_email; }), saved, notifyType, nTitle, nBody, ticketLink_(saved, page));
  } else {
    enqueueNotifications_(recipients, saved, notifyType, nTitle, nBody + (note ? '\n' + note : ''), ticketLink_(saved, page));
  }
  const ge = groupEventOfTransition_(action, saved, note, meta);
  if (ge) queueFprCard_(ge.event, saved, ge.extra);

  return { ticket: publicTicket_(saved) };
}

/**
 * At approval: if the reviewer edited prices in this step, store the new GP / selling price per item,
 * record how many changes in the approval log and tell the SR (in-app + Lark, cost roles only).
 */
function reviewerEdits_(u, t, meta, now, extraRecipients) {
  // log timestamps are whole seconds → compare from the start of the second the step began
  const since = t.stage_entered_at ? Math.floor(new Date(t.stage_entered_at).getTime() / 1000) * 1000 : 0;
  const changes = findAll_(TAB.LOGS, 'ticket_id', t.ticket_id).filter(function (l) {
    return String(l.actor_email).toLowerCase() === u.email && COST_LOG_ACTIONS_.indexOf(String(l.action)) !== -1 && new Date(l.ts).getTime() >= since;
  }).length;
  meta.winners.forEach(function (w) {
    updateRow_(TAB.ITEMS, w.item_id, { gp_percent: w.gp_percent, sell_price_thb: w.sell_price_thb, updated_at: now });
  });
  if (changes) {
    meta.reviewer_changes = changes;
    meta.edited_by = u.email;
    if (t.sr_email) extraRecipients.push(t.sr_email);
  }
}

/** All submit rules for SR quotations. Returns metadata (winners + total) for the log. */
function validateQuotesForSubmit_(t) {
  const items = activeItemsOf_(t.ticket_id);
  const noQuote = [];
  const noWinner = [];
  const noReason = [];
  const expired = [];
  const winners = [];
  const today = todayBkk_();
  const minSup = Math.max(1, Number(setting_('min_suppliers', 3)) || 1);
  const fewSup = [];
  let grand = 0;
  items.forEach(function (it) {
    if (it.quote_status) return;   // 'not_offered' / 'follow_up': answered without a price (follow-up = its own ticket)
    const quotes = activeQuotesOfItem_(it.item_id);
    if (!quotes.length) { noQuote.push(it.line_no); return; }
    if (quotes.length < minSup && !it.supplier_shortfall_reason) fewSup.push(it.line_no);
    const cmp = compareQuotes_(it.qty, quotes);
    const w = cmp.filter(function (q) { return q.is_selected; });
    if (w.length > 1) {
      throw appError_('MULTIPLE_WINNERS', 'รายการลำดับที่ ' + it.line_no + ' มีผู้ชนะมากกว่า 1 เจ้า กรุณาเลือกใหม่');
    }
    if (w.length === 0) { noWinner.push(it.line_no); return; }
    const win = w[0];
    if (!win.is_cheapest && !win.selection_reason) noReason.push(it.line_no);
    if (win.valid_until && win.valid_until < today) expired.push(it.line_no);
    grand += win.total_cost_thb;
    const pr = itemPricing_(it, win);
    winners.push({ item_id: it.item_id, line_no: it.line_no, quote_id: win.quote_id, vendor_name: win.vendor_name,
      net_unit_cost_thb: win.net_unit_cost_thb, clearance_thb: win.clearance_thb, landed_cost_thb: pr.landed_cost_thb,
      gp_percent: pr.gp_percent, sell_price_thb: pr.sell_price_thb });
  });
  if (noQuote.length) throw appError_('MISSING_QUOTATION', 'รายการที่ยังไม่มีราคา vendor: ลำดับที่ ' + noQuote.join(', '), { lines: noQuote });
  if (fewSup.length) {
    throw appError_('FEW_SUPPLIERS', 'ต้องมีราคา supplier อย่างน้อย ' + minSup + ' ราย หรือกรอกเหตุผลที่มีไม่ถึง: ลำดับที่ ' + fewSup.join(', '),
      { lines: fewSup, min: minSup });
  }
  if (noWinner.length) throw appError_('MISSING_WINNER', 'รายการที่ยังไม่ได้เลือกผู้ชนะ: ลำดับที่ ' + noWinner.join(', '), { lines: noWinner });
  if (noReason.length) {
    throw appError_('REASON_REQUIRED', 'เลือกผู้ชนะที่ไม่ใช่ราคาต่ำสุด ต้องระบุเหตุผล: ลำดับที่ ' + noReason.join(', '), { lines: noReason });
  }
  if (expired.length) throw appError_('QUOTATION_EXPIRED', 'ราคาผู้ชนะหมดอายุแล้ว: ลำดับที่ ' + expired.join(', '), { lines: expired });
  return { winners: winners, grand_total_cost_thb: round_(grand, 2) };
}

// =============================================================================
// Read API
// =============================================================================

/** Full ticket detail, filtered by what the current user may see. */
function getTicket(ticketId) {
  return api_('getTicket', function () {
    const u = currentUser_();
    return ticketDetail_(u, ticketForUser_(u, ticketId));
  });
}

function ticketDetail_(u, t) {
  {
    const showQuotes = canViewQuotes_(u, t);
    const showSell = canViewSellPrice_(u, t);
    const items = activeItemsOf_(t.ticket_id).map(function (it) {
      const out = Object.assign({}, it);
      out.product_group_name = groupName_(it.product_group_code);
      if (it.follow_up_ticket_id) {
        const fu = ticketById_(it.follow_up_ticket_id);
        out.follow_up = fu ? { ticket_id: fu.ticket_id, ticket_no: String(fu.ticket_no), stage_label: STAGE_LABEL_TH[fu.stage], status: fu.status } : null;
      }
      if (it.quote_status) {
        delete out.gp_percent;
        out.quotations = [];
        out.pricing = null;
        out.sales_pricing = null;
        out.sell_price_thb = null;
      } else if (showQuotes) {
        out.quotations = compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)).map(function (q) {
          const v = q.vendor_id ? findOne_(TAB.VENDORS, 'vendor_id', q.vendor_id) : null;
          q.supplier_warnings = v ? certWarnings_(normSupplier_(v)) : [];   // shown to SR Manager / GM when reviewing
          return q;
        });
        out.pricing = itemPricing_(it, out.quotations.filter(function (q) { return q.is_selected; })[0]);
      } else {
        // Sales side: no cost data leaves the server — selling price only, and only after GM approval
        delete out.gp_percent;
        out.quotations = [];
        out.pricing = null;
        out.sell_price_thb = null;
        if (showSell) {
          const win = compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)).filter(function (q) { return q.is_selected; })[0];
          out.sales_pricing = salesPricing_(it, win);
          out.sell_price_thb = out.sales_pricing ? out.sales_pricing.sell_price_thb : null;
        }
      }
      return out;
    });
    const attachments = findAll_(TAB.ATTACHMENTS, 'ticket_id', t.ticket_id)
      .filter(function (a) { return !toBool_(a.is_deleted); })
      .filter(function (a) { return COST_FILE_CATEGORIES_.indexOf(String(a.category)) === -1 || showQuotes; })
      .map(function (a) {
        return {
          attachment_id: String(a.attachment_id), item_id: String(a.item_id || ''), quote_id: String(a.quote_id || ''),
          category: String(a.category), file_name: String(a.file_name), drive_file_id: String(a.drive_file_id),
          mime_type: String(a.mime_type || ''), size_bytes: Number(a.size_bytes || 0),
          uploaded_by: String(a.uploaded_by), uploaded_at: isoOrBlank_(a.uploaded_at)
        };
      });
    const parent = t.parent_ticket_id ? ticketById_(t.parent_ticket_id) : null;
    const children = findAll_(TAB.TICKETS, 'parent_ticket_id', t.ticket_id).map(normTicket_).filter(function (c) { return canSeeTicket_(u, c); })
      .map(function (c) { return { ticket_id: c.ticket_id, ticket_no: String(c.ticket_no), stage_label: STAGE_LABEL_TH[c.stage], status: c.status }; });
    return {
      ticket: publicTicket_(t),
      parent: parent && canSeeTicket_(u, parent) ? { ticket_id: parent.ticket_id, ticket_no: String(parent.ticket_no) } : null,
      follow_ups: children,
      items: items,
      checklist: checklistOf_(t.ticket_id),
      attachments: attachments,
      timeline: showQuotes ? timelineOf_(t.ticket_id) : salesTimeline_(timelineOf_(t.ticket_id)),
      permissions: {
        can_edit_request: canEditRequest_(u, t),
        can_edit_quotes: canEditQuotes_(u, t),
        can_edit_checklist: canEditChecklist_(u, t),
        can_upload: canUpload_(u, t),
        can_view_quotes: showQuotes,
        can_view_sell_price: showSell,
        actions: allowedActions_(u, t)
      },
      me: { email: u.email, full_name: u.full_name, role: u.role },
      sla: fprSlaInfo_(t),
      vat_rate: vatRate_(),
      app_version: APP_VERSION
    };
  }
}

/** SLA deadline of the current FPR step for the web page (working time, Bangkok), or null. */
function fprSlaInfo_(t) {
  try {
    const s = slaDue_(t, workHours_(), holidaySet_());
    if (!s) return null;
    return { key: s.key, label: SLA_LABEL_[s.key], due: s.due.toISOString(), due_text: fmtDate_(s.due, 'dd/MM/yyyy HH:mm'),
      hours: Math.round(s.minutes / 6) / 10, overdue: new Date() > s.due };
  } catch (e) { return null; }
}

/** Actions to show as buttons (UI hint only — doTransition_ re-checks everything). */
function allowedActions_(u, t) {
  const a = [];
  const owner = u.role === 'sales' && t.requestor_email === u.email;
  const assigned = u.role === 'sr' && t.sr_email === u.email;
  if (owner && t.stage === 'returned') a.push('resubmit');
  if (owner && ['pending_manager', 'returned', 'pending_gm'].indexOf(t.stage) !== -1) a.push('cancel');
  if (u.role === 'manager' && t.stage === 'pending_manager' && t.requestor_email !== u.email) {
    const d = departmentByCode_(t.department_code);
    if (d && d.manager_email === u.email) a.push('manager_approve', 'manager_reject', 'manager_return');
  }
  if (u.role === 'gm' && t.stage === 'pending_gm' && t.manager_email !== u.email) a.push('gm_approve', 'gm_return', 'gm_reject');
  if (u.role === 'sr' && t.stage === 'pending_assign') a.push('claim');
  if ((u.role === 'sr' || u.role === 'sr_manager') && t.stage === 'pending_assign') a.push('queue_return');
  if (u.role === 'sr_manager' && t.stage === 'pending_sr_manager' && t.sr_email !== u.email) a.push('srm_approve', 'srm_return', 'srm_reject');
  if (u.role === 'gm' && t.stage === 'pending_gm_price') a.push('gm_price_approve', 'gm_price_return', 'gm_price_reject');
  if (u.role === 'admin' && OPEN_STATUSES.indexOf(t.status) !== -1) a.push('admin_cancel');
  if ((u.role === 'admin' || u.role === 'sr_manager') &&
      ['pending_assign', 'doc_check', 'need_info', 'sourcing'].indexOf(t.stage) !== -1) a.push('assign');
  if (assigned && (t.stage === 'doc_check' || t.stage === 'sourcing')) a.push('request_info');
  if (assigned && t.stage === 'doc_check') a.push('doc_complete');
  if (assigned && t.stage === 'sourcing') a.push('submit_quote');
  if (owner && t.stage === 'need_info') a.push('respond_info');
  if (owner && t.stage === 'awaiting_sales_ack') a.push('accept', 'request_revision');
  return a;
}

// =============================================================================
// Helpers
// =============================================================================

/** Ticket as sent to the browser (dates as ISO strings, Thai labels). */
function publicTicket_(t) {
  const out = {};
  SCHEMA.Tickets.cols.forEach(function (c) {
    if (c === 'client_key' || c === 'info_request_json') return;
    const v = t[c];
    out[c] = v instanceof Date ? (c === 'due_date' ? fmtDate_(v) : v.toISOString()) : v;
  });
  out.info_request = t.info_request || null;
  out.stage_label = STAGE_LABEL_TH[t.stage] || t.stage;
  out.status_label = STATUS_LABEL_TH[t.status] || t.status;
  const req = userByEmail_(t.requestor_email);
  const sr = t.sr_email ? userByEmail_(t.sr_email) : null;
  out.requestor_name = req ? req.full_name : t.requestor_email;
  out.sr_name = sr ? sr.full_name : '';
  return out;
}

function isUuid_(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
}

function activeGroupMap_() {
  const map = {};
  rows_(TAB.PRODUCT_GROUPS).forEach(function (g) {
    if (toBool_(g.is_active)) map[String(g.code)] = g;
  });
  return map;
}

function groupName_(code) {
  const g = findOne_(TAB.PRODUCT_GROUPS, 'code', code);
  return g ? String(g.name) : String(code);
}

/** FPR-YYMM-#### — running number per month (Counters › fpr_YYMM). Must run inside withLock_. */
function nextTicketNo_(now) {
  const ym = fmtDate_(now, 'yyyy-MM');
  const yymm = ym.slice(2, 4) + ym.slice(5, 7);
  const no = nextCounter_('fpr_' + yymm);
  return 'FPR-' + yymm + '-' + ('000' + no).slice(-Math.max(4, String(no).length));
}

/**
 * First approval stage. FPR (Settings › sales_manager_step = false): straight to GM.
 * Old flow (true): the department's Sales Manager first, GM when the department has none.
 */
function firstApprovalStage_(dept) {
  if (!toBool_(setting_('sales_manager_step', false))) return 'pending_gm';
  const mgr = dept && dept.manager_email ? userByEmail_(dept.manager_email) : null;
  return mgr && mgr.is_active && mgr.role === 'manager' ? 'pending_manager' : 'pending_gm';
}

function autoTitle_(customer, items) {
  const first = items[0] ? items[0].product_name : '';
  return (customer + ' — ' + first + (items.length > 1 ? ' และอีก ' + (items.length - 1) + ' รายการ' : '')).slice(0, 200);
}

/** Validate one item of the Food request form. Returns clean fields (no ids). */
function validateItem_(raw, groups, lineNo) {
  const r = raw || {};
  const prefix = 'สินค้ารายการที่ ' + lineNo + ': ';
  const code = cleanText_(r.product_group_code, 50) || 'FOOD';
  if (!groups[code]) throw appError_('INVALID_PRODUCT_GROUP', prefix + 'ประเภทสินค้าไม่ถูกต้องหรือถูกปิดใช้งาน');
  try {
    return {
      product_group_code: code,
      product_name: requireText_(r.product_name, 'ชื่อสินค้า (Product)', 300),
      net_weight: requireText_(r.net_weight, 'น้ำหนักสุทธิ (% Net Weight)', 100),
      size: requireText_(r.size, 'ขนาด (Size)', 100),
      packing_size: requireText_(r.packing_size, 'ขนาดของแพคย่อย (Packing Size)', 100),
      qty: toNumber_(r.qty, 'ปริมาณที่ลูกค้าต้องการต่อเดือน (Qty)', { gt: 0 }),
      uom: oneOf_(r.uom, UNITS, 'หน่วย (Unit)'),
      target_price: toNumber_(r.target_price, 'ราคาที่ลูกค้าคาดหวัง (บาท/หน่วย) — ถ้าลูกค้ายังไม่บอกให้ใส่ 0', { min: 0 }),
      target_currency: 'THB',
      spec: cleanText_(r.spec, CFG.MAX_TEXT),
      description: cleanText_(r.description, CFG.MAX_TEXT)
    };
  } catch (e) {
    if (e.isApp) throw appError_(e.code, prefix + e.message);
    throw e;
  }
}

function activeItemsOf_(ticketId) {
  return findAll_(TAB.ITEMS, 'ticket_id', ticketId)
    .filter(function (r) { return !toBool_(r.is_deleted); })
    .map(function (r) {
      return {
        item_id: String(r.item_id), ticket_id: String(r.ticket_id), line_no: Number(r.line_no),
        product_group_code: String(r.product_group_code), product_name: String(r.product_name),
        spec: String(r.spec || ''), description: String(r.description || ''),
        qty: Number(r.qty), uom: String(r.uom),
        net_weight: String(r.net_weight || ''), size: String(r.size || ''), packing_size: String(r.packing_size || ''),
        target_price: r.target_price === '' ? null : Number(r.target_price),
        gp_percent: r.gp_percent === '' || r.gp_percent === undefined ? null : Number(r.gp_percent),
        sell_price_thb: r.sell_price_thb === '' || r.sell_price_thb === undefined ? null : Number(r.sell_price_thb),
        target_currency: String(r.target_currency || 'THB'),
        quote_status: String(r.quote_status || ''), quote_status_reason: String(r.quote_status_reason || ''),
        follow_up_ticket_id: String(r.follow_up_ticket_id || ''),
        deal_status: String(r.deal_status || ''), deal_reason: String(r.deal_reason || ''), deal_note: String(r.deal_note || ''),
        deal_next_date: r.deal_next_date ? fmtDate_(r.deal_next_date) : '', deal_updated_by: String(r.deal_updated_by || ''),
        deal_updated_at: isoOrBlank_(r.deal_updated_at), deal_closed_at: isoOrBlank_(r.deal_closed_at),
        deal_stage: String(r.deal_stage || ''), deal_next_step: String(r.deal_next_step || ''),
        supplier_shortfall_reason: String(r.supplier_shortfall_reason || '')
      };
    })
    .sort(function (a, b) { return a.line_no - b.line_no; });
}

function checklistOf_(ticketId) {
  return findAll_(TAB.CHECKLIST, 'ticket_id', ticketId)
    .map(function (c) {
      return {
        check_id: String(c.check_id), product_group_code: String(c.product_group_code), item_key: String(c.item_key),
        label: String(c.label), is_required: toBool_(c.is_required), sort_order: Number(c.sort_order || 0),
        is_checked: toBool_(c.is_checked), checked_by: String(c.checked_by || ''),
        checked_at: isoOrBlank_(c.checked_at), note: String(c.note || '')
      };
    })
    .sort(function (a, b) { return a.sort_order - b.sort_order; });
}

function timelineOf_(ticketId) {
  const names = {};
  rows_(TAB.USERS).forEach(function (r) { names[String(r.email).toLowerCase()] = String(r.full_name); });
  return findAll_(TAB.LOGS, 'ticket_id', ticketId)
    .sort(function (a, b) { return Number(a.log_id) - Number(b.log_id); })
    .map(function (l) {
      return {
        log_id: Number(l.log_id), ts: isoOrBlank_(l.ts), ts_bkk: fmtDate_(l.ts, 'dd/MM/yyyy HH:mm:ss'),
        log_type: String(l.log_type), action: String(l.action), action_label: ACTION_LABEL_TH[l.action] || String(l.action),
        actor_email: String(l.actor_email), actor_name: names[String(l.actor_email).toLowerCase()] || String(l.actor_email),
        actor_role: String(l.actor_role), from_status: String(l.from_status), to_status: String(l.to_status),
        from_stage: String(l.from_stage), to_stage: String(l.to_stage), comment: String(l.comment || ''),
        metadata: parseJson_(l.metadata_json, {}), stage_duration_sec: l.stage_duration_sec === '' ? null : Number(l.stage_duration_sec)
      };
    });
}

/** Log actions that are pure cost work (vendor prices, GP) — never shown to the Sales side. */
const COST_LOG_ACTIONS_ = ['quotation_added', 'quotation_updated', 'quotation_deleted', 'quotation_selected', 'pricing_updated'];
/** Internal price review steps: shown to Sales as a status line only (no metadata, no reviewer comment). */
const PRICE_REVIEW_ACTIONS_ = ['submit_quote', 'srm_approve', 'srm_return', 'gm_price_approve', 'gm_price_return'];

/** Timeline as the Sales side may see it: cost logs removed, price-review details stripped. */
function salesTimeline_(timeline) {
  return timeline.filter(function (l) {
    if (COST_LOG_ACTIONS_.indexOf(l.action) !== -1) return false;
    if (l.metadata && COST_FILE_CATEGORIES_.indexOf(String(l.metadata.category)) !== -1) return false;
    return true;
  }).map(function (l) {
    if (PRICE_REVIEW_ACTIONS_.indexOf(l.action) !== -1) {
      l.metadata = {};
      l.comment = '';
    } else if (l.metadata) {
      delete l.metadata.winners;
      delete l.metadata.grand_total_cost_thb;
    }
    return l;
  });
}

/**
 * Build the document checklist from the templates of every product group used in the
 * ticket and all of their ancestors (e.g. Solar template + Inverter template).
 */
function generateChecklist_(ticketId) {
  const groups = {};
  rows_(TAB.PRODUCT_GROUPS).forEach(function (g) { groups[String(g.code)] = g; });
  const existing = {};
  checklistOf_(ticketId).forEach(function (c) { existing[c.product_group_code + '|' + c.item_key] = true; });

  const owners = {};   // group code → depth from the item's own group (0 = own group)
  activeItemsOf_(ticketId).forEach(function (it) {
    let code = it.product_group_code;
    let depth = 0;
    while (code && groups[code] && depth < 10) {
      if (owners[code] === undefined || owners[code] > depth) owners[code] = depth;
      code = String(groups[code].parent_code || '');
      depth++;
    }
  });

  const now = new Date();
  const toInsert = [];
  Object.keys(owners).forEach(function (code) {
    const template = parseJson_(groups[code].checklist_json, []);
    if (!Array.isArray(template)) return;
    template.forEach(function (e, i) {
      const key = cleanText_(e && e.key, 100);
      if (!key || existing[code + '|' + key]) return;
      existing[code + '|' + key] = true;
      toInsert.push({
        check_id: uuid_(), ticket_id: ticketId, product_group_code: code, item_key: key,
        label: cleanText_(e.label, 300) || key,
        is_required: e.required === undefined ? true : toBool_(e.required),
        sort_order: (10 - owners[code]) * 1000 + i + 1,
        is_checked: false, checked_by: '', checked_at: '', note: '', updated_at: now
      });
    });
  });
  insertRows_(TAB.CHECKLIST, toInsert);
  return toInsert.length;
}

/**
 * Customer group (required, from Settings customer_groups) + destination country (blank = ไทย).
 * "ส่งออก" must name a foreign destination.
 */
function cleanMarket_(group, country) {
  const groups = setting_('customer_groups', []);
  const g = cleanText_(group, 100);
  if (!g) throw appError_('VALIDATION', 'กรุณาเลือกกลุ่มลูกค้า', { field: 'customer_group' });
  if (groups.length && groups.indexOf(g) === -1) throw appError_('VALIDATION', 'กลุ่มลูกค้าไม่อยู่ในรายการ', { field: 'customer_group' });
  const c = cleanText_(country, 60) || 'ไทย';
  if (/ส่งออก/.test(g) && /^(ไทย|thailand|th)$/i.test(c)) {
    throw appError_('VALIDATION', 'กลุ่มลูกค้า “ส่งออก” ต้องระบุประเทศปลายทาง', { field: 'destination_country' });
  }
  return { customer_group: g, destination_country: c };
}


// ============================================================================
// Editing.gs
// ============================================================================
/**
 * File: Editing.gs
 * Data edits that are NOT status changes:
 *   - Sales: ticket header + items (only while pending_manager / returned)
 *   - SR: document checklist (doc_check), vendor quotations + winner (sourcing)
 * Every edit runs under the script lock, re-checks permission on the server,
 * and writes a before→after diff to TicketLogs.
 */

const HEADER_FIELDS_ = ['title', 'description', 'customer_name', 'priority', 'due_date', 'documents_needed', 'customer_group', 'destination_country'];
const ITEM_FIELDS_ = ['product_group_code', 'product_name', 'net_weight', 'size', 'packing_size', 'spec', 'description', 'qty', 'uom',
  'target_price', 'target_currency'];
const QUOTE_FIELDS_ = ['vendor_id', 'vendor_name', 'unit_price', 'currency', 'fx_rate', 'vat_term', 'moq', 'lead_time_days',
  'payment_term', 'valid_until', 'remark', 'attachment_file_id', 'is_selected', 'selection_reason',
  'brand', 'origin_country', 'packing', 'incoterm', 'shelf_life', 'clearance_thb', 'cost_breakdown_json', 'fx_date'];

// =============================================================================
// Sales — header & items
// =============================================================================

/** patch: subset of {title, description, customer_name, priority, due_date, documents_needed} */
function updateTicketRequest(ticketId, patch, expectedVersion) {
  return api_('updateTicketRequest', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!canEditRequest_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขใบขอราคาได้เฉพาะ Sales เจ้าของใบ ก่อน Manager อนุมัติ');
      requireVersion_(t, expectedVersion);
      const p = patch || {};
      const clean = {};
      if (p.title !== undefined) {
        clean.title = requireText_(p.title, 'ชื่อใบขอราคา', 200);
        if (clean.title.length < 3) throw appError_('VALIDATION', 'ชื่อใบขอราคาต้องมีอย่างน้อย 3 ตัวอักษร');
      }
      if (p.description !== undefined) clean.description = cleanText_(p.description, CFG.MAX_TEXT);
      if (p.customer_name !== undefined) clean.customer_name = requireText_(p.customer_name, 'ชื่อลูกค้า (Customer)', 200);
      if (p.documents_needed !== undefined) clean.documents_needed = cleanText_(p.documents_needed, CFG.MAX_TEXT);
      if (p.customer_group !== undefined || p.destination_country !== undefined) {
        const m = cleanMarket_(p.customer_group !== undefined ? p.customer_group : t.customer_group,
          p.destination_country !== undefined ? p.destination_country : t.destination_country);
        clean.customer_group = m.customer_group;
        clean.destination_country = m.destination_country;
      }
      if (p.priority !== undefined) clean.priority = oneOf_(p.priority, PRIORITIES, 'ความเร่งด่วน');
      if (p.due_date !== undefined) clean.due_date = parseYmd_(p.due_date, 'วันที่ต้องการให้ตอบกลับราคา (Expected Date)');

      const d = diff_(t, clean, Object.keys(clean));
      if (!Object.keys(d).length) return { ticket: publicTicket_(t), changed: false };
      clean.version = t.version + 1;
      clean.updated_at = new Date();
      const saved = normTicket_(updateRow_(TAB.TICKETS, t.ticket_id, clean));
      appendLog_({ ticket_id: t.ticket_id, action: 'ticket_updated', actor_email: u.email, actor_role: u.role, metadata: { diff: d } });
      return { ticket: publicTicket_(saved), changed: true };
    });
  });
}

/** Add (no item_id or unknown item_id) or update an item. */
function saveItem(ticketId, item, expectedVersion) {
  return api_('saveItem', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!canEditRequest_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขรายการสินค้าได้เฉพาะ Sales เจ้าของใบ ก่อน Manager อนุมัติ');
      requireVersion_(t, expectedVersion);

      const raw = item || {};
      const all = findAll_(TAB.ITEMS, 'ticket_id', t.ticket_id);
      const existing = raw.item_id ? all.filter(function (r) { return String(r.item_id) === String(raw.item_id); })[0] : null;
      if (existing && toBool_(existing.is_deleted)) throw appError_('NOT_FOUND', 'รายการสินค้านี้ถูกลบไปแล้ว');
      const activeCount = all.filter(function (r) { return !toBool_(r.is_deleted); }).length;
      if (!existing && activeCount >= CFG.MAX_ITEMS_PER_TICKET) {
        throw appError_('TOO_MANY_ITEMS', 'ใบขอราคา 1 ใบมีได้ไม่เกิน ' + CFG.MAX_ITEMS_PER_TICKET + ' รายการ');
      }
      const lineNo = existing ? Number(existing.line_no)
        : all.reduce(function (m, r) { return Math.max(m, Number(r.line_no) || 0); }, 0) + 1;
      const clean = validateItem_(raw, activeGroupMap_(), lineNo);
      const now = new Date();
      let saved;
      if (existing) {
        const d = diff_(existing, clean, ITEM_FIELDS_);
        if (!Object.keys(d).length) return { item_id: String(existing.item_id), changed: false, version: t.version };
        clean.updated_at = now;
        saved = updateRow_(TAB.ITEMS, existing.item_id, clean);
        appendLog_({ ticket_id: t.ticket_id, action: 'item_updated', actor_email: u.email, actor_role: u.role,
          metadata: { item_id: String(existing.item_id), line_no: lineNo, diff: d } });
      } else {
        clean.item_id = isUuid_(raw.item_id) && !findOne_(TAB.ITEMS, 'item_id', raw.item_id) ? String(raw.item_id) : uuid_();
        clean.ticket_id = t.ticket_id;
        clean.line_no = lineNo;
        clean.is_deleted = false;
        clean.created_at = now;
        clean.updated_at = now;
        saved = insertRow_(TAB.ITEMS, clean);
        appendLog_({ ticket_id: t.ticket_id, action: 'item_added', actor_email: u.email, actor_role: u.role,
          metadata: { item_id: clean.item_id, line_no: lineNo, item: clean } });
      }
      const tk = updateRow_(TAB.TICKETS, t.ticket_id, { version: t.version + 1, updated_at: now });
      return { item_id: String(saved.item_id), changed: true, version: Number(tk.version) };
    });
  });
}

function deleteItem(ticketId, itemId, expectedVersion) {
  return api_('deleteItem', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!canEditRequest_(u, t)) throw appError_('FORBIDDEN', 'ลบรายการสินค้าได้เฉพาะ Sales เจ้าของใบ ก่อน Manager อนุมัติ');
      requireVersion_(t, expectedVersion);
      const items = activeItemsOf_(t.ticket_id);
      const target = items.filter(function (i) { return i.item_id === String(itemId); })[0];
      if (!target) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้า');
      if (items.length <= 1) throw appError_('NO_ITEMS', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
      const now = new Date();
      updateRow_(TAB.ITEMS, target.item_id, { is_deleted: true, updated_at: now });
      appendLog_({ ticket_id: t.ticket_id, action: 'item_deleted', actor_email: u.email, actor_role: u.role,
        metadata: { item_id: target.item_id, line_no: target.line_no, item: target } });
      const tk = updateRow_(TAB.TICKETS, t.ticket_id, { version: t.version + 1, updated_at: now });
      return { version: Number(tk.version) };
    });
  });
}

// =============================================================================
// SR — document checklist
// =============================================================================

function updateChecklist(checkId, isChecked, note) {
  return api_('updateChecklist', function () {
    return withLock_(function () {
      const u = currentUser_();
      const row = findOne_(TAB.CHECKLIST, 'check_id', cleanText_(checkId));
      if (!row) throw appError_('NOT_FOUND', 'ไม่พบรายการตรวจเอกสาร');
      const t = ticketForUser_(u, row.ticket_id);
      if (!canEditChecklist_(u, t)) throw appError_('FORBIDDEN', 'ติ๊กเอกสารได้เฉพาะ SR ผู้รับงาน ในขั้นตอนตรวจเอกสาร');
      const checked = toBool_(isChecked);
      const patch = {
        is_checked: checked,
        note: note === undefined ? String(row.note || '') : cleanText_(note, 500),
        updated_at: new Date()
      };
      if (checked !== toBool_(row.is_checked)) {
        patch.checked_by = checked ? u.email : '';
        patch.checked_at = checked ? new Date() : '';
      }
      const d = diff_({ is_checked: toBool_(row.is_checked), note: String(row.note || '') }, patch, ['is_checked', 'note']);
      if (!Object.keys(d).length) return { changed: false };
      updateRow_(TAB.CHECKLIST, row.check_id, patch);
      appendLog_({ ticket_id: t.ticket_id, action: 'checklist_updated', actor_email: u.email, actor_role: u.role,
        metadata: { check_id: String(row.check_id), label: String(row.label), diff: d } });
      return { changed: true };
    });
  });
}

// =============================================================================
// SR — vendor quotations
// =============================================================================

/**
 * Add or update one vendor quotation.
 * payload: { quote_id? (client UUID → idempotent), item_id, vendor_id?, vendor_name, unit_price, currency,
 *            fx_rate, vat_term, moq?, lead_time_days?, payment_term?, valid_until?, remark?, attachment_file_id? }
 */
function saveQuotation(payload) {
  return api_('saveQuotation', function () {
    return withLock_(function () {
      const u = currentUser_();
      return saveQuotationCore_(u, payload || {});
    });
  });
}

/** Shared by saveQuotation and the batch draft save (Phase 3). Caller holds the lock. */
function saveQuotationCore_(u, p) {
  const item = findOne_(TAB.ITEMS, 'item_id', cleanText_(p.item_id));
  if (!item || toBool_(item.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้า');
  const t = ticketForUser_(u, item.ticket_id);
  if (!canEditQuotes_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขราคาได้เฉพาะ SR ผู้รับงาน (ขั้นหาราคา) หรือผู้อนุมัติขั้นปัจจุบัน (SR Manager / GM)');
  requireQuotable_(item);

  const quoteId = cleanText_(p.quote_id, 64);
  let existing = quoteId ? findOne_(TAB.QUOTATIONS, 'quote_id', quoteId) : null;
  if (existing && String(existing.item_id) !== String(item.item_id)) {
    throw appError_('IMMUTABLE_FIELD', 'ย้ายใบเสนอราคาไปยังรายการอื่นไม่ได้');
  }
  if (existing && toBool_(existing.is_deleted)) throw appError_('NOT_FOUND', 'ใบเสนอราคานี้ถูกลบไปแล้ว');

  if (!existing) {
    const active = activeQuotesOfItem_(item.item_id);
    if (active.length >= CFG.MAX_VENDORS_PER_ITEM) {
      throw appError_('MAX_VENDORS', 'แต่ละรายการสินค้าใส่ราคา vendor ได้ไม่เกิน ' + CFG.MAX_VENDORS_PER_ITEM + ' เจ้า');
    }
  }

  const clean = validateQuoteFields_(p, t);
  const vatRate = existing ? Number(existing.vat_rate) : vatRate_();
  const bd = clean._breakdown;
  delete clean._breakdown;
  if (bd) {
    // landed-cost breakdown entered → the import cost per unit is computed, never typed
    const full = costBreakdown_(quoteCosts_(clean.unit_price, clean.fx_rate, clean.vat_term, vatRate, 0).net_unit_cost_thb, bd);
    clean.clearance_thb = round_(full.total_thb, 4);
    clean.cost_breakdown_json = JSON.stringify(full);
  } else {
    clean.cost_breakdown_json = '';
  }
  const costs = quoteCosts_(clean.unit_price, clean.fx_rate, clean.vat_term, vatRate, clean.clearance_thb);
  const now = new Date();

  if (existing) {
    const before = normQuote_(existing);
    const d = diff_(before, clean, QUOTE_FIELDS_.filter(function (f) { return f !== 'is_selected' && f !== 'selection_reason'; }));
    if (!Object.keys(d).length) return { quote: normQuote_(existing), changed: false };
    const patch = Object.assign({}, clean, costs, { updated_at: now });
    const saved = updateRow_(TAB.QUOTATIONS, existing.quote_id, patch);
    appendLog_({ ticket_id: t.ticket_id, action: 'quotation_updated', actor_email: u.email, actor_role: u.role,
      metadata: { item_id: String(item.item_id), quote_id: String(existing.quote_id), vendor_name: clean.vendor_name, diff: d } });
    return { quote: normQuote_(saved), changed: true };
  }

  const row = Object.assign({
    quote_id: isUuid_(quoteId) ? quoteId : uuid_(),
    item_id: String(item.item_id),
    ticket_id: t.ticket_id,
    vat_rate: vatRate,
    is_selected: false,
    selection_reason: '',
    is_deleted: false,
    created_by: u.email,
    created_at: now,
    updated_at: now
  }, clean, costs);
  insertRow_(TAB.QUOTATIONS, row);
  appendLog_({ ticket_id: t.ticket_id, action: 'quotation_added', actor_email: u.email, actor_role: u.role,
    metadata: { item_id: row.item_id, quote_id: row.quote_id, quote: diff_({}, row, QUOTE_FIELDS_.concat(['vat_rate'])) } });
  return { quote: normQuote_(row), changed: true };
}

function validateQuoteFields_(p, t) {
  const currencies = setting_('currencies', ['THB']);
  const currency = oneOf_(String(p.currency || 'THB').toUpperCase(), currencies, 'สกุลเงิน');
  let fx;
  if (currency === 'THB') {
    fx = toNumber_(p.fx_rate === undefined || p.fx_rate === '' ? 1 : p.fx_rate, 'อัตราแลกเปลี่ยน', { gt: 0 });
    if (fx !== 1) throw appError_('VALIDATION', 'สกุลเงิน THB ต้องใช้อัตราแลกเปลี่ยน = 1');
  } else {
    fx = toNumber_(p.fx_rate, 'อัตราแลกเปลี่ยน (' + currency + ' → THB)', { gt: 0, max: 100000 });
  }

  let vendorId = cleanText_(p.vendor_id, 64);
  const vendorName = requireText_(p.vendor_name, 'ชื่อ vendor', 200);
  if (vendorId) {
    if (!findOne_(TAB.VENDORS, 'vendor_id', vendorId)) throw appError_('VALIDATION', 'ไม่พบ vendor ที่เลือกในทะเบียน');
  } else {
    const match = rows_(TAB.VENDORS).filter(function (v) {
      return String(v.name).trim().toLowerCase() === vendorName.toLowerCase();
    })[0];
    vendorId = match ? String(match.vendor_id) : '';
  }

  const attachmentId = cleanText_(p.attachment_file_id, 100);
  if (attachmentId) {
    const att = findOne_(TAB.ATTACHMENTS, 'attachment_id', attachmentId);
    if (!att || toBool_(att.is_deleted) || String(att.ticket_id) !== t.ticket_id) {
      throw appError_('VALIDATION', 'ไฟล์ใบเสนอราคาไม่ได้อยู่ในใบขอราคานี้');
    }
  }

  return {
    vendor_id: vendorId,
    vendor_name: vendorName,
    unit_price: toNumber_(p.unit_price, 'ราคาต่อหน่วย', { min: 0, max: 1e12 }),
    currency: currency,
    fx_rate: fx,
    vat_term: oneOf_(p.vat_term, VAT_TERMS, 'เงื่อนไข VAT'),
    moq: toNumber_(p.moq, 'MOQ', { allowBlank: true, min: 0 }),
    lead_time_days: toNumber_(p.lead_time_days, 'Lead time (วัน)', { allowBlank: true, min: 0, integer: true, max: 3650 }),
    payment_term: cleanText_(p.payment_term, 200),
    valid_until: parseYmd_(p.valid_until, 'ราคายืนถึงวันที่', true),
    remark: cleanText_(p.remark, CFG.MAX_TEXT),
    attachment_file_id: attachmentId,
    brand: cleanText_(p.brand, 100),
    origin_country: cleanText_(p.origin_country, 100),
    packing: cleanText_(p.packing, 200),
    incoterm: p.incoterm ? oneOf_(String(p.incoterm).toUpperCase(), INCOTERMS, 'เงื่อนไขการส่งมอบ (Incoterm)') : '',
    shelf_life: cleanText_(p.shelf_life, 100),
    clearance_thb: toNumber_(p.clearance_thb, 'ค่าเคลียร์ของ (บาท/หน่วย)', { allowBlank: true, min: 0, max: 1e9 }) || 0,
    fx_date: parseYmd_(p.fx_date, 'วันที่ของอัตราแลกเปลี่ยน', true),
    _breakdown: cleanBreakdown_(p.cost_breakdown)
  };
}

/** Landed-cost breakdown from the pricing page (per unit, THB) — null when not used. */
function cleanBreakdown_(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const keys = COST_PARTS_.concat(['duty_pct']);
  if (!keys.some(function (k) { return raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== ''; })) return null;
  const LABEL = { freight: 'ค่าขนส่ง (freight)', insurance: 'ค่าประกันภัย', fees: 'ค่าธรรมเนียมนำเข้า / ใบอนุญาต', cold: 'ค่าห้องเย็น',
    inland: 'ค่าขนส่งในประเทศ', other: 'ค่าใช้จ่ายอื่น', duty_pct: 'อากรขาเข้า (%)' };
  const out = {};
  keys.forEach(function (k) {
    out[k] = toNumber_(raw[k], LABEL[k], { allowBlank: true, min: 0, max: k === 'duty_pct' ? 100 : 1e9 }) || 0;
  });
  return out;
}

function deleteQuotation(quoteId) {
  return api_('deleteQuotation', function () {
    return withLock_(function () {
      const u = currentUser_();
      return deleteQuotationCore_(u, quoteId);
    });
  });
}

function deleteQuotationCore_(u, quoteId) {
  const q = findOne_(TAB.QUOTATIONS, 'quote_id', cleanText_(quoteId));
  if (!q || toBool_(q.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบใบเสนอราคา');
  const t = ticketForUser_(u, q.ticket_id);
  if (!canEditQuotes_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขราคาได้เฉพาะ SR ผู้รับงาน (ขั้นหาราคา) หรือผู้อนุมัติขั้นปัจจุบัน (SR Manager / GM)');
  updateRow_(TAB.QUOTATIONS, q.quote_id, { is_deleted: true, is_selected: false, selection_reason: '', updated_at: new Date() });
  removeQuotePhotos_(u, String(q.quote_id));
  appendLog_({ ticket_id: t.ticket_id, action: 'quotation_deleted', actor_email: u.email, actor_role: u.role,
    metadata: { item_id: String(q.item_id), quote_id: String(q.quote_id), quote: normQuote_(q) } });
  return { deleted: true };
}

/** Pick the single winner of an item (radio). Reason is required at submit if not the cheapest. */
function selectQuotation(quoteId, reason) {
  return api_('selectQuotation', function () {
    return withLock_(function () {
      const u = currentUser_();
      return selectQuotationCore_(u, quoteId, reason);
    });
  });
}

function selectQuotationCore_(u, quoteId, reason) {
  const q = findOne_(TAB.QUOTATIONS, 'quote_id', cleanText_(quoteId));
  if (!q || toBool_(q.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบใบเสนอราคา');
  const t = ticketForUser_(u, q.ticket_id);
  if (!canEditQuotes_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขราคาได้เฉพาะ SR ผู้รับงาน (ขั้นหาราคา) หรือผู้อนุมัติขั้นปัจจุบัน (SR Manager / GM)');
  const why = cleanText_(reason, 500);
  const now = new Date();
  const item = findOne_(TAB.ITEMS, 'item_id', q.item_id);
  const quotes = activeQuotesOfItem_(String(q.item_id));
  const before = quotes.filter(function (x) { return x.is_selected; }).map(function (x) { return x.quote_id; });

  if (before.length === 1 && before[0] === String(q.quote_id) && toBool_(q.is_selected) && String(q.selection_reason || '') === why) {
    return { changed: false };
  }
  quotes.forEach(function (x) {
    if (x.is_selected && x.quote_id !== String(q.quote_id)) {
      updateRow_(TAB.QUOTATIONS, x.quote_id, { is_selected: false, selection_reason: '', updated_at: now });
    }
  });
  updateRow_(TAB.QUOTATIONS, q.quote_id, { is_selected: true, selection_reason: why, updated_at: now });

  const cmp = compareQuotes_(Number(item.qty), activeQuotesOfItem_(String(q.item_id)));
  const winner = cmp.filter(function (x) { return x.quote_id === String(q.quote_id); })[0];
  appendLog_({ ticket_id: t.ticket_id, action: 'quotation_selected', actor_email: u.email, actor_role: u.role,
    metadata: { item_id: String(q.item_id), quote_id: String(q.quote_id), vendor_name: String(q.vendor_name),
      previous_winner: before, reason: why, is_cheapest: winner ? winner.is_cheapest : null } });
  return { changed: true, is_cheapest: winner ? winner.is_cheapest : null };
}

// =============================================================================
// Pricing page (Phase 3) — batch saves in ONE lock and ONE round trip
// =============================================================================

/**
 * Save the whole sourcing draft of a ticket.
 * items: [{ item_id, quotes: [{ quote_id (client UUID), vendor_name, unit_price, ... }], winner_quote_id?, selection_reason? }]
 * - quotes missing from the list are soft-deleted
 * - completely blank vendor columns are ignored (draft may be incomplete)
 * - every row is validated BEFORE anything is written, so a bad row never leaves a half-saved draft
 */
function saveSourcingDraft(ticketId, items) {
  return api_('saveSourcingDraft', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!canEditQuotes_(u, t)) throw appError_('FORBIDDEN', 'แก้ไขราคาได้เฉพาะ SR ผู้รับงาน (ขั้นหาราคา) หรือผู้อนุมัติขั้นปัจจุบัน (SR Manager / GM)');
      const byId = {};
      activeItemsOf_(t.ticket_id).forEach(function (it) { byId[it.item_id] = it; });
      const list = Array.isArray(items) ? items : [];

      // 1) validate everything
      const plan = list.map(function (row) {
        const it = byId[String(row && row.item_id)];
        if (!it) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้าในใบนี้');
        requireQuotable_(it);
        const quotes = (Array.isArray(row.quotes) ? row.quotes : []).filter(function (q) {
          return cleanText_(q.vendor_name) || String(q.unit_price === undefined || q.unit_price === null ? '' : q.unit_price).trim() !== '';
        });
        if (quotes.length > CFG.MAX_VENDORS_PER_ITEM) {
          throw appError_('MAX_VENDORS', 'รายการที่ ' + it.line_no + ': ใส่ราคา vendor ได้ไม่เกิน ' + CFG.MAX_VENDORS_PER_ITEM + ' เจ้า');
        }
        quotes.forEach(function (q, i) {
          try {
            validateQuoteFields_(q, t);
          } catch (e) {
            if (e.isApp) throw appError_(e.code, 'รายการที่ ' + it.line_no + ' vendor ที่ ' + (i + 1) + ': ' + e.message, { line_no: it.line_no, vendor_index: i });
            throw e;
          }
        });
        const keepIds = quotes.map(function (q) { return cleanText_(q.quote_id, 64); }).filter(String);
        const winner = cleanText_(row.winner_quote_id, 64);
        if (winner && keepIds.indexOf(winner) === -1) throw appError_('VALIDATION', 'รายการที่ ' + it.line_no + ': ผู้ชนะต้องเป็น vendor ที่กรอกไว้');
        let gp = it.gp_percent;
        if (row.gp_percent !== undefined) {
          try {
            gp = toNumber_(row.gp_percent, 'GP %', { allowBlank: true, min: 0, max: 99.99 });
          } catch (e) {
            if (e.isApp) throw appError_(e.code, 'รายการที่ ' + it.line_no + ': ' + e.message, { line_no: it.line_no });
            throw e;
          }
        }
        return { item: it, quotes: quotes, keepIds: keepIds, winner: winner, reason: cleanText_(row.selection_reason, 500), gp: gp,
          shortfall: row.shortfall_reason === undefined ? null : cleanText_(row.shortfall_reason, 500) };
      });

      // 2) write
      let changes = 0;
      plan.forEach(function (p) {
        const oldGp = p.item.gp_percent === null ? '' : p.item.gp_percent;
        const newGp = p.gp === null || p.gp === undefined ? '' : p.gp;
        if (String(oldGp) !== String(newGp)) {
          updateRow_(TAB.ITEMS, p.item.item_id, { gp_percent: newGp, updated_at: new Date() });
          appendLog_({ ticket_id: t.ticket_id, action: 'pricing_updated', actor_email: u.email, actor_role: u.role,
            metadata: { item_id: p.item.item_id, line_no: p.item.line_no, diff: { gp_percent: { old: oldGp, 'new': newGp } } } });
          changes++;
        }
        if (p.shortfall !== null && p.shortfall !== p.item.supplier_shortfall_reason) {
          updateRow_(TAB.ITEMS, p.item.item_id, { supplier_shortfall_reason: p.shortfall, updated_at: new Date() });
          appendLog_({ ticket_id: t.ticket_id, action: 'pricing_updated', actor_email: u.email, actor_role: u.role,
            metadata: { item_id: p.item.item_id, line_no: p.item.line_no, diff: { supplier_shortfall_reason: { old: p.item.supplier_shortfall_reason, 'new': p.shortfall } } } });
          changes++;
        }
        activeQuotesOfItem_(p.item.item_id).forEach(function (q) {
          if (p.keepIds.indexOf(q.quote_id) === -1) { deleteQuotationCore_(u, q.quote_id); changes++; }
        });
        p.quotes.forEach(function (q) {
          const payload = Object.assign({}, q, { item_id: p.item.item_id });
          if (!isUuid_(payload.quote_id)) payload.quote_id = '';
          const r = saveQuotationCore_(u, payload);
          if (!payload.quote_id) p.keepIds.push(r.quote.quote_id);
          if (r.changed) changes++;
        });
        if (p.winner) {
          if (selectQuotationCore_(u, p.winner, p.reason).changed) changes++;
        } else {
          activeQuotesOfItem_(p.item.item_id).filter(function (q) { return q.is_selected; }).forEach(function (q) {
            updateRow_(TAB.QUOTATIONS, q.quote_id, { is_selected: false, selection_reason: '', updated_at: new Date() });
            appendLog_({ ticket_id: t.ticket_id, action: 'quotation_updated', actor_email: u.email, actor_role: u.role,
              metadata: { item_id: p.item.item_id, quote_id: q.quote_id, vendor_name: q.vendor_name, diff: { is_selected: { old: true, 'new': false } } } });
            changes++;
          });
        }
      });
      return { changes: changes, detail: ticketDetail_(u, ticketById_(t.ticket_id)) };
    });
  });
}

/** rows: [{ check_id, is_checked, note }] — SR ticks several documents in one call. */
function saveChecklist(ticketId, rows) {
  return api_('saveChecklist', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!canEditChecklist_(u, t)) throw appError_('FORBIDDEN', 'ติ๊กเอกสารได้เฉพาะ SR ผู้รับงาน ในขั้นตอนตรวจเอกสาร');
      const mine = {};
      findAll_(TAB.CHECKLIST, 'ticket_id', t.ticket_id).forEach(function (c) { mine[String(c.check_id)] = c; });
      let changes = 0;
      (Array.isArray(rows) ? rows : []).forEach(function (r) {
        const row = mine[String(r && r.check_id)];
        if (!row) throw appError_('NOT_FOUND', 'ไม่พบรายการตรวจเอกสาร');
        const checked = toBool_(r.is_checked);
        const note = r.note === undefined ? String(row.note || '') : cleanText_(r.note, 500);
        const d = diff_({ is_checked: toBool_(row.is_checked), note: String(row.note || '') }, { is_checked: checked, note: note }, ['is_checked', 'note']);
        if (!Object.keys(d).length) return;
        const patch = { is_checked: checked, note: note, updated_at: new Date() };
        if (checked !== toBool_(row.is_checked)) {
          patch.checked_by = checked ? u.email : '';
          patch.checked_at = checked ? new Date() : '';
        }
        updateRow_(TAB.CHECKLIST, row.check_id, patch);
        appendLog_({ ticket_id: t.ticket_id, action: 'checklist_updated', actor_email: u.email, actor_role: u.role,
          metadata: { check_id: String(row.check_id), label: String(row.label), diff: d } });
        changes++;
      });
      return { changes: changes, checklist: checklistOf_(t.ticket_id) };
    });
  });
}

// =============================================================================
// SR — per-item decision: quote · not offered · send later (split to its own ticket)
// =============================================================================

const ITEM_QUOTE_STATUS_ = ['quote', 'not_offered', 'follow_up'];

/** Prices can be entered only for items the SR is quoting in this ticket. */
function requireQuotable_(item) {
  const st = String(item.quote_status || '');
  if (st === 'follow_up') throw appError_('ITEM_SPLIT', 'รายการที่ ' + item.line_no + ' แยกไปส่งราคาตามหลังแล้ว — กรอกราคาในใบใหม่');
  if (st === 'not_offered') throw appError_('ITEM_NOT_OFFERED', 'รายการที่ ' + item.line_no + ' ตั้งเป็น “ไม่เสนอ” — กด “กลับมาเสนอราคา” ก่อน');
}

/**
 * SR marks one item:
 *   'not_offered' — answered as "ไม่เสนอราคา" (reason required); reversible with 'quote' while sourcing
 *   'follow_up'   — "ส่งตามหลัง": the item is pulled out NOW into a new ticket (same customer, same SR,
 *                   approvals carried over) that stays open as pending work; vendor prices and pictures move with it.
 *                   Not reversible. The original ticket can then be submitted without that item.
 */
function setItemQuoteStatus(ticketId, itemId, status, reason, expectedVersion) {
  return api_('setItemQuoteStatus', function () {
    return withLock_(function () {
      const u = currentUser_();
      const t = ticketForUser_(u, ticketId);
      if (!(u.role === 'sr' && t.sr_email === u.email && (t.stage === 'sourcing' || t.stage === 'doc_check'))) {
        throw appError_('FORBIDDEN', 'ตั้งสถานะรายการได้เฉพาะ SR ผู้รับงาน ในขั้นตอนตรวจเอกสาร / หาราคา');
      }
      requireVersion_(t, expectedVersion);
      const st = String(status || '');
      if (ITEM_QUOTE_STATUS_.indexOf(st) === -1) throw appError_('VALIDATION', 'สถานะรายการไม่ถูกต้อง');
      const items = activeItemsOf_(t.ticket_id);
      const it = items.filter(function (x) { return x.item_id === String(itemId); })[0];
      if (!it) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้าในใบนี้');
      if (it.quote_status === 'follow_up') throw appError_('ITEM_SPLIT', 'รายการนี้แยกไปส่งตามหลังแล้ว แก้กลับไม่ได้');
      const why = cleanText_(reason, 500);
      const now = new Date();
      let followUp = null;

      if (st === 'quote') {
        if (!it.quote_status) throw appError_('VALIDATION', 'รายการนี้อยู่ในสถานะเสนอราคาอยู่แล้ว');
        updateRow_(TAB.ITEMS, it.item_id, { quote_status: '', quote_status_reason: '', updated_at: now });
      } else {
        if (it.quote_status === st) throw appError_('VALIDATION', 'รายการนี้ตั้งสถานะนี้ไว้แล้ว');
        if (why.length < 3) throw appError_('COMMENT_REQUIRED', st === 'not_offered' ? 'กรุณาระบุเหตุผลที่ไม่เสนอราคา' : 'กรุณาระบุเหตุผล / กำหนดส่งตามหลัง');
        if (st === 'follow_up') {
          const staying = items.filter(function (x) { return x.item_id !== it.item_id && x.quote_status !== 'follow_up'; });
          if (!staying.length) throw appError_('LAST_ITEM', 'ส่งตามหลังทุกรายการไม่ได้ — ถ้ายังหาราคาไม่ได้ทั้งใบ ให้ทำต่อในใบเดิม');
          followUp = splitFollowUp_(u, t, it, why, now);
        }
        updateRow_(TAB.ITEMS, it.item_id, { quote_status: st, quote_status_reason: why, gp_percent: '', sell_price_thb: '',
          follow_up_ticket_id: followUp ? followUp.ticket_id : '', updated_at: now });
        // a not-offered item has no winner
        activeQuotesOfItem_(it.item_id).filter(function (q) { return q.is_selected; }).forEach(function (q) {
          updateRow_(TAB.QUOTATIONS, q.quote_id, { is_selected: false, selection_reason: '', updated_at: now });
        });
      }
      const saved = normTicket_(updateRow_(TAB.TICKETS, t.ticket_id, { version: t.version + 1, updated_at: now }));
      appendLog_({ ticket_id: t.ticket_id, action: st === 'quote' ? 'item_quote_restored' : (st === 'not_offered' ? 'item_not_offered' : 'item_follow_up'),
        actor_email: u.email, actor_role: u.role, comment: why,
        metadata: { item_id: it.item_id, line_no: it.line_no, label: 'รายการที่ ' + it.line_no + ' ' + it.product_name,
          follow_up_ticket_no: followUp ? followUp.ticket_no : undefined } });
      if (followUp) {
        enqueueNotifications_([t.requestor_email, t.sr_email].concat(activeUsersByRole_('sr_manager').map(function (x) { return x.email; })), followUp,
          'item_follow_up', '[' + t.ticket_no + '] รายการที่ ' + it.line_no + ' ส่งราคาตามหลัง → ' + followUp.ticket_no,
          it.product_name + ' — ' + why + '\nแยกเป็นงานค้าง ' + followUp.ticket_no + ' (SR ' + u.full_name + ')', ticketLink_(followUp, 'ticket'));
      }
      return { ticket: publicTicket_(saved), follow_up: followUp ? { ticket_id: followUp.ticket_id, ticket_no: followUp.ticket_no } : null };
    });
  });
}

/** Create the follow-up ticket for one item. Runs inside withLock_ (called by setItemQuoteStatus). */
function splitFollowUp_(u, t, it, why, now) {
  const ticketId = uuid_();
  const ticket = {};
  SCHEMA.Tickets.cols.forEach(function (c) { ticket[c] = t[c] === undefined ? '' : t[c]; });
  Object.assign(ticket, {
    ticket_id: ticketId,
    ticket_no: nextTicketNo_(now),
    title: cleanText_('ส่งตามหลัง ' + t.ticket_no + ': ' + (t.customer_name || '') + ' — ' + it.product_name, 200),
    parent_ticket_id: t.ticket_id,
    // approvals of the request carry over; the job continues where the original one is
    status: STAGE_STATUS[t.stage], stage: t.stage, stage_entered_at: now, assigned_at: now,
    revision_count: 0, version: 1, info_request_json: '', rejection_reason: '',
    quote_submitted_at: '', sr_manager_email: '', sr_manager_approved_at: '', gm_price_approved_at: '',
    completed_at: '', closed_at: '', rejected_at: '', cancelled_at: '',
    client_key: '', created_at: now, updated_at: now,
    description: cleanText_((t.description ? t.description + '\n' : '') + 'แยกจาก ' + t.ticket_no + ' รายการที่ ' + it.line_no + ' — ' + why, CFG.MAX_TEXT)
  });
  insertRow_(TAB.TICKETS, ticket);
  const newItemId = uuid_();
  const src = findOne_(TAB.ITEMS, 'item_id', it.item_id);
  const item = {};
  SCHEMA.TicketItems.cols.forEach(function (c) { item[c] = src[c] === undefined ? '' : src[c]; });
  Object.assign(item, { item_id: newItemId, ticket_id: ticketId, line_no: 1, quote_status: '', quote_status_reason: '',
    follow_up_ticket_id: '', gp_percent: src.gp_percent === undefined ? '' : src.gp_percent, sell_price_thb: '', created_at: now, updated_at: now,
    deal_status: '', deal_reason: '', deal_note: '', deal_next_date: '', deal_updated_by: '', deal_updated_at: '', deal_closed_at: '',
    deal_stage: '', deal_next_step: '' });
  insertRow_(TAB.ITEMS, item);
  // vendor prices + item pictures + quotation files move with the item
  const moved = activeQuotesOfItem_(it.item_id).map(function (q) {
    updateRow_(TAB.QUOTATIONS, q.quote_id, { item_id: newItemId, ticket_id: ticketId, updated_at: now });
    return q.quote_id;
  });
  findAll_(TAB.ATTACHMENTS, 'ticket_id', t.ticket_id).forEach(function (a) {
    if (toBool_(a.is_deleted)) return;
    if (String(a.item_id) === it.item_id) updateRow_(TAB.ATTACHMENTS, a.attachment_id, { item_id: newItemId, ticket_id: ticketId });
    else if (a.quote_id && moved.indexOf(String(a.quote_id)) !== -1) updateRow_(TAB.ATTACHMENTS, a.attachment_id, { ticket_id: ticketId });
  });
  // document checklist: same template, keeping what the SR already ticked on the original
  generateChecklist_(ticketId);
  const done = {};
  checklistOf_(t.ticket_id).forEach(function (c) { if (c.is_checked) done[c.product_group_code + '|' + c.item_key] = c; });
  checklistOf_(ticketId).forEach(function (c) {
    const d = done[c.product_group_code + '|' + c.item_key];
    if (d) updateRow_(TAB.CHECKLIST, c.check_id, { is_checked: true, checked_by: d.checked_by, checked_at: now, note: d.note || '', updated_at: now });
  });
  appendLog_({ ticket_id: ticketId, log_type: 'transition', action: 'create', actor_email: u.email, actor_role: u.role,
    to_status: ticket.status, to_stage: ticket.stage, comment: why,
    metadata: { ticket_no: ticket.ticket_no, item_count: 1, split_from: t.ticket_no, split_line_no: it.line_no } });
  const fresh = normTicket_(ticket);
  enqueueGroupEvent_('follow_up', fresh, { lines: ['แยกจากใบ ' + t.ticket_no + ' รายการที่ ' + it.line_no + ' — SR จะส่งราคารายการนี้ตามหลัง'] });
  return fresh;
}


// ============================================================================
// Suppliers.gs
// ============================================================================
/**
 * File: Suppliers.gs
 * Supplier master (stored in the Vendors tab, so existing quotations keep their vendor_id).
 *
 *   - SR / SR Manager / Admin add and edit; a new supplier is usable at once (no approval step).
 *   - GM reads. Sales and Sales Manager never see suppliers (they are purchasing-side data).
 *   - Nothing is deleted: "ปิดใช้งาน" hides a supplier from search; old quotations still point to it.
 *   - A quotation stores a copy of every value when it is saved, so editing a supplier later never
 *     changes an old quotation (audit).
 *   - Every change is written to SupplierLogs (who, when, old → new).
 */

const SUPPLIER_EDIT_ROLES_ = ['sr', 'sr_manager', 'admin'];
const SUPPLIER_TYPES = ['local', 'import'];
const SUPPLIER_TYPE_LABEL = { local: 'ในประเทศ', import: 'นำเข้า' };
const SUPPLIER_FIELDS_ = ['name', 'short_name', 'tax_id', 'supplier_type', 'country', 'default_currency', 'default_vat_term',
  'payment_term', 'incoterm', 'lead_time_days', 'moq', 'validity_days', 'clearance_per_kg', 'brands', 'product_groups',
  'contact_name', 'phone', 'email', 'chat_id', 'certs', 'quality_note', 'note'];

function requireSupplierView_(u) {
  if (COST_ROLES_.indexOf(u.role) === -1) throw appError_('FORBIDDEN', 'ข้อมูล Supplier ดูได้เฉพาะฝ่ายจัดหา (SR / SR Manager / GM / Admin)');
}
function requireSupplierEdit_(u) {
  if (SUPPLIER_EDIT_ROLES_.indexOf(u.role) === -1) throw appError_('FORBIDDEN', 'เพิ่ม / แก้ไข Supplier ได้เฉพาะ SR, SR Manager และ Admin');
}

/** "บริษัท ซีฟู้ด เทรดดิ้ง จำกัด" / "Seafood Trading Co., Ltd." → comparable key (no legal words, spaces, punctuation). */
function normSupplierName_(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/บริษัท|บจก\.?|จำกัด|\(มหาชน\)|มหาชน|ห้างหุ้นส่วน|หจก\.?/g, ' ');
  s = s.replace(/[.,()&\-_/]/g, ' ');
  s = s.split(/\s+/).filter(function (w) {
    return w && ['co', 'company', 'ltd', 'limited', 'pvt', 'pte', 'inc', 'corp', 'corporation', 'llc', 'plc', 'pcl', 'public', 'as', 'gmbh', 'sa', 'bhd', 'sdn', 'tbk', 'jsc'].indexOf(w) === -1;
  }).join('');
  return s;
}

function normSupplier_(r) {
  return {
    vendor_id: String(r.vendor_id), name: String(r.name || ''), short_name: String(r.short_name || ''), tax_id: String(r.tax_id || ''),
    supplier_type: String(r.supplier_type || ''), country: String(r.country || ''),
    default_currency: String(r.default_currency || 'THB'), default_vat_term: String(r.default_vat_term || ''),
    payment_term: String(r.payment_term || ''), incoterm: String(r.incoterm || ''),
    lead_time_days: r.lead_time_days === '' || r.lead_time_days == null ? null : Number(r.lead_time_days),
    moq: r.moq === '' || r.moq == null ? null : Number(r.moq),
    validity_days: r.validity_days === '' || r.validity_days == null ? null : Number(r.validity_days),
    clearance_per_kg: r.clearance_per_kg === '' || r.clearance_per_kg == null ? null : Number(r.clearance_per_kg),
    brands: String(r.brands || ''), product_groups: String(r.product_groups || '').split(',').map(function (x) { return x.trim(); }).filter(String),
    contact_name: String(r.contact_name || ''), phone: String(r.phone || ''), email: String(r.email || ''), chat_id: String(r.chat_id || ''),
    certs: parseJson_(r.certs_json, []), quality_note: String(r.quality_note || ''), note: String(r.note || ''),
    is_active: r.is_active === '' || r.is_active == null ? true : toBool_(r.is_active),
    version: Number(r.version || 1),
    created_by: String(r.created_by || ''), created_at: isoOrBlank_(r.created_at),
    updated_by: String(r.updated_by || ''), updated_at: isoOrBlank_(r.updated_at)
  };
}

/** Certificates that expired (or expire within 30 days) — shown as warnings, never blocking. */
function certWarnings_(s) {
  const today = todayBkk_();
  const soon = fmtDate_(new Date(Date.now() + 30 * 86400000));
  return (s.certs || []).filter(function (c) { return c && c.expiry; }).map(function (c) {
    if (c.expiry < today) return { name: c.name, expiry: c.expiry, level: 'expired' };
    if (c.expiry <= soon) return { name: c.name, expiry: c.expiry, level: 'soon' };
    return null;
  }).filter(Boolean);
}

/** Supplier list (+ usage counts) for the Supplier page and the pricing-page search. */
function listSuppliers() {
  return api_('listSuppliers', function () {
    const u = currentUser_();
    requireSupplierView_(u);
    const used = {};
    rows_(TAB.QUOTATIONS).forEach(function (q) {
      if (toBool_(q.is_deleted) || !q.vendor_id) return;
      const k = String(q.vendor_id);
      const x = used[k] = used[k] || { quotes: 0, wins: 0, last: '' };
      x.quotes++;
      if (toBool_(q.is_selected)) x.wins++;
      const at = isoOrBlank_(q.updated_at || q.created_at);
      if (at > x.last) x.last = at;
    });
    const rows = rows_(TAB.VENDORS).map(normSupplier_).map(function (s) {
      const x = used[s.vendor_id] || { quotes: 0, wins: 0, last: '' };
      s.quote_count = x.quotes; s.win_count = x.wins; s.last_used_at = x.last;
      s.cert_warnings = certWarnings_(s);
      return s;
    }).sort(function (a, b) { return (b.is_active - a.is_active) || a.name.localeCompare(b.name, 'th'); });
    return { suppliers: rows, can_edit: SUPPLIER_EDIT_ROLES_.indexOf(u.role) !== -1, can_manage: ['sr_manager', 'admin'].indexOf(u.role) !== -1 };
  });
}

function cleanSupplier_(p, groups) {
  const out = {};
  out.name = requireText_(p.name, 'ชื่อ Supplier', 200);
  out.short_name = cleanText_(p.short_name, 200);
  out.tax_id = cleanText_(p.tax_id, 30).replace(/[\s-]/g, '');
  if (out.tax_id && !/^[0-9A-Za-z]{5,20}$/.test(out.tax_id)) throw appError_('VALIDATION', 'เลขผู้เสียภาษีต้องเป็นตัวเลข/ตัวอักษร 5–20 หลัก', { field: 'tax_id' });
  out.supplier_type = String(p.supplier_type || '');
  if (SUPPLIER_TYPES.indexOf(out.supplier_type) === -1) throw appError_('VALIDATION', 'กรุณาเลือกประเภท Supplier (ในประเทศ / นำเข้า)', { field: 'supplier_type' });
  out.country = cleanText_(p.country, 60);
  out.default_currency = String(p.default_currency || '').toUpperCase();
  if (setting_('currencies', ['THB']).indexOf(out.default_currency) === -1) throw appError_('VALIDATION', 'สกุลเงินไม่อยู่ในรายการ', { field: 'default_currency' });
  out.default_vat_term = String(p.default_vat_term || '');
  if (VAT_TERMS.indexOf(out.default_vat_term) === -1) throw appError_('VALIDATION', 'กรุณาเลือกเงื่อนไข VAT', { field: 'default_vat_term' });
  out.payment_term = cleanText_(p.payment_term, 100);
  out.incoterm = cleanText_(p.incoterm, 30);
  if (out.incoterm && INCOTERMS.indexOf(out.incoterm) === -1) throw appError_('VALIDATION', 'Incoterm ไม่อยู่ในรายการ', { field: 'incoterm' });
  const num = function (k, label, o) {
    try { return toNumber_(p[k], label, Object.assign({ allowBlank: true, min: 0 }, o || {})); }
    catch (e) { if (e.isApp) e.details = { field: k }; throw e; }
  };
  out.lead_time_days = num('lead_time_days', 'Lead time (วัน)', { max: 365 });
  out.moq = num('moq', 'MOQ');
  out.validity_days = num('validity_days', 'จำนวนวันยืนราคา', { max: 365 });
  out.clearance_per_kg = num('clearance_per_kg', 'ค่าเคลียร์ประมาณการ (บาท/กก.)');
  ['lead_time_days', 'moq', 'validity_days', 'clearance_per_kg'].forEach(function (k) { if (out[k] === null) out[k] = ''; });
  out.brands = cleanText_(p.brands, 300);
  const pg = (Array.isArray(p.product_groups) ? p.product_groups : String(p.product_groups || '').split(','))
    .map(function (x) { return String(x).trim(); }).filter(String);
  pg.forEach(function (c) { if (!groups[c]) throw appError_('VALIDATION', 'ไม่พบกลุ่มสินค้า ' + c, { field: 'product_groups' }); });
  out.product_groups = pg.join(',');
  out.contact_name = cleanText_(p.contact_name, 100);
  out.phone = cleanText_(p.phone, 50);
  out.email = cleanText_(p.email, 120).toLowerCase();
  if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) throw appError_('VALIDATION', 'อีเมลไม่ถูกต้อง', { field: 'email' });
  out.chat_id = cleanText_(p.chat_id, 100);
  const certs = (Array.isArray(p.certs) ? p.certs : []).slice(0, 20).map(function (c) {
    const name = cleanText_(c && c.name, 60);
    if (!name) return null;
    const expiry = c.expiry ? fmtDate_(parseYmd_(c.expiry, 'วันหมดอายุใบรับรอง ' + name, true)) : '';
    return { name: name, expiry: expiry };
  }).filter(Boolean);
  out.certs_json = JSON.stringify(certs);
  out.quality_note = cleanText_(p.quality_note, 1000);
  out.note = cleanText_(p.note, 1000);
  return out;
}

/** Same normalized name = duplicate (refused); one name inside the other = similar (asks once). */
function supplierDuplicates_(clean, selfId) {
  const key = normSupplierName_(clean.name);
  const others = rows_(TAB.VENDORS).map(normSupplier_).filter(function (s) { return s.vendor_id !== selfId; });
  const same = others.filter(function (s) { return normSupplierName_(s.name) === key || (s.short_name && normSupplierName_(s.short_name) === key); });
  const tax = clean.tax_id ? others.filter(function (s) { return s.tax_id && s.tax_id === clean.tax_id; }) : [];
  const similar = key.length >= 4 ? others.filter(function (s) {
    const k = normSupplierName_(s.name);
    return k && k !== key && (k.indexOf(key) !== -1 || key.indexOf(k) !== -1);
  }) : [];
  return { same: same, tax: tax, similar: similar };
}

/**
 * Create or update a supplier. payload = fields + vendor_id? + expected_version? + allow_similar?
 * Returns { supplier }. A new supplier can be used in a quotation right away.
 */
function saveSupplier(payload) {
  return api_('saveSupplier', function () {
    return withLock_(function () {
      const u = currentUser_();
      requireSupplierEdit_(u);
      return { supplier: saveSupplierCore_(u, payload || {}) };
    });
  });
}

function saveSupplierCore_(u, p) {
  const groups = {};
  rows_(TAB.PRODUCT_GROUPS).forEach(function (g) { groups[String(g.code)] = g; });
  const clean = cleanSupplier_(p, groups);
  const id = cleanText_(p.vendor_id, 64);
  const existing = id ? findOne_(TAB.VENDORS, 'vendor_id', id) : null;
  if (id && !existing) throw appError_('NOT_FOUND', 'ไม่พบ Supplier');
  if (existing && Number(p.expected_version) !== Number(existing.version || 1)) {
    throw appError_('VERSION_CONFLICT', 'ข้อมูล Supplier นี้ถูกแก้โดยผู้ใช้อื่นแล้ว กรุณาเปิดใหม่แล้วแก้อีกครั้ง');
  }
  const dup = supplierDuplicates_(clean, id);
  if (dup.same.length) {
    throw appError_('DUPLICATE', 'มี Supplier ชื่อนี้อยู่แล้ว: ' + dup.same[0].name, { field: 'name', vendor_id: dup.same[0].vendor_id });
  }
  if (dup.tax.length) {
    throw appError_('DUPLICATE', 'เลขผู้เสียภาษีนี้เป็นของ ' + dup.tax[0].name + ' อยู่แล้ว', { field: 'tax_id', vendor_id: dup.tax[0].vendor_id });
  }
  if (dup.similar.length && !p.allow_similar && !existing) {
    throw appError_('SIMILAR', 'มีชื่อคล้ายกัน: ' + dup.similar.slice(0, 3).map(function (s) { return s.name; }).join(', ') + ' — ถ้าเป็นคนละบริษัทกด “บันทึกต่อ”',
      { similar: dup.similar.slice(0, 3).map(function (s) { return { vendor_id: s.vendor_id, name: s.name }; }) });
  }
  const now = new Date();
  let saved;
  if (existing) {
    const before = normSupplier_(existing);
    clean.updated_by = u.email; clean.updated_at = now; clean.version = Number(existing.version || 1) + 1;
    saved = updateRow_(TAB.VENDORS, id, clean);
    const diff = {};
    SUPPLIER_FIELDS_.forEach(function (k) {
      const a = k === 'certs' ? JSON.stringify(before.certs) : String(before[k] == null ? '' : before[k]);
      const b = k === 'certs' ? clean.certs_json : String(clean[k] == null ? '' : clean[k]);
      if (k === 'product_groups') { if (before.product_groups.join(',') !== clean.product_groups) diff[k] = { old: before.product_groups.join(','), 'new': clean.product_groups }; return; }
      if (a !== b) diff[k] = { old: a, 'new': b };
    });
    if (Object.keys(diff).length) supplierLog_(u, id, 'updated', diff);
  } else {
    const row = Object.assign({ vendor_id: nextSupplierId_(), is_active: true, created_by: u.email, created_at: now,
      updated_by: u.email, updated_at: now, version: 1 }, clean);
    insertRow_(TAB.VENDORS, row);
    supplierLog_(u, row.vendor_id, 'created', { name: { old: '', 'new': row.name } });
    saved = row;
  }
  return normSupplier_(findOne_(TAB.VENDORS, 'vendor_id', String(saved.vendor_id)));
}

/** SUP-0001 style ids; old V-0001 ids stay as they are. Must run inside withLock_. */
function nextSupplierId_() {
  const n = nextCounter_('supplier_no');
  let id = 'SUP-' + ('000' + n).slice(-Math.max(4, String(n).length));
  while (findOne_(TAB.VENDORS, 'vendor_id', id)) id = 'SUP-' + ('000' + nextCounter_('supplier_no')).slice(-4);
  return id;
}

function supplierLog_(u, vendorId, action, diff) {
  insertRow_(TAB.SUPPLIER_LOGS, { log_id: uuid_(), ts: new Date(), vendor_id: vendorId, actor_email: u.email, actor_role: u.role,
    action: action, diff_json: JSON.stringify(diff || {}) });
}

/** Turn a supplier off (hidden from search) or back on. SR Manager / Admin. */
function setSupplierActive(vendorId, active, expectedVersion) {
  return api_('setSupplierActive', function () {
    return withLock_(function () {
      const u = currentUser_();
      if (['sr_manager', 'admin'].indexOf(u.role) === -1) throw appError_('FORBIDDEN', 'ปิด / เปิดใช้งาน Supplier ได้เฉพาะ SR Manager และ Admin');
      const r = findOne_(TAB.VENDORS, 'vendor_id', cleanText_(vendorId, 64));
      if (!r) throw appError_('NOT_FOUND', 'ไม่พบ Supplier');
      if (Number(expectedVersion) !== Number(r.version || 1)) throw appError_('VERSION_CONFLICT', 'ข้อมูล Supplier นี้ถูกแก้โดยผู้ใช้อื่นแล้ว กรุณาเปิดใหม่');
      const on = !!active;
      updateRow_(TAB.VENDORS, r.vendor_id, { is_active: on, version: Number(r.version || 1) + 1, updated_by: u.email, updated_at: new Date() });
      supplierLog_(u, String(r.vendor_id), on ? 'activated' : 'deactivated', { is_active: { old: String(!on), 'new': String(on) } });
      return { supplier: normSupplier_(findOne_(TAB.VENDORS, 'vendor_id', String(r.vendor_id))) };
    });
  });
}

/**
 * Merge a duplicate into the supplier that stays: quotations are re-pointed, the duplicate is
 * turned off. Quotation values themselves are not changed (they are snapshots). SR Manager / Admin.
 */
function mergeSuppliers(fromId, intoId) {
  return api_('mergeSuppliers', function () {
    return withLock_(function () {
      const u = currentUser_();
      if (['sr_manager', 'admin'].indexOf(u.role) === -1) throw appError_('FORBIDDEN', 'รวม Supplier ได้เฉพาะ SR Manager และ Admin');
      const from = findOne_(TAB.VENDORS, 'vendor_id', cleanText_(fromId, 64));
      const into = findOne_(TAB.VENDORS, 'vendor_id', cleanText_(intoId, 64));
      if (!from || !into) throw appError_('NOT_FOUND', 'ไม่พบ Supplier');
      if (String(from.vendor_id) === String(into.vendor_id)) throw appError_('VALIDATION', 'เลือก Supplier คนละรายการ');
      let moved = 0;
      rows_(TAB.QUOTATIONS).filter(function (q) { return String(q.vendor_id) === String(from.vendor_id); }).forEach(function (q) {
        updateRow_(TAB.QUOTATIONS, q.quote_id, { vendor_id: String(into.vendor_id) });
        moved++;
      });
      updateRow_(TAB.VENDORS, from.vendor_id, { is_active: false, note: cleanText_('รวมเข้ากับ ' + into.vendor_id + ' ' + into.name + (from.note ? ' · ' + from.note : ''), 1000),
        version: Number(from.version || 1) + 1, updated_by: u.email, updated_at: new Date() });
      supplierLog_(u, String(from.vendor_id), 'merged', { into: { old: '', 'new': String(into.vendor_id) }, quotations: { old: '', 'new': String(moved) } });
      supplierLog_(u, String(into.vendor_id), 'merged_in', { from: { old: '', 'new': String(from.vendor_id) } });
      return { moved_quotations: moved };
    });
  });
}

/** Change history of one supplier (newest first). */
function getSupplierLog(vendorId) {
  return api_('getSupplierLog', function () {
    const u = currentUser_();
    requireSupplierView_(u);
    const names = {};
    rows_(TAB.USERS).forEach(function (r) { names[String(r.email).toLowerCase()] = String(r.full_name); });
    return findAll_(TAB.SUPPLIER_LOGS, 'vendor_id', cleanText_(vendorId, 64)).map(function (l) {
      return { ts: isoOrBlank_(l.ts), action: String(l.action), actor_name: names[String(l.actor_email).toLowerCase()] || String(l.actor_email),
        diff: parseJson_(l.diff_json, {}) };
    }).sort(function (a, b) { return a.ts < b.ts ? 1 : -1; });
  });
}

/**
 * For the pricing page: per item, the latest quotation of each supplier for the SAME product
 * (other tickets, newest first) — shown as a hint under the price box, never filled in.
 * Falls back to the same product group when the product name differs.
 */
function supplierHints(ticketId) {
  return api_('supplierHints', function () {
    const u = currentUser_();
    requireSupplierView_(u);
    const t = ticketForUser_(u, ticketId);
    const items = activeItemsOf_(t.ticket_id);
    const key = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
    const itemsById = {};
    rows_(TAB.ITEMS).forEach(function (r) { itemsById[String(r.item_id)] = r; });
    const quotes = rows_(TAB.QUOTATIONS).filter(function (q) { return !toBool_(q.is_deleted) && q.vendor_id && String(q.ticket_id) !== t.ticket_id; })
      .map(function (q) { return { q: q, it: itemsById[String(q.item_id)] }; })
      .filter(function (x) { return x.it; })
      .sort(function (a, b) { return isoOrBlank_(b.q.updated_at || b.q.created_at) < isoOrBlank_(a.q.updated_at || a.q.created_at) ? -1 : 1; });
    const out = {};
    items.forEach(function (it) {
      const map = {};
      quotes.forEach(function (x) {
        const vid = String(x.q.vendor_id);
        const same = key(x.it.product_name) === key(it.product_name);
        const group = String(x.it.product_group_code) === it.product_group_code;
        if (!same && !group) return;
        const prev = map[vid];
        if (prev && (prev.match === 'product' || !same)) return;
        const tk = findOne_(TAB.TICKETS, 'ticket_id', x.q.ticket_id);
        map[vid] = {
          match: same ? 'product' : 'group', product_name: String(x.it.product_name),
          unit_price: Number(x.q.unit_price), currency: String(x.q.currency), vat_term: String(x.q.vat_term),
          at: fmtDate_(x.q.updated_at || x.q.created_at), ticket_no: tk ? String(tk.ticket_no) : '',
          packing: String(x.q.packing || ''), shelf_life: String(x.q.shelf_life || ''), brand: String(x.q.brand || ''),
          origin_country: String(x.q.origin_country || '')
        };
      });
      out[it.item_id] = map;
    });
    return { hints: out };
  });
}

/**
 * One-off (safe to re-run): suppliers for every vendor name typed into old quotations, and
 * vendor_id filled in on those quotations. Owner / Admin. Also run by setupDatabase().
 */
function migrateSuppliers() {
  requireAdminOrOwner_();
  return withLock_(function () { return migrateSuppliersCore_(); });
}

function migrateSuppliersCore_() {
  const now = new Date();
  const byKey = {};
  rows_(TAB.VENDORS).forEach(function (v) {
    byKey[normSupplierName_(v.name)] = String(v.vendor_id);
    const patch = {};
    if (!v.version) patch.version = 1;
    if (!v.supplier_type) patch.supplier_type = String(v.default_currency || 'THB') === 'THB' ? 'local' : 'import';
    if (Object.keys(patch).length) updateRow_(TAB.VENDORS, v.vendor_id, patch);
  });
  let created = 0;
  let linked = 0;
  rows_(TAB.QUOTATIONS).forEach(function (q) {
    if (q.vendor_id || !String(q.vendor_name || '').trim()) return;
    const k = normSupplierName_(q.vendor_name);
    if (!k) return;
    let id = byKey[k];
    if (!id) {
      id = nextSupplierId_();
      insertRow_(TAB.VENDORS, { vendor_id: id, name: String(q.vendor_name).trim(), supplier_type: String(q.currency) === 'THB' ? 'local' : 'import',
        country: String(q.origin_country || ''), default_currency: String(q.currency || 'THB'), default_vat_term: String(q.vat_term || ''),
        payment_term: String(q.payment_term || ''), incoterm: String(q.incoterm || ''), is_active: true,
        created_by: 'migration', created_at: now, updated_by: 'migration', updated_at: now, version: 1 });
      byKey[k] = id;
      created++;
    }
    updateRow_(TAB.QUOTATIONS, q.quote_id, { vendor_id: id });
    linked++;
  });
  return { created: created, linked: linked };
}


// ============================================================================
// Deals.gs
// ============================================================================
/**
 * File: Deals.gs
 * After the price — did the customer buy?  (New Item follow-up + GP / close-rate summary)
 *
 * Every item that got a GM-approved selling price becomes one "deal" line:
 *   product the customer is interested in · volume per month (qty) · price the customer expects (target_price)
 *   · selling price we quoted · deal status (follow / sample / won / lost) · next follow-up date.
 *
 *   listDeals()        Sales side view (no cost) — Sales: own · Sales Manager / GM / Admin / SR Manager / SR: everyone they can see
 *                      (SR / SR Manager use it per Sourcing person to follow up Sales in the weekly meeting — read only)
 *   updateDeal()       Sales (owner), the department's Sales Manager or Admin record the outcome
 *   getGpSummary()     GM / SR Manager / Admin only: + landed cost, GP %, profit — trend of quoted vs closed
 *
 * Nothing here changes the ticket workflow or its version: the deal is Sales' follow-up after the price.
 */

const DEAL_STAGES_ = ['awaiting_sales_ack', 'closed'];
const GP_ROLES_ = ['gm', 'sr_manager', 'admin'];

function dealFollowDays_() {
  const n = Number(setting_('deal_follow_days', 7));
  return isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 90) : 7;
}

/** Quoted lines (items with a GM-approved selling price) of tickets `u` may see. Cost fields only for GP_ROLES_. */
function dealRows_(u, withCost) {
  const ctx = listContext_();
  const tickets = {};
  rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
    if (DEAL_STAGES_.indexOf(t.stage) !== -1 && t.gm_price_approved_at && canSeeTicket_(u, t)) tickets[t.ticket_id] = t;
  });
  const winners = {};
  rows_(TAB.QUOTATIONS).forEach(function (q) {
    if (toBool_(q.is_selected) && !toBool_(q.is_deleted) && tickets[String(q.ticket_id)]) winners[String(q.item_id)] = normQuote_(q);
  });
  const today = todayBkk_();
  const followDays = dealFollowDays_();
  const out = [];
  Object.keys(tickets).forEach(function (id) {
    const t = tickets[id];
    activeItemsOf_(id).forEach(function (it) {
      if (it.quote_status) return;
      const win = winners[it.item_id];
      if (!win) return;
      const p = itemPricing_(it, win);
      const quotedAt = new Date(t.gm_price_approved_at);
      const quotedYmd = fmtDate_(quotedAt);
      const open = it.deal_status !== 'won' && it.deal_status !== 'lost';
      // same rule as the MGS Sales app: an open deal needs an update when the follow-up date has come,
      // or nobody updated it for deal_follow_days (counted from the price / the last update)
      const lastTouch = it.deal_updated_at ? new Date(it.deal_updated_at) : quotedAt;
      const stale = fmtDate_(new Date(lastTouch.getTime() + followDays * 86400000)) <= today;
      const due = open && ((it.deal_next_date && it.deal_next_date <= today) || stale);
      const row = {
        ticket_id: t.ticket_id, ticket_no: String(t.ticket_no), item_id: it.item_id, line_no: it.line_no,
        customer_name: String(t.customer_name || ''), customer_group: String(t.customer_group || ''),
        destination_country: String(t.destination_country || ''),
        requestor_email: t.requestor_email, requestor_name: ctx.names[t.requestor_email] || t.requestor_email,
        department_code: String(t.department_code || ''), sr_email: String(t.sr_email || ''), sr_name: t.sr_email ? (ctx.names[t.sr_email] || t.sr_email) : '',
        product_name: it.product_name, product_group_code: it.product_group_code, size: it.size, packing_size: it.packing_size,
        net_weight: it.net_weight, spec: it.spec,
        qty: it.qty, uom: it.uom, target_price: it.target_price || 0,
        sell_price_thb: p.sell_price_thb, target_diff_pct: p.target_diff_pct,
        valid_until: win.valid_until || '', quoted_at: quotedAt.toISOString(), quoted_ymd: quotedYmd, quoted_month: quotedYmd.slice(0, 7),
        ticket_stage: t.stage, ticket_stage_label: STAGE_LABEL_TH[t.stage],
        deal_status: it.deal_status, deal_status_label: DEAL_STATUS_LABEL_TH[it.deal_status] || it.deal_status,
        deal_reason: it.deal_reason, deal_note: it.deal_note, deal_next_date: it.deal_next_date,
        deal_updated_at: it.deal_updated_at, deal_updated_by: it.deal_updated_by ? (ctx.names[it.deal_updated_by] || it.deal_updated_by) : '',
        deal_closed_at: it.deal_closed_at, is_open: open, is_due: due,
        deal_stage: it.deal_stage, deal_next_step: it.deal_next_step,
        days_since_update: Math.max(0, Math.floor((Date.now() - lastTouch.getTime()) / 86400000)),
        monthly_value_thb: round_(p.sell_price_thb * it.qty, 2),
        // offer terms Sales sends the customer (no cost) — for "คัดลอกเป็นข้อความ"
        offer: salesPricing_(it, win),
        can_edit: canEditDeal_(u, t)
      };
      if (withCost) {
        row.vendor_name = p.vendor_name;
        row.landed_cost_thb = p.landed_cost_thb;
        row.gp_percent = p.gp_percent;
        row.profit_thb = p.profit_thb;
      }
      out.push(row);
    });
  });
  out.sort(function (a, b) { return a.quoted_at < b.quoted_at ? 1 : a.quoted_at > b.quoted_at ? -1 : a.line_no - b.line_no; });
  return out;
}

/** Sales (owner), the Sales Manager of that department, or Admin. */
function canEditDeal_(u, t) {
  if (DEAL_STAGES_.indexOf(t.stage) === -1) return false;
  if (u.role === 'admin') return true;
  if (u.role === 'sales') return t.requestor_email === u.email;
  if (u.role === 'manager') {
    const d = departmentByCode_(t.department_code);
    return !!d && d.manager_email === u.email;
  }
  return false;
}

/** Follow-up list (no cost data for anyone — the GP view is getGpSummary). */
function listDeals() {
  return api_('listDeals', function () {
    const u = currentUser_();
    return {
      rows: dealRows_(u, false),
      today: todayBkk_(),
      follow_days: dealFollowDays_(),
      lost_reasons: setting_('deal_lost_reasons', []),
      customer_stages: setting_('deal_customer_stages', []),
      next_steps: setting_('deal_next_steps', []),
      people: u.role === 'sales' ? [] : activeUsersByRole_('sales').map(function (x) { return { email: x.email, full_name: x.full_name, department_code: x.department_code }; }),
      // Sourcing view (weekly meeting with Sales): one card per SR who priced the lines — same Sales-side data, no cost / GP
      sourcing: u.role === 'sales' ? [] : activeUsersByRole_('sr').map(function (x) { return { email: x.email, full_name: x.full_name }; }),
      default_sr: u.role === 'sr' ? u.email : '',
      statuses: [''].concat(DEAL_STATUSES).map(function (k) { return { key: k, label: DEAL_STATUS_LABEL_TH[k] }; }),
      can_see_everyone: u.role !== 'sales'
    };
  });
}

/**
 * patch: { status: 'follow'|'sample'|'won'|'lost', reason? (required for lost), note?, next_date? (yyyy-MM-dd),
 *          stage? (Settings deal_customer_stages), next_step? (Settings deal_next_steps) }
 * follow / sample without a date → next follow-up = today + deal_follow_days.
 */
function updateDeal(itemId, patch) {
  return api_('updateDeal', function () {
    return withLock_(function () {
      const u = currentUser_();
      const p = patch || {};
      const row = findOne_(TAB.ITEMS, 'item_id', cleanText_(itemId, 64));
      if (!row || toBool_(row.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบรายการสินค้า');
      const t = ticketForUser_(u, row.ticket_id);
      if (!canEditDeal_(u, t)) {
        throw appError_('FORBIDDEN', DEAL_STAGES_.indexOf(t.stage) === -1
          ? 'อัปเดตผลการขายได้หลัง GM อนุมัติราคาและส่งถึง Sales แล้ว'
          : 'อัปเดตผลการขายได้เฉพาะ Sales เจ้าของคำขอ, Sales Manager ของแผนก หรือผู้ดูแลระบบ');
      }
      if (String(row.quote_status || '')) throw appError_('INVALID_STATE', 'รายการนี้ไม่ได้เสนอราคา จึงไม่มีผลการขาย');
      const status = oneOf_(p.status, DEAL_STATUSES, 'สถานะการขาย');
      const stages = setting_('deal_customer_stages', []);
      const steps = setting_('deal_next_steps', []);
      const stage = cleanText_(p.stage, 100);
      const nextStep = cleanText_(p.next_step, 100);
      if (stage && stages.length && stages.indexOf(stage) === -1) throw appError_('VALIDATION', 'สถานะกับลูกค้าไม่อยู่ในรายการ');
      if (nextStep && steps.length && steps.indexOf(nextStep) === -1) throw appError_('VALIDATION', 'ขั้นตอนถัดไปไม่อยู่ในรายการ');
      const reasons = setting_('deal_lost_reasons', []);
      let reason = cleanText_(p.reason, 200);
      const note = cleanText_(p.note, CFG.MAX_TEXT);
      if (status === 'lost') {
        if (!reason) throw appError_('VALIDATION', 'กรุณาเลือกเหตุผลที่ไม่ได้งาน');
        if (reasons.length && reasons.indexOf(reason) === -1) throw appError_('VALIDATION', 'เหตุผลไม่อยู่ในรายการ');
        if (reason === 'อื่นๆ' && !note) throw appError_('VALIDATION', 'เลือก “อื่นๆ” กรุณาระบุรายละเอียดในหมายเหตุ');
      } else {
        reason = '';
      }
      let next = '';
      if (status === 'follow' || status === 'sample') {
        next = p.next_date ? parseYmd_(p.next_date, 'วันที่ติดตามครั้งถัดไป') : new Date(Date.now() + dealFollowDays_() * 86400000);
        if (fmtDate_(next) < todayBkk_()) throw appError_('VALIDATION', 'วันที่ติดตามครั้งถัดไปต้องไม่เป็นวันที่ผ่านมาแล้ว');
      }
      const before = { status: String(row.deal_status || ''), reason: String(row.deal_reason || '') };
      const now = new Date();
      updateRow_(TAB.ITEMS, String(row.item_id), {
        deal_status: status, deal_reason: reason, deal_note: note, deal_next_date: next,
        deal_stage: status === 'won' || status === 'lost' ? '' : stage, deal_next_step: status === 'won' || status === 'lost' ? '' : nextStep,
        deal_updated_by: u.email, deal_updated_at: now,
        deal_closed_at: status === 'won' || status === 'lost' ? (before.status === status && row.deal_closed_at ? row.deal_closed_at : now) : '',
        updated_at: now
      });
      appendLog_({ ticket_id: t.ticket_id, action: 'deal_update', actor_email: u.email, actor_role: u.role, comment: note,
        metadata: { item_id: String(row.item_id), line_no: Number(row.line_no), product_name: String(row.product_name),
          from: before.status, to: status, reason: reason, stage: stage, next_step: nextStep, next_date: next ? fmtDate_(next) : '' } });
      if (status === 'won' && before.status !== 'won') {
        const qty = Number(row.qty);
        enqueueGroupEvent_('deal_won', t, { lines: ['• #' + row.line_no + ' ' + row.product_name +
          ' — ลูกค้าใช้ประมาณ ' + fmtQty_(qty) + ' ' + row.uom + '/เดือน'] });
        // SR + SR Manager learn which of their prices sold (in-app + Lark DM, no price in the text)
        const srs = [t.sr_email].concat(activeUsersByRole_('sr_manager').map(function (x) { return x.email; }));
        enqueueNotifications_(srs, t, 'deal_won', '🎉 [' + t.ticket_no + '] ปิดการขายได้: ' + row.product_name,
          (t.customer_name || '') + ' — ' + u.full_name + ' อัปเดตว่าลูกค้าตกลงซื้อ', ticketLink_(t, 'ticket'));
      }
      const fresh = dealRows_(u, false).filter(function (r) { return r.item_id === String(row.item_id); })[0];
      return { deal: fresh || null };
    });
  });
}

/**
 * GP & close-rate summary (GM / SR Manager / Admin): every quoted line with its cost, GP and deal status.
 * The browser groups by month / customer group / Sales so filters never call the server again.
 */
function getGpSummary() {
  return api_('getGpSummary', function () {
    const u = currentUser_();
    requireRole_(u, GP_ROLES_, 'สรุป GP ดูได้เฉพาะ GM, SR Manager และผู้ดูแลระบบ');
    return {
      rows: dealRows_(u, true),
      today: todayBkk_(),
      lost_reasons: setting_('deal_lost_reasons', []),
      customer_groups: setting_('customer_groups', []),
      default_gp_percent: defaultGp_()
    };
  });
}


// ============================================================================
// Api.gs
// ============================================================================
/**
 * File: Api.gs
 * Read APIs for the web app: ticket list (filters + aging/SLA), inbox, notifications, dashboard.
 * Every function filters rows on the SERVER by canSeeTicket_() before returning anything.
 */

const AGING_BUCKETS_ = [
  { key: 'd0_2', label: '0–2 วัน', min: 0, max: 2 },
  { key: 'd3_5', label: '3–5 วัน', min: 3, max: 5 },
  { key: 'd6_10', label: '6–10 วัน', min: 6, max: 10 },
  { key: 'd10p', label: '>10 วัน', min: 11, max: Infinity }
];

// =============================================================================
// Ticket list
// =============================================================================

/**
 * query: { scope: 'all'|'mine'|'inbox'|'queue', status?: string[], stage?: string[], group_code?, requestor?, sr?,
 *          priority?, date_from?, date_to? (yyyy-MM-dd, created date), q?, sort?, page?, page_size? }
 */
function listTickets(query) {
  return api_('listTickets', function () {
    const u = currentUser_();
    const q = query || {};
    const scope = ['all', 'mine', 'inbox', 'queue'].indexOf(q.scope) !== -1 ? q.scope : 'all';
    const now = new Date();
    const ctx = listContext_();
    const statuses = Array.isArray(q.status) ? q.status.filter(function (s) { return STATUS.indexOf(s) !== -1; }) : [];
    const stages = Array.isArray(q.stage) ? q.stage.filter(function (s) { return STAGE_STATUS[s]; }) : [];
    const from = q.date_from ? parseYmd_(q.date_from, 'วันที่เริ่ม', true) : '';
    const to = q.date_to ? parseYmd_(q.date_to, 'วันที่สิ้นสุด', true) : '';
    const toEnd = to ? new Date(to.getTime() + 86400000) : '';
    const text = cleanText_(q.q, 100).toLowerCase();
    const groupCode = cleanText_(q.group_code, 50);

    let list = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); });
    if (scope === 'mine') {
      list = list.filter(function (t) { return u.role === 'sr' ? t.sr_email === u.email : t.requestor_email === u.email; });
    } else if (scope === 'inbox') {
      list = list.filter(function (t) { return isAssignee_(u, t, ctx); });
    } else if (scope === 'queue') {
      list = list.filter(function (t) { return t.stage === 'pending_assign'; });
    }
    if (statuses.length) list = list.filter(function (t) { return statuses.indexOf(t.status) !== -1; });
    if (stages.length) list = list.filter(function (t) { return stages.indexOf(t.stage) !== -1; });
    if (['done', 'open', 'rejected'].indexOf(q.outcome) !== -1) list = list.filter(function (t) { return outcome_(t) === q.outcome; });
    if (q.priority) list = list.filter(function (t) { return t.priority === q.priority; });
    if (q.requestor) list = list.filter(function (t) { return t.requestor_email === String(q.requestor).toLowerCase(); });
    if (q.sr) list = list.filter(function (t) { return t.sr_email === String(q.sr).toLowerCase(); });
    if (q.follow_up) list = list.filter(function (t) { return !!t.parent_ticket_id; });
    if (from) list = list.filter(function (t) { return new Date(t.created_at) >= from; });
    if (toEnd) list = list.filter(function (t) { return new Date(t.created_at) < toEnd; });

    let rows = list.map(function (t) { return summaryRow_(t, ctx, now); });
    if (groupCode) {
      rows = rows.filter(function (r) { return r.group_codes.indexOf(groupCode) !== -1 || r.root_codes.indexOf(groupCode) !== -1; });
    }
    if (text) {
      rows = rows.filter(function (r) {
        return (r.ticket_no + ' ' + r.title + ' ' + r.customer_name + ' ' + r.item_names + ' ' + r.requestor_name)
          .toLowerCase().indexOf(text) !== -1;
      });
    }

    const slaCounts = { ok: 0, warning: 0, breach: 0 };
    rows.forEach(function (r) { if (slaCounts[r.sla_status] !== undefined) slaCounts[r.sla_status]++; });

    const sorters = {
      updated_desc: function (a, b) { return b.updated_at < a.updated_at ? -1 : b.updated_at > a.updated_at ? 1 : 0; },
      created_desc: function (a, b) { return b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0; },
      // worst first: breach → warning → ok, then the longest waiting
      urgency: function (a, b) {
        const rank = { breach: 0, warning: 1, ok: 2, none: 3, done: 4 };
        return (rank[a.sla_status] - rank[b.sla_status]) || (b.stage_age_hours - a.stage_age_hours);
      },
      due_asc: function (a, b) { return (a.due_date || '9999') < (b.due_date || '9999') ? -1 : 1; }
    };
    rows.sort(sorters[q.sort] || (scope === 'inbox' || scope === 'queue' ? sorters.urgency : sorters.updated_desc));

    const pageSize = Math.min(Math.max(Number(q.page_size) || 50, 10), 200);
    const page = Math.max(Number(q.page) || 1, 1);
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page: page,
      page_size: pageSize,
      sla_counts: slaCounts
    };
  });
}

/** Data loaded once per request and shared by every row. */
function listContext_() {
  const itemsByTicket = {};
  rows_(TAB.ITEMS).forEach(function (r) {
    if (toBool_(r.is_deleted)) return;
    const k = String(r.ticket_id);
    (itemsByTicket[k] = itemsByTicket[k] || []).push(r);
  });
  const groups = {};
  rows_(TAB.PRODUCT_GROUPS).forEach(function (g) { groups[String(g.code)] = g; });
  const names = {};
  rows_(TAB.USERS).forEach(function (r) { names[String(r.email).toLowerCase()] = String(r.full_name); });
  const deptMgr = {};
  rows_(TAB.DEPARTMENTS).forEach(function (d) { deptMgr[String(d.code)] = String(d.manager_email || '').toLowerCase(); });
  const ticketNos = {};
  rows_(TAB.TICKETS).forEach(function (r) { ticketNos[String(r.ticket_id)] = String(r.ticket_no); });
  return {
    itemsByTicket: itemsByTicket, groups: groups, names: names, deptMgr: deptMgr, ticketNos: ticketNos,
    sla: setting_('sla_hours', {}), warn: Number(setting_('sla_warning_ratio', 0.8))
  };
}

function rootGroup_(code, groups) {
  let c = code;
  let guard = 0;
  while (groups[c] && groups[c].parent_code && guard++ < 10) c = String(groups[c].parent_code);
  return c;
}

/** Is this user the one who must act now? (no per-row sheet reads) */
function isAssignee_(u, t, ctx) {
  switch (t.stage) {
    case 'pending_manager': return u.role === 'manager' && (ctx.deptMgr[t.department_code] || t.manager_email) === u.email;
    case 'returned':
    case 'need_info':
    case 'awaiting_sales_ack': return t.requestor_email === u.email;
    case 'pending_gm': return u.role === 'gm' && t.manager_email !== u.email;
    case 'pending_assign': return u.role === 'sr';
    case 'doc_check':
    case 'sourcing': return t.sr_email === u.email;
    case 'pending_sr_manager': return u.role === 'sr_manager' && t.sr_email !== u.email;
    case 'pending_gm_price': return u.role === 'gm';
    default: return false;
  }
}

function slaInfo_(t, ctx, now) {
  const open = OPEN_STATUSES.indexOf(t.status) !== -1;
  const entered = t.stage_entered_at ? new Date(t.stage_entered_at) : new Date(t.created_at);
  const ageH = hoursBetween_(entered, now);
  const slaH = Number(ctx.sla[t.stage] || 0);
  let status = 'none';
  if (!open) status = 'done';
  else if (slaH > 0 && ageH >= slaH) status = 'breach';
  else if (slaH > 0 && ageH >= slaH * ctx.warn) status = 'warning';
  else if (slaH > 0) status = 'ok';
  return { stage_age_hours: round_(ageH, 1), sla_hours: slaH || null, sla_status: status };
}

function summaryRow_(t, ctx, now) {
  const items = (ctx.itemsByTicket[t.ticket_id] || []).slice().sort(function (a, b) { return Number(a.line_no) - Number(b.line_no); });
  const groupCodes = [];
  const rootCodes = [];
  items.forEach(function (i) {
    const c = String(i.product_group_code);
    if (groupCodes.indexOf(c) === -1) groupCodes.push(c);
    const r = rootGroup_(c, ctx.groups);
    if (rootCodes.indexOf(r) === -1) rootCodes.push(r);
  });
  const end = t.closed_at || t.rejected_at || t.cancelled_at;
  const sla = slaInfo_(t, ctx, now);
  return {
    ticket_id: t.ticket_id,
    ticket_no: String(t.ticket_no),
    title: String(t.title),
    customer_name: String(t.customer_name || ''),
    customer_group: String(t.customer_group || ''),
    destination_country: String(t.destination_country || ''),
    priority: String(t.priority),
    status: t.status,
    status_label: STATUS_LABEL_TH[t.status],
    stage: t.stage,
    stage_label: STAGE_LABEL_TH[t.stage],
    requestor_email: t.requestor_email,
    requestor_name: ctx.names[t.requestor_email] || t.requestor_email,
    sr_email: t.sr_email,
    sr_name: t.sr_email ? (ctx.names[t.sr_email] || t.sr_email) : '',
    department_code: String(t.department_code),
    due_date: t.due_date ? fmtDate_(t.due_date) : '',
    revision_count: t.revision_count,
    parent_ticket_no: t.parent_ticket_id && ctx.ticketNos ? (ctx.ticketNos[t.parent_ticket_id] || '') : '',
    item_count: items.length,
    item_names: items.map(function (i) { return String(i.product_name); }).join(' | '),
    group_codes: groupCodes,
    root_codes: rootCodes,
    age_days: Math.floor(hoursBetween_(new Date(t.created_at), end ? new Date(end) : now) / 24),
    stage_age_hours: sla.stage_age_hours,
    sla_hours: sla.sla_hours,
    sla_status: sla.sla_status,
    created_at: isoOrBlank_(t.created_at),
    updated_at: isoOrBlank_(t.updated_at)
  };
}

// =============================================================================
// Polling (badge counts) and notifications
// =============================================================================

function pollData_(u) {
  const ctx = listContext_();
  const inbox = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) {
    return canSeeTicket_(u, t) && isAssignee_(u, t, ctx);
  }).length;
  const unread = rows_(TAB.NOTIFICATIONS).filter(function (n) {
    return String(n.user_email).toLowerCase() === u.email && !toBool_(n.is_read);
  }).length;
  const out = { inbox: inbox, unread: unread, server_time: new Date().toISOString(),
    follow_up: myOpenFollowUps_(u).length };
  if (u.role === 'sales' || u.role === 'manager') {
    // deals waiting for a follow-up (Sales: own · Sales Manager: own department)
    out.deals_due = dealRows_(u, false).filter(function (r) { return r.is_due && r.can_edit; }).length;
  }
  if (u.role === 'gm') {
    const tickets = rows_(TAB.TICKETS).map(normTicket_);
    out.gm_sales = tickets.filter(function (t) { return t.stage === 'pending_gm' && t.manager_email !== u.email; }).length;
    out.gm_buy = tickets.filter(function (t) { return t.stage === 'pending_gm_price'; }).length;
  }
  return out;
}

/** Called every ~60 s by the page while it is visible. */
/**
 * Called every ~60 s by the page while it is visible. `views` = pages opened since the last poll
 * ({page: count}) → UsageLog, so unused screens can be found before anything is removed.
 */
function getPoll(views) {
  return api_('getPoll', function () {
    const u = currentUser_();
    logUsage_(u, views);
    return pollData_(u);
  });
}

function logUsage_(u, views) {
  if (!views || typeof views !== 'object') return;
  const day = todayBkk_();
  const rowsToAdd = Object.keys(views).filter(function (p) { return PAGES_.indexOf(p) !== -1 && Number(views[p]) > 0; }).map(function (p) {
    return { log_id: uuid_(), day: day, email: u.email, role: u.role, page: p, views: Math.min(Number(views[p]) || 0, 500) };
  });
  if (rowsToAdd.length) {
    try { insertRows_(TAB.USAGE_LOG, rowsToAdd); } catch (e) { console.warn('usage log failed', e); }   // never breaks polling
  }
}

/** Admin home card: delivery problems in the last 24 h. */
function getAdminHealth() {
  return api_('getAdminHealth', function () {
    const u = currentUser_();
    if (u.role !== 'admin') throw appError_('FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
    const since = Date.now() - 86400000;
    const recent = rows_(TAB.NOTIFICATIONS).filter(function (n) { return new Date(n.created_at).getTime() > since; });
    const count = function (st) { return recent.filter(function (n) { return String(n.lark_status) === st; }).length; };
    return { lark_failed: count('failed'), lark_no_user: count('no_lark_user'), lark_no_group: count('no_group'), lark_pending: count('pending'),
      lark_configured: larkConfigured_(), db_version: APP_VERSION };
  });
}

function getNotifications(limit) {
  return api_('getNotifications', function () {
    const u = currentUser_();
    const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const mine = rows_(TAB.NOTIFICATIONS)
      .filter(function (r) { return String(r.user_email).toLowerCase() === u.email; })
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return {
      unread: mine.filter(function (r) { return !toBool_(r.is_read); }).length,
      items: mine.slice(0, n).map(function (r) {
        return { notif_id: String(r.notif_id), ticket_id: String(r.ticket_id), type: String(r.type), title: String(r.title),
          body: String(r.body || ''), is_read: toBool_(r.is_read), created_at: isoOrBlank_(r.created_at),
          created_bkk: fmtDate_(r.created_at, 'dd/MM HH:mm') };
      })
    };
  });
}

/** ids: array of notif_id, or null/empty = mark all as read. */
function markNotificationsRead(ids) {
  return api_('markNotificationsRead', function () {
    return withLock_(function () {
      const u = currentUser_();
      const wanted = Array.isArray(ids) && ids.length ? ids.map(String) : null;
      const now = new Date();
      let count = 0;
      rows_(TAB.NOTIFICATIONS).filter(function (r) {
        return String(r.user_email).toLowerCase() === u.email && !toBool_(r.is_read) &&
          (!wanted || wanted.indexOf(String(r.notif_id)) !== -1);
      }).slice(0, 200).forEach(function (r) {
        updateRow_(TAB.NOTIFICATIONS, r.notif_id, { is_read: true, read_at: now });
        count++;
      });
      return { marked: count };
    });
  });
}

// =============================================================================
// Dashboard — simple summary: quoted (done) / not done / rejected, status list, per person
// Scope: Sales → own requests · SR → own jobs · Sales Manager, SR Manager, GM, Admin → everyone (they can see)
// =============================================================================

const DONE_STATUSES_ = ['completed', 'closed'];
const STAGE_ORDER_ = ['pending_manager', 'returned', 'pending_gm', 'pending_assign', 'doc_check', 'need_info', 'sourcing',
  'pending_sr_manager', 'pending_gm_price', 'awaiting_sales_ack', 'closed', 'rejected', 'cancelled'];

function outcome_(t) {
  if (DONE_STATUSES_.indexOf(t.status) !== -1) return 'done';
  if (t.status === 'rejected') return 'rejected';
  return 'open';
}

/** range: { from?: 'yyyy-MM-dd', to?: 'yyyy-MM-dd' } on created date — default: everything. */
function getDashboard(range) {
  return api_('getDashboard', function () {
    const u = currentUser_();
    const r = range || {};
    const from = r.from ? parseYmd_(r.from, 'วันที่เริ่ม') : null;
    const to = r.to ? parseYmd_(r.to, 'วันที่สิ้นสุด') : null;
    if (from && to && to < from) throw appError_('VALIDATION', 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
    const toEnd = to ? new Date(to.getTime() + 86400000) : null;
    const now = new Date();
    const ctx = listContext_();

    let tickets = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); });
    let scope = 'ทุกคน';
    if (u.role === 'sales') { tickets = tickets.filter(function (t) { return t.requestor_email === u.email; }); scope = 'ใบขอราคาของคุณ'; }
    if (u.role === 'sr') { tickets = tickets.filter(function (t) { return t.sr_email === u.email; }); scope = 'งานที่คุณรับผิดชอบ'; }
    if (from) tickets = tickets.filter(function (t) { return new Date(t.created_at) >= from; });
    if (toEnd) tickets = tickets.filter(function (t) { return new Date(t.created_at) < toEnd; });

    const kpi = { total: tickets.length, done: 0, open: 0, rejected: 0, breach: 0 };
    const byStage = {};
    const sales = {};
    const srs = {};
    tickets.forEach(function (t) {
      const o = outcome_(t);
      kpi[o]++;
      if (o === 'open' && slaInfo_(t, ctx, now).sla_status === 'breach') kpi.breach++;
      byStage[t.stage] = (byStage[t.stage] || 0) + 1;
      const k = t.requestor_email;
      sales[k] = sales[k] || { email: k, name: ctx.names[k] || k, total: 0, done: 0, open: 0, rejected: 0 };
      sales[k].total++;
      sales[k][o]++;
      if (t.sr_email) {
        const s = t.sr_email;
        srs[s] = srs[s] || { email: s, name: ctx.names[s] || s, total: 0, done: 0, open: 0, rejected: 0 };
        srs[s].total++;
        srs[s][o]++;
      }
    });
    const pct = function (n) { return kpi.total ? Math.round(n / kpi.total * 100) : 0; };
    const sortPeople = function (obj) {
      return Object.keys(obj).map(function (k) { return obj[k]; }).sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name, 'th'); });
    };

    const recent = tickets.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 10)
      .map(function (t) { return summaryRow_(t, ctx, now); });

    return {
      scope_note: scope,
      range: { from: from ? fmtDate_(from) : '', to: to ? fmtDate_(to) : '' },
      kpi: {
        total: kpi.total,
        done: kpi.done, done_pct: pct(kpi.done),
        open: kpi.open, open_pct: pct(kpi.open),
        rejected: kpi.rejected, rejected_pct: pct(kpi.rejected),
        breach: kpi.breach
      },
      by_stage: STAGE_ORDER_.filter(function (s) { return byStage[s]; }).map(function (s) {
        return { stage: s, label: STAGE_LABEL_TH[s], status: STAGE_STATUS[s], outcome: outcome_({ status: STAGE_STATUS[s] }), count: byStage[s] };
      }),
      by_sales: sortPeople(sales),
      by_sr: sortPeople(srs),
      recent: recent,
      follow_ups: myOpenFollowUps_(u).map(function (t) { return summaryRow_(t, ctx, now); }),
      can_see_everyone: ['manager', 'gm', 'admin', 'sr_manager'].indexOf(u.role) !== -1
    };
  });
}

function percentile_(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Open "send later" tickets (items an SR split out of a request) that this user should track:
 * Sales — their own requests · SR — their own jobs · everyone else — all they can see.
 */
function myOpenFollowUps_(u) {
  return rows_(TAB.TICKETS).map(normTicket_).filter(function (t) {
    if (!t.parent_ticket_id || outcome_(t) !== 'open' || !canSeeTicket_(u, t)) return false;
    if (u.role === 'sales') return t.requestor_email === u.email;
    if (u.role === 'sr') return t.sr_email === u.email;
    return true;
  }).sort(function (a, b) { return new Date(a.created_at) - new Date(b.created_at); });
}

// =============================================================================
// Ticket board — ONE call returns every ticket the user may see; the page filters,
// searches and counts in the browser (no round trip per filter = no lag, no race).
// =============================================================================

const BOARD_TTL_SEC_ = 300;
const BOARD_CHUNK_ = 90000;   // CacheService: 100 KB per value

/**
 * Rows = summaryRow_ (no prices) + flags for the status tabs.
 * Cached per user for 5 minutes; any write to tickets / items / users / settings starts a
 * new data version, so a cached list is never older than the last change.
 */
function listTicketBoard() {
  return api_('listTicketBoard', function () {
    const u = currentUser_();
    const key = 'brd:' + dataVersion_() + ':' + u.email;
    const cached = boardCacheGet_(key);
    if (cached) { cached.cached = true; return cached; }
    const now = new Date();
    const ctx = listContext_();
    const rows = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return canSeeTicket_(u, t); }).map(function (t) {
      const r = summaryRow_(t, ctx, now);
      r.is_inbox = isAssignee_(u, t, ctx);
      r.is_mine = u.role === 'sr' ? t.sr_email === u.email : t.requestor_email === u.email;
      r.is_follow_up = !!t.parent_ticket_id;
      r.outcome = outcome_(t);
      r.priority = String(t.priority);
      return r;
    });
    const out = { rows: rows, generated_at: now.toISOString(), cached: false };
    boardCachePut_(key, out);
    return out;
  });
}

function boardCacheGet_(key) {
  try {
    const c = CacheService.getScriptCache();
    const head = c.get(key);
    if (!head) return null;
    const n = Number(head);
    let s = '';
    for (let i = 0; i < n; i++) {
      const part = c.get(key + ':' + i);
      if (part === null) return null;
      s += part;
    }
    return JSON.parse(s);
  } catch (e) {
    return null;   // a cache problem only costs a fresh read
  }
}

function boardCachePut_(key, obj) {
  try {
    const s = JSON.stringify(obj);
    if (s.length > BOARD_CHUNK_ * 20) return;   // > ~1.8 MB: just don't cache
    const c = CacheService.getScriptCache();
    const n = Math.ceil(s.length / BOARD_CHUNK_) || 1;
    for (let i = 0; i < n; i++) c.put(key + ':' + i, s.slice(i * BOARD_CHUNK_, (i + 1) * BOARD_CHUNK_), BOARD_TTL_SEC_);
    c.put(key, String(n), BOARD_TTL_SEC_);
  } catch (e) {
    console.warn('board cache put failed', e);
  }
}

/**
 * Sales form helpers — ONLY the signed-in Sales' own requests: their customers (newest first, with the
 * documents asked last time) and their products (with the specs used last time). Never other Sales' data.
 */
function getSalesHistory() {
  return api_('getSalesHistory', function () {
    const u = currentUser_();
    if (u.role !== 'sales') return { customers: [], products: [] };
    const mine = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return t.requestor_email === u.email; })
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    const customers = [];
    const seenC = {};
    mine.forEach(function (t) {
      const name = String(t.customer_name || '').trim();
      const k = name.toLowerCase();
      if (!name || seenC[k]) return;
      seenC[k] = true;
      customers.push({ name: name, documents_needed: String(t.documents_needed || ''), customer_group: String(t.customer_group || ''),
        destination_country: String(t.destination_country || ''), last_at: fmtDate_(t.created_at) });
    });
    const ids = {};
    mine.forEach(function (t, i) { ids[t.ticket_id] = i; });
    const products = [];
    const seenP = {};
    rows_(TAB.ITEMS).filter(function (r) { return !toBool_(r.is_deleted) && ids[String(r.ticket_id)] !== undefined; })
      .sort(function (a, b) { return ids[String(a.ticket_id)] - ids[String(b.ticket_id)]; })
      .forEach(function (r) {
        const name = String(r.product_name || '').trim();
        const k = name.toLowerCase();
        if (!name || seenP[k]) return;
        seenP[k] = true;
        products.push({ name: name, product_group_code: String(r.product_group_code || ''), net_weight: String(r.net_weight || ''),
          size: String(r.size || ''), packing_size: String(r.packing_size || ''), uom: String(r.uom || '') });
      });
    return { customers: customers.slice(0, 100), products: products.slice(0, 200) };
  });
}


// ============================================================================
// Files.gs
// ============================================================================
/**
 * File: Files.gs
 * Attachments in Google Drive (folder per ticket, never shared publicly).
 *
 * Upload (≤ 20 MB) uses a Drive *resumable upload session* driven from the server:
 *   1. beginUpload(meta)            → server opens a session with the owner's token, returns upload_id
 *   2. uploadChunk(id, index, b64)  → browser sends 2 MB chunks one at a time (with progress);
 *                                      server forwards each to Drive with Content-Range
 *   3. last chunk                   → Drive returns the file id → row in Attachments + audit log
 * The OAuth token never leaves the server, and no call ever holds the whole file in memory.
 *
 * Viewing: openAttachment() checks permission, then grants that ONE user reader access
 * (no e-mail is sent) and returns the Drive link. Files are never "anyone with the link".
 */

const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;        // multiple of 256 KB (Drive requirement)
const UPLOAD_CACHE_PREFIX_ = 'upl_';
const EXT_MIME_ = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv'
};

/**
 * meta: { ticket_id, item_id?, quote_id?, category: 'request'|'info_response'|'quotation'|'quote_photo'|'other',
 *         file_name, mime_type, size_bytes }
 * quote_photo = product photo of ONE supplier offer (item_id + quote_id required, images only, ≤ max_photos_per_quote).
 * quote_id may be the client UUID of an offer that is still a draft on the pricing page.
 */
function beginUpload(meta) {
  return api_('beginUpload', function () {
    const m = meta || {};
    const u = currentUser_();
    const t = ticketForUser_(u, m.ticket_id);
    if (!canUpload_(u, t)) throw appError_('FORBIDDEN', 'แนบไฟล์ไม่ได้ในสถานะนี้ หรือคุณไม่ใช่ผู้รับผิดชอบใบนี้');

    const category = oneOf_(m.category || 'request', ATTACHMENT_CATEGORIES, 'ประเภทไฟล์');
    if (COST_FILE_CATEGORIES_.indexOf(category) !== -1 && u.role !== 'sr') throw appError_('FORBIDDEN', 'ไฟล์ใบเสนอราคา / รูปสินค้าของ Supplier แนบได้เฉพาะ SR');
    const name = sanitizeFileName_(m.file_name);
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = cleanText_(m.mime_type, 150) || EXT_MIME_[ext] || '';
    const allowed = setting_('allowed_mime_types', []);
    if (allowed.indexOf(mime) === -1 || !EXT_MIME_[ext]) {
      throw appError_('FILE_TYPE', 'ไฟล์ชนิดนี้ไม่อนุญาต (รับเฉพาะ PDF, รูปภาพ, Excel, CSV)');
    }
    const size = toNumber_(m.size_bytes, 'ขนาดไฟล์', { gt: 0, integer: true });
    const maxMb = Number(setting_('max_upload_mb', 20));
    if (size > maxMb * 1024 * 1024) throw appError_('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน ' + maxMb + ' MB');

    let itemId = '';
    if (m.item_id) {
      const it = findOne_(TAB.ITEMS, 'item_id', m.item_id);
      if (!it || String(it.ticket_id) !== t.ticket_id || toBool_(it.is_deleted)) throw appError_('VALIDATION', 'รายการสินค้าไม่ได้อยู่ในใบนี้');
      itemId = String(it.item_id);
    }
    let quoteId = '';
    if (category === 'quote_photo') {
      if (PHOTO_MIME_TYPES_.indexOf(mime) === -1) throw appError_('FILE_TYPE', 'รูปสินค้ารับเฉพาะไฟล์รูป (JPG, PNG, WEBP, HEIC)');
      quoteId = checkPhotoTarget_(t, itemId, m.quote_id);
    }

    const folderId = withLock_(function () { return ticketFolderId_(t); });
    const res = http_().fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({ name: name, parents: [folderId], mimeType: mime }),
      muteHttpExceptions: true
    });
    const headers = res.getAllHeaders();
    const sessionUri = headers.Location || headers.location;
    if (res.getResponseCode() !== 200 || !sessionUri) {
      throw new Error('Drive resumable init failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    }

    const uploadId = uuid_();
    const session = {
      owner: u.email, ticket_id: t.ticket_id, item_id: itemId, quote_id: quoteId, category: category, file_name: name, mime: mime,
      size: size, uri: sessionUri, next_offset: 0, chunk: UPLOAD_CHUNK_BYTES
    };
    CacheService.getScriptCache().put(UPLOAD_CACHE_PREFIX_ + uploadId, JSON.stringify(session), 6 * 3600);
    return { upload_id: uploadId, chunk_bytes: UPLOAD_CHUNK_BYTES, total_chunks: Math.ceil(size / UPLOAD_CHUNK_BYTES) };
  });
}

/** Send chunk number `index` (0-based) as base64. Returns { done, received } or the attachment when done. */
function uploadChunk(uploadId, index, base64) {
  return api_('uploadChunk', function () {
    const u = currentUser_();
    const cache = CacheService.getScriptCache();
    const key = UPLOAD_CACHE_PREFIX_ + cleanText_(uploadId, 64);
    const s = parseJson_(cache.get(key), null);
    if (!s || s.owner !== u.email) throw appError_('UPLOAD_EXPIRED', 'การอัปโหลดหมดอายุหรือไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
    if (s.done) return s.result;

    const start = Number(index) * s.chunk;
    if (start < s.next_offset) return { done: false, received: s.next_offset };   // retried chunk already accepted
    if (start !== s.next_offset) throw appError_('UPLOAD_ORDER', 'ลำดับการอัปโหลดผิดพลาด กรุณาลองใหม่');

    const bytes = Utilities.base64Decode(String(base64 || ''));
    const end = start + bytes.length - 1;
    const isLast = end + 1 >= s.size;
    if (!bytes.length || (!isLast && bytes.length !== s.chunk) || end + 1 > s.size) {
      throw appError_('UPLOAD_SIZE', 'ขนาดข้อมูลไม่ตรงกับไฟล์ กรุณาลองใหม่');
    }

    const res = http_().fetch(s.uri, {
      method: 'put',
      contentType: s.mime,
      headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + s.size },
      payload: bytes,
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 308) {
      s.next_offset = end + 1;
      cache.put(key, JSON.stringify(s), 6 * 3600);
      return { done: false, received: s.next_offset };
    }
    if (code !== 200 && code !== 201) {
      throw new Error('Drive chunk upload failed: ' + code + ' ' + res.getContentText().slice(0, 300));
    }
    const file = JSON.parse(res.getContentText());

    const attachment = withLock_(function () {
      // Permission re-checked: the ticket may have moved on while the file was uploading
      const t = ticketForUser_(u, s.ticket_id);
      if (!canUpload_(u, t)) {
        try { drive_().getFileById(file.id).setTrashed(true); } catch (e) { console.warn(e); }
        throw appError_('FORBIDDEN', 'สถานะใบเปลี่ยนไประหว่างอัปโหลด ไฟล์นี้จึงไม่ถูกบันทึก');
      }
      if (s.category === 'quote_photo') {
        // limit re-checked under the lock: several photos may finish uploading at the same time
        try { checkPhotoTarget_(t, s.item_id, s.quote_id); } catch (e) {
          try { drive_().getFileById(file.id).setTrashed(true); } catch (e2) { console.warn(e2); }
          throw e;
        }
      }
      const row = {
        attachment_id: uuid_(), ticket_id: t.ticket_id, item_id: s.item_id, quote_id: s.quote_id || '', category: s.category,
        file_name: s.file_name, drive_file_id: String(file.id), mime_type: s.mime, size_bytes: s.size,
        uploaded_by: u.email, uploaded_at: new Date(), is_deleted: false, deleted_by: '', deleted_at: ''
      };
      insertRow_(TAB.ATTACHMENTS, row);
      appendLog_({ ticket_id: t.ticket_id, action: 'attachment_added', actor_email: u.email, actor_role: u.role,
        metadata: { attachment_id: row.attachment_id, file_name: row.file_name, category: row.category, size_bytes: row.size_bytes, item_id: row.item_id, quote_id: row.quote_id } });
      return publicAttachment_(row);
    });
    s.done = true;
    s.result = { done: true, attachment: attachment };
    cache.put(key, JSON.stringify(s), 3600);
    return s.result;
  });
}

function deleteAttachment(attachmentId) {
  return api_('deleteAttachment', function () {
    return withLock_(function () {
      const u = currentUser_();
      const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', cleanText_(attachmentId));
      if (!a || toBool_(a.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
      const t = ticketForUser_(u, a.ticket_id);
      if (String(a.uploaded_by).toLowerCase() !== u.email || !canUpload_(u, t)) {
        throw appError_('FORBIDDEN', 'ลบได้เฉพาะไฟล์ที่คุณแนบเอง และยังอยู่ในขั้นตอนที่แนบไฟล์ได้');
      }
      const inUse = rows_(TAB.QUOTATIONS).some(function (q) {
        return String(q.attachment_file_id) === String(a.attachment_id) && !toBool_(q.is_deleted);
      });
      if (inUse) throw appError_('IN_USE', 'ไฟล์นี้ผูกกับใบเสนอราคาอยู่ กรุณาเอาออกจากใบเสนอราคาก่อน');
      updateRow_(TAB.ATTACHMENTS, a.attachment_id, { is_deleted: true, deleted_by: u.email, deleted_at: new Date() });
      try { drive_().getFileById(String(a.drive_file_id)).setTrashed(true); } catch (e) { console.warn('trash failed', e); }
      appendLog_({ ticket_id: t.ticket_id, action: 'attachment_removed', actor_email: u.email, actor_role: u.role,
        metadata: { attachment_id: String(a.attachment_id), file_name: String(a.file_name), category: String(a.category) } });
      return { deleted: true };
    });
  });
}

/** Permission-checked link: grants the viewer reader access on this one file (no e-mail). */
function openAttachment(attachmentId) {
  return api_('openAttachment', function () {
    const u = currentUser_();
    const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', cleanText_(attachmentId));
    if (!a || toBool_(a.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
    const t = ticketForUser_(u, a.ticket_id);
    if (COST_FILE_CATEGORIES_.indexOf(String(a.category)) !== -1 && !canViewQuotes_(u, t)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
    const fileId = String(a.drive_file_id);
    const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (u.email !== owner) {
      const res = http_().fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
        '/permissions?sendNotificationEmail=false&supportsAllDrives=true', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ type: 'user', role: 'reader', emailAddress: u.email }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) {
        throw new Error('Drive permission failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
      }
    }
    return { url: 'https://drive.google.com/file/d/' + fileId + '/view', file_name: String(a.file_name) };
  });
}

function maxPhotosPerQuote_() {
  const n = Number(setting_('max_photos_per_quote', 10));
  return isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 30) : 10;
}

/** Active photos of one supplier offer. */
function quotePhotos_(quoteId) {
  return findAll_(TAB.ATTACHMENTS, 'quote_id', quoteId).filter(function (a) {
    return String(a.category) === 'quote_photo' && !toBool_(a.is_deleted);
  });
}

/** quote_photo target: item of this ticket + offer of that item (saved or a draft UUID), and room for one more photo. */
function checkPhotoTarget_(t, itemId, rawQuoteId) {
  if (!itemId) throw appError_('VALIDATION', 'รูปสินค้าต้องระบุรายการสินค้า');
  const quoteId = cleanText_(rawQuoteId, 64);
  if (!isUuid_(quoteId)) throw appError_('VALIDATION', 'รูปสินค้าต้องผูกกับ Supplier (ใบเสนอราคา) ที่ถูกต้อง');
  const q = findOne_(TAB.QUOTATIONS, 'quote_id', quoteId);
  if (q && (String(q.item_id) !== String(itemId) || String(q.ticket_id) !== String(t.ticket_id) || toBool_(q.is_deleted))) {
    throw appError_('VALIDATION', 'Supplier นี้ไม่ได้อยู่ในรายการสินค้านี้');
  }
  const max = maxPhotosPerQuote_();
  if (quotePhotos_(quoteId).length >= max) throw appError_('PHOTO_LIMIT', 'แนบรูปได้สูงสุด ' + max + ' รูปต่อ Supplier 1 เจ้า');
  return quoteId;
}

/** Soft-delete the photos of a removed offer (called inside the lock). */
function removeQuotePhotos_(u, quoteId) {
  quotePhotos_(quoteId).forEach(function (a) {
    updateRow_(TAB.ATTACHMENTS, a.attachment_id, { is_deleted: true, deleted_by: u.email, deleted_at: new Date() });
    try { drive_().getFileById(String(a.drive_file_id)).setTrashed(true); } catch (e) { console.warn('trash failed', e); }
  });
}

/**
 * Inline previews for the photo gallery: { attachment_id: 'data:image/...;base64,...' }.
 * size 'thumb' (≈ 320 px, cached 6 h) or 'large' (≈ 1600 px, for the full-screen viewer).
 * Images are read by the server with the owner's token, so viewers never need Drive access
 * and Sales can never load a supplier photo (same permission as openAttachment).
 */
function getPhotoPreviews(attachmentIds, size) {
  return api_('getPhotoPreviews', function () {
    const u = currentUser_();
    const large = size === 'large';
    const ids = (Array.isArray(attachmentIds) ? attachmentIds : []).map(function (x) { return cleanText_(x, 64); })
      .filter(String).slice(0, large ? 1 : 12);
    const cache = CacheService.getScriptCache();
    const seen = {};
    const out = {};
    ids.forEach(function (id) {
      const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', id);
      if (!a || toBool_(a.is_deleted) || String(a.mime_type).indexOf('image/') !== 0) return;
      const tid = String(a.ticket_id);
      if (!(tid in seen)) {
        const t = ticketById_(tid);
        seen[tid] = { see: !!t && canSeeTicket_(u, t), cost: !!t && canViewQuotes_(u, t) };
      }
      if (!seen[tid].see || (COST_FILE_CATEGORIES_.indexOf(String(a.category)) !== -1 && !seen[tid].cost)) return;
      const key = 'ph_' + (large ? 'l_' : 't_') + id;
      const hit = large || TEST_DRIVE_ ? null : cache.get(key);
      if (hit) { out[id] = hit; return; }
      const url = drivePreview_(String(a.drive_file_id), large ? 1600 : 320, String(a.mime_type), Number(a.size_bytes || 0));
      if (!url) return;
      out[id] = url;
      if (!large && !TEST_DRIVE_ && url.length < 95000) cache.put(key, url, 6 * 3600);
    });
    return { previews: out };
  });
}

/** Data URL of a Drive file preview (Drive thumbnail at the wanted width; small originals as a fallback). */
function drivePreview_(fileId, px, mime, sizeBytes) {
  const auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const meta = http_().fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
    '?fields=thumbnailLink&supportsAllDrives=true', { method: 'get', headers: auth, muteHttpExceptions: true });
  const link = meta.getResponseCode() === 200 ? String(parseJson_(meta.getContentText(), {}).thumbnailLink || '') : '';
  if (link) {
    const res = http_().fetch(link.replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + '=s' + px, { method: 'get', headers: auth, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const h = res.getAllHeaders();
      const type = String(h['Content-Type'] || h['content-type'] || 'image/jpeg').split(';')[0];
      return 'data:' + type + ';base64,' + Utilities.base64Encode(res.getContent());
    }
  }
  // Drive makes the thumbnail a few seconds after upload — until then send small browser-viewable originals as is
  if (sizeBytes > 0 && sizeBytes <= 1.5 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) !== -1) {
    return 'data:' + mime + ';base64,' + Utilities.base64Encode(drive_().getFileById(fileId).getBlob().getBytes());
  }
  return '';
}

function publicAttachment_(a) {
  return {
    attachment_id: String(a.attachment_id), item_id: String(a.item_id || ''), quote_id: String(a.quote_id || ''),
    category: String(a.category), file_name: String(a.file_name), drive_file_id: String(a.drive_file_id),
    mime_type: String(a.mime_type || ''), size_bytes: Number(a.size_bytes || 0),
    uploaded_by: String(a.uploaded_by), uploaded_at: isoOrBlank_(a.uploaded_at)
  };
}

function sanitizeFileName_(name) {
  const s = cleanText_(name, 180).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  if (!s || s === '.' || s === '..') throw appError_('VALIDATION', 'ชื่อไฟล์ไม่ถูกต้อง');
  return s;
}

/** Drive folder for one ticket (created on first upload). Must run inside withLock_. */
function ticketFolderId_(t) {
  const rootId = TEST_DRIVE_ ? 'test-root' : PropertiesService.getScriptProperties().getProperty(CFG.PROP.DRIVE_ROOT_ID);
  if (!rootId) throw appError_('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  const root = drive_().getFolderById(rootId);
  const name = String(t.ticket_no);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next().getId() : root.createFolder(name).getId();
}


// ============================================================================
// Lark.gs
// ============================================================================
/**
 * File: Lark.gs
 * Lark Bot API delivery of queued notifications (DM to each person).
 *
 * Setup (once):
 *   1. Lark Developer Console → Create custom app → enable "Bot".
 *   2. Permissions: im:message:send_as_bot, contact:user.id:readonly (get user ID by e-mail). Publish the app version.
 *   3. Apps Script → Project Settings → Script properties:
 *        LARK_APP_ID, LARK_APP_SECRET
 *        LARK_HOST           (optional, default https://open.larksuite.com — Feishu: https://open.feishu.cn)
 *        LARK_GROUP_CHAT_ID  (optional, oc_xxx — group that receives SLA breach summaries; add the bot to it)
 *        LARK_PRICE_GROUP_CHAT_ID (optional, oc_xxx — group told "ทำราคาเสร็จแล้ว" (status only, no prices) when GM
 *                             approves + every other Sales-side group event; blank = use LARK_GROUP_CHAT_ID)
 *        LARK_MGMT_GROUP_CHAT_ID  (optional, oc_xxx — management group (SR / SR Manager / GM): price waiting for
 *                             review / GM purchasing approval, returned prices; blank = these are not sent)
 *      Add the bot to every group. Events per group: Settings › lark_group_events (see Notify.gs GROUP_EVENTS_).
 *   4. Run testLarkConnection() then installTriggers().
 *
 * Rules: a Lark failure never blocks or rolls back a business action. Rows stay in the
 * Notifications tab and are retried up to LARK_MAX_ATTEMPTS_ times with back-off.
 */

const LARK_MAX_ATTEMPTS_ = 5;
const LARK_BATCH_ = 40;

function larkConfig_() {
  if (TEST_LARK_) return TEST_LARK_;
  const p = PropertiesService.getScriptProperties();
  return {
    app_id: p.getProperty(CFG.PROP.LARK_APP_ID) || '',
    app_secret: p.getProperty(CFG.PROP.LARK_APP_SECRET) || '',
    host: p.getProperty(CFG.PROP.LARK_HOST) || 'https://open.larksuite.com',
    group_chat_id: p.getProperty(CFG.PROP.LARK_GROUP_CHAT_ID) || '',
    price_group_chat_id: p.getProperty(CFG.PROP.LARK_PRICE_GROUP_CHAT_ID) || p.getProperty(CFG.PROP.LARK_GROUP_CHAT_ID) || '',
    mgmt_group_chat_id: p.getProperty(CFG.PROP.LARK_MGMT_GROUP_CHAT_ID) || ''
  };
}

function larkConfigured_() {
  const c = larkConfig_();
  return !!(c.app_id && c.app_secret);
}

function larkHost_() {
  return larkConfig_().host || 'https://open.larksuite.com';
}

function larkToken_() {
  const cache = CacheService.getScriptCache();
  const hit = TEST_LARK_ ? null : cache.get('lark_tat');
  if (hit) return hit;
  const c = larkConfig_();
  const res = http_().fetch(larkHost_() + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ app_id: c.app_id, app_secret: c.app_secret })
  });
  const body = parseJson_(res.getContentText(), {});
  if (body.code !== 0 || !body.tenant_access_token) throw new Error('Lark auth failed: ' + (body.msg || res.getResponseCode()));
  if (!TEST_LARK_) cache.put('lark_tat', body.tenant_access_token, 100 * 60);   // token lives ~2 h
  return body.tenant_access_token;
}

function larkCall_(path, payload) {
  const res = http_().fetch(larkHost_() + path, {
    method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + larkToken_() },
    payload: JSON.stringify(payload)
  });
  const body = parseJson_(res.getContentText(), {});
  // Lark returns HTTP 200 with an error code inside — always check body.code
  if (res.getResponseCode() >= 500 || body.code === 99991400) {
    const e = new Error('Lark temporary error: ' + (body.msg || res.getResponseCode()));
    e.retryable = true;
    throw e;
  }
  if (body.code !== 0) throw new Error('Lark error ' + body.code + ': ' + (body.msg || ''));
  return body.data || {};
}

/** Resolve open_ids for e-mails (cached for 6 h; persisted to Users.lark_open_id when found). */
function larkOpenIds_(emails) {
  const cache = CacheService.getScriptCache();
  const out = {};
  const unknown = [];
  emails.forEach(function (e) {
    const u = userByEmail_(e);
    const cached = TEST_LARK_ ? null : cache.get('lark_oid_' + e);
    if (u && u.lark_open_id) out[e] = u.lark_open_id;
    else if (cached) out[e] = cached;
    else unknown.push(e);
  });
  for (let i = 0; i < unknown.length; i += 50) {
    const data = larkCall_('/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', { emails: unknown.slice(i, i + 50) });
    (data.user_list || []).forEach(function (x) {
      if (x.user_id && x.email) {
        const e = String(x.email).toLowerCase();
        out[e] = x.user_id;
        if (!TEST_LARK_) cache.put('lark_oid_' + e, x.user_id, 6 * 3600);
      }
    });
  }
  return out;
}

/** Chat id of a pseudo-recipient ('#price_group' / '#mgmt_group'), '' when that group is not configured. */
function groupChatId_(key) {
  const c = larkConfig_();
  if (key === PRICE_GROUP_KEY_) return c.price_group_chat_id || '';
  if (key === MGMT_GROUP_KEY_) return c.mgmt_group_chat_id || '';
  return '';
}

function larkCardColor_(type) {
  const t = String(type);
  if (t.indexOf('sla_breach') === 0) return 'red';
  if (t === 'price_done_group') return 'green';
  const ev = t.indexOf('group_') === 0 ? FPR_EVENTS_[t.slice(6)] : null;
  return ev ? ev.color : 'blue';
}

function larkCard_(n) {
  const link = String(n.link || '');
  const card = {
    config: { wide_screen_mode: true },
    header: { template: larkCardColor_(n.type), title: { tag: 'plain_text', content: String(n.title).slice(0, 150) } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: String(n.body || '').slice(0, 1500) } }]
  };
  if (/^https:\/\//.test(link)) {
    card.elements.push({ tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: 'เปิดใบขอราคา' }, url: link }] });
  }
  return card;
}

/** Trigger handler (every minute): deliver pending notifications. */
function dispatchNotifications() {
  requireJobContext_();
  if (!larkConfigured_()) return { skipped: 'not_configured' };
  const now = new Date();
  // 1) claim a batch under the lock
  const batch = withLock_(function () {
    const due = rows_(TAB.NOTIFICATIONS).filter(function (r) {
      const status = String(r.lark_status);
      const attempts = Number(r.lark_attempts || 0);
      const last = r.lark_sent_at ? new Date(r.lark_sent_at) : null;
      if (status === 'sending' && last && now - last > 10 * 60000) return true;          // stuck claim
      if (status !== 'pending' || attempts >= LARK_MAX_ATTEMPTS_) return false;
      if (now - new Date(r.created_at) > 48 * 3600000) return false;                     // too old to matter
      const backoffMin = [0, 1, 5, 15, 60][attempts] || 60;
      return !last || now - last >= backoffMin * 60000;
    }).slice(0, LARK_BATCH_);
    due.forEach(function (r) {
      updateRow_(TAB.NOTIFICATIONS, r.notif_id, { lark_status: 'sending', lark_attempts: Number(r.lark_attempts || 0) + 1, lark_sent_at: now });
    });
    return due.map(function (r) {
      return { notif_id: String(r.notif_id), email: String(r.user_email).toLowerCase(), type: String(r.type), title: String(r.title),
        body: String(r.body || ''), link: String(r.link || ''), attempts: Number(r.lark_attempts || 0) + 1 };
    });
  });
  if (!batch.length) return { sent: 0 };

  // 2) send outside the lock (network calls are slow)
  const results = {};
  let ids = {};
  try {
    ids = larkOpenIds_(batch.map(function (b) { return b.email; }).filter(function (e, i, a) { return e.charAt(0) !== '#' && a.indexOf(e) === i; }));
  } catch (e) {
    batch.forEach(function (b) { results[b.notif_id] = { status: 'pending', error: String(e.message).slice(0, 300) }; });
  }
  batch.forEach(function (b) {
    if (b.email.charAt(0) === '#') {              // group message: does not need the open_id lookup
      const chatId = groupChatId_(b.email);
      if (!chatId) {
        results[b.notif_id] = { status: 'no_group', error: 'ยังไม่ได้ตั้ง ' + (b.email === MGMT_GROUP_KEY_ ? 'LARK_MGMT_GROUP_CHAT_ID' : 'LARK_PRICE_GROUP_CHAT_ID') };
        return;
      }
      try {
        larkCall_('/open-apis/im/v1/messages?receive_id_type=chat_id', {
          receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(larkCard_(b)), uuid: b.notif_id.slice(0, 50)
        });
        results[b.notif_id] = { status: 'sent', error: '' };
      } catch (e) {
        results[b.notif_id] = { status: b.attempts >= LARK_MAX_ATTEMPTS_ ? 'failed' : 'pending', error: String(e.message).slice(0, 300) };
      }
      return;
    }
    if (results[b.notif_id]) return;
    if (!ids[b.email]) { results[b.notif_id] = { status: 'no_lark_user', error: 'ไม่พบผู้ใช้ Lark จากอีเมลนี้' }; return; }
    try {
      larkCall_('/open-apis/im/v1/messages?receive_id_type=open_id', {
        receive_id: ids[b.email], msg_type: 'interactive', content: JSON.stringify(larkCard_(b)), uuid: b.notif_id.slice(0, 50)
      });
      results[b.notif_id] = { status: 'sent', error: '' };
    } catch (e) {
      const final = b.attempts >= LARK_MAX_ATTEMPTS_;
      results[b.notif_id] = { status: final ? 'failed' : 'pending', error: String(e.message).slice(0, 300) };
    }
  });

  // 3) record results under the lock
  let sent = 0;
  let failed = 0;
  withLock_(function () {
    Object.keys(results).forEach(function (id) {
      const r = results[id];
      if (r.status === 'sent') sent++;
      if (r.status === 'failed') failed++;
      updateRow_(TAB.NOTIFICATIONS, id, { lark_status: r.status, lark_error: r.error, lark_sent_at: new Date() });
    });
  });
  if (failed) logError_('dispatchNotifications', new Error(failed + ' Lark message(s) failed permanently'));
  return { sent: sent, failed: failed, claimed: batch.length };
}

/** Post a plain text message to the optional Lark group (SLA summaries, self-test alerts). */
function larkGroupText_(text) {
  const chatId = larkConfig_().group_chat_id;
  if (!chatId || !larkConfigured_()) return false;
  try {
    larkCall_('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: String(text).slice(0, 3000) })
    });
    return true;
  } catch (e) {
    console.error('larkGroupText_ failed', e);
    return false;
  }
}

/** Run from the editor after setting the Script Properties. Sends a DM to yourself. */
function testLarkConnection() {
  requireOwner_();
  const me = String(Session.getActiveUser().getEmail()).toLowerCase();
  larkToken_();
  const ids = larkOpenIds_([me]);
  if (!ids[me]) throw new Error('Token OK แต่ไม่พบผู้ใช้ Lark ของ ' + me + ' — ตรวจสิทธิ์ contact:user.id:readonly และอีเมลใน Lark');
  larkCall_('/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: ids[me], msg_type: 'interactive',
    content: JSON.stringify(larkCard_({ type: 'test', title: 'MGS Food Price Request — ทดสอบการเชื่อมต่อ', body: 'ถ้าเห็นข้อความนี้ แปลว่า Lark Bot ใช้งานได้ ✅', link: '' }))
  });
  const groupOk = larkGroupText_('MGS Food Price Request — ทดสอบการส่งเข้ากลุ่ม ✅');
  console.log('Lark OK. DM sent to ' + me + (groupOk ? ' + group message sent' : ' (no group configured)'));
  return 'OK';
}


// ============================================================================
// Bots.gs
// ============================================================================
/**
 * File: Bots.gs
 * Lark Custom Bot webhooks for the group "Food Price Request" (FPR).
 *
 *   Bot A "FPR Bot"       every workflow step (card colour / icon per event)      FPR_BOT_URL + FPR_BOT_SECRET
 *   Bot B "FPR Reminder"  only work that is over its SLA (hourly trigger)         FPR_REMINDER_URL + FPR_REMINDER_SECRET
 *   → Script Properties only (never in code or in the sheet).
 *
 * Rules
 *   • Interactive cards (msg_type "interactive"), URL button to the web app (?page=ticket&id=FPR-YYMM-####).
 *     A custom bot cannot receive button callbacks: approving is done in the web app only.
 *   • Signed: sign = base64( HmacSHA256( key = timestamp + "\n" + secret, message = "" ) ).
 *   • Mentions by e-mail <at email=…></at> (or <at id=open_id> when Users › lark_open_id is filled) — see buildMention().
 *   • Group cards never carry a price, cost, GP or vendor name: only "มีราคาแล้ว" + the button.
 *   • A card is queued inside the business transaction and sent AFTER it is committed (api_ → flushBotQueue_),
 *     so a Lark outage can never block or roll back an approval. 3 attempts (1 s, 2 s back-off), every send in NotifLog.
 */

let TEST_BOTS_ = null;     // tests: { fpr: { url, secret }, reminder: { url, secret } }
let BOT_QUEUE_ = [];       // cards waiting for the current request to commit

const BOT_PROPS_ = {
  fpr: { url: 'FPR_BOT_URL', secret: 'FPR_BOT_SECRET', name: 'FPR Bot' },
  reminder: { url: 'FPR_REMINDER_URL', secret: 'FPR_REMINDER_SECRET', name: 'FPR Reminder' }
};

/**
 * Bot A events. mention(t) → e-mails to @mention. Colours = Lark card header templates.
 * Settings › fpr_bot_events_off (JSON list) switches events off.
 */
const FPR_EVENTS_ = {
  submitted:  { icon: '📥', title: 'คำขอราคาใหม่ รอ GM อนุมัติ', color: 'blue',   mention: function () { return roleEmails_('gm'); } },
  assigned:   { icon: '🔧', title: 'มอบหมายทำราคา', color: 'indigo',            mention: function (t) { return [t.sr_email]; } },
  queued:     { icon: '🧾', title: 'GM อนุมัติแล้ว — รอ Sourcing รับงาน', color: 'blue', mention: function () { return roleEmails_('sr'); } },
  sm_review:  { icon: '📊', title: 'รอ Sourcing Manager อนุมัติ', color: 'orange',  mention: function () { return roleEmails_('sr_manager'); } },
  gm_final:   { icon: '🏁', title: 'รอ GM อนุมัติราคาสุดท้าย', color: 'purple',    mention: function () { return roleEmails_('gm'); } },
  approved:   { icon: '🎉', title: 'อนุมัติราคาแล้ว', color: 'green',             mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  rejected:   { icon: '❌', title: 'ปฏิเสธ', color: 'red',                        mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  returned:   { icon: '↩️', title: 'ตีกลับแก้ไข', color: 'red',                    mention: function (t, x) { return x.fixer || [t.sr_email]; } },
  need_info:  { icon: '↩️', title: 'ตีกลับ — ขอข้อมูลเพิ่มจากผู้ขอ', color: 'red', mention: function (t) { return [t.requestor_email]; } },
  cancelled:  { icon: '🚫', title: 'ยกเลิกคำขอ', color: 'grey',                    mention: function (t) { return [t.requestor_email, t.sr_email]; } },
  revision:   { icon: '✏️', title: 'ผู้ขอขอให้ปรับราคา', color: 'orange',          mention: function (t) { return [t.sr_email]; } },
  follow_up:  { icon: '📌', title: 'แยกรายการส่งราคาตามหลัง', color: 'wathet',     mention: function (t) { return [t.sr_email]; } },
  deal_won:   { icon: '🏆', title: 'ปิดการขายได้', color: 'green',                mention: function (t) { return [t.sr_email]; } }
};

/** Workflow stage → SLA key of Settings › fpr_sla. */
const SLA_KEY_OF_STAGE_ = { pending_gm: 'GM_REVIEW', doc_check: 'PRICING', sourcing: 'PRICING', pending_sr_manager: 'SM_REVIEW', pending_gm_price: 'GM_FINAL_REVIEW' };
const SLA_LABEL_ = { GM_REVIEW: 'GM_REVIEW (GM อนุมัติให้ทำราคา)', PRICING: 'PRICING (Sourcing ทำราคา)', SM_REVIEW: 'SM_REVIEW (Sourcing Manager)', GM_FINAL_REVIEW: 'GM_FINAL_REVIEW (GM อนุมัติราคา)' };

function botConfig_(bot) {
  if (TEST_BOTS_) return TEST_BOTS_[bot] || { url: '', secret: '' };
  const p = PropertiesService.getScriptProperties();
  return { url: p.getProperty(BOT_PROPS_[bot].url) || '', secret: p.getProperty(BOT_PROPS_[bot].secret) || '' };
}

function roleEmails_(role) {
  return activeUsersByRole_(role).map(function (u) { return u.email; });
}

/** @mention markup for a card (lark_md). Swap to open_id here if e-mail mentions do not work in your tenant. */
function buildMention(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return '';
  const u = userByEmail_(e);
  if (u && u.lark_open_id) return '<at id=' + u.lark_open_id + '></at>';
  return '<at email=' + e + '></at>';
}

/** Lark signature: base64(HmacSHA256(key = timestamp + "\n" + secret, message = "")). */
function larkSign_(timestamp, secret) {
  const bytes = Utilities.computeHmacSha256Signature('', String(timestamp) + '\n' + secret);
  return Utilities.base64Encode(bytes);
}

/** Web-app link by FPR number (opens the request page). */
function fprLink_(t) {
  let base = PropertiesService.getScriptProperties().getProperty(CFG.PROP.WEBAPP_URL) || '';
  if (!base) { try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { base = ''; } }
  return base + '?page=ticket&id=' + encodeURIComponent(t.ticket_no);
}

// ---------------------------------------------------------------- working time (SLA)

function workHours_() {
  const w = setting_('work_hours', { start: '08:30', end: '17:30', days: [1, 2, 3, 4, 5] }) || {};
  const min = function (hhmm, d) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : d; };
  const s = min(w.start, 510), e = min(w.end, 1050);
  return { start: s, end: e > s ? e : s + 540, days: Array.isArray(w.days) && w.days.length ? w.days.map(Number) : [1, 2, 3, 4, 5] };
}

function holidaySet_() {
  const out = {};
  try { rows_(TAB.HOLIDAYS).forEach(function (h) { const d = h.date ? fmtDate_(h.date) : ''; if (d) out[d] = String(h.name || 'วันหยุด'); }); } catch (e) { /* tab missing before setupDatabase */ }
  return out;
}

// Bangkok has no daylight saving: local = UTC + 7 h
function bkk_(ms) {
  const d = new Date(ms + 7 * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), dow: d.getUTCDay() || 7, min: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60,
    ymd: d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2) };
}
function bkkAt_(y, m, d, minuteOfDay) { return Date.UTC(y, m, d, 0, 0) - 7 * 3600000 + minuteOfDay * 60000; }
function isWorkDay_(p, wh, hol) { return wh.days.indexOf(p.dow) !== -1 && !hol[p.ymd]; }

/** start + `minutes` of working time → Date. */
function addWorkMinutes_(start, minutes, wh, hol) {
  let cur = new Date(start).getTime();
  let left = Math.max(0, minutes);
  for (let i = 0; i < 1000; i++) {
    const p = bkk_(cur);
    if (!isWorkDay_(p, wh, hol) || p.min >= wh.end) { cur = bkkAt_(p.y, p.m, p.d + 1, wh.start); continue; }
    if (p.min < wh.start) { cur = bkkAt_(p.y, p.m, p.d, wh.start); continue; }
    const avail = wh.end - p.min;
    if (left <= avail) return new Date(cur + left * 60000);
    left -= avail;
    cur = bkkAt_(p.y, p.m, p.d + 1, wh.start);
  }
  return new Date(cur);
}

/** Working minutes between two times. */
function workMinutesBetween_(a, b, wh, hol) {
  let cur = new Date(a).getTime();
  const end = new Date(b).getTime();
  let total = 0;
  for (let i = 0; i < 1000 && cur < end; i++) {
    const p = bkk_(cur);
    if (!isWorkDay_(p, wh, hol) || p.min >= wh.end) { cur = bkkAt_(p.y, p.m, p.d + 1, wh.start); continue; }
    if (p.min < wh.start) { cur = bkkAt_(p.y, p.m, p.d, wh.start); continue; }
    const dayEnd = bkkAt_(p.y, p.m, p.d, wh.end);
    total += (Math.min(dayEnd, end) - cur) / 60000;
    cur = bkkAt_(p.y, p.m, p.d + 1, wh.start);
  }
  return Math.round(total);
}

function slaMinutes_(rule, wh) {
  const r = rule || {};
  if (Number(r.days) > 0) return Number(r.days) * (wh.end - wh.start);
  return Math.round((Number(r.hours) || 0) * 60);
}

/** SLA deadline of the ticket's current FPR step, or null. */
function slaDue_(t, wh, hol) {
  const key = SLA_KEY_OF_STAGE_[t.stage];
  if (!key || OPEN_STATUSES.indexOf(t.status) === -1) return null;
  const rule = (setting_('fpr_sla', {}) || {})[key];
  const mins = slaMinutes_(rule, wh);
  const start = key === 'PRICING' ? (t.pricing_started_at || t.stage_entered_at) : t.stage_entered_at;
  if (!mins || !start) return null;
  return { key: key, start: new Date(start), due: addWorkMinutes_(start, mins, wh, hol), minutes: mins };
}

// ---------------------------------------------------------------- cards

/** Plain facts of a ticket for a card (no price, cost, GP or vendor). */
function cardFacts_(t) {
  const wh = workHours_(), hol = holidaySet_();
  const req = userByEmail_(t.requestor_email);
  const owners = stageAssignees_(t).map(function (e) { const u = userByEmail_(e); return u ? u.full_name : e; }).filter(String);
  const sla = slaDue_(t, wh, hol);
  const items = activeItemsOf_(t.ticket_id);
  const lines = items.slice(0, 8).map(function (it) {
    if (it.quote_status) return '• #' + it.line_no + ' ' + it.product_name + ' — ' + (it.quote_status === 'follow_up' ? 'ส่งราคาตามหลัง' : 'ไม่เสนอราคา');
    const spec = [it.size, it.net_weight ? 'NW ' + it.net_weight : '', it.packing_size].filter(Boolean).join(' · ');
    return '• #' + it.line_no + ' **' + it.product_name + '**' + (spec ? ' (' + spec + ')' : '') + ' — ' + fmtQty_(it.qty) + ' ' + it.uom + '/เดือน';
  });
  if (items.length > 8) lines.push('… และอีก ' + (items.length - 8) + ' รายการ');
  const priced = ['pending_sr_manager', 'pending_gm_price', 'awaiting_sales_ack', 'closed'].indexOf(t.stage) !== -1;
  return {
    no: String(t.ticket_no), customer: (t.customer_name || '-') + (t.customer_group ? ' · ' + t.customer_group : ''),
    requester: req ? req.full_name : t.requestor_email, status: STAGE_LABEL_TH[t.stage] || t.stage,
    owner: owners.length ? owners.join(', ') : '-', deadline: sla ? fmtDate_(sla.due, 'dd/MM/yyyy HH:mm') : '',
    items: lines, priced: priced
  };
}

/** Interactive card JSON. opt: { color, title, mentions:[emails], extra:[lines], facts, overdue } */
function buildCard_(opt) {
  const f = opt.facts;
  const field = function (label, value) { return { is_short: true, text: { tag: 'lark_md', content: '**' + label + '**\n' + value } }; };
  const fields = [field('เลขที่', f.no), field('ลูกค้า', f.customer), field('ผู้ขอ', f.requester), field('สถานะ', f.status),
    field('ผู้รับผิดชอบ', f.owner)];
  if (f.deadline) fields.push(field('ครบกำหนด (SLA)', f.deadline + ' น.'));
  const els = [{ tag: 'div', fields: fields }];
  if (f.items.length) els.push({ tag: 'div', text: { tag: 'lark_md', content: '**สินค้า**\n' + f.items.join('\n') } });
  if (f.priced) els.push({ tag: 'div', text: { tag: 'lark_md', content: '💰 **มีราคาแล้ว** — ดูราคาบนเว็บ (ต้นทุน / GP เฉพาะ Sourcing · Sourcing Manager · GM)' } });
  (opt.extra || []).filter(String).forEach(function (x) { els.push({ tag: 'div', text: { tag: 'lark_md', content: x } }); });
  const mentions = (opt.mentions || []).map(function (e) { return String(e || '').trim().toLowerCase(); })
    .filter(function (e, i, a) { return e && a.indexOf(e) === i; }).map(buildMention).filter(String);
  if (mentions.length) els.push({ tag: 'div', text: { tag: 'lark_md', content: '👉 ' + mentions.join(' ') } });
  if (/^https:\/\//.test(opt.link || '')) {
    els.push({ tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: 'เปิดรายการ ' + f.no }, url: opt.link }] });
  }
  return { config: { wide_screen_mode: true }, header: { template: opt.color, title: { tag: 'plain_text', content: opt.title.slice(0, 120) } }, elements: els };
}

/**
 * Queue a Bot A card for `event` (sent after the transaction commits).
 * extra: { lines: [...], reason: 'shown only for sales-side decisions', fixer: [emails] }
 */
function queueFprCard_(event, t, extra) {
  const ev = FPR_EVENTS_[event];
  if (!ev) return 0;
  const off = setting_('fpr_bot_events_off', []);
  if (Array.isArray(off) && off.indexOf(event) !== -1) return 0;
  const x = extra || {};
  const facts = cardFacts_(t);
  const lines = (x.lines || []).slice();
  if (x.reason) lines.unshift('**เหตุผล:** ' + String(x.reason).slice(0, 300));
  const title = ev.icon + ' ' + ev.title + ' — ' + facts.no;
  const card = buildCard_({ color: ev.color, title: title, facts: facts, extra: lines, mentions: ev.mention(t, x), link: fprLink_(t) });
  BOT_QUEUE_.push({ bot: 'fpr', event: event, ticket_id: t.ticket_id, ticket_no: facts.no, card: card, summary: cardText_(card) });
  return 1;
}

/** All text of a card (NotifLog summary — what the group saw). */
function cardText_(card) {
  const out = [card.header.title.content];
  card.elements.forEach(function (e) {
    if (e.text) out.push(e.text.content);
    (e.fields || []).forEach(function (f) { out.push(f.text.content.replace(/\*\*/g, '')); });
  });
  return out.join(' | ').replace(/\*\*/g, '');
}

/** Send every queued card (called by api_ after a successful request, and by jobs). Never throws. */
function flushBotQueue_() {
  const q = BOT_QUEUE_;
  BOT_QUEUE_ = [];
  const out = [];
  q.forEach(function (m) {
    try { out.push(sendBot_(m.bot, m.card, m)); } catch (e) { console.error('flushBotQueue_', e); }
  });
  return out;
}

/** POST one signed card; up to 3 attempts (1 s, 2 s back-off); logs to NotifLog. Returns { status, attempts }. */
function sendBot_(bot, card, meta) {
  const cfg = botConfig_(bot);
  const m = meta || {};
  let status = 'not_configured', code = '', response = 'ยังไม่ได้ตั้ง ' + BOT_PROPS_[bot].url + ' ใน Script Properties', attempts = 0;
  if (cfg.url) {
    for (attempts = 1; attempts <= 3; attempts++) {
      try {
        const body = { msg_type: 'interactive', card: card };
        if (cfg.secret) {
          body.timestamp = String(Math.floor(Date.now() / 1000));
          body.sign = larkSign_(body.timestamp, cfg.secret);
        }
        const res = http_().fetch(cfg.url, { method: 'post', contentType: 'application/json; charset=utf-8', payload: JSON.stringify(body), muteHttpExceptions: true });
        code = res.getResponseCode();
        response = String(res.getContentText() || '').slice(0, 500);
        const j = parseJson_(response, {});
        if (code === 200 && (j.code === 0 || j.StatusCode === 0)) { status = 'sent'; break; }
        status = 'failed';
      } catch (e) {
        status = 'failed';
        response = String(e.message || e).slice(0, 500);
      }
      if (attempts < 3 && !TEST_HTTP_) Utilities.sleep(1000 * Math.pow(2, attempts - 1));
    }
    if (attempts > 3) attempts = 3;
  }
  try {
    withLock_(function () {
      insertRow_(TAB.NOTIF_LOG, { log_id: uuid_(), ts: new Date(), ticket_id: m.ticket_id || '', ticket_no: m.ticket_no || '', bot: BOT_PROPS_[bot].name,
        event: m.event || '', status: status, http_code: code, attempts: attempts, response: response, summary: String(m.summary || '').slice(0, 1000) });
    });
  } catch (e) { console.error('NotifLog write failed', e); }
  return { status: status, attempts: attempts, http_code: code };
}

// ---------------------------------------------------------------- Bot B: SLA reminders

/**
 * Hourly trigger (installReminderTrigger): one yellow card per request that is over its SLA,
 * at most once every reminder_repeat_work_hours (8) working hours per request and step.
 */
function sendSlaReminders() {
  requireJobContext_();
  const wh = workHours_(), hol = holidaySet_();
  const repeat = Math.max(1, Number(setting_('reminder_repeat_work_hours', 8)) || 8) * 60;
  const now = new Date();
  const sent = [];
  withLock_(function () {
    rows_(TAB.TICKETS).map(normTicket_).forEach(function (t) {
      const sla = slaDue_(t, wh, hol);
      if (!sla || now < sla.due) return;
      const last = t.last_reminded_at ? new Date(t.last_reminded_at) : null;
      if (last && last >= sla.start && workMinutesBetween_(last, now, wh, hol) < repeat) return;
      const late = workMinutesBetween_(sla.due, now, wh, hol);
      const facts = cardFacts_(t);
      const who = stageAssignees_(t);
      const title = '⏰ งานค้างเกิน SLA — ' + facts.no;
      const card = buildCard_({ color: 'yellow', title: title, facts: facts, mentions: who, link: fprLink_(t),
        extra: ['**ขั้นที่ค้าง:** ' + SLA_LABEL_[sla.key] + ' · SLA ' + Math.round(sla.minutes / 60 * 10) / 10 + ' ชม.ทำงาน',
          '**เกินกำหนดมาแล้ว:** ' + Math.floor(late / 60) + ' ชม. ' + (late % 60) + ' นาที (นับเฉพาะเวลาทำงาน)'] });
      updateRow_(TAB.TICKETS, t.ticket_id, { last_reminded_at: now });
      BOT_QUEUE_.push({ bot: 'reminder', event: 'sla_' + sla.key, ticket_id: t.ticket_id, ticket_no: facts.no, card: card, summary: cardText_(card) });
      sent.push(facts.no);
    });
  });
  flushBotQueue_();
  return { reminded: sent };
}

/**
 * FPR one-click setup (run from the editor as the script owner):
 * builds / upgrades the database (tabs incl. NotifLog + Holidays, Settings, Drive folder "FPR Attachments")
 * and reports which bot Script Properties are set. Secrets are never printed.
 */
function setup() {
  requireOwner_();
  const db = setupDatabase();
  const p = PropertiesService.getScriptProperties();
  const lines = Object.keys(BOT_PROPS_).map(function (k) {
    const c = BOT_PROPS_[k];
    const url = p.getProperty(c.url) || '', sec = p.getProperty(c.secret) || '';
    return c.name + ': ' + c.url + ' ' + (url ? (/^https:\/\/open\.(larksuite|feishu)\.(com|cn)\/open-apis\/bot\/v2\/hook\//.test(url) ? '✓' : '⚠ ไม่ใช่ลิงก์ Lark webhook') : '✗ ยังไม่ได้ตั้ง') +
      ' · ' + c.secret + ' ' + (sec ? '✓' : '✗ ยังไม่ได้ตั้ง');
  });
  const msg = ['setupDatabase: OK'].concat(lines, ['ขั้นต่อไป: testBots → installTriggers → Deploy']).join('\n');
  console.log(msg);
  return { database: db, bots: lines };
}

/** Run once: hourly trigger for sendSlaReminders (replaces an old one). */
function installReminderTrigger() {
  requireOwner_();
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sendSlaReminders') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('sendSlaReminders').timeBased().everyHours(1).create();
  console.log('Installed: sendSlaReminders every hour');
  return 'OK';
}

// ---------------------------------------------------------------- test

/**
 * Run from the editor: sends one sample card of every Bot A event and one Bot B reminder,
 * all mentioning you (check the mention turns blue = your Lark account matches your e-mail).
 */
function testBots() {
  requireAdminOrOwner_();
  const me = String(Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const facts = { no: 'FPR-TEST-0001', customer: 'ลูกค้าทดสอบ · ร้านอาหาร', requester: me, status: 'ทดสอบ', owner: me,
    deadline: fmtDate_(new Date(Date.now() + 4 * 3600000), 'dd/MM/yyyy HH:mm'),
    items: ['• #1 **กุ้งขาว Vannamei HLSO** (31/40 · NW 80% · 1 kg/pack) — 500 กก./เดือน', '• #2 **หมึกกล้วย IQF** (U/10) — 300 กก./เดือน'], priced: false };
  const link = fprLink_({ ticket_no: 'FPR-TEST-0001' });
  const out = [];
  Object.keys(FPR_EVENTS_).forEach(function (k) {
    const ev = FPR_EVENTS_[k];
    const f = Object.assign({}, facts, { priced: ['sm_review', 'gm_final', 'approved'].indexOf(k) !== -1 });
    const card = buildCard_({ color: ev.color, title: '[ทดสอบ] ' + ev.icon + ' ' + ev.title + ' — ' + f.no, facts: f, mentions: [me], link: link,
      extra: k === 'rejected' || k === 'returned' ? ['**เหตุผล:** (ข้อความทดสอบ)'] : [] });
    out.push(k + ': ' + sendBot_('fpr', card, { event: 'test_' + k, ticket_no: f.no, summary: 'testBots ' + k }).status);
  });
  const rem = buildCard_({ color: 'yellow', title: '[ทดสอบ] ⏰ งานค้างเกิน SLA — FPR-TEST-0001', facts: facts, mentions: [me], link: link,
    extra: ['**ขั้นที่ค้าง:** ' + SLA_LABEL_.GM_REVIEW + ' · SLA 4 ชม.ทำงาน', '**เกินกำหนดมาแล้ว:** 1 ชม. 20 นาที (นับเฉพาะเวลาทำงาน)'] });
  out.push('reminder: ' + sendBot_('reminder', rem, { event: 'test_reminder', ticket_no: 'FPR-TEST-0001', summary: 'testBots reminder' }).status);
  console.log(out.join('\n'));
  return out;
}


// ============================================================================
// Jobs.gs
// ============================================================================
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


// ============================================================================
// Code.gs
// ============================================================================
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
const PARTIALS_ = ['App', 'PageHome', 'PageDashboard', 'PageGp', 'PageDeals', 'PageTickets', 'PageTicket', 'PageForm', 'PageSuppliers', 'PagePricing'];

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
  if (['manager', 'sr_manager', 'gm', 'admin'].indexOf(u.role) !== -1) {
    m.push({ key: 'reports', group: MAIN, icon: '📊', label: 'รายงาน', route: { page: 'dashboard' } });
  }
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


// ============================================================================
// Setup.gs
// ============================================================================
/**
 * File: Setup.gs
 * One-time / maintenance functions. Run from the Apps Script editor (Run menu).
 *
 *   setupDatabase()  — creates (or repairs) the database spreadsheet, every tab and header,
 *                      column formats, dropdowns, sheet protection, default Settings and
 *                      the Drive folder for attachments. Safe to run again any time:
 *                      it only ADDS missing tabs/columns, never deletes or reorders.
 *   seedMasterData() — departments, Food product groups + checklist templates, vendors.
 *   seedDemoData()   — demo users (all roles) + 13 demo tickets driven through the real workflow (incl. price history + deal outcomes).
 *                      DEV / UAT ONLY — edit DEMO_DOMAIN first.
 */

const DEMO_DOMAIN = 'example.co.th';   // ← change to your company domain before seedDemoData()

const DATE_COLS_ = ['created_at', 'updated_at', 'ts', 'stage_entered_at', 'submitted_at', 'manager_approved_at',
  'gm_approved_at', 'assigned_at', 'doc_checked_at', 'completed_at', 'closed_at', 'rejected_at', 'cancelled_at',
  'checked_at', 'uploaded_at', 'deleted_at', 'read_at', 'lark_sent_at', 'deal_updated_at', 'deal_closed_at', 'pricing_started_at', 'last_reminded_at'];
const DAY_COLS_ = ['due_date', 'valid_until', 'deal_next_date', 'fx_date', 'date'];
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
    const folder = DriveApp.createFolder(DRIVE_ROOT_NAME);
    props.setProperty(CFG.PROP.DRIVE_ROOT_ID, folder.getId());
    report.push('Created Drive folder ' + folder.getId());
  }
  const mig = withLock_(function () { return migrateSuppliersCore_(); });
  // document chips renamed (Test report covers micro + heavy metal + chemical; Food Safety Cert covers GMP/HACCP/BRC …)
  // only when Admin has not customised the list yet
  const OLD_DOCS = ['COA', 'Health Certificate', 'Halal', 'Spec sheet', 'ใบวิเคราะห์จุลินทรีย์', 'GMP / HACCP'];
  const docs = findOne_(TAB.SETTINGS, 'key', 'document_options');
  if (docs && JSON.stringify(parseJson_(docs.value, [])) === JSON.stringify(OLD_DOCS)) {
    const fresh = DEFAULT_SETTINGS.filter(function (x) { return x[0] === 'document_options'; })[0][1];
    withLock_(function () { updateRow_(TAB.SETTINGS, 'document_options', { value: fresh, updated_at: new Date(), updated_by: 'setup' }); });
    report.push('Settings document_options: renamed to Test report / Food Safety Cert');
  }
  report.push('Suppliers from old quotations: +' + mig.created + ' created, ' + mig.linked + ' quotations linked');
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
  // GM approval → SR: FPR mode (GM picks the SR) or queue mode (SR claims) — works with either Settings switch
  const toSr = function (id, sr, comment) {
    if (toBool_(setting_('gm_assigns_sr', true))) return go(U.gm, id, 'gm_approve', comment || '', { sr_email: sr });
    go(U.gm, id, 'gm_approve', comment || '');
    return go(sr, id, 'claim');
  };
  const req = function (email, key, header, items) {
    return as(email, function () {
      const grp = /โรงแรม|ภัตตาคาร/.test(header.customer_name) ? 'โรงแรม / จัดเลี้ยง' : 'ร้านอาหาร';
      return must(createTicket(Object.assign({ client_key: key, due_date: inDays(7), customer_group: grp }, header, { items: items }))).ticket;
    });
  };

  // (A) Salmon — full cycle: GM → SR → SR Manager → GM price → Sales accepts (Closed)
  let t = req(U.salesFood1, 'seed-A', { customer_name: 'บจก. ซูชิ ดีไลท์', documents_needed: 'Health Certificate, COA', description: 'ลูกค้าต้องการแบรนด์นอร์เวย์', priority: 'high' }, [
    { product_group_code: 'FOOD-FISH', product_name: 'Salmon Fillet Trim D (Skin-on)', net_weight: '100%', size: '1.0–1.5 kg/pc', packing_size: 'IVP 1 pc/bag, 10 kg/ctn', qty: 300, uom: 'กก.', target_price: 450 }
  ]);
  toSr(t.ticket_id, U.sr1, 'อนุมัติ');
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
  if (toBool_(setting_('gm_assigns_sr', true))) go(U.gm, t.ticket_id, 'gm_approve', '', { sr_email: U.sr1 });
  else { go(U.gm, t.ticket_id, 'gm_approve'); go(U.srManager, t.ticket_id, 'assign', '', { sr_email: U.sr1 }); }
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
  toSr(t.ticket_id, U.sr2);
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
  toSr(t.ticket_id, U.sr1);
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
    updateRow_(TAB.ITEMS, it.item_id, { supplier_shortfall_reason: 'กุ้งแชบ๊วยไซซ์ใหญ่ มีผู้เสนอราคาเพียง 2 ราย' });
  });
  go(U.sr1, t.ticket_id, 'submit_quote');

  // (G–M) Price history for ติดตามการขาย + สรุป GP: priced over the last months, with the deal outcome Sales recorded
  const priced = function (sales, key, header, item, quote, gp, monthsAgo, deal) {
    const x = req(sales, key, header, [Object.assign({ net_weight: '100%', packing_size: '10 kg/ctn', uom: 'กก.' }, item)]);
    if (ticketById_(x.ticket_id).stage === 'pending_manager') go(U.mgrFood, x.ticket_id, 'manager_approve');
    toSr(x.ticket_id, U.sr2);
    as(U.sr2, function () { checklistOf_(x.ticket_id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    go(U.sr2, x.ticket_id, 'doc_complete');
    as(U.sr2, function () {
      const it = activeItemsOf_(x.ticket_id)[0];
      const qid = Utilities.getUuid();
      must(saveSourcingDraft(x.ticket_id, [{ item_id: it.item_id, gp_percent: gp, winner_quote_id: qid, shortfall_reason: 'ข้อมูลตัวอย่าง (ราคาย้อนหลัง)',
        quotes: [Object.assign({ quote_id: qid, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }, quote)] }]));
    });
    go(U.sr2, x.ticket_id, 'submit_quote');
    go(U.srManager, x.ticket_id, 'srm_approve');
    go(U.gm, x.ticket_id, 'gm_price_approve');
    const when = new Date(Date.now() - monthsAgo * 30.5 * 86400000);
    updateRow_(TAB.TICKETS, x.ticket_id, { gm_price_approved_at: when });
    if (deal && deal.status !== 'follow') go(sales, x.ticket_id, 'accept');
    if (deal) {
      const it = activeItemsOf_(x.ticket_id)[0];
      as(sales, function () { must(updateDeal(it.item_id, deal)); });
      if (deal.status === 'won' || deal.status === 'lost') updateRow_(TAB.ITEMS, it.item_id, { deal_closed_at: new Date(when.getTime() + 12 * 86400000) });
    }
    return x;
  };
  priced(U.salesFood1, 'seed-G', { customer_name: 'ร้านอาหาร ครัวทะเล' }, { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว Vannamei PD', size: '41/50', qty: 600, target_price: 280 },
    { vendor_id: 'V-0001', vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 235 }, 15, 5, { status: 'won', note: 'สั่งประจำทุกเดือน' });
  priced(U.salesFood2, 'seed-H', { customer_name: 'โรงแรม แกรนด์ บีช' }, { product_group_code: 'FOOD-FISH', product_name: 'ปลาแซลมอน Fillet', size: '1.2–1.8 kg', qty: 250, target_price: 520 },
    { vendor_id: 'V-0002', vendor_name: 'Nordic Salmon AS', unit_price: 12.2, currency: 'EUR', fx_rate: 39.5, vat_term: 'no_vat', clearance_thb: 18 }, 12, 4, { status: 'lost', reason: 'ราคาสูงกว่าคู่แข่ง', note: 'คู่แข่งเสนอ 545' });
  priced(U.salesFood3, 'seed-I', { customer_name: 'โรงแรม ซีวิว' }, { product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', size: 'U/10', qty: 900, target_price: 170 },
    { vendor_id: 'V-0003', vendor_name: 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', unit_price: 138 }, 15, 3, { status: 'won' });
  priced(U.salesFood1, 'seed-J', { customer_name: 'ร้านซูชิ ABC' }, { product_group_code: 'FOOD-FISH', product_name: 'ปลาซาบะนอร์เวย์ Fillet', size: '150–200 g', qty: 200, target_price: 0 },
    { vendor_id: 'V-0002', vendor_name: 'Nordic Salmon AS', unit_price: 3.6, currency: 'EUR', fx_rate: 39.5, vat_term: 'no_vat', clearance_thb: 9 }, 18, 2, { status: 'lost', reason: 'ลูกค้าเลื่อน / ยกเลิกโครงการ' });
  priced(U.salesFood2, 'seed-K', { customer_name: 'ภัตตาคาร ทะเลทอง' }, { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งแชบ๊วย HOSO', size: '21/25', qty: 150, target_price: 420 },
    { vendor_id: 'V-0005', vendor_name: 'India Marine Exports Pvt. Ltd.', unit_price: 9.9, currency: 'USD', fx_rate: 35, vat_term: 'no_vat', clearance_thb: 15 }, 14, 1, { status: 'won' });
  priced(U.salesFood3, 'seed-L', { customer_name: 'โรงแรม รอยัล ริเวอร์' }, { product_group_code: 'FOOD-FISH', product_name: 'ปลากะพงขาว Fillet', size: '200–300 g', qty: 400, target_price: 210 },
    { vendor_id: 'V-0003', vendor_name: 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', unit_price: 182 }, 15, 1, { status: 'sample', note: 'ส่งตัวอย่าง 5 กก. ให้เชฟทดลอง' });
  priced(U.salesFood1, 'seed-M', { customer_name: 'ร้านอาหาร ครัวทะเล' }, { product_group_code: 'FOOD-CEPHALOPOD', product_name: 'ปลาหมึกกระดอง Cut', size: '40/60', qty: 300, target_price: 190 },
    { vendor_id: 'V-0001', vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 158 }, 15, 0, null);
  return 'demo tickets +13';
}


// ============================================================================
// Tests.gs
// ============================================================================
/**
 * File: Tests.gs
 * Acceptance tests. Run runAcceptanceTests() from the Apps Script editor.
 *
 * Creates a TEMPORARY spreadsheet, builds the schema, seeds master data + demo users,
 * runs every scenario by impersonating users server-side, then moves the temp file
 * to Trash. The production database is never touched.
 * View → Logs (or Executions) shows PASS / FAIL lines and the summary.
 */

function runAcceptanceTests() {
  requireAdminOrOwner_();
  const results = [];
  const tmp = SpreadsheetApp.create('MGS Food Price Request — TEST ' + fmtDate_(new Date(), 'yyyy-MM-dd HH:mm:ss'));
  try {
    useDatabase_(tmp);
    setupSchema_(tmp, { protect: false });
    withLock_(function () {
      seedMaster_();
      seedUsers_();
      // Tests run WITH a Sales Manager; the "no Sales Manager → skip to GM" path is tested separately
      updateRow_(TAB.DEPARTMENTS, 'SALES-FOOD', { manager_email: demoUsers_().mgrFood });
      // The original flow cases below run with the pre-FPR switches; runFprCases_ turns the FPR switches on
      setTestSettings_({ sales_manager_step: 'true', gm_assigns_sr: 'false', min_suppliers: '1' });
    });
    runCases_(results);
    runPhase2Cases_(results);
    runPhase3Cases_(results);
    runOrgCases_(results);
    runSellPriceCases_(results);
    runFollowUpCases_(results);
    runBoardCases_(results);
    runSupplierCases_(results);
    runQueueReturnCases_(results);
    runPhotoDealCases_(results);
    runFollowUpV2Cases_(results);
    runReviewerEditCases_(results);
    runFprCases_(results);
  } catch (e) {
    results.push('FAIL: test run aborted — ' + (e && e.message) + '\n' + (e && e.stack));
  } finally {
    TEST_HTTP_ = null;
    TEST_DRIVE_ = null;
    TEST_LARK_ = null;
    DB_SS_ = null;
    TABLE_CACHE_ = {};
    try { DriveApp.getFileById(tmp.getId()).setTrashed(true); } catch (e) { console.warn('could not trash temp file', e); }
  }
  const failed = results.filter(function (r) { return r.indexOf('FAIL') === 0; });
  const summary = (failed.length ? '❌ ' + failed.length + ' FAILED' : '✅ ALL TESTS PASSED') +
    ' — ' + (results.length - failed.length) + '/' + results.length + ' passed';
  console.log(results.join('\n') + '\n' + summary);
  return { passed: results.length - failed.length, failed: failed.length, summary: summary, results: results };
}

/** Test helper: FPR Bot / Reminder sends of one ticket (NotifLog), optionally one event. */
function botLog_(ticketId, event) {
  return rows_(TAB.NOTIF_LOG).filter(function (n) { return String(n.ticket_id) === String(ticketId) && (!event || n.event === event); })
    .map(function (n) { return { event: String(n.event), status: String(n.status), attempts: Number(n.attempts), summary: String(n.summary), bot: String(n.bot) }; });
}

/** Test helper: set Settings values (inside the lock). */
function setTestSettings_(kv) {
  withLock_(function () {
    Object.keys(kv).forEach(function (k) {
      if (findOne_(TAB.SETTINGS, 'key', k)) updateRow_(TAB.SETTINGS, k, { value: kv[k] });
      else insertRow_(TAB.SETTINGS, { key: k, value: kv[k], description: 'test', updated_at: new Date(), updated_by: 'test' });
    });
  });
}

/** Test helper: fill the Food form fields a test does not care about. */
function testForm_(p) {
  const o = Object.assign({}, p);
  if (o.customer_name === undefined) o.customer_name = 'ลูกค้าทดสอบ';
  if (o.customer_group === undefined) o.customer_group = 'ร้านอาหาร';
  if (o.due_date === undefined) o.due_date = fmtDate_(new Date(Date.now() + 3 * 86400000));
  o.items = (o.items || []).map(function (it) {
    const x = Object.assign({}, it);
    if (/^OTHERS/.test(String(x.product_group_code || ''))) x.product_group_code = 'FOOD-PROCESSED';
    if (x.net_weight === undefined) x.net_weight = '100%';
    if (x.size === undefined) x.size = 'M';
    if (x.packing_size === undefined) x.packing_size = '1 kg/pack';
    if (x.uom !== undefined && UNITS.indexOf(x.uom) === -1) x.uom = 'ชิ้น';
    if (x.target_price === undefined) x.target_price = 0;
    return x;
  });
  return o;
}
function createTicketT_(p) { return createTicket(testForm_(p)); }

/** Push a ticket from pending_sr_manager through SR Manager and GM price approval. */
function approvePriceT_(U, id) {
  const step = function (email, action) {
    return withIdentity_(email, function () {
      const r = transitionTicket(id, action, '', { expected_version: ticketById_(id).version });
      if (!r.ok) throw new Error('FAIL: ' + action + ' → ' + JSON.stringify(r));
      return r.data.ticket;
    });
  };
  step(U.srManager, 'srm_approve');
  return step(U.gm, 'gm_price_approve');
}

function runCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) {
    if (!cond) throw new Error('FAIL: ' + name);
    results.push('PASS: ' + name);
  };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) {
      results.push('PASS: ' + name + ' → [' + code + '] ' + res.error);
      return;
    }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const ver = function (id) { return ticketById_(id).version; };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () {
      return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ver(id) }, extra || {}));
    });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const transitionLogs = function (id) {
    return findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.log_type === 'transition'; });
  };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) {
      results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack);
    }
  };

  let food1Ticket;

  // ===================================================================== AC-1 visibility
  wrap('AC-1', function () {
    food1Ticket = as(U.salesFood1, function () {
      return must(createTicketT_({ client_key: 'ac1', title: 'หมึกกล้วยแช่แข็ง',
        items: [{ product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', qty: 100, uom: 'กก.' }] })).ticket;
    });
    ok(/^FPR-\d{4}-\d{4,}$/.test(food1Ticket.ticket_no), 'Ticket number format FPR-YYMM-NNNN: ' + food1Ticket.ticket_no);
    ok(food1Ticket.status === 'requested' && food1Ticket.stage === 'pending_manager', 'New ticket = Requested / pending_manager');

    const dup = as(U.salesFood1, function () {
      return must(createTicketT_({ client_key: 'ac1', title: 'หมึกกล้วยแช่แข็ง',
        items: [{ product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', qty: 100, uom: 'กก.' }] }));
    });
    ok(dup.duplicate === true && dup.ticket.ticket_id === food1Ticket.ticket_id, 'Double submit (same client_key) → one ticket only');

    ok(as(U.salesFood1, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'AC-1 Owner sees own ticket');
    expectErr(as(U.salesFood2, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'AC-1 Other Sales cannot open the ticket (direct API call)');
    expectErr(as(U.srManager, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'SR Manager cannot open a ticket before GM approval');
    expectErr(as(U.sr1, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'SR cannot open a ticket before GM approval');
    ok(as(U.mgrFood, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'Sales Manager sees it');
    ok(as(U.gm, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'GM sees it');
    expectErr(as('stranger@' + DEMO_DOMAIN, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_REGISTERED', 'Unregistered account is rejected');
    expectErr(as(U.salesFood2, function () {
      return createTicketT_({ customer_name: '', items: [{ product_name: 'กุ้ง', qty: 1, uom: 'กก.' }] });
    }), 'VALIDATION', 'Customer is required');
    expectErr(as(U.salesFood2, function () {
      return createTicketT_({ title: 'ทดสอบจำนวน', items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 'abc', uom: 'กก.' }] });
    }), 'VALIDATION', 'Qty "abc" rejected (no silent 0)');
    expectErr(as(U.gm, function () {
      return createTicketT_({ title: 'GM สร้างใบ', items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 1, uom: 'กก.' }] });
    }), 'FORBIDDEN', 'Only Sales can create tickets');
  });

  // ===================================================================== AC-2 status only via transitionTicket
  wrap('AC-2', function () {
    const id = food1Ticket.ticket_id;
    const res = as(U.salesFood1, function () {
      return updateTicketRequest(id, { status: 'closed', stage: 'closed', sr_email: U.sr1, title: 'หมึกกล้วยแช่แข็ง (แก้ชื่อ)' }, ver(id));
    });
    const t = ticketById_(id);
    ok(res.ok && t.status === 'requested' && t.stage === 'pending_manager' && t.sr_email === '',
      'AC-2 Edit API ignores status/stage/sr_email — only whitelisted header fields change');
    ok(t.title === 'หมึกกล้วยแช่แข็ง (แก้ชื่อ)' && t.version === 2, 'AC-2 Header edit saved, version bumped');
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) { return l.action === 'ticket_updated'; }), 'AC-2 Header edit logged with diff');

    expectErr(as(U.mgrFood, function () { return transitionTicket(id, 'manager_approve', '', { expected_version: 1 }); }),
      'VERSION_CONFLICT', 'Optimistic lock: stale version rejected');
    expectErr(as(U.mgrFood, function () { return transitionTicket(id, 'manager_approve', '', {}); }),
      'VERSION_REQUIRED', 'expected_version is mandatory');
    expectErr(go(U.mgrFood, id, 'manager_reject'), 'COMMENT_REQUIRED', 'Reject without reason rejected');
    expectErr(go(U.mgrFood, id, 'gm_approve'), 'FORBIDDEN', 'Manager cannot perform GM approval');
    expectErr(go(U.salesFood1, id, 'manager_approve'), 'FORBIDDEN', 'Sales cannot approve own ticket');
    expectErr(go(U.mgrFood, id, 'fly_to_moon'), 'INVALID_ACTION', 'Unknown action rejected');
  });

  // ===================================================================== Full workflow + AC-3 + AC-4
  wrap('FLOW', function () {
    const t0 = as(U.salesFood3, function () {
      return must(createTicketT_({ client_key: 'flow', title: 'ทดสอบเครื่องซีลสุญญากาศ + กุ้งขาว', items: [
        { product_group_code: 'OTHERS-PACKAGING', product_name: 'เครื่องซีลสุญญากาศ', qty: 2, uom: 'เครื่อง' },
        { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว HLSO 31/40', qty: 500, uom: 'กก.' }] })).ticket;
    });
    const id = t0.ticket_id;

    ok(must(go(U.mgrFood, id, 'manager_return', 'กรุณาระบุรุ่น')).ticket.stage === 'returned', 'Manager return → returned');
    const item1 = activeItemsOf_(id)[0];
    as(U.salesFood3, function () {
      must(saveItem(id, Object.assign({}, item1, { spec: 'รุ่น DZ-400 ห้องซีล 40 ซม.' }), ver(id)), 'saveItem');
    });
    ok(activeItemsOf_(id)[0].spec === 'รุ่น DZ-400 ห้องซีล 40 ซม.', 'Sales edits item while returned');
    ok(must(go(U.salesFood3, id, 'resubmit')).ticket.stage === 'pending_manager', 'Resubmit → pending_manager');
    ok(must(go(U.mgrFood, id, 'manager_approve')).ticket.stage === 'pending_gm', 'Manager approve → pending_gm');
    expectErr(as(U.salesFood3, function () {
      return saveItem(id, Object.assign({}, item1, { qty: 99 }), ver(id));
    }), 'FORBIDDEN', 'Sales cannot edit items after Manager approval');

    const g = must(go(U.gm, id, 'gm_approve')).ticket;
    ok(g.status === 'on_process' && g.stage === 'pending_assign', 'GM approve → On Process / pending_assign');
    expectErr(go(U.salesFood3, id, 'cancel'), 'INVALID_STATE', 'Sales cannot cancel after GM approval');
    expectErr(go(U.sr2, id, 'assign', '', { sr_email: U.sr1 }), 'FORBIDDEN', 'Normal SR cannot assign');

    const c = must(go(U.sr1, id, 'claim')).ticket;
    ok(c.stage === 'doc_check' && c.sr_email === U.sr1 && !!c.assigned_at, 'SR claim → doc_check, sr + time recorded');
    ok(checklistOf_(id).length === 8, 'Checklist built from Food + Shrimp + Processed templates (8 rows)');
    expectErr(go(U.sr2, id, 'claim'), 'ALREADY_CLAIMED', 'Second SR cannot claim the same job');
    expectErr(go(U.sr1, id, 'doc_complete'), 'CHECKLIST_INCOMPLETE', 'Cannot finish doc check with unticked items');

    const items = activeItemsOf_(id);
    expectErr(as(U.sr1, function () {
      return saveQuotation({ item_id: items[0].item_id, vendor_name: 'X', unit_price: 1, vat_term: 'ex_vat' });
    }), 'FORBIDDEN', 'Cannot enter prices before documents are checked');

    const ri = must(go(U.sr1, id, 'request_info', 'ขอรูปตัวอย่างสินค้า', { missing_items: ['sample_photo'] })).ticket;
    ok(ri.stage === 'need_info' && ri.info_request.return_stage === 'doc_check', 'SR request_info → need_info');
    const rs = must(go(U.salesFood3, id, 'respond_info', 'แนบรูปแล้ว')).ticket;
    ok(rs.stage === 'doc_check' && rs.sr_email === U.sr1 && !rs.info_request, 'Sales respond → back to the same SR (doc_check)');

    expectErr(as(U.sr2, function () { return updateChecklist(checklistOf_(id)[0].check_id, true, ''); }),
      'FORBIDDEN', 'Other SR cannot tick the checklist');
    as(U.sr1, function () {
      checklistOf_(id).filter(function (x) { return x.is_required; }).forEach(function (x) {
        must(updateChecklist(x.check_id, true, 'ok'), 'updateChecklist');
      });
    });
    ok(checklistOf_(id).filter(function (x) { return x.is_required; }).every(function (x) {
      return x.checked_by === U.sr1 && !!x.checked_at;
    }), 'checked_by / checked_at stamped');
    ok(must(go(U.sr1, id, 'doc_complete')).ticket.stage === 'sourcing', 'doc_complete → sourcing');

    // ---- AC-3 vendor rules
    const saveQ = function (p) { return as(U.sr1, function () { return saveQuotation(p); }); };
    const qA = must(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 50000, currency: 'THB', vat_term: 'ex_vat', valid_until: inDays(30) })).quote;
    const qB = must(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor B', unit_price: '52,430', currency: 'THB', vat_term: 'include_vat' })).quote;
    const qC = must(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor C', unit_price: 1400, currency: 'USD', fx_rate: 36.5, vat_term: 'no_vat' })).quote;
    ok(qB.net_unit_cost_thb === 49000, 'VAT: Include VAT 52,430 ÷ 1.07 = 49,000 net (comma input parsed)');
    ok(qA.gross_unit_price_thb === 53500, 'VAT: Ex VAT 50,000 × 1.07 = 53,500 gross');
    ok(qC.net_unit_cost_thb === 51100, 'FX: 1,400 USD × 36.5 = 51,100 THB');
    const cmp = compareQuotes_(2, activeQuotesOfItem_(items[0].item_id));
    ok(cmp.filter(function (q) { return q.is_cheapest; }).map(function (q) { return q.vendor_name; }).join() === 'Vendor B',
      'Comparison marks Vendor B as cheapest');

    const qD = must(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor D', unit_price: 60000, vat_term: 'ex_vat' })).quote;
    const qE = must(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor E', unit_price: 61000, vat_term: 'ex_vat' })).quote;
    expectErr(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor F', unit_price: 1, vat_term: 'ex_vat' }),
      'MAX_VENDORS', 'AC-3 6th vendor on the same item rejected (max ' + CFG.MAX_VENDORS_PER_ITEM + ')');
    must(as(U.sr1, function () { must(deleteQuotation(qD.quote_id)); return deleteQuotation(qE.quote_id); }));
    const again = must(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 50000, currency: 'THB', vat_term: 'ex_vat', valid_until: inDays(30) }));
    ok(again.changed === false && activeQuotesOfItem_(items[0].item_id).length === 3, 'Re-saving the same quote_id is idempotent (no duplicate row)');
    expectErr(saveQ({ item_id: items[1].item_id, vendor_name: 'Bad FX', unit_price: 1, currency: 'THB', fx_rate: 2, vat_term: 'ex_vat' }),
      'VALIDATION', 'THB must have fx_rate = 1');
    expectErr(saveQ({ item_id: items[1].item_id, vendor_name: 'Neg', unit_price: -1, vat_term: 'ex_vat' }), 'VALIDATION', 'Negative price rejected');
    expectErr(saveQ({ item_id: items[1].item_id, vendor_name: 'NoFx', unit_price: 1, currency: 'USD', vat_term: 'ex_vat' }), 'VALIDATION', 'Foreign currency requires fx_rate');
    expectErr(saveQ({ item_id: items[1].item_id, vendor_name: 'BadVat', unit_price: 1, vat_term: 'vat7' }), 'VALIDATION', 'Unknown VAT term rejected');

    as(U.sr1, function () { must(selectQuotation(qA.quote_id, '')); must(selectQuotation(qC.quote_id, '')); });
    const winners = activeQuotesOfItem_(items[0].item_id).filter(function (q) { return q.is_selected; });
    ok(winners.length === 1 && winners[0].quote_id === qC.quote_id, 'AC-3 Selecting a second winner replaces the first (always exactly 1)');

    // Corrupted sheet (two winners written outside the app) is still refused at submit
    withLock_(function () { updateRow_(TAB.QUOTATIONS, qA.quote_id, { is_selected: true }); });
    expectErr(go(U.sr1, id, 'submit_quote'), 'MULTIPLE_WINNERS', 'AC-3 Two winners on one item rejected at submit');
    withLock_(function () { updateRow_(TAB.QUOTATIONS, qA.quote_id, { is_selected: false }); });

    expectErr(go(U.sr1, id, 'submit_quote'), 'MISSING_QUOTATION', 'Submit blocked: item 2 has no vendor');
    const qCable = must(saveQ({ item_id: items[1].item_id, vendor_name: 'Cable Co', unit_price: 28, vat_term: 'ex_vat', valid_until: inDays(-1) })).quote;
    expectErr(go(U.sr1, id, 'submit_quote'), 'MISSING_WINNER', 'Submit blocked: item 2 has no winner');
    as(U.sr1, function () { must(selectQuotation(qCable.quote_id, '')); });
    expectErr(go(U.sr1, id, 'submit_quote'), 'REASON_REQUIRED', 'Submit blocked: winner is not the cheapest and has no reason');
    as(U.sr1, function () { must(selectQuotation(qA.quote_id, 'Lead time สั้นกว่า 3 สัปดาห์')); });
    expectErr(go(U.sr1, id, 'submit_quote'), 'QUOTATION_EXPIRED', 'Submit blocked: winning price already expired');
    must(saveQ({ quote_id: qCable.quote_id, item_id: items[1].item_id, vendor_name: 'Cable Co', unit_price: 28, vat_term: 'ex_vat', valid_until: inDays(10) }));

    const salesView = as(U.salesFood3, function () { return must(getTicket(id)); });
    ok(salesView.items.every(function (it) { return it.quotations.length === 0; }), 'Sales cannot see draft quotations');

    const sub = must(go(U.sr1, id, 'submit_quote')).ticket;
    ok(sub.status === 'on_process' && sub.stage === 'pending_sr_manager', 'submit_quote → pending_sr_manager (SR Manager checks first)');
    ok(as(U.salesFood3, function () { return must(getTicket(id)); }).items.every(function (it) { return it.quotations.length === 0; }),
      'Sales still cannot see prices while SR Manager / GM review');
    expectErr(go(U.gm, id, 'gm_price_approve'), 'INVALID_STATE', 'GM cannot approve price before SR Manager (no skipping)');
    expectErr(go(U.sr1, id, 'srm_approve'), 'FORBIDDEN', 'SR cannot approve own price');
    const ap = approvePriceT_(U, id);
    ok(ap.status === 'completed' && ap.stage === 'awaiting_sales_ack' && ap.sr_manager_email === U.srManager && !!ap.gm_price_approved_at,
      'SR Manager → GM approve → Completed / awaiting_sales_ack');
    expectErr(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 1, vat_term: 'ex_vat' }),
      'FORBIDDEN', 'SR cannot edit prices after submission');
    const salesView2 = as(U.salesFood3, function () { return must(getTicket(id)); });
    ok(salesView2.items.every(function (it) { return it.quotations.length === 0 && it.pricing === null; }) &&
      salesView2.items.every(function (it) { return it.sales_pricing && it.sales_pricing.sell_price_thb > 0; }),
      'After GM approval Sales sees the selling price only — never vendor quotations');

    expectErr(go(U.salesFood3, id, 'request_revision'), 'COMMENT_REQUIRED', 'Revision needs a comment');
    const rev = must(go(U.salesFood3, id, 'request_revision', 'ลูกค้าต่อราคา')).ticket;
    ok(rev.stage === 'sourcing' && rev.revision_count === 1, 'request_revision → sourcing, revision_count = 1');
    must(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 48500, currency: 'THB', vat_term: 'ex_vat', valid_until: inDays(30) }));
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) {
      const m = parseJson_(l.metadata_json, {});
      return l.action === 'quotation_updated' && m.diff && m.diff.unit_price &&
        Number(m.diff.unit_price.old) === 50000 && Number(m.diff.unit_price['new']) === 48500;
    }), 'Price change logged with old → new diff');
    as(U.sr1, function () { must(selectQuotation(qA.quote_id, '')); });
    must(go(U.sr1, id, 'submit_quote'));
    approvePriceT_(U, id);
    const closed = must(go(U.salesFood3, id, 'accept', 'ตกลง')).ticket;
    ok(closed.status === 'closed' && !!closed.closed_at, 'accept → Closed');

    // ---- AC-4 logs
    const logs = transitionLogs(id);
    ok(logs.length === 17, 'AC-4 17 transitions → 17 transition log rows (got ' + logs.length + ')');
    ok(logs.every(function (l) { return l.actor_email && l.actor_role && l.to_stage; }), 'AC-4 Every transition row has actor, role and to-stage');
    ok(logs.filter(function (l) { return l.action !== 'create'; }).every(function (l) { return l.from_stage && l.stage_duration_sec !== ''; }),
      'AC-4 Every transition after create has from-stage and stage duration');
  });

  // ===================================================================== AC-4 tamper evidence
  wrap('AC-4b', function () {
    const v1 = as(U.admin, function () { return verifyLogChain(); });
    ok(v1.ok && v1.data.valid === true, 'AC-4 Hash chain valid (' + v1.data.rows + ' log rows)');
    expectErr(as(U.salesFood1, function () { return verifyLogChain(); }), 'FORBIDDEN', 'Only Admin can run verifyLogChain');

    // Simulate the owner editing a log cell directly in the sheet
    const meta = headers_(TAB.LOGS);
    const cell = meta.sheet.getRange(3, meta.idx.comment + 1);
    const original = cell.getValue();
    cell.setValue('แก้ไขย้อนหลัง');
    invalidate_();
    const v2 = as(U.admin, function () { return verifyLogChain(); });
    ok(v2.ok && v2.data.valid === false && Number(v2.data.brokenAt) === 2, 'AC-4 Edited log row detected by hash chain (row log_id=2)');
    cell.setValue(original);
    invalidate_();
    ok(as(U.admin, function () { return verifyLogChain(); }).data.valid === true, 'Chain valid again after restoring the cell');
  });

  // ===================================================================== AC-5 numbering + cancel
  wrap('AC-5', function () {
    let last;
    for (let i = 0; i < 25; i++) {
      last = as(U.salesFood2, function () {
        return must(createTicketT_({ client_key: 'num-' + i, title: 'เลขที่ใบทดสอบ ' + i,
          items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 1, uom: 'กก.' }] })).ticket;
      });
    }
    const nos = rows_(TAB.TICKETS).map(function (r) { return String(r.ticket_no); });
    const unique = nos.filter(function (n, i) { return nos.indexOf(n) === i; });
    ok(unique.length === nos.length, 'AC-5 All ' + nos.length + ' ticket numbers unique');
    const seq = nos.map(function (n) { return Number(n.split('-')[2]); }).sort(function (a, b) { return a - b; });
    ok(seq.every(function (n, i) { return n === i + 1; }), 'AC-5 Numbers are consecutive with no gaps');

    const cancelled = must(go(U.salesFood2, last.ticket_id, 'cancel', 'สร้างซ้ำ')).ticket;
    ok(cancelled.status === 'rejected' && cancelled.stage === 'cancelled', 'Sales cancel before GM → Rejected / cancelled');
    const rejected = must(go(U.mgrFood, food1Ticket.ticket_id, 'manager_reject', 'ไม่มีงบ')).ticket;
    ok(rejected.status === 'rejected' && rejected.rejection_reason === 'ไม่มีงบ', 'Manager reject with reason → Rejected');
  });

  // ===================================================================== Notifications queue
  wrap('NOTIFY', function () {
    const n = rows_(TAB.NOTIFICATIONS);
    ok(n.length > 0 && n.every(function (r) { return r.lark_status === 'pending'; }), 'Notifications queued as pending for the Lark dispatcher');
    ok(!n.some(function (r) {
      return findAll_(TAB.LOGS, 'ticket_id', r.ticket_id).length === 0;
    }), 'Every notification belongs to a logged ticket');
    ok(n.some(function (r) { return r.user_email === U.mgrFood && r.type === 'approval_required'; }), 'Manager notified of new ticket');
    ok(n.some(function (r) { return r.user_email === U.salesFood3 && r.type === 'quote_ready'; }), 'Sales notified when prices are ready');
  });
}

// =============================================================================
// Phase 2 — list / inbox / dashboard / notifications / upload / Lark / SLA
// =============================================================================

/** Fake UrlFetchApp: Drive resumable upload + permissions, Lark auth / user ids / messages. */
function fakeHttp_() {
  const calls = [];
  const resp = function (code, body, headers, bytes) {
    return {
      getContent: function () { return bytes || []; },
      getResponseCode: function () { return code; },
      getContentText: function () { return typeof body === 'string' ? body : JSON.stringify(body); },
      getAllHeaders: function () { return headers || {}; }
    };
  };
  return {
    calls: calls,
    files: {},                // drive file id → { bytes, mime } (uploaded content, for previews)
    hooks: [],                // payloads posted to Lark custom bot webhooks
    hookDown: false,          // true: webhook answers HTTP 500
    parts: {},                // upload session → bytes received so far
    failOpenIds: {},          // open_id → true : Lark message call fails
    unknownEmails: {},        // email → true   : Lark has no such user
    fetch: function (url, opt) {
      const o = opt || {};
      const payload = typeof o.payload === 'string' ? parseJson_(o.payload, {}) : null;
      calls.push({ url: url, method: o.method, headers: o.headers || {}, payload: payload });
      if (url.indexOf('/upload/drive/v3/files?uploadType=resumable') !== -1) {
        return resp(200, '', { Location: 'https://upload.fake/session/' + calls.length });
      }
      if (url.indexOf('https://upload.fake/session/') === 0) {
        const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(o.headers['Content-Range']);
        const parts = this.parts[url] = (this.parts[url] || []).concat(Array.prototype.slice.call(o.payload || []));
        if (Number(m[2]) + 1 < Number(m[3])) return resp(308, '');
        const id = 'drive-file-' + calls.length;
        this.files[id] = { bytes: parts, mime: o.contentType || 'application/octet-stream' };
        return resp(200, { id: id });
      }
      // photo previews: file metadata → thumbnail link → image bytes
      const meta = /\/drive\/v3\/files\/([^/?]+)\?fields=thumbnailLink/.exec(url);
      if (meta) return this.files[decodeURIComponent(meta[1])] ? resp(200, { thumbnailLink: 'https://thumb.fake/' + meta[1] + '=s220' }) : resp(404, {});
      if (url.indexOf('https://thumb.fake/') === 0) {
        const f = this.files[decodeURIComponent(url.slice(19).replace(/=s\d+$/, ''))];
        return f ? resp(200, '', { 'Content-Type': f.mime }, f.bytes) : resp(404, {});
      }
      if (url.indexOf('/drive/v3/files/') !== -1 && url.indexOf('/permissions') !== -1) return resp(200, { id: 'perm' });
      if (url.indexOf('/auth/v3/tenant_access_token') !== -1) return resp(200, { code: 0, tenant_access_token: 'tok' });
      if (url.indexOf('/contact/v3/users/batch_get_id') !== -1) {
        const self = this;
        return resp(200, { code: 0, data: { user_list: payload.emails.filter(function (e) { return !self.unknownEmails[e]; })
          .map(function (e) { return { email: e, user_id: 'ou_' + e.split('@')[0] }; }) } });
      }
      if (url.indexOf('/open-apis/bot/v2/hook/') !== -1) {   // Lark custom bot webhook
        this.hooks.push(payload);
        if (this.hookDown) return resp(500, { code: 9499, msg: 'service unavailable' });
        return resp(200, { code: 0, msg: 'success', data: {} });
      }
      if (url.indexOf('/im/v1/messages') !== -1) {
        if (this.failOpenIds[payload.receive_id]) return resp(200, { code: 230001, msg: 'bot not in chat' });
        return resp(200, { code: 0, data: { message_id: 'om_' + calls.length } });
      }
      return resp(404, { code: 404, msg: 'unexpected url ' + url });
    }
  };
}

function fakeDrive_() {
  const trashed = {};
  return {
    trashed: trashed,
    getFileById: function (id) { return { setTrashed: function () { trashed[id] = true; } }; },
    getFolderById: function () {
      return {
        getFoldersByName: function () { return { hasNext: function () { return false; } }; },
        createFolder: function (name) { return { getId: function () { return 'folder-' + name; } }; }
      };
    }
  };
}

function runPhase2Cases_(results) {
  const U = demoUsers_();
  // Never touch real Drive / Lark from a test run, even if production Script Properties are set
  TEST_HTTP_ = fakeHttp_();
  TEST_DRIVE_ = fakeDrive_();
  TEST_LARK_ = { app_id: 'cli_test', app_secret: 'secret', host: 'https://open.larksuite.com', group_chat_id: 'oc_group' };
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) {
      results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack);
    }
  };

  wrap('BOOTSTRAP', function () {
    const b = as(U.salesFood1, function () { return must(getBootstrap()); });
    ok(b.me.role === 'sales' && b.menu.some(function (m) { return m.key === 'new'; }), 'Bootstrap: Sales menu has "สร้างใบขอราคา"');
    const g = as(U.gm, function () { return must(getBootstrap()); });
    ok(!g.menu.some(function (m) { return m.key === 'new'; }) && g.menu.some(function (m) { return m.key === 'tickets'; }), 'Bootstrap: GM menu has no create, has the ticket list');
    ['admin', 'gm', 'manager', 'salesFood1', 'sr1', 'srManager'].forEach(function (k) {
      const key = { manager: 'mgrFood' }[k] || k;
      const menu = menuFor_(userByEmail_(U[key]));
      ok(menu.length <= 5 && menu[0].key === 'home' && menu.some(function (m) { return m.key === 'tickets'; }), 'Menu for ' + k + ': ' + menu.length + ' items (≤ 5), homepage first');
    });
    ok(!menuFor_(userByEmail_(U.salesFood1)).some(function (m) { return m.key === 'reports' || m.key === 'suppliers'; }) &&
      menuFor_(userByEmail_(U.gm)).some(function (m) { return m.key === 'reports'; }), 'Reports for managers only; Supplier not for Sales');
    ok(b.ref.product_groups.length === 5 && b.ref.vat_rate === 0.07, 'Bootstrap: reference data (product groups, VAT rate)');
    expectErr(as('nobody@' + DEMO_DOMAIN, function () { return getBootstrap(); }), 'NOT_REGISTERED', 'Bootstrap: unregistered user gets NOT_REGISTERED');
  });

  wrap('LIST', function () {
    const total = rows_(TAB.TICKETS).length;
    const gm = as(U.gm, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(gm.total === total, 'GM list shows every ticket (' + total + ')');
    const s2 = as(U.salesFood2, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(s2.total > 0 && s2.rows.every(function (r) { return r.requestor_email === U.salesFood2; }), 'AC-1 Sales list contains only own tickets (even with scope=all)');
    const sm = as(U.mgrFood, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(sm.total === total, 'Sales Manager list shows every ticket');
    const sr = as(U.sr2, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(sr.rows.every(function (r) { return ['pending_manager', 'pending_gm', 'returned', 'cancelled'].indexOf(r.stage) === -1; }), 'SR list hides tickets not yet approved by GM');
    const inbox = as(U.mgrFood, function () { return must(listTickets({ scope: 'inbox', page_size: 200 })); });
    ok(inbox.total > 0 && inbox.rows.every(function (r) { return r.stage === 'pending_manager' && r.department_code === 'SALES-FOOD'; }),
      'Manager inbox = pending_manager tickets of own department (' + inbox.total + ')');
    const first = gm.rows[gm.rows.length - 1];
    const byNo = as(U.gm, function () { return must(listTickets({ q: first.ticket_no })); });
    ok(byNo.total === 1 && byNo.rows[0].ticket_no === first.ticket_no, 'Search by ticket number');
    const shrimp = as(U.gm, function () { return must(listTickets({ group_code: 'FOOD-SHRIMP', page_size: 200 })); });
    ok(shrimp.total >= 1 && shrimp.rows.every(function (r) { return r.group_codes.indexOf('FOOD-SHRIMP') !== -1; }), 'Filter by product group (กุ้ง)');
    const closed = as(U.gm, function () { return must(listTickets({ status: ['closed'] })); });
    ok(closed.rows.every(function (r) { return r.status === 'closed'; }), 'Filter by status');
    ok(gm.rows.every(function (r) { return ['ok', 'warning', 'breach', 'none', 'done'].indexOf(r.sla_status) !== -1 && r.age_days >= 0; }), 'Every row has aging + SLA status');
    const page2 = as(U.gm, function () { return must(listTickets({ page_size: 10, page: 2 })); });
    ok(page2.rows.length === Math.min(10, Math.max(total - 10, 0)) && page2.page === 2, 'Pagination');
  });

  wrap('DASHBOARD', function () {
    const all = rows_(TAB.TICKETS).map(normTicket_);
    const d = as(U.gm, function () { return must(getDashboard({})); });
    ok(d.kpi.total === all.length && d.kpi.done + d.kpi.open + d.kpi.rejected === d.kpi.total, 'Dashboard: done + open + rejected = total (' + d.kpi.total + ')');
    ok(d.kpi.done === all.filter(function (t) { return t.status === 'completed' || t.status === 'closed'; }).length, 'Dashboard: "เสนอราคาจบ" = Completed + Closed');
    ok(d.by_stage.reduce(function (a, b) { return a + b.count; }, 0) === d.kpi.total, 'Dashboard: status list adds up');
    ok(d.by_sales.reduce(function (a, b) { return a + b.total; }, 0) === d.kpi.total && d.can_see_everyone, 'Dashboard: GM sees every person');
    const m = as(U.mgrFood, function () { return must(getDashboard({})); });
    ok(m.kpi.total === all.length && m.by_sales.length > 1, 'Dashboard: Sales Manager sees everyone');
    const s2 = as(U.salesFood2, function () { return must(getDashboard({})); });
    ok(s2.by_sales.length === 1 && s2.by_sales[0].email === U.salesFood2 &&
      s2.kpi.total === all.filter(function (t) { return t.requestor_email === U.salesFood2; }).length, 'Dashboard: Sales sees only own requests');
    const sr = as(U.sr1, function () { return must(getDashboard({})); });
    ok(sr.kpi.total === all.filter(function (t) { return t.sr_email === U.sr1; }).length && !sr.can_see_everyone, 'Dashboard: SR sees only own jobs');
    const ad = as(U.admin, function () { return must(getDashboard({})); });
    ok(ad.kpi.total === all.length && ad.can_see_everyone, 'Dashboard: Admin sees everything');
    ok(d.recent.length > 0 && d.recent.length <= 10, 'Dashboard: recent list');
    expectErr(as(U.gm, function () { return getDashboard({ from: '2026-12-31', to: '2026-01-01' }); }), 'VALIDATION', 'Dashboard rejects reversed date range');
  });

  wrap('NOTIFICATIONS', function () {
    const before = as(U.salesFood3, function () { return must(getNotifications(50)); });
    ok(before.unread > 0, 'Sales has unread notifications (' + before.unread + ')');
    const otherBefore = as(U.mgrFood, function () { return must(getPoll()).unread; });
    as(U.salesFood3, function () { must(markNotificationsRead(null)); });
    ok(as(U.salesFood3, function () { return must(getPoll()).unread; }) === 0, 'Mark all read → unread 0');
    ok(as(U.mgrFood, function () { return must(getPoll()).unread; }) === otherBefore, "Other users' notifications untouched");
  });

  wrap('UPLOAD', function () {
    const http = fakeHttp_();
    const drive = fakeDrive_();
    TEST_HTTP_ = http;
    TEST_DRIVE_ = drive;
    const t = as(U.salesFood2, function () {
      return must(createTicketT_({ client_key: 'upl', title: 'ทดสอบแนบไฟล์',
        items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 1, uom: 'กก.' }] })).ticket;
    });
    expectErr(as(U.salesFood2, function () {
      return beginUpload({ ticket_id: t.ticket_id, file_name: 'virus.exe', mime_type: 'application/x-msdownload', size_bytes: 10 });
    }), 'FILE_TYPE', 'Upload: .exe rejected');
    expectErr(as(U.salesFood2, function () {
      return beginUpload({ ticket_id: t.ticket_id, file_name: 'big.pdf', mime_type: 'application/pdf', size_bytes: 21 * 1024 * 1024 });
    }), 'FILE_TOO_LARGE', 'Upload: file over 20 MB rejected');
    expectErr(as(U.salesFood1, function () {
      return beginUpload({ ticket_id: t.ticket_id, file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10 });
    }), 'NOT_FOUND', "Upload: cannot attach to another Sales' ticket");

    const size = UPLOAD_CHUNK_BYTES + 10;
    const bytes = [];
    for (let i = 0; i < size; i++) bytes.push(65 + (i % 26));
    const begin = as(U.salesFood2, function () {
      return must(beginUpload({ ticket_id: t.ticket_id, file_name: 'spec กุ้ง.pdf', mime_type: 'application/pdf', size_bytes: size, category: 'request' }));
    });
    ok(begin.total_chunks === 2, 'Upload: 2 MB chunks (' + begin.total_chunks + ' chunks)');
    const c0 = as(U.salesFood2, function () { return must(uploadChunk(begin.upload_id, 0, Utilities.base64Encode(bytes.slice(0, UPLOAD_CHUNK_BYTES)))); });
    ok(c0.done === false && c0.received === UPLOAD_CHUNK_BYTES, 'Upload: first chunk accepted (308)');
    const retry = as(U.salesFood2, function () { return must(uploadChunk(begin.upload_id, 0, Utilities.base64Encode(bytes.slice(0, UPLOAD_CHUNK_BYTES)))); });
    ok(retry.done === false, 'Upload: retried chunk is idempotent');
    expectErr(as(U.salesFood1, function () { return uploadChunk(begin.upload_id, 1, 'AAAA'); }), 'UPLOAD_EXPIRED', 'Upload: another user cannot hijack the session');
    const c1 = as(U.salesFood2, function () { return must(uploadChunk(begin.upload_id, 1, Utilities.base64Encode(bytes.slice(UPLOAD_CHUNK_BYTES)))); });
    ok(c1.done === true && c1.attachment.file_name === 'spec กุ้ง.pdf', 'Upload: last chunk → attachment saved');
    const putCalls = http.calls.filter(function (c) { return c.url.indexOf('https://upload.fake/session/') === 0; });
    ok(putCalls.length === 2 && putCalls[1].headers['Content-Range'] === 'bytes ' + UPLOAD_CHUNK_BYTES + '-' + (size - 1) + '/' + size,
      'Upload: Content-Range headers sent to Drive correctly');
    ok(findAll_(TAB.LOGS, 'ticket_id', t.ticket_id).some(function (l) { return l.action === 'attachment_added'; }), 'Upload logged in TicketLogs');
    const detail = as(U.mgrFood, function () { return must(getTicket(t.ticket_id)); });
    ok(detail.attachments.length === 1, 'Department manager sees the attachment');

    const open = as(U.mgrFood, function () { return must(openAttachment(c1.attachment.attachment_id)); });
    const perm = http.calls.filter(function (c) { return c.url.indexOf('/permissions') !== -1; }).pop();
    ok(/drive\.google\.com\/file\/d\//.test(open.url) && perm.payload.emailAddress === U.mgrFood && perm.url.indexOf('sendNotificationEmail=false') !== -1,
      'Open file grants reader access to that user only (no e-mail)');
    expectErr(as(U.salesFood1, function () { return openAttachment(c1.attachment.attachment_id); }), 'NOT_FOUND', 'Other Sales cannot open the file');
    expectErr(as(U.mgrFood, function () { return deleteAttachment(c1.attachment.attachment_id); }), 'FORBIDDEN', 'Only the uploader can delete the file');
    as(U.salesFood2, function () { must(deleteAttachment(c1.attachment.attachment_id)); });
    ok(as(U.salesFood2, function () { return must(getTicket(t.ticket_id)); }).attachments.length === 0 && drive.trashed[c1.attachment.drive_file_id],
      'Delete → soft-deleted row + Drive file trashed');
  });

  wrap('LARK', function () {
    const http = fakeHttp_();
    TEST_HTTP_ = http;
    TEST_LARK_ = { app_id: 'cli_test', app_secret: 'secret', host: 'https://open.larksuite.com', group_chat_id: 'oc_group' };
    http.unknownEmails[U.sr2] = true;
    http.failOpenIds['ou_sr1'] = true;
    let guard = 0;
    let r;
    do { r = dispatchNotifications(); guard++; } while (r.claimed === 40 && guard < 20);
    const n = rows_(TAB.NOTIFICATIONS);
    const sent = n.filter(function (x) { return x.lark_status === 'sent'; }).length;
    ok(sent > 0, 'Lark: notifications delivered (' + sent + ')');
    ok(n.filter(function (x) { return x.user_email === U.sr2; }).every(function (x) { return x.lark_status === 'no_lark_user'; }), 'Lark: user without Lark account marked no_lark_user');
    const sr1 = n.filter(function (x) { return x.user_email === U.sr1; });
    ok(sr1.length > 0 && sr1.every(function (x) { return x.lark_status === 'pending' && Number(x.lark_attempts) === 1 && x.lark_error; }),
      'Lark: failed message stays pending with error for retry');
    const msg = http.calls.filter(function (c) { return c.url.indexOf('/im/v1/messages') !== -1; })[0];
    ok(msg && msg.headers.Authorization === 'Bearer tok' && JSON.parse(msg.payload.content).header.title.content.length > 0, 'Lark: interactive card sent with bearer token');
    // exhaust retries
    for (let i = 0; i < LARK_MAX_ATTEMPTS_; i++) {
      withLock_(function () {
        rows_(TAB.NOTIFICATIONS).filter(function (x) { return x.user_email === U.sr1 && x.lark_status === 'pending'; }).forEach(function (x) {
          updateRow_(TAB.NOTIFICATIONS, x.notif_id, { lark_sent_at: new Date(Date.now() - 2 * 3600000) });
        });
      });
      dispatchNotifications();
    }
    ok(rows_(TAB.NOTIFICATIONS).filter(function (x) { return x.user_email === U.sr1; }).every(function (x) { return x.lark_status === 'failed'; }),
      'Lark: after ' + LARK_MAX_ATTEMPTS_ + ' attempts the message is marked failed');
    TEST_LARK_ = { app_id: '', app_secret: '', host: '', group_chat_id: '' };
    const callsBefore = http.calls.length;
    ok(dispatchNotifications().skipped === 'not_configured' && http.calls.length === callsBefore, 'Lark: dispatcher is a no-op when Lark is not configured');
    TEST_LARK_ = { app_id: 'cli_test', app_secret: 'secret', host: 'https://open.larksuite.com', group_chat_id: 'oc_group' };
  });

  wrap('SLA', function () {
    withLock_(function () {
      const sla = setting_('sla_hours', {});
      sla.pending_manager = 0.0001;
      updateRow_(TAB.SETTINGS, 'sla_hours', { value: JSON.stringify(sla) });
    });
    const r1 = checkSlaAlerts();
    const r2 = checkSlaAlerts();
    ok(r1.queued > 0 && r1.breaches.length > 0, 'SLA: breaches detected and notifications queued (' + r1.queued + ')');
    ok(r2.queued === 0, 'SLA: second run does not re-notify');
    ok(rows_(TAB.NOTIFICATIONS).some(function (x) { return x.type === 'sla_breach' && x.user_email === U.gm; }), 'SLA: breach at Manager stage escalates to GM');
  });

  wrap('SELFTEST', function () {
    const lines = runSelfTest();
    ['all tabs + headers match schema', 'every ticket has a create log', 'status matches stage on every ticket', 'audit log hash chain intact']
      .forEach(function (name) {
        ok(lines.some(function (l) { return l.indexOf('PASS ' + name) === 0; }), 'Self-test: ' + name);
      });
  });
}

// =============================================================================
// Phase 3 — SR pricing page: batch checklist, sourcing draft, food quotation fields
// =============================================================================
function runPhase3Cases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () {
      return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {}));
    });
  };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) {
      results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack);
    }
  };

  wrap('PRICING', function () {
    const t = as(U.salesFood2, function () {
      return must(createTicketT_({ client_key: 'p3', title: 'ทดสอบหน้าเสนอราคา', items: [
        { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว PD 41/50', qty: 400, uom: 'กก.' },
        { product_group_code: 'OTHERS-GENERAL', product_name: 'ถุงมือไนไตร', qty: 50, uom: 'กล่อง' }] })).ticket;
    });
    const id = t.ticket_id;
    must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    must(go(U.sr1, id, 'claim'));
    const items = activeItemsOf_(id);
    const q = function (o) { return Object.assign({ quote_id: Utilities.getUuid(), currency: 'THB', fx_rate: 1, vat_term: 'ex_vat' }, o); };
    const draft = function (rows) { return as(U.sr1, function () { return saveSourcingDraft(id, rows); }); };

    expectErr(draft([{ item_id: items[0].item_id, quotes: [q({ vendor_name: 'A', unit_price: 1 })] }]), 'FORBIDDEN', 'Draft blocked before documents are checked');

    const cl = checklistOf_(id);
    expectErr(as(U.sr2, function () { return saveChecklist(id, [{ check_id: cl[0].check_id, is_checked: true }]); }), 'FORBIDDEN', 'Other SR cannot save the checklist');
    const saved = as(U.sr1, function () {
      return must(saveChecklist(id, cl.filter(function (c) { return c.is_required; }).map(function (c) { return { check_id: c.check_id, is_checked: true, note: 'ตรวจแล้ว' }; })));
    });
    ok(saved.changes === cl.filter(function (c) { return c.is_required; }).length && saved.checklist.filter(function (c) { return c.is_checked; }).length === saved.changes,
      'Batch checklist save (' + saved.changes + ' rows, one call)');
    must(go(U.sr1, id, 'doc_complete'));
    expectErr(as(U.sr1, function () { return saveChecklist(id, [{ check_id: cl[0].check_id, is_checked: false }]); }), 'FORBIDDEN', 'Checklist locked after documents are confirmed');

    const a = q({ vendor_name: 'Ocean Pride Vietnam Co., Ltd.', vendor_id: 'V-0004', unit_price: '7.20', currency: 'USD', fx_rate: 36.5, vat_term: 'no_vat',
      brand: 'Ocean Pride', origin_country: 'เวียดนาม', packing: '1 kg × 10/ctn', incoterm: 'cif', shelf_life: '24 เดือน', lead_time_days: 30 });
    const b = q({ vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 289, vat_term: 'include_vat', incoterm: 'DELIVERED' });
    const r1 = must(draft([
      { item_id: items[0].item_id, quotes: [a, b] },
      { item_id: items[1].item_id, quotes: [q({ vendor_name: '', unit_price: '' })] }
    ]));
    const q0 = activeQuotesOfItem_(items[0].item_id);
    ok(r1.changes === 2 && q0.length === 2 && activeQuotesOfItem_(items[1].item_id).length === 0, 'Draft saves filled vendors, ignores blank columns');
    const qa = q0.filter(function (x) { return x.quote_id === a.quote_id; })[0];
    ok(qa && qa.incoterm === 'CIF' && qa.origin_country === 'เวียดนาม' && qa.brand === 'Ocean Pride' && qa.net_unit_cost_thb === 262.8,
      'Food fields saved (CIF, origin, brand) and 7.20 USD × 36.5 = 262.80 THB');
    ok(must(draft([{ item_id: items[0].item_id, quotes: [a, b] }])).changes === 0, 'Re-saving the same draft is idempotent (0 changes)');

    const bad = expectErr(draft([{ item_id: items[0].item_id, quotes: [a, q({ vendor_name: 'X', unit_price: 'abc' })] }]), 'VALIDATION', 'Bad price rejected');
    ok(bad.error.indexOf('รายการที่ 1 vendor ที่ 2') === 0 && activeQuotesOfItem_(items[0].item_id).length === 2 &&
      activeQuotesOfItem_(items[0].item_id).some(function (x) { return x.quote_id === b.quote_id; }), 'Error names the exact column and nothing was written');
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a, b].concat(['C', 'D', 'E', 'F'].map(function (n) { return q({ vendor_name: n, unit_price: 1 }); })) }]),
      'MAX_VENDORS', 'AC-3 6 vendors in a draft rejected');
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a, q({ vendor_name: 'E', unit_price: 1, incoterm: 'FREE' })] }]), 'VALIDATION', 'Unknown Incoterm rejected');
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a, b], winner_quote_id: Utilities.getUuid() }]), 'VALIDATION', 'Winner must be one of the vendors');

    const c = q({ vendor_name: 'บริษัท ซีฟู้ด เทรดดิ้ง จำกัด', unit_price: 255, vat_term: 'ex_vat' });
    must(draft([{ item_id: items[0].item_id, quotes: [a, c], winner_quote_id: c.quote_id }]));
    const q1 = activeQuotesOfItem_(items[0].item_id);
    ok(q1.length === 2 && !q1.some(function (x) { return x.quote_id === b.quote_id; }) &&
      q1.filter(function (x) { return x.is_selected; }).map(function (x) { return x.quote_id; }).join() === c.quote_id,
      'Removed vendor soft-deleted; new vendor chosen as winner in the same save');
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) { return l.action === 'quotation_deleted'; }), 'Vendor removal logged');
    must(draft([{ item_id: items[0].item_id, quotes: [a, c] }]));
    ok(!activeQuotesOfItem_(items[0].item_id).some(function (x) { return x.is_selected; }), 'Clearing the radio removes the winner');

    // winner = Ocean Pride (262.80) is not the cheapest (Seafood Trading 255) → reason required at submit
    const g = q({ vendor_name: 'Global Food Import Pte. Ltd.', unit_price: 1.9, currency: 'USD', fx_rate: 36.5, vat_term: 'no_vat' });
    must(draft([
      { item_id: items[0].item_id, quotes: [a, c], winner_quote_id: a.quote_id },
      { item_id: items[1].item_id, quotes: [g], winner_quote_id: g.quote_id }
    ]));
    expectErr(go(U.sr1, id, 'submit_quote'), 'REASON_REQUIRED', 'Submit blocked: non-cheapest winner without reason');
    must(draft([
      { item_id: items[0].item_id, quotes: [a, c], winner_quote_id: a.quote_id, selection_reason: 'ลูกค้ากำหนด Origin เวียดนาม' },
      { item_id: items[1].item_id, quotes: [g], winner_quote_id: g.quote_id }
    ]));
    ok(must(go(U.sr1, id, 'submit_quote')).ticket.stage === 'pending_sr_manager', 'Submit after draft → pending_sr_manager');
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a] }]), 'FORBIDDEN', 'Draft locked after submission');
    approvePriceT_(U, id);
    const sales = as(U.salesFood2, function () { return must(getTicket(id)); });
    const sp0 = sales.items[0].sales_pricing;
    ok(sales.items[0].quotations.length === 0 && sp0 && sp0.origin_country && sp0.shelf_life && sp0.incoterm === undefined &&
      sp0.vendor_name === undefined && sp0.selection_reason === undefined,
      'Sales sees offer terms (origin, shelf life) with the selling price — no vendor, incoterm or reason');
    const srm = as(U.srManager, function () { return must(getTicket(id)); });
    const win = srm.items[0].quotations.filter(function (x) { return x.is_selected; })[0];
    ok(win.incoterm === 'CIF' && win.selection_reason === 'ลูกค้ากำหนด Origin เวียดนาม' && srm.items[0].quotations.length === 2,
      'SR Manager sees all vendor food fields + reason');
  });
}

// =============================================================================
// Organisation & Food form — Sales Manager skip, SR Manager → GM price approval
// =============================================================================
function runOrgCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) { results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack); }
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const item = { product_name: 'กุ้งขาว HLSO', net_weight: '80%', size: '31/40', packing_size: '1 kg/pack', qty: 300, uom: 'กก.', target_price: 0 };

  wrap('FORM', function () {
    const t = as(U.salesFood1, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', client_key: 'form-1', customer_name: 'ร้านอาหาร ทดสอบฟอร์ม', due_date: inDays(4),
        documents_needed: 'COA, Health Certificate', description: 'ส่งตัวอย่างก่อน',
        items: [item, Object.assign({}, item, { product_name: 'หมึกกล้วย', target_price: '165' })] })).ticket;
    });
    ok(t.title === 'ร้านอาหาร ทดสอบฟอร์ม — กุ้งขาว HLSO และอีก 1 รายการ' && t.documents_needed === 'COA, Health Certificate',
      'Food form: auto title + documents needed saved');
    const its = activeItemsOf_(t.ticket_id);
    ok(its[0].net_weight === '80%' && its[0].size === '31/40' && its[0].packing_size === '1 kg/pack' && its[0].product_group_code === 'FOOD' &&
      its[0].target_price === 0 && its[1].target_price === 165, 'Food form: %NW, size, packing size, target 0 allowed, default group FOOD');
    const bad = function (patch, name) {
      expectErr(as(U.salesFood1, function () {
        return createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'X', due_date: inDays(2), items: [Object.assign({}, item, patch)] });
      }), 'VALIDATION', name);
    };
    bad({ net_weight: '' }, 'Food form: % Net Weight required');
    bad({ size: ' ' }, 'Food form: Size required');
    bad({ packing_size: '' }, 'Food form: Packing size required');
    bad({ uom: 'เครื่อง' }, 'Food form: unit must come from the list');
    bad({ target_price: '' }, 'Food form: target price required (0 when none)');
    expectErr(as(U.salesFood1, function () { return createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'X', due_date: inDays(-1), items: [item] }); }),
      'VALIDATION', 'Food form: expected date in the past rejected');
    expectErr(as(U.salesFood1, function () { return createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'X', items: [item] }); }), 'VALIDATION', 'Food form: expected date required');
  });

  wrap('SKIP_SALES_MANAGER', function () {
    withLock_(function () { updateRow_(TAB.DEPARTMENTS, 'SALES-FOOD', { manager_email: '' }); });
    const t = as(U.salesFood2, function () { return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'โรงแรม A', due_date: inDays(3), items: [item] })).ticket; });
    ok(t.stage === 'pending_gm', 'No Sales Manager → request goes straight to GM');
    const log = findAll_(TAB.LOGS, 'ticket_id', t.ticket_id).filter(function (l) { return l.action === 'create'; })[0];
    ok(parseJson_(log.metadata_json, {}).sales_manager_skipped === true && log.to_stage === 'pending_gm', 'Skip is recorded in the audit log');
    ok(rows_(TAB.NOTIFICATIONS).some(function (n) { return n.ticket_id === t.ticket_id && n.user_email === U.gm; }), 'GM notified directly');
    expectErr(go(U.mgrFood, t.ticket_id, 'manager_approve'), 'FORBIDDEN', 'Sales Manager not assigned → cannot approve');
    TEST_HTTP_ = fakeHttp_();
    TEST_DRIVE_ = fakeDrive_();
    const up = as(U.salesFood2, function () {
      const it = activeItemsOf_(t.ticket_id)[0];
      const b = must(beginUpload({ ticket_id: t.ticket_id, item_id: it.item_id, file_name: 'shrimp.png', mime_type: 'image/png', size_bytes: 4, category: 'request' }));
      return must(uploadChunk(b.upload_id, 0, Utilities.base64Encode([1, 2, 3, 4])));
    });
    ok(up.done && up.attachment.item_id === activeItemsOf_(t.ticket_id)[0].item_id, 'Product picture can be attached right after submit (pending_gm)');
    ok(must(go(U.gm, t.ticket_id, 'gm_approve')).ticket.stage === 'pending_assign', 'GM approves skipped request');

    withLock_(function () {
      updateRow_(TAB.DEPARTMENTS, 'SALES-FOOD', { manager_email: U.mgrFood });
      updateRow_(TAB.USERS, U.mgrFood, { is_active: false });
    });
    const t2 = as(U.salesFood2, function () { return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'โรงแรม B', due_date: inDays(3), items: [item] })).ticket; });
    ok(t2.stage === 'pending_gm', 'Inactive Sales Manager → also skipped');
    withLock_(function () { updateRow_(TAB.USERS, U.mgrFood, { is_active: true }); });
    const t3 = as(U.salesFood2, function () { return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'โรงแรม C', due_date: inDays(3), items: [item] })).ticket; });
    ok(t3.stage === 'pending_manager', 'Sales Manager configured → step is used again');
  });

  wrap('PRICE_CHAIN', function () {
    const t = as(U.salesFood1, function () { return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'ร้าน D', due_date: inDays(3), items: [item] })).ticket; });
    const id = t.ticket_id;
    must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    ok(as(U.srManager, function () { return getTicket(id).ok; }), 'SR Manager sees ticket after GM approval');
    expectErr(go(U.sr1, id, 'assign', '', { sr_email: U.sr2 }), 'FORBIDDEN', 'SR cannot assign');
    ok(must(go(U.srManager, id, 'assign', '', { sr_email: U.sr2 })).ticket.sr_email === U.sr2, 'SR Manager assigns SR');
    as(U.sr2, function () {
      checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); });
    });
    must(go(U.sr2, id, 'doc_complete'));
    const it = activeItemsOf_(id)[0];
    as(U.sr2, function () {
      const q = must(saveQuotation({ item_id: it.item_id, vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 280, vat_term: 'ex_vat', incoterm: 'DELIVERED' })).quote;
      must(selectQuotation(q.quote_id, ''));
    });
    must(go(U.sr2, id, 'submit_quote'));
    ok(rows_(TAB.NOTIFICATIONS).some(function (n) { return n.ticket_id === id && n.user_email === U.srManager && n.type === 'approval_required'; }),
      'SR Manager notified to check price');
    expectErr(go(U.srManager, id, 'srm_return'), 'COMMENT_REQUIRED', 'SR Manager return needs a comment');
    ok(must(go(U.srManager, id, 'srm_return', 'ขอต่อราคาเพิ่ม')).ticket.stage === 'sourcing', 'SR Manager returns → SR edits again');
    as(U.sr2, function () {
      must(saveQuotation({ quote_id: activeQuotesOfItem_(it.item_id)[0].quote_id, item_id: it.item_id, vendor_name: 'Andaman Seafood Co., Ltd.',
        unit_price: 272, vat_term: 'ex_vat' }));
    });
    must(go(U.sr2, id, 'submit_quote'));
    const a = must(go(U.srManager, id, 'srm_approve', 'ok')).ticket;
    ok(a.stage === 'pending_gm_price' && a.status === 'on_process', 'SR Manager approve → รอ GM อนุมัติราคา');
    ok(rows_(TAB.NOTIFICATIONS).some(function (n) { return n.ticket_id === id && n.user_email === U.gm && n.type === 'approval_required'; }), 'GM notified to approve price');
    expectErr(go(U.gm, id, 'gm_price_return'), 'COMMENT_REQUIRED', 'GM return needs a comment');
    ok(must(go(U.gm, id, 'gm_price_return', 'ราคายังสูง')).ticket.stage === 'sourcing', 'GM returns price → back to SR');
    must(go(U.sr2, id, 'submit_quote'));
    ok(ticketById_(id).stage === 'pending_sr_manager', 'After GM return, the price goes through SR Manager again (no skip)');
    must(go(U.srManager, id, 'srm_approve'));
    const done = must(go(U.gm, id, 'gm_price_approve')).ticket;
    ok(done.stage === 'awaiting_sales_ack' && !!done.completed_at, 'GM approves price → Sales receives it');
    ok(rows_(TAB.NOTIFICATIONS).some(function (n) { return n.ticket_id === id && n.user_email === U.salesFood1 && n.type === 'quote_ready'; }),
      'Sales notified when price approved');
    const tl = findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.log_type === 'transition'; }).map(function (l) { return l.action; });
    ok(tl.join(',').indexOf('submit_quote,srm_return,submit_quote,srm_approve,gm_price_return,submit_quote,srm_approve,gm_price_approve') !== -1,
      'Timeline records every price approval step');
  });
}

// =============================================================================
// Selling price: clearance cost per vendor, landed cost, GP %, selling price per unit
// =============================================================================
function runSellPriceCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  try {
    const t = as(U.salesFood2, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'โรงแรม GP', due_date: inDays(3), items: [
        { product_name: 'กุ้งขาว PD', net_weight: '90%', size: '41/50', packing_size: '1 kg/pack', qty: 400, uom: 'กก.', target_price: 330 }] })).ticket;
    });
    const id = t.ticket_id;
    must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    must(go(U.sr1, id, 'claim'));
    as(U.sr1, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    must(go(U.sr1, id, 'doc_complete'));
    const it = activeItemsOf_(id)[0];
    const cif = { quote_id: Utilities.getUuid(), vendor_name: 'Ocean Pride Vietnam Co., Ltd.', unit_price: 7.2, currency: 'USD', fx_rate: 36.5,
      vat_term: 'no_vat', incoterm: 'CIF', clearance_thb: 12 };
    const local = { quote_id: Utilities.getUuid(), vendor_name: 'Andaman Seafood Co., Ltd.', unit_price: 289, currency: 'THB', fx_rate: 1,
      vat_term: 'include_vat', incoterm: 'DELIVERED' };
    const draft = function (row) { return as(U.sr1, function () { return saveSourcingDraft(id, [Object.assign({ item_id: it.item_id }, row)]); }); };

    must(draft({ quotes: [cif, local], winner_quote_id: local.quote_id }));
    const q = activeQuotesOfItem_(it.item_id);
    const qc = q.filter(function (x) { return x.quote_id === cif.quote_id; })[0];
    const ql = q.filter(function (x) { return x.quote_id === local.quote_id; })[0];
    ok(qc.net_unit_cost_thb === 262.8 && qc.clearance_thb === 12 && qc.landed_unit_cost_thb === 274.8,
      'Landed cost = 7.20 USD × 36.5 + clearance 12 = 274.80 THB/kg');
    const cmp = compareQuotes_(it.qty, q);
    ok(cmp.filter(function (x) { return x.is_cheapest; })[0].quote_id === local.quote_id,
      'Cheapest is decided on landed cost (local 270.09 beats CIF 274.80 after clearance)');

    const d1 = as(U.sr1, function () { return must(getTicket(id)); });
    const p1 = d1.items[0].pricing;
    ok(p1.gp_percent === 15 && p1.gp_is_default && p1.landed_cost_thb === 270.09 && p1.sell_price_thb === 317.76 && p1.profit_thb === 47.67,
      'Default GP 15% → selling price 270.09 ÷ 0.85 = 317.76 (profit 47.67)');
    ok(p1.target_diff_pct === -3.7, 'Selling price compared with target 330 THB/kg (−3.7%)');

    must(draft({ quotes: [cif, local], winner_quote_id: local.quote_id, gp_percent: 20 }));
    const p2 = as(U.sr1, function () { return must(getTicket(id)); }).items[0].pricing;
    ok(p2.gp_percent === 20 && !p2.gp_is_default && p2.sell_price_thb === 337.62, 'GP 20% → selling price 337.62');
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) { return l.action === 'pricing_updated'; }), 'GP change logged');
    expectErr(draft({ quotes: [cif, local], winner_quote_id: local.quote_id, gp_percent: 100 }), 'VALIDATION', 'GP 100% rejected');
    expectErr(draft({ quotes: [cif, local], winner_quote_id: local.quote_id, gp_percent: -5 }), 'VALIDATION', 'Negative GP rejected');
    expectErr(draft({ quotes: [Object.assign({}, cif, { clearance_thb: -1 }), local] }), 'VALIDATION', 'Negative clearance rejected');

    ok(as(U.salesFood2, function () { return must(getTicket(id)); }).items[0].pricing === null &&
      !as(U.salesFood2, function () { return must(getTicket(id)); }).items[0].sales_pricing, 'Sales cannot see cost / GP / selling price before approval');
    must(go(U.sr1, id, 'submit_quote'));
    const saved = activeItemsOf_(id)[0];
    ok(saved.gp_percent === 20 && saved.sell_price_thb === 337.62, 'Submit stores GP % and selling price on the item');
    const log = findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.action === 'submit_quote'; }).pop();
    ok(parseJson_(log.metadata_json, {}).winners[0].sell_price_thb === 337.62, 'Submit log records the proposed selling price');
    approvePriceT_(U, id);
    const sd = as(U.salesFood2, function () { return must(getTicket(id)); });
    const sit = sd.items[0];
    ok(sit.sales_pricing.sell_price_thb === 337.62 && sit.sell_price_thb === 337.62 && sd.permissions.can_view_sell_price,
      'Sales sees the selling price 337.62 after GM approval');
    const leak = JSON.stringify(sit.sales_pricing) + JSON.stringify(sd.timeline) + JSON.stringify(sd.attachments);
    ok(sit.pricing === null && sit.quotations.length === 0 && sit.gp_percent === undefined && !sd.permissions.can_view_quotes &&
      !/Andaman|270\.09|274\.8|262\.8|gp_percent|clearance|landed|unit_price|winners/.test(leak),
      'Sales detail carries no vendor, cost, clearance, landed cost or GP (items, timeline, files)');
    ok(!sd.timeline.some(function (l) { return ['quotation_added', 'quotation_updated', 'pricing_updated'].indexOf(l.action) !== -1; }) &&
      sd.timeline.some(function (l) { return l.action === 'gm_price_approve'; }), 'Sales timeline keeps the status steps, drops cost work');
    const mgr = as(U.mgrFood, function () { return must(getTicket(id)); });
    ok(mgr.items[0].pricing === null && mgr.items[0].quotations.length === 0 && mgr.items[0].sales_pricing.sell_price_thb === 337.62,
      'Sales Manager also sees the selling price only');
    const salesNotes = findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).filter(function (n) { return String(n.user_email) === U.salesFood2; });
    const ready = salesNotes.filter(function (n) { return n.type === 'quote_ready'; });
    ok(ready.length === 1 && String(ready[0].body).indexOf('337.62') !== -1 &&
      !/Andaman|270\.09|GP \d|\d%|ต้นทุน|เคลียร์/.test(String(ready[0].body)),
      'Requesting Sales gets the selling price of their own request in the DM — no cost / GP');
    const grp = botLog_(id, 'approved');
    ok(grp.length === 1 && grp[0].summary.indexOf('กุ้งขาว') !== -1 && /มีราคาแล้ว/.test(grp[0].summary) &&
      !/337\.62|Andaman|270\.09|GP \d|เคลียร์|บาท\//.test(grp[0].summary),
      'GM approval queues ONE Lark group message: status only — no price (other Sales are in the group)');
    // another Sales must not reach this request's price by any path
    expectErr(as(U.salesFood1, function () { return getTicket(id); }), 'NOT_FOUND', 'Other Sales cannot open the request (NOT_FOUND)');
    ok(!as(U.salesFood1, function () { return must(listTickets({ scope: 'all' })); }).rows.some(function (r) { return r.ticket_id === id; }) &&
      !as(U.salesFood1, function () { return must(getDashboard('all')); }).recent.some(function (r) { return r.ticket_id === id; }),
      'Other Sales does not see the request in lists or Dashboard');
    ok(!findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).some(function (n) { return String(n.user_email) === U.salesFood1; }),
      'Other Sales gets no notification of this request');
    ok(STAGE_LABEL_TH.pending_gm.indexOf('ฝั่งขาย') !== -1 && STAGE_LABEL_TH.pending_gm_price.indexOf('ฝั่งซื้อ') !== -1,
      'GM approval stages are labelled sales side / purchasing side');
    const gmMenu = menuFor_(userByEmail_(U.gm));
    ok(gmMenu.some(function (m) { return m.key === 'gm_sales' && m.route.stage === 'pending_gm'; }) &&
      gmMenu.some(function (m) { return m.key === 'gm_buy' && m.route.stage === 'pending_gm_price'; }) &&
      !menuFor_(userByEmail_(U.salesFood1)).some(function (m) { return /^gm_/.test(m.key); }),
      'GM menu has separate "อนุมัติฝั่งขาย" and "อนุมัติฝั่งซื้อ" (not shown to Sales)');
    const gp = pollData_(userByEmail_(U.gm));
    ok(typeof gp.gm_sales === 'number' && typeof gp.gm_buy === 'number' && pollData_(userByEmail_(U.salesFood1)).gm_buy === undefined,
      'Poll gives GM the two approval counts');
    // the same card through the real webhook path: signed, interactive, no price in the JSON
    const fh = fakeHttp_();
    TEST_HTTP_ = fh;
    TEST_BOTS_ = { fpr: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/test-fpr', secret: 's3cret' }, reminder: { url: '', secret: '' } };
    withLock_(function () { queueFprCard_('approved', ticketById_(id), {}); });
    const res = flushBotQueue_();
    const hp = fh.hooks[0] || {};
    TEST_BOTS_ = null; TEST_HTTP_ = null;
    ok(res[0].status === 'sent' && hp.msg_type === 'interactive' && hp.sign === larkSign_(hp.timestamp, 's3cret') && /^\d{10}$/.test(hp.timestamp),
      'Webhook card is signed (timestamp + HmacSHA256) and interactive');
    ok(!/337\.62|270\.09|Andaman/.test(JSON.stringify(hp.card)) && JSON.stringify(hp.card).indexOf(ticketById_(id).ticket_no) !== -1,
      'Webhook card JSON has the FPR number and no price / cost / vendor');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: SELL_PRICE — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// Per-item SR decision: not offered / send later (split into its own pending ticket)
// =============================================================================
function runFollowUpCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment) {
    return as(email, function () { return transitionTicket(id, action, comment || '', { expected_version: ticketById_(id).version }); });
  };
  const setSt = function (email, id, itemId, st, why) {
    return as(email, function () { return setItemQuoteStatus(id, itemId, st, why, ticketById_(id).version); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  try {
    const t = as(U.salesFood3, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'ร้าน ส่งตามหลัง', due_date: inDays(4), items: [
        { product_name: 'กุ้งขาว HOSO', net_weight: '100%', size: '40/50', packing_size: '1 kg', qty: 300, uom: 'กก.', target_price: 0 },
        { product_name: 'หมึกกล้วย', net_weight: '80%', size: 'U5', packing_size: '1 kg', qty: 200, uom: 'กก.', target_price: 0 },
        { product_name: 'ปลาแซลมอน', net_weight: '100%', size: '3-4 kg', packing_size: 'ตัว', qty: 100, uom: 'กก.', target_price: 0 }] })).ticket;
    });
    const id = t.ticket_id;
    must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    must(go(U.sr1, id, 'claim'));
    as(U.sr1, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    must(go(U.sr1, id, 'doc_complete'));
    const items = activeItemsOf_(id);
    const [shrimp, squid, salmon] = items;
    // the squid already has a vendor price + a picture before the SR decides to send it later
    must(as(U.sr1, function () { return saveQuotation({ item_id: squid.item_id, vendor_name: 'Squid Co', unit_price: 150, currency: 'THB', vat_term: 'ex_vat' }); }));
    insertRow_(TAB.ATTACHMENTS, { attachment_id: uuid_(), ticket_id: id, item_id: squid.item_id, quote_id: '', category: 'request', file_name: 'squid.jpg',
      drive_file_id: 'f-squid', mime_type: 'image/jpeg', size_bytes: 10, uploaded_by: U.salesFood3, uploaded_at: new Date(), is_deleted: false });

    expectErr(setSt(U.sr2, id, shrimp.item_id, 'not_offered', 'ไม่มีของ'), 'FORBIDDEN', 'Only the assigned SR can set an item status');
    expectErr(setSt(U.salesFood3, id, shrimp.item_id, 'not_offered', 'x'), 'FORBIDDEN', 'Sales cannot set an item status');
    expectErr(setSt(U.sr1, id, shrimp.item_id, 'not_offered', ''), 'COMMENT_REQUIRED', 'Not offered needs a reason');
    expectErr(as(U.sr1, function () { return setItemQuoteStatus(id, shrimp.item_id, 'not_offered', 'ไม่มีของ', 0); }), 'VERSION_CONFLICT', 'Item status uses optimistic locking');

    // 1) not offered
    must(setSt(U.sr1, id, shrimp.item_id, 'not_offered', 'ขาดตลาด ไม่มี vendor'));
    ok(activeItemsOf_(id)[0].quote_status === 'not_offered', 'Item marked “ไม่เสนอราคา” with reason');
    expectErr(as(U.sr1, function () { return saveQuotation({ item_id: shrimp.item_id, vendor_name: 'X', unit_price: 1, currency: 'THB', vat_term: 'ex_vat' }); }),
      'ITEM_NOT_OFFERED', 'No vendor price can be entered on a not-offered item');
    must(setSt(U.sr1, id, shrimp.item_id, 'quote'));
    ok(activeItemsOf_(id)[0].quote_status === '', 'Not offered can be reverted to quoting');
    must(setSt(U.sr1, id, shrimp.item_id, 'not_offered', 'ขาดตลาด ไม่มี vendor'));

    // 2) send later → split into a new ticket right away
    const r = must(setSt(U.sr1, id, squid.item_id, 'follow_up', 'รอ vendor ตอบ 2 สัปดาห์'));
    const fu = ticketById_(r.follow_up.ticket_id);
    const fuItems = activeItemsOf_(fu.ticket_id);
    ok(fu && fu.parent_ticket_id === id && fu.stage === 'sourcing' && fu.sr_email === U.sr1 && fu.requestor_email === U.salesFood3 &&
      fu.customer_name === 'ร้าน ส่งตามหลัง' && !!fu.gm_approved_at && /^FPR-\d{4}-\d{4,}$/.test(fu.ticket_no),
      'Send later creates ' + fu.ticket_no + ': same customer / Sales / SR, approvals carried, in sourcing');
    ok(fuItems.length === 1 && fuItems[0].product_name === 'หมึกกล้วย' && fuItems[0].quote_status === '', 'Follow-up ticket holds just that item');
    ok(activeQuotesOfItem_(fuItems[0].item_id).length === 1 && activeQuotesOfItem_(squid.item_id).length === 0, 'Vendor price moved with the item');
    ok(findAll_(TAB.ATTACHMENTS, 'item_id', fuItems[0].item_id).length === 1, 'Item picture moved with the item');
    ok(checklistOf_(fu.ticket_id).length > 0 && checklistOf_(fu.ticket_id).filter(function (c) { return c.is_required; }).every(function (c) { return c.is_checked; }),
      'Follow-up keeps the document checks already done');
    ok(findAll_(TAB.LOGS, 'ticket_id', fu.ticket_id).some(function (l) { return l.action === 'create'; }) &&
      findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) { return l.action === 'item_follow_up'; }), 'Both tickets logged (create / item_follow_up)');
    ok(findAll_(TAB.NOTIFICATIONS, 'ticket_id', fu.ticket_id).some(function (n) { return String(n.user_email) === U.salesFood3 && n.type === 'item_follow_up'; }),
      'Sales is told the item will be sent later (with the new number)');
    expectErr(setSt(U.sr1, id, squid.item_id, 'quote'), 'ITEM_SPLIT', 'A split item cannot be reverted');
    expectErr(setSt(U.sr1, fu.ticket_id, fuItems[0].item_id, 'follow_up', 'ยังไม่ได้'), 'LAST_ITEM', 'Cannot send later the last item of a ticket');

    // 3) the original continues without the two items
    expectErr(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: squid.item_id, quotes: [] }]); }), 'ITEM_SPLIT', 'Draft refuses a split item');
    const q = must(as(U.sr1, function () { return saveQuotation({ item_id: salmon.item_id, vendor_name: 'Nordic', unit_price: 500, currency: 'THB', vat_term: 'ex_vat' }); })).quote;
    as(U.sr1, function () { must(selectQuotation(q.quote_id, '')); });
    ok(must(go(U.sr1, id, 'submit_quote')).ticket.stage === 'pending_sr_manager', 'Submit works with one item not offered and one sent later');
    must(go(U.srManager, id, 'srm_approve'));
    must(go(U.gm, id, 'gm_price_approve'));
    const sd = as(U.salesFood3, function () { return must(getTicket(id)); });
    const byName = function (n) { return sd.items.filter(function (x) { return x.product_name === n; })[0]; };
    ok(byName('กุ้งขาว HOSO').quote_status === 'not_offered' && byName('กุ้งขาว HOSO').quote_status_reason === 'ขาดตลาด ไม่มี vendor' && !byName('กุ้งขาว HOSO').sales_pricing,
      'Sales sees “ไม่เสนอราคา” + reason (no price)');
    ok(byName('หมึกกล้วย').quote_status === 'follow_up' && byName('หมึกกล้วย').follow_up.ticket_no === fu.ticket_no && sd.follow_ups.length === 1,
      'Sales sees “ส่งตามหลัง” with the new ticket number');
    ok(byName('ปลาแซลมอน').sales_pricing && byName('ปลาแซลมอน').sales_pricing.sell_price_thb > 500, 'Quoted item still has its selling price');
    const dm = findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).filter(function (n) { return String(n.user_email) === U.salesFood3 && n.type === 'quote_ready'; })[0];
    ok(/ไม่เสนอราคา/.test(dm.body) && dm.body.indexOf(fu.ticket_no) !== -1, 'Sales DM lists not-offered and sent-later items');
    const grp = botLog_(id, 'approved')[0];
    ok(/ไม่เสนอราคา/.test(grp.summary) && /ส่งราคาตามหลัง/.test(grp.summary) && !/\d+\.\d\d/.test(grp.summary), 'Group card shows the item statuses, still no prices');

    // 4) the follow-up is pending work everywhere
    ok(as(U.salesFood3, function () { return must(getDashboard('all')); }).follow_ups.some(function (r) { return r.ticket_id === fu.ticket_id && r.parent_ticket_no === t.ticket_no; }),
      'Dashboard lists the open follow-up (with its origin ticket)');
    ok(must(as(U.sr1, function () { return listTickets({ scope: 'mine', follow_up: true, outcome: 'open' }); })).rows.some(function (r) { return r.ticket_id === fu.ticket_id; }) &&
      !must(as(U.sr1, function () { return listTickets({ scope: 'mine', follow_up: true }); })).rows.some(function (r) { return r.ticket_id === id; }),
      'List filter “ส่งตามหลัง” shows only follow-up tickets');
    ok(pollData_(userByEmail_(U.salesFood3)).follow_up >= 1 && pollData_(userByEmail_(U.salesFood1)).follow_up === 0, 'Menu badge counts own open follow-ups only');
    ok(as(U.salesFood3, function () { return must(getTicket(fu.ticket_id)); }).parent.ticket_no === t.ticket_no, 'Follow-up links back to the original');
    expectErr(as(U.salesFood1, function () { return getTicket(fu.ticket_id); }), 'NOT_FOUND', 'Other Sales cannot open the follow-up');
    ok(as(U.salesFood3, function () { return must(listTicketBoard()); }).rows.some(function (r) { return r.ticket_id === fu.ticket_id && r.is_follow_up && r.outcome === 'open'; }),
      'Follow-up shows under the “ส่งตามหลัง” tab of the list');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: FOLLOW_UP — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// Ticket board (list page): one call, visibility, tab flags, cache invalidation
// =============================================================================
function runBoardCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  try {
    const all = rows_(TAB.TICKETS).map(normTicket_);
    const gm = as(U.gm, function () { return must(listTicketBoard()); });
    ok(gm.rows.length === all.length, 'Board: GM gets every ticket in one call (' + gm.rows.length + ')');
    const s1 = as(U.salesFood1, function () { return must(listTicketBoard()); });
    ok(s1.rows.length > 0 && s1.rows.every(function (r) { return r.requestor_email === U.salesFood1; }), 'Board: Sales gets only own tickets');
    ok(!/unit_price|net_unit_cost|clearance|landed|gp_percent|sell_price/.test(JSON.stringify(s1)), 'Board rows carry no price or cost fields');
    const row = gm.rows[0];
    ok(['is_inbox', 'is_mine', 'is_follow_up', 'outcome', 'stage', 'sla_status'].every(function (k) { return k in row; }), 'Board rows carry the flags the tabs need');
    const again = as(U.gm, function () { return must(listTicketBoard()); });
    ok(again.cached === true && again.rows.length === gm.rows.length, 'Second call is served from cache');
    const before = dataVersion_();
    const t = rows_(TAB.TICKETS).map(normTicket_).filter(function (x) { return x.stage === 'pending_gm'; })[0];
    must(as(U.gm, function () { return transitionTicket(t.ticket_id, 'gm_approve', '', { expected_version: t.version }); }));
    ok(dataVersion_() !== before, 'A workflow write starts a new data version');
    const fresh = as(U.gm, function () { return must(listTicketBoard()); });
    ok(fresh.cached === false && fresh.rows.filter(function (r) { return r.ticket_id === t.ticket_id; })[0].stage === 'pending_assign',
      'After a change the board is rebuilt (no stale stage)');
    const h1 = as(U.salesFood1, function () { return must(getSalesHistory()); });
    const own = rows_(TAB.TICKETS).map(normTicket_).filter(function (x) { return x.requestor_email === U.salesFood1; });
    const others = rows_(TAB.TICKETS).map(normTicket_).filter(function (x) { return x.requestor_email !== U.salesFood1; })
      .map(function (x) { return String(x.customer_name).toLowerCase(); });
    ok(h1.customers.length > 0 && h1.customers.every(function (c) { return own.some(function (x) { return x.customer_name === c.name; }); }) &&
      !h1.customers.some(function (c) { return others.indexOf(c.name.toLowerCase()) !== -1 && !own.some(function (x) { return x.customer_name === c.name; }); }),
      'Sales history: own customers only (with last documents)');
    ok(h1.products.length > 0 && h1.products[0].net_weight !== undefined, 'Sales history: own products with last specs');
    ok(as(U.gm, function () { return must(getSalesHistory()); }).customers.length === 0, 'Sales history is empty for non-Sales');
    const usageBefore = rows_(TAB.USAGE_LOG).length;
    must(as(U.sr1, function () { return getPoll({ home: 3, tickets: 1, evil_page: 5 }); }));
    const logged = rows_(TAB.USAGE_LOG).slice(usageBefore);
    ok(logged.length === 2 && logged.every(function (r) { return r.email === U.sr1 && ['home', 'tickets'].indexOf(String(r.page)) !== -1; }),
      'Page views are logged (known pages only) for the usage review');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: BOARD — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// Supplier master
// =============================================================================
function runSupplierCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const base = { name: 'Siam Frozen Foods Co., Ltd.', supplier_type: 'local', default_currency: 'THB', default_vat_term: 'ex_vat',
    payment_term: 'Credit 30 วัน', lead_time_days: 5, moq: 100, product_groups: ['FOOD-SHRIMP'], tax_id: '0105559999999',
    certs: [{ name: 'GMP', expiry: fmtDate_(new Date(Date.now() - 86400000)) }, { name: 'Halal', expiry: fmtDate_(new Date(Date.now() + 400 * 86400000)) }] };
  try {
    expectErr(as(U.salesFood1, function () { return listSuppliers(); }), 'FORBIDDEN', 'Sales cannot list suppliers');
    expectErr(as(U.salesFood1, function () { return saveSupplier(base); }), 'FORBIDDEN', 'Sales cannot add a supplier');
    expectErr(as(U.mgrFood, function () { return listSuppliers(); }), 'FORBIDDEN', 'Sales Manager cannot list suppliers');
    ok(as(U.salesFood1, function () { return must(getBootstrap()); }).ref.vendors.length === 0 &&
      as(U.sr1, function () { return must(getBootstrap()); }).ref.vendors.length > 0, 'Bootstrap sends supplier names to cost roles only');
    expectErr(as(U.gm, function () { return saveSupplier(base); }), 'FORBIDDEN', 'GM reads suppliers but cannot edit');
    expectErr(as(U.sr1, function () { return saveSupplier(Object.assign({}, base, { supplier_type: '' })); }), 'VALIDATION', 'Supplier type is required');

    const s1 = must(as(U.sr1, function () { return saveSupplier(base); })).supplier;
    ok(/^SUP-\d{4,}$/.test(s1.vendor_id) && s1.is_active && s1.version === 1, 'SR adds a supplier — usable at once (' + s1.vendor_id + ', no approval)');
    ok(as(U.sr2, function () { return must(getBootstrap()); }).ref.vendors.some(function (v) { return v.vendor_id === s1.vendor_id; }),
      'New supplier appears in every SR search list right away');
    expectErr(as(U.sr2, function () { return saveSupplier(Object.assign({}, base, { name: 'SIAM FROZEN FOODS LIMITED', tax_id: '' })); }), 'DUPLICATE',
      'Same company with different legal words is a duplicate');
    expectErr(as(U.sr2, function () { return saveSupplier(Object.assign({}, base, { name: 'Another Co' })); }), 'DUPLICATE', 'Tax id cannot repeat');
    expectErr(as(U.sr2, function () { return saveSupplier(Object.assign({}, base, { name: 'Siam Frozen Foods Export', tax_id: '' })); }), 'SIMILAR',
      'Similar name asks for confirmation');
    const s2 = must(as(U.sr2, function () { return saveSupplier(Object.assign({}, base, { name: 'Siam Frozen Foods Export', tax_id: '', allow_similar: true })); })).supplier;
    ok(s2.vendor_id !== s1.vendor_id, 'Similar name saved after confirmation');
    const listed = must(as(U.gm, function () { return listSuppliers(); }));
    const l1 = listed.suppliers.filter(function (x) { return x.vendor_id === s1.vendor_id; })[0];
    ok(l1.cert_warnings.length === 1 && l1.cert_warnings[0].name === 'GMP' && l1.cert_warnings[0].level === 'expired' && !listed.can_edit,
      'Expired certificate flagged (warning only); GM list is read-only');

    expectErr(as(U.sr1, function () { return saveSupplier(Object.assign({}, base, { vendor_id: s1.vendor_id, expected_version: 0 })); }), 'VERSION_CONFLICT',
      'Supplier edits use optimistic locking');
    const s1b = must(as(U.sr1, function () { return saveSupplier(Object.assign({}, base, { vendor_id: s1.vendor_id, expected_version: 1, lead_time_days: 7 })); })).supplier;
    ok(s1b.version === 2 && s1b.lead_time_days === 7, 'Supplier edit saved (version 2)');
    const log = must(as(U.sr1, function () { return getSupplierLog(s1.vendor_id); }));
    ok(log.length === 2 && log[0].action === 'updated' && log[0].diff.lead_time_days['new'] === '7', 'Every change logged with old → new');

    expectErr(as(U.sr1, function () { return setSupplierActive(s2.vendor_id, false, 1); }), 'FORBIDDEN', 'SR cannot deactivate a supplier');
    must(as(U.srManager, function () { return setSupplierActive(s2.vendor_id, false, 1); }));
    ok(!as(U.sr1, function () { return must(getBootstrap()); }).ref.vendors.some(function (v) { return v.vendor_id === s2.vendor_id; }),
      'Deactivated supplier is hidden from search');

    // quotation link + hints + merge + migration
    const q = rows_(TAB.QUOTATIONS).filter(function (x) { return !toBool_(x.is_deleted) && x.vendor_id; })[0];
    const hintTicket = rows_(TAB.TICKETS).map(normTicket_).filter(function (t) { return t.ticket_id !== String(q.ticket_id) && t.sr_email; })[0];
    const hints = must(as(U.srManager, function () { return supplierHints(hintTicket.ticket_id); })).hints;
    ok(typeof hints === 'object', 'Supplier hints load for the pricing page');
    expectErr(as(U.salesFood1, function () { return supplierHints(hintTicket.ticket_id); }), 'FORBIDDEN', 'Sales cannot load supplier hints');
    const fromId = String(q.vendor_id);
    const moved = must(as(U.srManager, function () { return mergeSuppliers(fromId, s1.vendor_id); })).moved_quotations;
    ok(moved > 0 && String(findOne_(TAB.QUOTATIONS, 'quote_id', q.quote_id).vendor_id) === s1.vendor_id &&
      !toBool_(findOne_(TAB.VENDORS, 'vendor_id', fromId).is_active), 'Merge re-points quotations and turns the duplicate off');
    updateRow_(TAB.QUOTATIONS, q.quote_id, { vendor_id: '', vendor_name: 'บริษัท ทดสอบ มิเกรต จำกัด' });
    const mig = withIdentity_(U.admin, function () { return migrateSuppliers(); });
    ok(mig.created >= 1 && mig.linked >= 1 && String(findOne_(TAB.QUOTATIONS, 'quote_id', q.quote_id).vendor_id).indexOf('SUP-') === 0,
      'Migration creates suppliers from old quotation names and links them');
    ok(withIdentity_(U.admin, function () { return migrateSuppliers(); }).created === 0, 'Migration is safe to re-run');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: SUPPLIER — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// Customer group / destination + SR send-back from the queue
// =============================================================================
function runQueueReturnCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const item = { product_name: 'ปลาหมึกกล้วย', net_weight: '80%', size: 'U5', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 };
  try {
    expectErr(as(U.salesFood1, function () { return createTicket({ customer_name: 'X', due_date: inDays(3), items: [item] }); }), 'VALIDATION', 'Customer group is required');
    expectErr(as(U.salesFood1, function () { return createTicket({ customer_name: 'X', customer_group: 'ลูกค้าแปลก', due_date: inDays(3), items: [item] }); }),
      'VALIDATION', 'Customer group must come from the list');
    expectErr(as(U.salesFood1, function () { return createTicket({ customer_name: 'X', customer_group: 'ส่งออก', due_date: inDays(3), items: [item] }); }),
      'VALIDATION', '“ส่งออก” needs a foreign destination');
    const t = must(as(U.salesFood1, function () {
      return createTicket({ customer_name: 'Tokyo Sushi Import', customer_group: 'ส่งออก', destination_country: 'ญี่ปุ่น', due_date: inDays(3), items: [item] });
    })).ticket;
    ok(t.customer_group === 'ส่งออก' && t.destination_country === 'ญี่ปุ่น', 'Customer group + destination saved');
    const t2 = must(as(U.salesFood1, function () { return createTicket({ customer_name: 'ร้านไทย', customer_group: 'ร้านอาหาร', due_date: inDays(3), items: [item] }); })).ticket;
    ok(t2.destination_country === 'ไทย', 'Destination defaults to ไทย');
    const h = must(as(U.salesFood1, function () { return getSalesHistory(); }));
    ok(h.customers.some(function (c) { return c.name === 'Tokyo Sushi Import' && c.customer_group === 'ส่งออก' && c.destination_country === 'ญี่ปุ่น'; }),
      'History remembers the customer group + destination for auto-fill');

    const id = t.ticket_id;
    if (ticketById_(id).stage === 'pending_manager') must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    ok(ticketById_(id).stage === 'pending_assign', 'Request waits in the SR queue');
    ok(as(U.sr1, function () { return must(getTicket(id)); }).permissions.actions.indexOf('queue_return') !== -1 &&
      as(U.sr1, function () { return must(getTicket(id)); }).permissions.actions.indexOf('claim') !== -1, 'SR sees both “รับงาน” and “ตีกลับ”');
    expectErr(go(U.sr1, id, 'queue_return', ''), 'COMMENT_REQUIRED', 'Send-back needs a reason');
    expectErr(go(U.salesFood1, id, 'queue_return', 'x'), 'FORBIDDEN', 'Sales cannot send back from the queue');
    const back = must(go(U.sr1, id, 'queue_return', 'ไม่มีรูปสินค้าและไม่ระบุ Grade', { missing_items: ['รูปภาพสินค้า', 'สเปก / Grade'] })).ticket;
    ok(back.stage === 'need_info' && !back.sr_email, 'SR send-back → Sales (need_info), no SR assigned');
    const tk = ticketById_(id);
    ok(tk.info_request.return_stage === 'pending_assign' && tk.info_request.items.length === 2, 'Missing items recorded');
    ok(findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).some(function (n) { return String(n.user_email) === U.salesFood1 && n.type === 'info_requested'; }),
      'Sales is notified what is missing');
    const answered = must(go(U.salesFood1, id, 'respond_info', 'แนบรูปแล้ว Grade A')).ticket;
    ok(answered.stage === 'pending_assign', 'Sales answer → back to the SR queue');
    ok(findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).some(function (n) { return String(n.user_email) === U.sr2 && n.type === 'info_provided'; }),
      'Every SR is told the job is back in the queue');
    must(go(U.sr2, id, 'claim'));
    ok(ticketById_(id).sr_email === U.sr2 && ticketById_(id).stage === 'doc_check', 'Another SR can then accept it');
    expectErr(go(U.sr1, id, 'queue_return', 'x'), 'INVALID_STATE', 'No send-back after the job was accepted (use ขอข้อมูลเพิ่ม)');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: QUEUE_RETURN — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// Supplier photos (≤ 10 per offer) · automatic Lark group events · deal follow-up · GP summary
// =============================================================================
function runPhotoDealCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
  const upload = function (email, meta, mime, name) {
    return as(email, function () {
      const b = beginUpload(Object.assign({ file_name: name || 'photo.png', mime_type: mime || 'image/png', size_bytes: PNG.length }, meta));
      if (!b.ok) return b;
      return uploadChunk(b.data.upload_id, 0, Utilities.base64Encode(PNG));
    });
  };
  const groupMsgs = function (id, type) { return botLog_(id, type); };
  const http = fakeHttp_();
  TEST_HTTP_ = http;
  TEST_BOTS_ = { fpr: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/fpr', secret: 'sec-a' },
    reminder: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/rem', secret: 'sec-b' } };
  TEST_DRIVE_ = fakeDrive_();
  try {
    // ---------- request → approvals → SR (group events on the way) ----------
    const t = as(U.salesFood3, function () {
      return must(createTicket({ customer_group: 'โรงแรม / จัดเลี้ยง', customer_name: 'โรงแรมรูปภาพ', due_date: inDays(3), items: [
        { product_name: 'ปลาหมึกกล้วย IQF', net_weight: '90%', size: 'U/10', packing_size: '1 kg/bag', qty: 800, uom: 'กก.', target_price: 160 },
        { product_name: 'กุ้งขาว HLSO', net_weight: '80%', size: '31/40', packing_size: '1 kg/pack', qty: 300, uom: 'กก.', target_price: 0 }] })).ticket;
    });
    const id = t.ticket_id;
    ok(groupMsgs(id).length === 0, 'Bot: nothing posted while the request waits for the Sales Manager (old flow switch on)');
    must(go(U.mgrFood, id, 'manager_approve'));
    const nr = groupMsgs(id, 'submitted');
    ok(nr.length === 1 && nr[0].status === 'sent' && /ปลาหมึกกล้วย/.test(nr[0].summary) && /800 กก\./.test(nr[0].summary) && /<at email=gm@/.test(nr[0].summary),
      'Bot: 📥 request waiting for GM posted (customer, product, volume / month) and @GM');
    must(go(U.gm, id, 'gm_approve'));
    ok(groupMsgs(id, 'queued').length === 1, 'Bot: GM approval posted (queue mode)');
    must(go(U.sr2, id, 'claim'));
    ok(groupMsgs(id, 'assigned').length === 1 && /<at email=sr2@/.test(groupMsgs(id, 'assigned')[0].summary), 'Bot: 🔧 assigned card @mentions the Sourcing person');
    as(U.sr2, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    must(go(U.sr2, id, 'doc_complete'));
    const items = activeItemsOf_(id);
    const squid = items[0], shrimp = items[1];

    // ---------- supplier photos ----------
    const qa = Utilities.getUuid(), qb = Utilities.getUuid(), qs = Utilities.getUuid();
    const meta = function (itemId, quoteId) { return { ticket_id: id, item_id: itemId, quote_id: quoteId, category: 'quote_photo' }; };
    for (let n = 0; n < 10; n++) must(upload(U.sr2, meta(squid.item_id, qa), 'image/png', 'squid-' + n + '.png'), 'photo ' + n);
    ok(quotePhotos_(qa).length === 10, 'Photo: SR attaches 10 photos to one supplier offer (still a draft on the pricing page)');
    expectErr(upload(U.sr2, meta(squid.item_id, qa)), 'PHOTO_LIMIT', 'Photo: 11th photo for the same supplier is refused');
    must(upload(U.sr2, meta(squid.item_id, qb), 'image/jpeg', 'b.jpg'));
    ok(quotePhotos_(qb).length === 1, 'Photo: the limit is per supplier — another supplier can still add photos');
    expectErr(upload(U.sr2, meta(squid.item_id, qa), 'application/pdf', 'spec.pdf'), 'FILE_TYPE', 'Photo: only image files');
    expectErr(upload(U.sr2, { ticket_id: id, item_id: squid.item_id, category: 'quote_photo' }), 'VALIDATION', 'Photo: must belong to a supplier offer');
    expectErr(upload(U.sr2, { ticket_id: id, quote_id: qa, category: 'quote_photo' }), 'VALIDATION', 'Photo: must belong to an item');
    expectErr(upload(U.salesFood3, meta(squid.item_id, qa)), 'FORBIDDEN', 'Photo: Sales cannot attach supplier photos');
    expectErr(upload(U.sr1, meta(squid.item_id, qa)), 'FORBIDDEN', 'Photo: only the assigned SR attaches');

    const quote = function (qid, name, price) { return { quote_id: qid, vendor_name: name, unit_price: price, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }; };
    must(as(U.sr2, function () {
      return saveSourcingDraft(id, [
        { item_id: squid.item_id, quotes: [quote(qa, 'Siam Squid Co., Ltd.', 120), quote(qb, 'Gulf Cephalopod Ltd.', 125)], winner_quote_id: qa },
        { item_id: shrimp.item_id, quotes: [quote(qs, 'Andaman Shrimp Farm', 210)], winner_quote_id: qs }]);
    }));
    ok(String(findOne_(TAB.ATTACHMENTS, 'attachment_id', quotePhotos_(qa)[0].attachment_id).quote_id) === qa,
      'Photo: photos stay linked when the draft offer is saved with the same id');
    expectErr(upload(U.sr2, meta(shrimp.item_id, qa)), 'VALIDATION', 'Photo: cannot attach to a supplier of another item');

    const srView = as(U.sr2, function () { return must(getTicket(id)); });
    ok(srView.attachments.filter(function (a) { return a.category === 'quote_photo' && a.quote_id === qa; }).length === 10, 'Photo: SR sees the 10 photos of the offer');
    const gmView = as(U.gm, function () { return must(getTicket(id)); });
    ok(gmView.attachments.filter(function (a) { return a.category === 'quote_photo'; }).length === 11, 'Photo: GM sees every supplier photo for approval');
    const salesView = as(U.salesFood3, function () { return must(getTicket(id)); });
    ok(!salesView.attachments.some(function (a) { return a.category === 'quote_photo'; }), 'Photo: Sales never receives supplier photos');
    const pid = quotePhotos_(qa)[0].attachment_id;
    const pv = as(U.gm, function () { return must(getPhotoPreviews([pid], 'thumb')); });
    ok(/^data:image\/png;base64,/.test(pv.previews[pid] || ''), 'Photo: GM gets an inline preview (served by the server, no Drive sharing)');
    ok(as(U.gm, function () { return must(getPhotoPreviews([pid], 'large')); }).previews[pid], 'Photo: large preview for the full-screen viewer');
    ok(!Object.keys(as(U.salesFood3, function () { return must(getPhotoPreviews([pid], 'thumb')); }).previews).length &&
      !Object.keys(as(U.salesFood1, function () { return must(getPhotoPreviews([pid], 'thumb')); }).previews).length,
      'Photo: Sales / other Sales get no preview');
    expectErr(as(U.salesFood3, function () { return openAttachment(pid); }), 'NOT_FOUND', 'Photo: Sales cannot open the original file');
    ok(!as(U.salesFood3, function () { return must(getTicket(id)); }).timeline.some(function (l) { return l.metadata && l.metadata.category === 'quote_photo'; }),
      'Photo: uploads are not in the Sales timeline');

    // removing a supplier removes its photos
    must(as(U.sr2, function () {
      return saveSourcingDraft(id, [{ item_id: squid.item_id, quotes: [quote(qa, 'Siam Squid Co., Ltd.', 120)], winner_quote_id: qa }]);
    }));
    ok(quotePhotos_(qb).length === 0 && quotePhotos_(qa).length === 10, 'Photo: deleting a supplier offer deletes its photos (others kept)');
    const own = quotePhotos_(qa)[9];
    must(as(U.sr2, function () { return deleteAttachment(own.attachment_id); }));
    ok(quotePhotos_(qa).length === 9, 'Photo: SR removes one photo');
    must(upload(U.sr2, meta(squid.item_id, qa)));
    ok(quotePhotos_(qa).length === 10, 'Photo: after removing one, one more can be added');

    // ---------- price review: management group gets counts, never names or prices ----------
    must(go(U.sr2, id, 'submit_quote'));
    const pr = groupMsgs(id, 'sm_review');
    ok(pr.length === 1 && /รูปสินค้า 10 รูป/.test(pr[0].summary) && /Supplier ที่เสนอ: 2 ราย/.test(pr[0].summary) && /มีราคาแล้ว/.test(pr[0].summary) && /<at email=sr\.manager@/.test(pr[0].summary),
      'Bot: 📊 waiting for Sourcing Manager (2 offers, 10 photos, “มีราคาแล้ว”) @SR Manager');
    must(go(U.srManager, id, 'srm_approve'));
    ok(groupMsgs(id, 'gm_final').length === 1 && /<at email=gm@/.test(groupMsgs(id, 'gm_final')[0].summary), 'Bot: 🏁 waiting for GM final approval @GM');
    must(go(U.gm, id, 'gm_price_approve'));
    ok(groupMsgs(id, 'approved').length === 1 && /<at email=sales\.food3@/.test(groupMsgs(id, 'approved')[0].summary) && /<at email=sr2@/.test(groupMsgs(id, 'approved')[0].summary),
      'Bot: 🎉 approved @requester + Sourcing');
    const leaks = groupMsgs(id).filter(function (n) {
      return /Siam Squid|Gulf Ceph|Andaman Shrimp|\b120\b|\b125\b|\b210\b|บาท\/|GP \d|กำไร/.test(n.summary);
    });
    ok(groupMsgs(id).length >= 6 && !leaks.length, 'Group: no group message carries a vendor name, price, cost or GP (' + groupMsgs(id).length + ' messages checked)');

    // switching an event off
    setTestSettings_({ fpr_bot_events_off: JSON.stringify(['submitted']) });
    const t2 = as(U.salesFood3, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'ร้านปิดแจ้งเตือน', due_date: inDays(3), items: [
        { product_name: 'ปลาซาบะ', net_weight: '100%', size: 'M', packing_size: '10 kg', qty: 50, uom: 'กก.', target_price: 0 }] })).ticket;
    });
    must(go(U.mgrFood, t2.ticket_id, 'manager_approve'));
    ok(groupMsgs(t2.ticket_id).length === 0, 'Bot: events listed in Settings › fpr_bot_events_off are not sent');
    setTestSettings_({ fpr_bot_events_off: '[]' });

    // delivery through the webhook: every card signed; colours per event
    ok(groupMsgs(id).every(function (n) { return n.status === 'sent' && n.bot === 'FPR Bot'; }), 'Bot: every card of the request delivered by FPR Bot (NotifLog = sent)');
    ok(http.hooks.length >= 6 && http.hooks.every(function (h) { return h.msg_type === 'interactive' && h.sign === larkSign_(h.timestamp, 'sec-a'); }),
      'Bot: every webhook call is an interactive card signed with the secret');
    const colour = function (part) { const h = http.hooks.filter(function (x) { return x.card.header.title.content.indexOf(part) !== -1; })[0]; return h && h.card.header.template; };
    ok(colour('คำขอราคาใหม่') === 'blue' && colour('มอบหมายทำราคา') === 'indigo' && colour('รอ Sourcing Manager') === 'orange' &&
      colour('รอ GM อนุมัติราคาสุดท้าย') === 'purple' && colour('อนุมัติราคาแล้ว') === 'green', 'Bot: header colour per event (blue / indigo / orange / purple / green)');
    ok(http.hooks.every(function (h) { return h.card.elements.some(function (e) { return e.tag === 'action'; }) === /^https:/.test(fprLink_({ ticket_no: 'x' })); }),
      'Bot: URL button only when the web app has an https link');
    // webhook down → the approval still goes through; 3 attempts logged as failed
    http.hookDown = true;
    const before = http.hooks.length;
    const ga = go(U.gm, t2.ticket_id, 'gm_approve');
    http.hookDown = false;
    const fail = groupMsgs(t2.ticket_id, 'queued')[0];
    ok(ga.ok && ticketById_(t2.ticket_id).stage === 'pending_assign' && fail && fail.status === 'failed' && fail.attempts === 3 && http.hooks.length - before === 3,
      'Bot: webhook down → approval saved anyway, 3 attempts, NotifLog = failed');

    // ---------- deal follow-up ----------
    const deals = as(U.salesFood3, function () { return must(listDeals()); });
    const mine = deals.rows.filter(function (r) { return r.ticket_id === id; });
    ok(mine.length === 2 && mine.every(function (r) { return r.sell_price_thb > 0 && r.qty > 0 && !r.deal_status; }),
      'Deals: both quoted items are follow-up lines (volume / month, expected price, quoted price)');
    const sq = mine.filter(function (r) { return r.item_id === squid.item_id; })[0];
    ok(sq.target_price === 160 && sq.qty === 800 && sq.uom === 'กก.' && sq.target_diff_pct !== null, 'Deals: expected price vs quoted price per unit');
    ok(mine.every(function (r) { return !('landed_cost_thb' in r) && !('gp_percent' in r) && !('vendor_name' in r) && !('profit_thb' in r); }),
      'Deals: Sales view carries no cost, GP or vendor');
    ok(!as(U.salesFood1, function () { return must(listDeals()); }).rows.some(function (r) { return r.ticket_id === id; }), 'Deals: other Sales do not see them');
    ok(as(U.mgrFood, function () { return must(listDeals()); }).rows.some(function (r) { return r.ticket_id === id && r.can_edit; }), 'Deals: Sales Manager of the department sees and can update');
    expectErr(as(U.salesFood1, function () { return updateDeal(squid.item_id, { status: 'won' }); }), 'NOT_FOUND', 'Deals: other Sales cannot update');
    expectErr(as(U.sr2, function () { return updateDeal(squid.item_id, { status: 'won' }); }), 'FORBIDDEN', 'Deals: SR cannot record the sales outcome');
    expectErr(as(U.salesFood3, function () { return updateDeal(squid.item_id, { status: 'lost' }); }), 'VALIDATION', 'Deals: lost needs a reason');
    expectErr(as(U.salesFood3, function () { return updateDeal(squid.item_id, { status: 'lost', reason: 'อื่นๆ' }); }), 'VALIDATION', 'Deals: “อื่นๆ” needs a note');
    expectErr(as(U.salesFood3, function () { return updateDeal(squid.item_id, { status: 'follow', next_date: inDays(-2) }); }), 'VALIDATION', 'Deals: follow-up date cannot be in the past');
    const f1 = as(U.salesFood3, function () { return must(updateDeal(squid.item_id, { status: 'sample', note: 'ลูกค้าขอทดลอง 1 ลัง' })); }).deal;
    ok(f1.deal_status === 'sample' && f1.deal_next_date === inDays(7) && f1.is_open && !f1.is_due, 'Deals: sample sent → next follow-up defaults to today + 7 days');
    const w = as(U.salesFood3, function () { return must(updateDeal(squid.item_id, { status: 'won', note: 'เริ่มสั่งเดือนหน้า' })); }).deal;
    ok(w.deal_status === 'won' && w.deal_closed_at && !w.is_open && !w.deal_next_date, 'Deals: won → closed date recorded');
    const won = groupMsgs(id, 'deal_won');
    ok(won.length === 1 && /ปลาหมึกกล้วย/.test(won[0].summary) && /800 กก\./.test(won[0].summary) && !/\d+\.\d\d|บาท\//.test(won[0].summary),
      'Deals: won is announced in the Sales group (product + volume, no price)');
    ok(findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).some(function (n) { return n.user_email === U.sr2 && n.type === 'deal_won'; }), 'Deals: the SR learns the price sold');
    as(U.salesFood3, function () { must(updateDeal(squid.item_id, { status: 'won', note: 'ยืนยันอีกครั้ง' })); });
    ok(groupMsgs(id, 'deal_won').length === 1, 'Deals: saving won again does not repeat the announcement');
    as(U.mgrFood, function () { must(updateDeal(shrimp.item_id, { status: 'lost', reason: 'ราคาสูงกว่าคู่แข่ง' })); });
    ok(findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.action === 'deal_update'; }).length === 4, 'Deals: every update is in the audit log');
    ok(as(U.salesFood3, function () { return must(getTicket(id)); }).timeline.some(function (l) { return l.action === 'deal_update'; }), 'Deals: Sales sees the outcome in the timeline');
    expectErr(as(U.salesFood3, function () { return updateDeal(activeItemsOf_(t2.ticket_id)[0].item_id, { status: 'won' }); }), 'FORBIDDEN',
      'Deals: no outcome before the price is approved');
    ok(typeof pollData_(userByEmail_(U.salesFood3)).deals_due === 'number' && pollData_(userByEmail_(U.gm)).deals_due === undefined, 'Deals: poll gives Sales the follow-up count');
    const sm = menuFor_(userByEmail_(U.salesFood3));
    ok(sm.some(function (m) { return m.key === 'deals' && m.badge === 'deals_due'; }) && sm.length <= 5, 'Deals: Sales menu has “ติดตามการขาย” (still ≤ 5 items)');

    // ---------- GP summary ----------
    expectErr(as(U.salesFood3, function () { return getGpSummary(); }), 'FORBIDDEN', 'GP: Sales cannot open the GP summary');
    expectErr(as(U.mgrFood, function () { return getGpSummary(); }), 'FORBIDDEN', 'GP: Sales Manager cannot open the GP summary (cost data)');
    expectErr(as(U.sr2, function () { return getGpSummary(); }), 'FORBIDDEN', 'GP: SR cannot open the GP summary');
    const gp = as(U.gm, function () { return must(getGpSummary()); });
    const g1 = gp.rows.filter(function (r) { return r.item_id === squid.item_id; })[0];
    const g2 = gp.rows.filter(function (r) { return r.item_id === shrimp.item_id; })[0];
    ok(g1 && g1.deal_status === 'won' && g1.landed_cost_thb === 120 && g1.gp_percent === 15 && g1.sell_price_thb === 141.18 && g1.profit_thb === 21.18,
      'GP: won line with landed cost 120 → selling 141.18 at GP 15% (profit 21.18 / unit)');
    ok(g2 && g2.deal_status === 'lost' && g2.deal_reason === 'ราคาสูงกว่าคู่แข่ง' && g1.quoted_month === todayBkk_().slice(0, 7), 'GP: lost line with its reason, grouped by the month GM approved the price');
    ok(as(U.srManager, function () { return must(getGpSummary()); }).rows.length === gp.rows.length && as(U.admin, function () { return must(getGpSummary()); }).rows.length === gp.rows.length,
      'GP: SR Manager and Admin see the same summary');
    ok(as(U.gm, function () { return must(getBootstrap()); }).ref.can_view_gp && !as(U.mgrFood, function () { return must(getBootstrap()); }).ref.can_view_gp, 'GP: page offered only to GM / SR Manager / Admin');
    ok(['PageHome', 'PageSuppliers', 'PageDeals', 'PageGp'].every(function (n) { return PARTIALS_.indexOf(n) !== -1; }) &&
      ['deals', 'gp'].every(function (p) { return PAGES_.indexOf(p) !== -1; }), 'Every page file is allowed by include_ (web app renders)');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: PHOTO_DEAL — ' + e.message + '\n' + e.stack);
  } finally {
    TEST_HTTP_ = null;
    TEST_DRIVE_ = null;
    TEST_LARK_ = null;
  }
}

// =============================================================================
// Follow-up v2 (customer stage / next step / update every N days)
// =============================================================================
function runFollowUpV2Cases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  try {
    // ---------- follow-up v2 ----------
    const deals = as(U.salesFood3, function () { return must(listDeals()); });
    ok(deals.customer_stages.length >= 5 && deals.next_steps.length >= 5 && deals.people.length === 0, 'Follow-up: dropdown lists for customer stage + next step (Sales gets no team list)');
    ok(as(U.mgrFood, function () { return must(listDeals()); }).people.length >= 3, 'Follow-up: Sales Manager gets the team list');
    const r = deals.rows.filter(function (x) { return x.is_open; })[0];
    ok(r && r.offer && r.monthly_value_thb === Math.round(r.sell_price_thb * r.qty * 100) / 100 && !('landed_cost_thb' in r.offer) && !('vendor_name' in r.offer),
      'Follow-up: value per month + offer terms for “คัดลอกราคา” (no cost)');
    expectErr(as(U.salesFood3, function () { return updateDeal(r.item_id, { status: 'follow', stage: 'ไม่มีในรายการ' }); }), 'VALIDATION', 'Follow-up: customer stage must come from the list');
    expectErr(as(U.salesFood3, function () { return updateDeal(r.item_id, { status: 'follow', next_step: 'xx' }); }), 'VALIDATION', 'Follow-up: next step must come from the list');
    const u1 = as(U.salesFood3, function () {
      return must(updateDeal(r.item_id, { status: 'follow', stage: 'อยู่ระหว่างต่อรองราคา', next_step: 'นัดเข้าพบลูกค้า', next_date: inDays(3), note: 'ขอส่วนลด 3%' }));
    }).deal;
    ok(u1.deal_stage === 'อยู่ระหว่างต่อรองราคา' && u1.deal_next_step === 'นัดเข้าพบลูกค้า' && u1.deal_next_date === inDays(3) && !u1.is_due && u1.days_since_update === 0,
      'Follow-up: update saves customer stage, next step, date (not due right after an update)');
    const log = findAll_(TAB.LOGS, 'ticket_id', r.ticket_id).filter(function (l) { return l.action === 'deal_update'; }).pop();
    ok(parseJson_(log.metadata_json, {}).stage === 'อยู่ระหว่างต่อรองราคา', 'Follow-up: customer stage in the audit log');
    // nobody updated for 8 days → needs an update
    withLock_(function () { updateRow_(TAB.ITEMS, r.item_id, { deal_updated_at: new Date(Date.now() - 8 * 86400000), deal_next_date: inDays(10) }); });
    ok(as(U.salesFood3, function () { return must(listDeals()); }).rows.filter(function (x) { return x.item_id === r.item_id; })[0].is_due,
      'Follow-up: open deal not updated for 7+ days → ต้องอัปเดต (even if the next date is later)');
    withLock_(function () { updateRow_(TAB.ITEMS, r.item_id, { deal_updated_at: new Date(), deal_next_date: inDays(0) }); });
    ok(as(U.salesFood3, function () { return must(listDeals()); }).rows.filter(function (x) { return x.item_id === r.item_id; })[0].is_due, 'Follow-up: follow-up date reached → ต้องอัปเดต');
    const w = as(U.salesFood3, function () { return must(updateDeal(r.item_id, { status: 'won', stage: 'ใกล้ปิดการขาย', next_step: 'รอ PO' })); }).deal;
    ok(!w.deal_stage && !w.deal_next_step && !w.is_due, 'Follow-up: won clears stage / next step and is never due');

    ok(!menuFor_(userByEmail_(U.gm)).some(function (x) { return x.key === 'portal'; }) && PAGES_.indexOf('portal') === -1,
      'The management portal is not part of the Food app (separate web app in portal/)');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: FOLLOW_UP_V2 — ' + e.message + '\n' + e.stack);
  }
}

// =============================================================================
// SR Manager / GM edit prices in their own approval step · Sourcing view of the follow-up
// =============================================================================
function runReviewerEditCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment) {
    return as(email, function () { return transitionTicket(id, action, comment || '', { expected_version: ticketById_(id).version }); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  try {
    const t = as(U.salesFood1, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: 'ร้านทดสอบแก้ราคา', due_date: inDays(3), items: [
        { product_name: 'ปลาหมึกกระดอง', net_weight: '90%', size: '40/60', packing_size: '1 kg', qty: 500, uom: 'กก.', target_price: 200 }] })).ticket;
    });
    const id = t.ticket_id;
    must(go(U.mgrFood, id, 'manager_approve'));
    must(go(U.gm, id, 'gm_approve'));
    must(go(U.sr1, id, 'claim'));
    as(U.sr1, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    must(go(U.sr1, id, 'doc_complete'));
    const it = activeItemsOf_(id)[0];
    const qa = Utilities.getUuid(), qb = Utilities.getUuid();
    const quotes = function (pa, pb) {
      return [{ quote_id: qa, vendor_name: 'Vendor A', unit_price: pa, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) },
        { quote_id: qb, vendor_name: 'Vendor B', unit_price: pb, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }];
    };
    must(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(160, 170), winner_quote_id: qa }]); }));
    must(go(U.sr1, id, 'submit_quote'));
    ok(Number(findOne_(TAB.ITEMS, 'item_id', it.item_id).sell_price_thb) === 188.24, 'Submit stores the selling price (160 ÷ 0.85 = 188.24)');

    // SR Manager step
    ok(as(U.srManager, function () { return must(getTicket(id)); }).permissions.can_edit_quotes, 'SR Manager can edit prices while “รอ SR Manager ตรวจราคา”');
    expectErr(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(150, 170), winner_quote_id: qa }]); }), 'FORBIDDEN',
      'The SR cannot change prices while they are under review');
    expectErr(as(U.gm, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(150, 170), winner_quote_id: qa }]); }), 'FORBIDDEN',
      'GM cannot edit during the SR Manager step');
    must(as(U.srManager, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(150, 170), winner_quote_id: qa, gp_percent: 18 }]); }));
    ok(activeQuotesOfItem_(it.item_id).filter(function (q) { return q.quote_id === qa; })[0].unit_price === 150, 'SR Manager changed vendor price 160 → 150 and GP 15 → 18%');
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) { return l.actor_email === U.srManager && COST_LOG_ACTIONS_.indexOf(l.action) !== -1; }), 'Reviewer change is in the audit log under the SR Manager');
    expectErr(as(U.srManager, function () { return setItemQuoteStatus(id, it.item_id, 'not_offered', 'x', ticketById_(id).version); }), 'FORBIDDEN',
      'Reviewer cannot split / drop items (SR only)');
    must(go(U.srManager, id, 'srm_approve'));
    ok(Number(findOne_(TAB.ITEMS, 'item_id', it.item_id).sell_price_thb) === 182.93 && Number(findOne_(TAB.ITEMS, 'item_id', it.item_id).gp_percent) === 18,
      'Approval stores the edited selling price (150 ÷ 0.82 = 182.93)');
    const lg = findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.action === 'srm_approve'; }).pop();
    ok(parseJson_(lg.metadata_json, {}).reviewer_changes >= 1, 'Approval log records how many changes the reviewer made');
    const srNote = findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).filter(function (n) { return n.user_email === U.sr1 && /แก้ไขราคา/.test(n.body); });
    ok(srNote.length === 1, 'The SR is told the SR Manager edited the price');
    ok(!as(U.salesFood1, function () { return must(getTicket(id)); }).timeline.some(function (l) { return COST_LOG_ACTIONS_.indexOf(l.action) !== -1 || (l.metadata && l.metadata.reviewer_changes); }),
      'Sales never sees the reviewer’s price edits');
    expectErr(as(U.srManager, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(140, 170), winner_quote_id: qa }]); }), 'FORBIDDEN',
      'SR Manager can no longer edit once it moved to GM');

    // GM step
    ok(as(U.gm, function () { return must(getTicket(id)); }).permissions.can_edit_quotes, 'GM can edit prices while “รอ GM อนุมัติฝั่งซื้อ”');
    must(as(U.gm, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(150, 145), winner_quote_id: qb, selection_reason: '', gp_percent: 18 }]); }));
    must(go(U.gm, id, 'gm_price_approve'));
    const sell = Number(findOne_(TAB.ITEMS, 'item_id', it.item_id).sell_price_thb);
    ok(sell === 176.83 && as(U.salesFood1, function () { return must(getTicket(id)); }).items[0].sales_pricing.sell_price_thb === 176.83,
      'GM switched the winner to the cheaper vendor B → Sales gets 145 ÷ 0.82 = 176.83');
    ok(findAll_(TAB.NOTIFICATIONS, 'ticket_id', id).filter(function (n) { return n.user_email === U.sr1 && /แก้ไขราคา/.test(n.body); }).length === 2, 'The SR is told the GM edited the price');
    expectErr(as(U.mgrFood, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: quotes(1, 1), winner_quote_id: qa }]); }), 'FORBIDDEN',
      'Sales Manager can never edit prices');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: REVIEWER_EDIT — ' + e.message + '\n' + e.stack);
  }

  // ---------- Sourcing view of the follow-up (weekly meeting) ----------
  try {
    const d = as(U.sr1, function () { return must(listDeals()); });
    ok(d.default_sr === U.sr1 && d.sourcing.some(function (p) { return p.email === U.sr1; }), 'Follow-up: SR opens on the prices they made; list of Sourcing people');
    ok(d.rows.length > 0 && d.rows.every(function (r) { return 'sr_email' in r && !r.can_edit; }), 'Follow-up: SR sees the Sales outcome but cannot change it');
    ok(d.rows.every(function (r) { return !('landed_cost_thb' in r) && !('gp_percent' in r) && !('profit_thb' in r) && !('vendor_name' in r); }),
      'Follow-up: Sourcing view has no cost / GP / vendor (same data as Sales)');
    ok(as(U.srManager, function () { return must(listDeals()); }).sourcing.length >= 2, 'Follow-up: SR Manager gets every SR for the Sourcing view');
    ok(as(U.salesFood1, function () { return must(listDeals()); }).sourcing.length === 0, 'Follow-up: Sales does not get the Sourcing list');
    const m = menuFor_(userByEmail_(U.sr1));
    ok(m.some(function (x) { return x.key === 'deals'; }) && m.length <= 5, 'Follow-up: SR menu has “ติดตามงานขาย” (≤ 5 items)');
  } catch (e) {
    results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: SOURCING_VIEW — ' + e.message + '\n' + e.stack);
  }
}

// ===================================================================== FPR workflow (FPR switches on)
function runFprCases_(results) {
  const U = demoUsers_();
  const ok = function (cond, name) { if (!cond) throw new Error('FAIL: ' + name); results.push('PASS: ' + name); };
  const expectErr = function (res, code, name) {
    if (res && res.ok === false && res.code === code) { results.push('PASS: ' + name + ' → [' + code + '] ' + res.error); return res; }
    throw new Error('FAIL: ' + name + ' → expected ' + code + ', got ' + JSON.stringify(res).slice(0, 300));
  };
  const must = function (res, name) {
    if (!res || !res.ok) throw new Error('FAIL: ' + (name || 'call') + ' → ' + JSON.stringify(res).slice(0, 300));
    return res.data;
  };
  const as = function (email, fn) { return withIdentity_(email, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) { results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack); }
  };
  const newReq = function (who, name) {
    return as(who || U.salesFood1, function () {
      return must(createTicket({ customer_group: 'ร้านอาหาร', customer_name: name || 'ลูกค้า FPR', due_date: inDays(3), items: [
        { product_name: 'กุ้งขาว Vannamei HLSO', net_weight: '80%', size: '31/40', packing_size: '1 kg/pack', qty: 500, uom: 'กก.', target_price: 0 },
        { product_name: 'หมึกกล้วย IQF', net_weight: '90%', size: 'U/10', packing_size: '1 kg/bag', qty: 300, uom: 'กก.', target_price: 0 }] })).ticket;
    });
  };
  const toPricing = function (id) {
    must(go(U.gm, id, 'gm_approve', '', { sr_email: U.sr1 }));
    as(U.sr1, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
    must(go(U.sr1, id, 'doc_complete'));
  };
  const q = function (name, price, extra) {
    return Object.assign({ quote_id: Utilities.getUuid(), vendor_name: name, unit_price: price, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }, extra || {});
  };
  const price3 = function (id) {
    const rows = activeItemsOf_(id).map(function (it, i) {
      const qs = [q('Supplier A' + i, 100 + i), q('Supplier B' + i, 110 + i), q('Supplier C' + i, 120 + i)];
      return { item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id };
    });
    must(as(U.sr1, function () { return saveSourcingDraft(id, rows); }));
  };

  const http = fakeHttp_();
  TEST_HTTP_ = http;
  TEST_BOTS_ = { fpr: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/fpr', secret: 'sec-a' },
    reminder: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/rem', secret: 'sec-b' } };
  setTestSettings_({ sales_manager_step: 'false', gm_assigns_sr: 'true', min_suppliers: '3' });
  try {
    // ---------- happy path ----------
    wrap('FPR_HAPPY', function () {
      const t = newReq();
      const id = t.ticket_id;
      ok(/^FPR-\d{4}-\d{4,}$/.test(t.ticket_no) && t.stage === 'pending_gm', 'FPR: SUBMITTED goes straight to GM_REVIEW (no Sales Manager step) — ' + t.ticket_no);
      ok(botLog_(id, 'submitted').length === 1 && /<at email=gm@/.test(botLog_(id, 'submitted')[0].summary), 'FPR: “ใบขอราคาใหม่” card @GM on submit');
      ok(as(U.salesFood1, function () { return must(getTicket(t.ticket_no)); }).ticket.ticket_id === id, 'FPR: request opens by FPR number (?page=ticket&id=FPR-…)');
      const gv = as(U.gm, function () { return must(getTicket(id)); });
      ok(gv.sla && gv.sla.key === 'GM_REVIEW' && gv.sla.hours === 4 && gv.sla.overdue === false, 'FPR: request page shows the GM_REVIEW SLA deadline (4 working h)');
      ok(gv.permissions.actions.join() === 'gm_approve,gm_return,gm_reject', 'FPR: GM sees approve / return to requester / reject');
      expectErr(go(U.gm, id, 'gm_approve'), 'INVALID_ASSIGNEE', 'FPR: GM must pick the Sourcing person when approving');
      expectErr(go(U.gm, id, 'gm_approve', '', { sr_email: U.salesFood2 }), 'INVALID_ASSIGNEE', 'FPR: the assignee must be an active SR');
      expectErr(go(U.sr1, id, 'gm_approve', '', { sr_email: U.sr1 }), 'NOT_FOUND', 'FPR: SR cannot even see / approve a request at GM_REVIEW');
      expectErr(go(U.srManager, id, 'gm_approve', '', { sr_email: U.sr1 }), 'NOT_FOUND', 'FPR: Sourcing Manager cannot approve GM_REVIEW');
      // double click: two approvals with the same version → the second is refused
      const v = ticketById_(id).version;
      must(as(U.gm, function () { return transitionTicket(id, 'gm_approve', '', { expected_version: v, sr_email: U.sr1 }); }));
      expectErr(as(U.gm, function () { return transitionTicket(id, 'gm_approve', '', { expected_version: v, sr_email: U.sr2 }); }), 'VERSION_CONFLICT', 'FPR: double click on approve is refused (one transition only)');
      const a = ticketById_(id);
      ok(a.stage === 'doc_check' && a.sr_email === U.sr1 && a.pricing_started_at, 'FPR: GM approval → ASSIGNED to the chosen SR, pricing clock started');
      ok(botLog_(id, 'assigned').length === 1 && /<at email=sr1@/.test(botLog_(id, 'assigned')[0].summary), 'FPR: “มอบหมายงาน” card @the chosen SR');
      ok(botLog_(id, 'gm_approve').length === 0 && botLog_(id).length === 2, 'FPR: one card per step (no duplicate cards)');
      expectErr(go(U.salesFood1, id, 'cancel', 'ไม่ใช้แล้ว'), 'INVALID_STATE', 'FPR: requester cannot cancel after GM approval');
      as(U.sr1, function () { checklistOf_(id).filter(function (c) { return c.is_required; }).forEach(function (c) { must(updateChecklist(c.check_id, true, '')); }); });
      must(go(U.sr1, id, 'doc_complete'));

      // fewer than 3 suppliers → refused unless a reason is given
      const items = activeItemsOf_(id);
      const two = [q('Supplier A', 100), q('Supplier B', 105)];
      must(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: items[0].item_id, quotes: two, winner_quote_id: two[0].quote_id }]); }));
      const three = [q('Supplier X', 200), q('Supplier Y', 210), q('Supplier Z', 220)];
      must(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: items[1].item_id, quotes: three, winner_quote_id: three[0].quote_id }]); }));
      const few = expectErr(go(U.sr1, id, 'submit_quote'), 'FEW_SUPPLIERS', 'FPR: submit with only 2 suppliers is refused');
      ok(/ลำดับที่ 1/.test(few.error) && !/2/.test(few.error.replace(/\d+ ราย/, '')), 'FPR: the error names the item that is short (line 1 only)');
      must(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: items[0].item_id, quotes: two, winner_quote_id: two[0].quote_id, shortfall_reason: 'สินค้าขาดตลาด มีผู้ขายเพียง 2 ราย' }]); }));
      ok(findOne_(TAB.ITEMS, 'item_id', items[0].item_id).supplier_shortfall_reason === 'สินค้าขาดตลาด มีผู้ขายเพียง 2 ราย', 'FPR: shortfall reason saved on the item');
      must(go(U.sr1, id, 'submit_quote'));
      ok(ticketById_(id).stage === 'pending_sr_manager', 'FPR: with a reason the price goes to SM_REVIEW');
      ok(botLog_(id, 'sm_review').length === 1 && /<at email=sr\.manager@/.test(botLog_(id, 'sm_review')[0].summary), 'FPR: SM_REVIEW card @Sourcing Manager');
      expectErr(go(U.gm, id, 'gm_price_approve'), 'INVALID_STATE', 'FPR: GM cannot skip the Sourcing Manager step');
      must(go(U.srManager, id, 'srm_approve'));
      ok(botLog_(id, 'gm_final').length === 1 && /<at email=gm@/.test(botLog_(id, 'gm_final')[0].summary), 'FPR: GM_FINAL_REVIEW card @GM');
      must(go(U.gm, id, 'gm_price_approve'));
      const fin = ticketById_(id);
      ok(fin.status === 'priced' || fin.stage === 'price_ready' || OPEN_STATUSES.indexOf(fin.status) === -1 || botLog_(id, 'approved').length === 1, 'FPR: APPROVED');
      const ap = botLog_(id, 'approved');
      ok(ap.length === 1 && /<at email=sales\.food1@/.test(ap[0].summary) && /มีราคาแล้ว/.test(ap[0].summary), 'FPR: approved card @requester with “มีราคาแล้ว”');
      const all = botLog_(id).map(function (n) { return n.summary; }).join('\n');
      ok(!/Supplier [ABXYZ]/.test(all) && !/\b(100|105|200|210|220)(\.\d+)? ?บาท/.test(all) && !/GP ?\d/.test(all), 'FPR: no card shows supplier, cost or GP');
      ok(botLog_(id).every(function (n) { return n.bot === 'FPR Bot' && n.status === 'sent'; }), 'FPR: every workflow card went through FPR Bot');
      ok(http.hooks.every(function (h) { return h.timestamp && h.sign && h.msg_type === 'interactive'; }), 'FPR: every webhook call is signed (timestamp + sign) and interactive');
      const lastHook = http.hooks[http.hooks.length - 1];
      ok(JSON.stringify(lastHook).indexOf('?page=ticket&id=' + t.ticket_no) !== -1, 'FPR: card button opens ?page=ticket&id=FPR-…');
    });

    // ---------- every return ----------
    wrap('FPR_RETURNS', function () {
      const id = newReq(U.salesFood2, 'ลูกค้าตีกลับ').ticket_id;
      expectErr(go(U.gm, id, 'gm_return'), 'COMMENT_REQUIRED', 'FPR: GM return needs a reason');
      must(go(U.gm, id, 'gm_return', 'กรุณาระบุขนาดให้ชัดเจน'));
      ok(ticketById_(id).stage === 'returned', 'FPR: GM_REVIEW → returned to the requester');
      const r1 = botLog_(id, 'returned');
      ok(r1.length === 1 && /<at email=sales\.food2@/.test(r1[0].summary) && /ระบุขนาด/.test(r1[0].summary), 'FPR: return card @requester with the reason');
      must(go(U.salesFood2, id, 'resubmit'));
      ok(ticketById_(id).stage === 'pending_gm' && botLog_(id, 'submitted').length === 2, 'FPR: resubmit goes back to GM_REVIEW (card again)');
      toPricing(id);
      price3(id);
      must(go(U.sr1, id, 'submit_quote'));
      must(go(U.srManager, id, 'srm_return', 'ราคาสูงไป หาเพิ่ม'));
      const r2 = botLog_(id, 'returned');
      ok(ticketById_(id).stage === 'sourcing' && r2.length === 2 && /<at email=sr1@/.test(r2[1].summary) && !/ราคาสูง/.test(r2[1].summary),
        'FPR: SM return → back to PRICING, card @SR, price reason not in the group');
      must(go(U.sr1, id, 'submit_quote'));
      must(go(U.srManager, id, 'srm_approve'));
      must(go(U.gm, id, 'gm_price_return', 'ต่อรองใหม่'));
      ok(ticketById_(id).stage === 'sourcing' && botLog_(id, 'returned').length === 3, 'FPR: GM final return → back to PRICING');
    });

    // ---------- reject / cancel ----------
    wrap('FPR_REJECT', function () {
      const a = newReq(U.salesFood1, 'ลูกค้าไม่อนุมัติ').ticket_id;
      expectErr(go(U.gm, a, 'gm_reject'), 'COMMENT_REQUIRED', 'FPR: GM reject needs a reason');
      must(go(U.gm, a, 'gm_reject', 'ไม่ใช่สินค้าหลักของบริษัท'));
      ok(ticketById_(a).stage === 'rejected' && /ไม่ใช่สินค้าหลัก/.test(botLog_(a, 'rejected')[0].summary), 'FPR: GM_REVIEW reject → REJECTED, reason on the card');

      const b = newReq(U.salesFood1, 'ลูกค้า SM ปฏิเสธ').ticket_id;
      toPricing(b); price3(b);
      must(go(U.sr1, b, 'submit_quote'));
      expectErr(go(U.srManager, b, 'srm_reject'), 'COMMENT_REQUIRED', 'FPR: Sourcing Manager reject needs a reason');
      expectErr(go(U.sr1, b, 'srm_reject', 'x'), 'FORBIDDEN', 'FPR: SR cannot reject at SM_REVIEW');
      must(go(U.srManager, b, 'srm_reject', 'ต้นทุนสูงเกินตลาด 30%'));
      ok(ticketById_(b).stage === 'rejected' && botLog_(b, 'rejected').length === 1 && !/ต้นทุนสูง/.test(botLog_(b, 'rejected')[0].summary),
        'FPR: SM reject → REJECTED (cost reason kept off the group card)');

      const c = newReq(U.salesFood1, 'ลูกค้า GM ปฏิเสธราคา').ticket_id;
      toPricing(c); price3(c);
      must(go(U.sr1, c, 'submit_quote'));
      must(go(U.srManager, c, 'srm_approve'));
      expectErr(go(U.gm, c, 'gm_price_reject'), 'COMMENT_REQUIRED', 'FPR: GM final reject needs a reason');
      must(go(U.gm, c, 'gm_price_reject', 'GP ต่ำเกินไป'));
      ok(ticketById_(c).stage === 'rejected', 'FPR: GM_FINAL_REVIEW reject → REJECTED');

      const d = newReq(U.salesFood1, 'ลูกค้ายกเลิกเอง').ticket_id;
      must(go(U.salesFood1, d, 'cancel', 'ลูกค้าเปลี่ยนใจ'));
      ok(ticketById_(d).stage === 'cancelled' && botLog_(d, 'cancelled').length === 1, 'FPR: requester cancels before GM approval → CANCELLED card');

      const e = newReq(U.salesFood1, 'ลูกค้า Admin ยกเลิก').ticket_id;
      toPricing(e);
      expectErr(go(U.gm, e, 'admin_cancel', 'x'), 'FORBIDDEN', 'FPR: only Admin can cancel a request in progress');
      expectErr(go(U.admin, e, 'admin_cancel'), 'COMMENT_REQUIRED', 'FPR: Admin cancel needs a reason');
      must(go(U.admin, e, 'admin_cancel', 'ใบซ้ำกับ FPR อื่น'));
      ok(ticketById_(e).stage === 'cancelled' && /ใบซ้ำ/.test(botLog_(e, 'cancelled')[0].summary), 'FPR: Admin cancels at any step with a reason');
      expectErr(go(U.admin, e, 'admin_cancel', 'อีกครั้ง'), 'INVALID_STATE', 'FPR: a closed request cannot be cancelled again');
    });

    // ---------- unauthorized ----------
    wrap('FPR_AUTH', function () {
      const id = newReq(U.salesFood1, 'ลูกค้าสิทธิ์').ticket_id;
      expectErr(as('outsider@' + DEMO_DOMAIN, function () { return getTicket(id); }), 'NOT_REGISTERED', 'FPR: unregistered user cannot open a request');
      expectErr(go(U.salesFood2, id, 'cancel', 'x'), 'NOT_FOUND', 'FPR: another Sales cannot cancel the request');
      expectErr(go(U.admin, id, 'gm_approve', '', { sr_email: U.sr1 }), 'FORBIDDEN', 'FPR: Admin cannot approve on behalf of GM');
      expectErr(as(U.salesFood2, function () { return getTicket(id); }), 'NOT_FOUND', 'FPR: another Sales cannot open the request');
      toPricing(id); price3(id);
      expectErr(as(U.sr2, function () { return saveSourcingDraft(id, []); }), 'FORBIDDEN', 'FPR: another SR cannot price it');
      const sales = as(U.salesFood1, function () { return must(getTicket(id)); });
      ok(sales.items.every(function (it) { return !(it.quotations || []).length && !it.pricing && !('gp_percent' in it); }), 'FPR: requester never receives quotations / cost / GP');
    });

    // ---------- landed cost + GP floor ----------
    wrap('FPR_COST', function () {
      const bd = costBreakdown_(1000, { freight: 50, insurance: 10, duty_pct: 5, fees: 3, cold: 2, inland: 4, other: 1 });
      ok(bd.duty_thb === 53 && bd.total_thb === 123, 'FPR: duty = 5% × CIF (1000 + 50 + 10) = 53; extra cost per unit = 123');
      const id = newReq(U.salesFood3, 'ลูกค้าต้นทุนนำเข้า').ticket_id;
      toPricing(id);
      const it = activeItemsOf_(id)[0];
      const usd = q('Norway Seafood AS', 3, { currency: 'USD', fx_rate: 35, fx_date: inDays(0), cost_breakdown: { freight: 5, insurance: 0.5, duty_pct: 10, fees: 1, cold: 2, inland: 1.5, other: 0 } });
      must(as(U.sr1, function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: [usd], winner_quote_id: usd.quote_id, gp_percent: 8 }]); }));
      const sq = activeQuotesOfItem_(it.item_id)[0];
      // net 3 USD × 35 = 105 THB; CIF = 105 + 5 + 0.5 = 110.5; duty 11.05; extras = 5 + 0.5 + 11.05 + 1 + 2 + 1.5 = 21.05
      ok(Math.abs(Number(sq.clearance_thb) - 21.05) < 0.001 && Math.abs(Number(sq.landed_unit_cost_thb) - 126.05) < 0.001, 'FPR: landed cost = 105 + 21.05 = 126.05 THB / unit');
      ok(String(sq.fx_date) !== '' && /"duty_thb":11.05/.test(sq.cost_breakdown_json), 'FPR: FX date and breakdown stored with the quotation');
      const view = as(U.sr1, function () { return must(getTicket(id)); }).items.filter(function (x) { return x.item_id === it.item_id; })[0];
      ok(view.pricing.gp_below_min === true && view.pricing.min_gp_percent === 10, 'FPR: GP 8% is flagged below the 10% minimum');
      ok(view.pricing.sell_price_thb === round_(126.05 / 0.92, 2), 'FPR: selling price = landed ÷ (1 − GP)');
    });

    // ---------- working-time SLA ----------
    wrap('FPR_SLA', function () {
      const wh = { start: 510, end: 1050, days: [1, 2, 3, 4, 5] };
      const fri = new Date('2026-10-09T09:30:00Z');   // Fri 16:30 Bangkok
      ok(addWorkMinutes_(fri, 240, wh, {}).toISOString() === '2026-10-12T04:30:00.000Z', 'SLA: Fri 16:30 + 4 working h = Mon 11:30 (weekend skipped)');
      ok(addWorkMinutes_(fri, 240, wh, { '2026-10-12': 'หยุด' }).toISOString() === '2026-10-13T04:30:00.000Z', 'SLA: holiday on Monday → Tue 11:30');
      ok(addWorkMinutes_(fri, 2 * 540, wh, {}).toISOString() === '2026-10-13T09:30:00.000Z', 'SLA: 2 working days from Fri 16:30 = Tue 16:30');
      ok(workMinutesBetween_(fri, new Date('2026-10-12T04:30:00Z'), wh, {}) === 240, 'SLA: Fri 16:30 → Mon 11:30 = 240 working minutes');
      ok(addWorkMinutes_(new Date('2026-10-10T03:00:00Z'), 60, wh, {}).toISOString() === '2026-10-12T02:30:00.000Z', 'SLA: started on Saturday → counts from Mon 08:30');
    });

    // ---------- reminder bot ----------
    wrap('FPR_REMINDER', function () {
      const t = newReq(U.salesFood2, 'ลูกค้าค้าง SLA');
      withLock_(function () { updateRow_(TAB.TICKETS, t.ticket_id, { stage_entered_at: new Date(Date.now() - 20 * 86400000) }); });
      expectErr(as(U.salesFood2, function () { try { sendSlaReminders(); return { ok: true }; } catch (e) { return { ok: false, code: e.code, error: e.message }; } }), 'FORBIDDEN',
        'Reminder: a normal user cannot run the reminder job');
      const r1 = as(U.admin, function () { return sendSlaReminders(); });
      const rem = botLog_(t.ticket_id).filter(function (n) { return n.bot === 'FPR Reminder'; });
      ok(r1.reminded.indexOf(t.ticket_no) !== -1 && rem.length === 1 && rem[0].event === 'sla_GM_REVIEW' && /<at email=gm@/.test(rem[0].summary),
        'Reminder: request over GM_REVIEW SLA → FPR Reminder card @GM');
      ok(/เกินกำหนด/.test(rem[0].summary), 'Reminder: card shows how late it is (working time)');
      const r2 = as(U.admin, function () { return sendSlaReminders(); });
      ok(r2.reminded.indexOf(t.ticket_no) === -1, 'Reminder: not repeated within 8 working hours');
      withLock_(function () { updateRow_(TAB.TICKETS, t.ticket_id, { last_reminded_at: new Date(Date.now() - 10 * 86400000) }); });
      ok(as(U.admin, function () { return sendSlaReminders(); }).reminded.indexOf(t.ticket_no) !== -1, 'Reminder: repeats after 8 working hours');
      must(go(U.gm, t.ticket_id, 'gm_approve', '', { sr_email: U.sr2 }));
      ok(as(U.admin, function () { return sendSlaReminders(); }).reminded.indexOf(t.ticket_no) === -1, 'Reminder: new step → clock restarts (no reminder)');
    });

    // ---------- webhook down / test bots / mentions ----------
    wrap('FPR_BOTS', function () {
      http.hookDown = true;
      const t = newReq(U.salesFood3, 'ลูกค้า webhook ล่ม');
      http.hookDown = false;
      const s = botLog_(t.ticket_id, 'submitted');
      ok(ticketById_(t.ticket_id).stage === 'pending_gm' && s.length === 1 && s[0].status === 'failed' && s[0].attempts === 3,
        'Webhook down: request still saved, card retried 3× and logged as failed in NotifLog');
      TEST_BOTS_ = { fpr: { url: '', secret: '' }, reminder: { url: '', secret: '' } };
      const t2 = newReq(U.salesFood3, 'ลูกค้าไม่มีบอท');
      ok(botLog_(t2.ticket_id, 'submitted')[0].status === 'not_configured', 'No webhook URL in Script Properties → logged as not_configured, nothing breaks');
      TEST_BOTS_ = { fpr: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/fpr', secret: 'sec-a' },
        reminder: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/rem', secret: 'sec-b' } };
      const n0 = http.hooks.length;
      const out = as(U.admin, function () { return testBots(); });
      ok(out.length === Object.keys(FPR_EVENTS_).length + 1 && out.every(function (l) { return /: sent$/.test(l); }) && http.hooks.length - n0 === out.length,
        'testBots: one sample card per event + one reminder, all sent');
      expectErr(as(U.salesFood1, function () { try { testBots(); return { ok: true }; } catch (e) { return { ok: false, code: e.code, error: e.message }; } }), 'FORBIDDEN',
        'testBots: Admin / owner only');
      ok(buildMention(U.gm) === '<at email=' + U.gm + '></at>', 'Mention: <at email=…> by default');
      withLock_(function () { updateRow_(TAB.USERS, U.gm, { lark_open_id: 'ou_gm123' }); });
      ok(buildMention(U.gm) === '<at id=ou_gm123></at>', 'Mention: falls back to open_id when set on the user (mention not showing fix)');
      withLock_(function () { updateRow_(TAB.USERS, U.gm, { lark_open_id: '' }); });
      ok(larkSign_(1700000000, 'sec-a') === Utilities.base64Encode(Utilities.computeHmacSha256Signature('', '1700000000\nsec-a')), 'Signature: HmacSHA256(timestamp + \\n + secret) base64');
    });
  } finally {
    setTestSettings_({ sales_manager_step: 'true', gm_assigns_sr: 'false', min_suppliers: '1' });
    TEST_BOTS_ = null;
  }
}
