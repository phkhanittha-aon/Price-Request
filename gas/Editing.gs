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
  if (!canEditItem_(u, t, item)) throw appError_('FORBIDDEN', 'รายการนี้เป็นงานของ SR คนอื่น หรือส่งราคาไปแล้ว — แก้ได้เฉพาะ SR เจ้าของรายการ (ก่อนส่งราคา) หรือผู้อนุมัติขั้นปัจจุบัน');
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
  if (!canEditItem_(u, t, findOne_(TAB.ITEMS, 'item_id', q.item_id) || {})) throw appError_('FORBIDDEN', 'รายการนี้เป็นงานของ SR คนอื่น หรือส่งราคาไปแล้ว — แก้ได้เฉพาะ SR เจ้าของรายการ (ก่อนส่งราคา) หรือผู้อนุมัติขั้นปัจจุบัน');
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
  if (!canEditItem_(u, t, findOne_(TAB.ITEMS, 'item_id', q.item_id) || {})) throw appError_('FORBIDDEN', 'รายการนี้เป็นงานของ SR คนอื่น หรือส่งราคาไปแล้ว — แก้ได้เฉพาะ SR เจ้าของรายการ (ก่อนส่งราคา) หรือผู้อนุมัติขั้นปัจจุบัน');
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
        if (!canEditItem_(u, t, it)) throw appError_('FORBIDDEN', 'รายการที่ ' + it.line_no + ': เป็นงานของ SR คนอื่น หรือส่งราคาไปแล้ว', { line_no: it.line_no });
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
      const own = findOne_(TAB.ITEMS, 'item_id', cleanText_(itemId, 64));
      if (!((u.role === 'admin' || (u.role === 'sr' && own && itemOwner_(t, own) === u.email && !own.sr_submitted_at)) && (t.stage === 'sourcing' || t.stage === 'doc_check'))) {
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
        enqueueNotifications_([t.requestor_email].concat(t.srs).concat(activeUsersByRole_('sr_manager').map(function (x) { return x.email; })), followUp,
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
    // the SR of that item continues it
    sr_email: itemOwner_(t, it) || t.sr_email, sr_emails: itemOwner_(t, it) || t.sr_email,
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
    deal_stage: '', deal_next_step: '', sr_email: itemOwner_(t, it) || t.sr_email, sr_submitted_at: '' });
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
