/**
 * File: Config.gs
 * MGS Price Request & Sourcing System — configuration and the sheet "schema".
 *
 * The header row of every tab is the contract between code and data.
 * Columns are always addressed by header name, never by position.
 * Secrets (Lark app secret, etc.) live in Script Properties, never here.
 */

const APP_VERSION = '2026.10.06-2';

const CFG = {
  APP_NAME: 'MGS Price Request',
  TZ: 'Asia/Bangkok',
  LOCK_TIMEOUT_MS: 25000,
  MAX_ITEMS_PER_TICKET: 100,
  MAX_VENDORS_PER_ITEM: 3,
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
    WEBAPP_URL: 'WEBAPP_URL'
  }
};

const TAB = {
  USERS: 'Users',
  DEPARTMENTS: 'Departments',
  PRODUCT_GROUPS: 'ProductGroups',
  VENDORS: 'Vendors',
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
    cols: ['email', 'full_name', 'role', 'department_code', 'is_sr_lead', 'is_active',
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
           'contact_name', 'phone', 'email', 'note', 'is_active', 'created_by', 'created_at', 'updated_at']
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
           'client_key', 'created_at', 'updated_at']
  },
  TicketItems: {
    key: 'item_id',
    cols: ['item_id', 'ticket_id', 'line_no', 'product_group_code', 'product_name', 'spec', 'description',
           'qty', 'uom', 'target_price', 'target_currency', 'is_deleted', 'created_at', 'updated_at']
  },
  Quotations: {
    key: 'quote_id',
    cols: ['quote_id', 'item_id', 'ticket_id', 'vendor_id', 'vendor_name', 'unit_price', 'currency', 'fx_rate',
           'vat_term', 'vat_rate', 'moq', 'lead_time_days', 'payment_term', 'valid_until', 'remark',
           'attachment_file_id', 'is_selected', 'selection_reason',
           'net_unit_cost', 'net_unit_cost_thb', 'gross_unit_price_thb',
           'is_deleted', 'created_by', 'created_at', 'updated_at',
           // Food-specific (optional) — appended later, keep at the end
           'brand', 'origin_country', 'packing', 'incoterm', 'shelf_life']
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
  ErrorLog: {
    key: 'ts',
    cols: ['ts', 'fn', 'user_email', 'code', 'message', 'stack', 'context_json', 'app_version']
  }
};

// ---------------------------------------------------------------- Enumerations
const ROLES = ['sales', 'manager', 'gm', 'sr', 'admin'];
const ROLE_LABEL_TH = { sales: 'Sales', manager: 'Manager', gm: 'GM', sr: 'SR (Sourcing)', admin: 'Admin' };

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
  awaiting_sales_ack: 'completed',
  closed: 'closed',
  rejected: 'rejected',
  cancelled: 'rejected'
};

const STAGE_LABEL_TH = {
  pending_manager: 'รอ Manager อนุมัติ',
  returned: 'ส่งกลับให้ Sales แก้ไข',
  pending_gm: 'รอ GM อนุมัติ',
  pending_assign: 'รอ SR รับงาน',
  doc_check: 'SR ตรวจเอกสาร',
  need_info: 'รอ Sales ส่งข้อมูลเพิ่ม',
  sourcing: 'SR กำลังหาราคา',
  awaiting_sales_ack: 'รอ Sales รับทราบราคา',
  closed: 'ปิดงาน',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก'
};

const OPEN_STATUSES = ['requested', 'on_process', 'completed'];
const VAT_TERMS = ['ex_vat', 'no_vat', 'include_vat'];
const VAT_TERM_LABEL = { ex_vat: 'Ex VAT', no_vat: 'No VAT', include_vat: 'Include VAT' };
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
/** Delivery terms on a vendor quotation (food imports are usually CIF / CFR; local suppliers deliver). */
const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'DELIVERED'];
const INCOTERM_LABEL = { EXW: 'EXW', FCA: 'FCA', FOB: 'FOB', CFR: 'CFR (C&F)', CIF: 'CIF', DAP: 'DAP', DDP: 'DDP', DELIVERED: 'ส่งถึงคลัง MGS' };
const ATTACHMENT_CATEGORIES = ['request', 'info_response', 'quotation', 'other'];

/** Default rows for the Settings tab (value column stores JSON text). */
const DEFAULT_SETTINGS = [
  ['vat_rate', '0.07', 'อัตรา VAT (0.07 = 7%) — snapshot ลงแต่ละใบเสนอราคาตอนบันทึก'],
  ['sla_hours', JSON.stringify({
    pending_manager: 24, returned: 48, pending_gm: 24, pending_assign: 8,
    doc_check: 16, need_info: 48, sourcing: 72, awaiting_sales_ack: 48
  }), 'SLA เป็นชั่วโมงปฏิทินของแต่ละ stage'],
  ['sla_warning_ratio', '0.8', 'เตือนเมื่อใช้เวลาเกินสัดส่วนนี้ของ SLA'],
  ['currencies', JSON.stringify(['THB', 'USD', 'CNY', 'EUR', 'JPY', 'SGD']), 'สกุลเงินใน dropdown'],
  ['max_upload_mb', '20', 'ขนาดไฟล์แนบสูงสุดต่อไฟล์ (MB)'],
  ['allowed_mime_types', JSON.stringify([
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'
  ]), 'ชนิดไฟล์ที่อนุญาต']
];
