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
