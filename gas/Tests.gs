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
  const tmp = SpreadsheetApp.create('MGS Price Request — TEST ' + fmtDate_(new Date(), 'yyyy-MM-dd HH:mm:ss'));
  try {
    useDatabase_(tmp);
    setupSchema_(tmp, { protect: false });
    withLock_(function () { seedMaster_(); seedUsers_(); });
    runCases_(results);
    runPhase2Cases_(results);
    runPhase3Cases_(results);
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
      return must(createTicket({ client_key: 'ac1', title: 'หมึกกล้วยแช่แข็ง',
        items: [{ product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', qty: 100, uom: 'กก.' }] })).ticket;
    });
    ok(/^PR-\d{4}-\d{4,}$/.test(food1Ticket.ticket_no), 'Ticket number format PR-YYYY-NNNN: ' + food1Ticket.ticket_no);
    ok(food1Ticket.status === 'requested' && food1Ticket.stage === 'pending_manager', 'New ticket = Requested / pending_manager');

    const dup = as(U.salesFood1, function () {
      return must(createTicket({ client_key: 'ac1', title: 'หมึกกล้วยแช่แข็ง',
        items: [{ product_group_code: 'FOOD-CEPHALOPOD', product_name: 'หมึกกล้วย IQF', qty: 100, uom: 'กก.' }] }));
    });
    ok(dup.duplicate === true && dup.ticket.ticket_id === food1Ticket.ticket_id, 'Double submit (same client_key) → one ticket only');

    ok(as(U.salesFood1, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'AC-1 Owner sees own ticket');
    expectErr(as(U.salesFood2, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'AC-1 Other Sales cannot open the ticket (direct API call)');
    expectErr(as(U.mgrOthers, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'Manager of another department cannot open it');
    expectErr(as(U.sr1, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'SR cannot open a ticket before GM approval');
    ok(as(U.mgrFood, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'Department manager sees it');
    ok(as(U.gm, function () { return getTicket(food1Ticket.ticket_id).ok; }), 'GM sees it');
    expectErr(as('stranger@' + DEMO_DOMAIN, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_REGISTERED', 'Unregistered account is rejected');
    expectErr(as(U.salesFood2, function () {
      return createTicket({ title: 'x', items: [] });
    }), 'VALIDATION', 'Title shorter than 3 chars rejected');
    expectErr(as(U.salesFood2, function () {
      return createTicket({ title: 'ทดสอบจำนวน', items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 'abc', uom: 'กก.' }] });
    }), 'VALIDATION', 'Qty "abc" rejected (no silent 0)');
    expectErr(as(U.gm, function () {
      return createTicket({ title: 'GM สร้างใบ', items: [{ product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้ง', qty: 1, uom: 'กก.' }] });
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
    const t0 = as(U.salesOthers, function () {
      return must(createTicket({ client_key: 'flow', title: 'ทดสอบเครื่องซีลสุญญากาศ + กุ้งขาว', items: [
        { product_group_code: 'OTHERS-PACKAGING', product_name: 'เครื่องซีลสุญญากาศ', qty: 2, uom: 'เครื่อง' },
        { product_group_code: 'FOOD-SHRIMP', product_name: 'กุ้งขาว HLSO 31/40', qty: 500, uom: 'กก.' }] })).ticket;
    });
    const id = t0.ticket_id;

    ok(must(go(U.mgrOthers, id, 'manager_return', 'กรุณาระบุรุ่น')).ticket.stage === 'returned', 'Manager return → returned');
    const item1 = activeItemsOf_(id)[0];
    as(U.salesOthers, function () {
      must(saveItem(id, Object.assign({}, item1, { spec: 'รุ่น DZ-400 ห้องซีล 40 ซม.' }), ver(id)), 'saveItem');
    });
    ok(activeItemsOf_(id)[0].spec === 'รุ่น DZ-400 ห้องซีล 40 ซม.', 'Sales edits item while returned');
    ok(must(go(U.salesOthers, id, 'resubmit')).ticket.stage === 'pending_manager', 'Resubmit → pending_manager');
    ok(must(go(U.mgrOthers, id, 'manager_approve')).ticket.stage === 'pending_gm', 'Manager approve → pending_gm');
    expectErr(as(U.salesOthers, function () {
      return saveItem(id, Object.assign({}, item1, { qty: 99 }), ver(id));
    }), 'FORBIDDEN', 'Sales cannot edit items after Manager approval');

    const g = must(go(U.gm, id, 'gm_approve')).ticket;
    ok(g.status === 'on_process' && g.stage === 'pending_assign', 'GM approve → On Process / pending_assign');
    expectErr(go(U.salesOthers, id, 'cancel'), 'INVALID_STATE', 'Sales cannot cancel after GM approval');
    expectErr(go(U.sr2, id, 'assign', '', { sr_email: U.sr1 }), 'FORBIDDEN', 'Normal SR cannot assign');

    const c = must(go(U.sr1, id, 'claim')).ticket;
    ok(c.stage === 'doc_check' && c.sr_email === U.sr1 && !!c.assigned_at, 'SR claim → doc_check, sr + time recorded');
    ok(checklistOf_(id).length === 10, 'Checklist built from Food + Shrimp + Others + Packaging templates (10 rows)');
    expectErr(go(U.sr2, id, 'claim'), 'ALREADY_CLAIMED', 'Second SR cannot claim the same job');
    expectErr(go(U.sr1, id, 'doc_complete'), 'CHECKLIST_INCOMPLETE', 'Cannot finish doc check with unticked items');

    const items = activeItemsOf_(id);
    expectErr(as(U.sr1, function () {
      return saveQuotation({ item_id: items[0].item_id, vendor_name: 'X', unit_price: 1, vat_term: 'ex_vat' });
    }), 'FORBIDDEN', 'Cannot enter prices before documents are checked');

    const ri = must(go(U.sr1, id, 'request_info', 'ขอรูปตัวอย่างสินค้า', { missing_items: ['sample_photo'] })).ticket;
    ok(ri.stage === 'need_info' && ri.info_request.return_stage === 'doc_check', 'SR request_info → need_info');
    const rs = must(go(U.salesOthers, id, 'respond_info', 'แนบรูปแล้ว')).ticket;
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

    expectErr(saveQ({ item_id: items[0].item_id, vendor_name: 'Vendor D', unit_price: 1, vat_term: 'ex_vat' }),
      'MAX_VENDORS', 'AC-3 4th vendor on the same item rejected');
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

    const salesView = as(U.salesOthers, function () { return must(getTicket(id)); });
    ok(salesView.items.every(function (it) { return it.quotations.length === 0; }), 'Sales cannot see draft quotations');

    const sub = must(go(U.sr1, id, 'submit_quote')).ticket;
    ok(sub.status === 'completed' && sub.stage === 'awaiting_sales_ack', 'submit_quote → Completed / awaiting_sales_ack');
    expectErr(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 1, vat_term: 'ex_vat' }),
      'FORBIDDEN', 'SR cannot edit prices after submission');
    const salesView2 = as(U.salesOthers, function () { return must(getTicket(id)); });
    ok(salesView2.items[0].quotations.length === 3 && salesView2.items[1].quotations.length === 1, 'Sales sees quotations after submission');

    expectErr(go(U.salesOthers, id, 'request_revision'), 'COMMENT_REQUIRED', 'Revision needs a comment');
    const rev = must(go(U.salesOthers, id, 'request_revision', 'ลูกค้าต่อราคา')).ticket;
    ok(rev.stage === 'sourcing' && rev.revision_count === 1, 'request_revision → sourcing, revision_count = 1');
    must(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 48500, currency: 'THB', vat_term: 'ex_vat', valid_until: inDays(30) }));
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) {
      const m = parseJson_(l.metadata_json, {});
      return l.action === 'quotation_updated' && m.diff && m.diff.unit_price &&
        Number(m.diff.unit_price.old) === 50000 && Number(m.diff.unit_price['new']) === 48500;
    }), 'Price change logged with old → new diff');
    as(U.sr1, function () { must(selectQuotation(qA.quote_id, '')); });
    must(go(U.sr1, id, 'submit_quote'));
    const closed = must(go(U.salesOthers, id, 'accept', 'ตกลง')).ticket;
    ok(closed.status === 'closed' && !!closed.closed_at, 'accept → Closed');

    // ---- AC-4 logs
    const logs = transitionLogs(id);
    ok(logs.length === 13, 'AC-4 13 transitions → 13 transition log rows (got ' + logs.length + ')');
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
        return must(createTicket({ client_key: 'num-' + i, title: 'เลขที่ใบทดสอบ ' + i,
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
    ok(n.some(function (r) { return r.user_email === U.mgrOthers && r.type === 'approval_required'; }), 'Manager notified of new ticket');
    ok(n.some(function (r) { return r.user_email === U.salesOthers && r.type === 'quote_ready'; }), 'Sales notified when prices are ready');
  });
}

// =============================================================================
// Phase 2 — list / inbox / dashboard / notifications / upload / Lark / SLA
// =============================================================================

/** Fake UrlFetchApp: Drive resumable upload + permissions, Lark auth / user ids / messages. */
function fakeHttp_() {
  const calls = [];
  const resp = function (code, body, headers) {
    return {
      getResponseCode: function () { return code; },
      getContentText: function () { return typeof body === 'string' ? body : JSON.stringify(body); },
      getAllHeaders: function () { return headers || {}; }
    };
  };
  return {
    calls: calls,
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
        return Number(m[2]) + 1 < Number(m[3]) ? resp(308, '') : resp(200, { id: 'drive-file-' + calls.length });
      }
      if (url.indexOf('/drive/v3/files/') !== -1 && url.indexOf('/permissions') !== -1) return resp(200, { id: 'perm' });
      if (url.indexOf('/auth/v3/tenant_access_token') !== -1) return resp(200, { code: 0, tenant_access_token: 'tok' });
      if (url.indexOf('/contact/v3/users/batch_get_id') !== -1) {
        const self = this;
        return resp(200, { code: 0, data: { user_list: payload.emails.filter(function (e) { return !self.unknownEmails[e]; })
          .map(function (e) { return { email: e, user_id: 'ou_' + e.split('@')[0] }; }) } });
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
    ok(!g.menu.some(function (m) { return m.key === 'new'; }) && g.menu.some(function (m) { return m.key === 'all'; }), 'Bootstrap: GM menu has no create, has all tickets');
    ok(b.ref.product_groups.length === 8 && b.ref.vat_rate === 0.07, 'Bootstrap: reference data (product groups, VAT rate)');
    expectErr(as('nobody@' + DEMO_DOMAIN, function () { return getBootstrap(); }), 'NOT_REGISTERED', 'Bootstrap: unregistered user gets NOT_REGISTERED');
  });

  wrap('LIST', function () {
    const total = rows_(TAB.TICKETS).length;
    const gm = as(U.gm, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(gm.total === total, 'GM list shows every ticket (' + total + ')');
    const s2 = as(U.salesFood2, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(s2.total > 0 && s2.rows.every(function (r) { return r.requestor_email === U.salesFood2; }), 'AC-1 Sales list contains only own tickets (even with scope=all)');
    const solarMgr = as(U.mgrOthers, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(solarMgr.rows.every(function (r) { return r.department_code === 'SALES-OTHERS'; }), 'Manager list limited to own department');
    const sr = as(U.sr2, function () { return must(listTickets({ scope: 'all', page_size: 200 })); });
    ok(sr.rows.every(function (r) { return ['pending_manager', 'pending_gm', 'returned', 'cancelled'].indexOf(r.stage) === -1; }), 'SR list hides tickets not yet approved by GM');
    const inbox = as(U.mgrFood, function () { return must(listTickets({ scope: 'inbox', page_size: 200 })); });
    ok(inbox.total > 0 && inbox.rows.every(function (r) { return r.stage === 'pending_manager' && r.department_code === 'SALES-FOOD'; }),
      'Manager inbox = pending_manager tickets of own department (' + inbox.total + ')');
    const first = gm.rows[gm.rows.length - 1];
    const byNo = as(U.gm, function () { return must(listTickets({ q: first.ticket_no })); });
    ok(byNo.total === 1 && byNo.rows[0].ticket_no === first.ticket_no, 'Search by ticket number');
    const solar = as(U.gm, function () { return must(listTickets({ group_code: 'OTHERS', page_size: 200 })); });
    ok(solar.total >= 1 && solar.rows.every(function (r) { return r.root_codes.indexOf('OTHERS') !== -1; }), 'Filter by parent product group (Others)');
    const closed = as(U.gm, function () { return must(listTickets({ status: ['closed'] })); });
    ok(closed.rows.every(function (r) { return r.status === 'closed'; }), 'Filter by status');
    ok(gm.rows.every(function (r) { return ['ok', 'warning', 'breach', 'none', 'done'].indexOf(r.sla_status) !== -1 && r.age_days >= 0; }), 'Every row has aging + SLA status');
    const page2 = as(U.gm, function () { return must(listTickets({ page_size: 10, page: 2 })); });
    ok(page2.rows.length === Math.min(10, Math.max(total - 10, 0)) && page2.page === 2, 'Pagination');
  });

  wrap('DASHBOARD', function () {
    const d = as(U.gm, function () { return must(getDashboard({})); });
    const openCount = rows_(TAB.TICKETS).filter(function (r) { return OPEN_STATUSES.indexOf(r.status) !== -1; }).length;
    ok(d.kpi.open === openCount, 'Dashboard KPI open = ' + openCount);
    ok(d.aging.length === 4 && d.aging.reduce(function (a, b) { return a + b.count; }, 0) === openCount, 'Aging buckets add up to open tickets');
    ok(d.cycle_time.length > 0 && d.cycle_time.every(function (c) { return c.avg_hours >= 0 && c.count > 0; }), 'Cycle time per stage computed from logs');
    ok(d.top_vendors.length > 0 && d.top_vendors[0].wins >= 1, 'Top winning vendors');
    ok(d.group_share.some(function (g) { return g.code === 'OTHERS'; }), 'Product group share by parent group');
    ok(d.sr_workload.length === 3, 'SR workload lists 3 SRs');
    const s = as(U.salesFood2, function () { return must(getDashboard({})); });
    ok(s.by_sales.length === 1 && s.by_sales[0].email === U.salesFood2, 'Sales dashboard counts only own tickets');
    expectErr(as(U.gm, function () { return getDashboard({ from: '2026-12-31', to: '2026-01-01' }); }), 'VALIDATION', 'Dashboard rejects reversed date range');
  });

  wrap('NOTIFICATIONS', function () {
    const before = as(U.salesOthers, function () { return must(getNotifications(50)); });
    ok(before.unread > 0, 'Sales has unread notifications (' + before.unread + ')');
    const otherBefore = as(U.mgrOthers, function () { return must(getPoll()).unread; });
    as(U.salesOthers, function () { must(markNotificationsRead(null)); });
    ok(as(U.salesOthers, function () { return must(getPoll()).unread; }) === 0, 'Mark all read → unread 0');
    ok(as(U.mgrOthers, function () { return must(getPoll()).unread; }) === otherBefore, "Other users' notifications untouched");
  });

  wrap('UPLOAD', function () {
    const http = fakeHttp_();
    const drive = fakeDrive_();
    TEST_HTTP_ = http;
    TEST_DRIVE_ = drive;
    const t = as(U.salesFood2, function () {
      return must(createTicket({ client_key: 'upl', title: 'ทดสอบแนบไฟล์',
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
      return must(createTicket({ client_key: 'p3', title: 'ทดสอบหน้าเสนอราคา', items: [
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
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a, b, q({ vendor_name: 'C', unit_price: 1 }), q({ vendor_name: 'D', unit_price: 1 })] }]),
      'MAX_VENDORS', 'AC-3 4 vendors in a draft rejected');
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
    ok(must(go(U.sr1, id, 'submit_quote')).ticket.stage === 'awaiting_sales_ack', 'Submit after draft → awaiting_sales_ack');
    expectErr(draft([{ item_id: items[0].item_id, quotes: [a] }]), 'FORBIDDEN', 'Draft locked after submission');
    const sales = as(U.salesFood2, function () { return must(getTicket(id)); });
    const win = sales.items[0].quotations.filter(function (x) { return x.is_selected; })[0];
    ok(win.incoterm === 'CIF' && win.selection_reason === 'ลูกค้ากำหนด Origin เวียดนาม' && sales.items[0].quotations.length === 2,
      'Sales sees food fields + reason after submission');
  });
}
