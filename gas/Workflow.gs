/**
 * File: Workflow.gs
 * Ticket creation and the state machine.
 *
 * transitionTicket() is the ONLY function that changes status / stage / assignee.
 * No other code path writes those columns, and staff have no access to the sheet.
 *
 * Actions (role → from stage → to stage):
 *   resubmit          sales (owner)    returned                              → pending_manager
 *   cancel            sales (owner)    pending_manager | returned | pending_gm → cancelled
 *   manager_approve   manager (dept)   pending_manager                       → pending_gm
 *   manager_reject    manager (dept)   pending_manager                       → rejected     (comment required)
 *   manager_return    manager (dept)   pending_manager                       → returned     (comment required)
 *   gm_approve        gm               pending_gm                            → pending_assign
 *   gm_reject         gm               pending_gm                            → rejected     (comment required)
 *   claim             sr               pending_assign                        → doc_check
 *   assign            sr lead | admin  pending_assign | doc_check | need_info | sourcing → doc_check | same
 *   request_info      sr (assigned)    doc_check | sourcing                  → need_info    (comment required)
 *   respond_info      sales (owner)    need_info                             → stage SR asked from (comment required)
 *   doc_complete      sr (assigned)    doc_check                             → sourcing (required checklist ticked)
 *   submit_quote      sr (assigned)    sourcing                              → awaiting_sales_ack
 *   accept            sales (owner)    awaiting_sales_ack                    → closed
 *   request_revision  sales (owner)    awaiting_sales_ack                    → sourcing     (comment required)
 */

const TRANSITION_ACTIONS = ['resubmit', 'cancel', 'manager_approve', 'manager_reject', 'manager_return',
  'gm_approve', 'gm_reject', 'claim', 'assign', 'request_info', 'respond_info', 'doc_complete',
  'submit_quote', 'accept', 'request_revision'];

const ACTION_LABEL_TH = {
  create: 'สร้างใบขอราคา', resubmit: 'ส่งใบขอราคาอีกครั้ง', cancel: 'ยกเลิกใบขอราคา',
  manager_approve: 'Manager อนุมัติ', manager_reject: 'Manager ไม่อนุมัติ', manager_return: 'Manager ส่งกลับแก้ไข',
  gm_approve: 'GM อนุมัติ', gm_reject: 'GM ไม่อนุมัติ', claim: 'SR รับงาน', assign: 'มอบหมายงาน SR',
  request_info: 'SR ขอข้อมูลเพิ่ม', respond_info: 'Sales ส่งข้อมูลเพิ่ม', doc_complete: 'SR ตรวจเอกสารครบ',
  submit_quote: 'SR ส่งราคา', accept: 'Sales รับทราบราคา / ปิดงาน', request_revision: 'Sales ขอให้ปรับราคา'
};

// =============================================================================
// createTicket — public API
// payload: { client_key, title, description?, customer_name?, priority?, due_date? (yyyy-MM-dd),
//            items: [{ item_id?, product_group_code, product_name, spec?, description?, qty, uom,
//                      target_price?, target_currency? }] }
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
      if (!dept || !dept.is_active || !dept.manager_email) {
        throw appError_('NO_MANAGER', 'แผนกของคุณยังไม่ได้กำหนด Manager ผู้อนุมัติ กรุณาติดต่อผู้ดูแลระบบ');
      }

      const title = requireText_(p.title, 'ชื่อใบขอราคา', 200);
      if (title.length < 3) throw appError_('VALIDATION', 'ชื่อใบขอราคาต้องมีอย่างน้อย 3 ตัวอักษร');
      const priority = p.priority ? oneOf_(p.priority, PRIORITIES, 'ความเร่งด่วน') : 'normal';
      const dueDate = parseYmd_(p.due_date, 'วันที่ต้องการราคา', true);

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

      const year = fmtDate_(now, 'yyyy');
      const no = nextCounter_('ticket_no_' + year);
      const ticket = {
        ticket_id: ticketId,
        ticket_no: 'PR-' + year + '-' + ('000' + no).slice(-Math.max(4, String(no).length)),
        title: title,
        description: cleanText_(p.description, CFG.MAX_TEXT),
        customer_name: cleanText_(p.customer_name, 200),
        priority: priority,
        status: 'requested',
        stage: 'pending_manager',
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
        to_status: 'requested', to_stage: 'pending_manager',
        metadata: { ticket_no: ticket.ticket_no, item_count: cleanItems.length }
      });

      const t = normTicket_(ticket);
      enqueueNotifications_(stageAssignees_(t), t, 'approval_required',
        '[' + t.ticket_no + '] ใบขอราคาใหม่รออนุมัติ', t.title + ' — ' + u.full_name, ticketLink_(t));
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
      if (!d || !d.manager_email) throw appError_('NO_MANAGER', 'แผนกของคุณยังไม่ได้กำหนด Manager ผู้อนุมัติ');
      patch.manager_email = d.manager_email;
      patch.stage = 'pending_manager';
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
      if (u.role !== 'manager') forbid('เฉพาะ Manager เท่านั้นที่ทำรายการนี้ได้');
      const d = departmentByCode_(t.department_code);
      if (!d || d.manager_email !== u.email) forbid('คุณไม่ใช่ Manager ของแผนกผู้ขอราคา');
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
        patch.stage = 'pending_assign';
        patch.gm_approved_at = now;
        notifyType = 'job_available';
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
      break;
    }
    case 'assign': {
      if (!(u.role === 'admin' || (u.role === 'sr' && u.is_sr_lead))) {
        forbid('เฉพาะ SR Lead หรือ Admin เท่านั้นที่มอบหมายงานได้');
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
      const back = t.info_request && t.info_request.return_stage === 'sourcing' ? 'sourcing' : 'doc_check';
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
      patch.stage = 'awaiting_sales_ack';
      patch.completed_at = now;
      notifyType = 'quote_ready';
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

  if (t.stage === 'pending_assign' && saved.stage === 'doc_check') {
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
  const page = saved.status === 'on_process' && saved.stage !== 'need_info' ? 'pricing' : 'ticket';
  enqueueNotifications_(recipients, saved, notifyType,
    '[' + saved.ticket_no + '] ' + STAGE_LABEL_TH[saved.stage],
    ACTION_LABEL_TH[action] + ' โดย ' + u.full_name + ' — ' + saved.title + (note ? '\n' + note : ''),
    ticketLink_(saved, page));

  return { ticket: publicTicket_(saved) };
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
  let grand = 0;
  items.forEach(function (it) {
    const quotes = activeQuotesOfItem_(it.item_id);
    if (!quotes.length) { noQuote.push(it.line_no); return; }
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
    winners.push({ item_id: it.item_id, line_no: it.line_no, quote_id: win.quote_id, vendor_name: win.vendor_name,
      net_unit_cost_thb: win.net_unit_cost_thb, total_cost_thb: win.total_cost_thb });
  });
  if (noQuote.length) throw appError_('MISSING_QUOTATION', 'รายการที่ยังไม่มีราคา vendor: ลำดับที่ ' + noQuote.join(', '), { lines: noQuote });
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
    const t = ticketForUser_(u, ticketId);
    const showQuotes = canViewQuotes_(u, t);
    const items = activeItemsOf_(t.ticket_id).map(function (it) {
      const out = Object.assign({}, it);
      out.product_group_name = groupName_(it.product_group_code);
      out.quotations = showQuotes ? compareQuotes_(it.qty, activeQuotesOfItem_(it.item_id)) : [];
      return out;
    });
    const attachments = findAll_(TAB.ATTACHMENTS, 'ticket_id', t.ticket_id)
      .filter(function (a) { return !toBool_(a.is_deleted); })
      .filter(function (a) { return a.category !== 'quotation' || showQuotes; })
      .map(function (a) {
        return {
          attachment_id: String(a.attachment_id), item_id: String(a.item_id || ''), quote_id: String(a.quote_id || ''),
          category: String(a.category), file_name: String(a.file_name), drive_file_id: String(a.drive_file_id),
          mime_type: String(a.mime_type || ''), size_bytes: Number(a.size_bytes || 0),
          uploaded_by: String(a.uploaded_by), uploaded_at: isoOrBlank_(a.uploaded_at)
        };
      });
    return {
      ticket: publicTicket_(t),
      items: items,
      checklist: checklistOf_(t.ticket_id),
      attachments: attachments,
      timeline: timelineOf_(t.ticket_id),
      permissions: {
        can_edit_request: canEditRequest_(u, t),
        can_edit_quotes: canEditQuotes_(u, t),
        can_edit_checklist: canEditChecklist_(u, t),
        can_upload: canUpload_(u, t),
        can_view_quotes: showQuotes,
        actions: allowedActions_(u, t)
      },
      me: { email: u.email, full_name: u.full_name, role: u.role, is_sr_lead: u.is_sr_lead },
      vat_rate: vatRate_(),
      app_version: APP_VERSION
    };
  });
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
  if (u.role === 'gm' && t.stage === 'pending_gm' && t.manager_email !== u.email) a.push('gm_approve', 'gm_reject');
  if (u.role === 'sr' && t.stage === 'pending_assign') a.push('claim');
  if ((u.role === 'admin' || (u.role === 'sr' && u.is_sr_lead)) &&
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

/** Validate one item from the browser. Returns clean fields (no ids). */
function validateItem_(raw, groups, lineNo) {
  const r = raw || {};
  const prefix = 'รายการที่ ' + lineNo + ': ';
  const code = cleanText_(r.product_group_code, 50);
  if (!groups[code]) throw appError_('INVALID_PRODUCT_GROUP', prefix + 'กลุ่มสินค้าไม่ถูกต้องหรือถูกปิดใช้งาน');
  try {
    return {
      product_group_code: code,
      product_name: requireText_(r.product_name, 'ชื่อสินค้า', 300),
      spec: cleanText_(r.spec, CFG.MAX_TEXT),
      description: cleanText_(r.description, CFG.MAX_TEXT),
      qty: toNumber_(r.qty, 'จำนวน', { gt: 0 }),
      uom: requireText_(r.uom, 'หน่วย', 30),
      target_price: toNumber_(r.target_price, 'ราคาเป้าหมาย', { allowBlank: true, min: 0 }),
      target_currency: r.target_currency ? oneOf_(r.target_currency, setting_('currencies', ['THB']), 'สกุลเงิน') : 'THB'
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
        target_price: r.target_price === '' ? null : Number(r.target_price),
        target_currency: String(r.target_currency || 'THB')
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
