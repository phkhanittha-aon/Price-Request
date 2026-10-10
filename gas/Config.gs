/**
 * File: Config.gs
 * MGS Food Price Request & Sourcing System — configuration and the sheet "schema".
 *
 * The header row of every tab is the contract between code and data.
 * Columns are always addressed by header name, never by position.
 * Secrets (Lark app secret, etc.) live in Script Properties, never here.
 */

const APP_VERSION = '2026.10.10-6';

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

const STATUS = ['requested', 'on_process', 'completed', 'closed', 'rejected', 'deleted'];
const STATUS_LABEL_TH = {
  requested: 'Requested', on_process: 'On Process', completed: 'Completed', closed: 'Closed', rejected: 'Rejected', deleted: 'Deleted'
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
  cancelled: 'rejected',
  deleted: 'deleted'      // removed by Admin (soft delete — only Admin sees it, can restore)
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
  cancelled: 'ยกเลิก',
  deleted: 'ถูกลบ (Admin)'
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
  ['fpr_mention_owner', 'true', 'การ์ด Lark ทุกใบ (FPR Bot + Reminder) แท็กเจ้าของคำขอ (Sales ผู้ขอราคา) ด้วย — false = แท็กเฉพาะผู้ต้องดำเนินการ'],
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
