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
  } catch (e) {
    results.push('FAIL: test run aborted — ' + (e && e.message) + '\n' + (e && e.stack));
  } finally {
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
    expectErr(as(U.mgrSolar, function () { return getTicket(food1Ticket.ticket_id); }), 'NOT_FOUND', 'Manager of another department cannot open it');
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
    const t0 = as(U.salesSolar, function () {
      return must(createTicket({ client_key: 'flow', title: 'ทดสอบ Inverter 50kW + สายไฟ', items: [
        { product_group_code: 'SOLAR-INVERTER', product_name: 'Inverter 50kW', qty: 2, uom: 'เครื่อง' },
        { product_group_code: 'SOLAR-CABLE', product_name: 'PV1-F 6 sq.mm', qty: 500, uom: 'เมตร' }] })).ticket;
    });
    const id = t0.ticket_id;

    ok(must(go(U.mgrSolar, id, 'manager_return', 'กรุณาระบุรุ่น')).ticket.stage === 'returned', 'Manager return → returned');
    const item1 = activeItemsOf_(id)[0];
    as(U.salesSolar, function () {
      must(saveItem(id, Object.assign({}, item1, { spec: 'Sungrow SG50CX' }), ver(id)), 'saveItem');
    });
    ok(activeItemsOf_(id)[0].spec === 'Sungrow SG50CX', 'Sales edits item while returned');
    ok(must(go(U.salesSolar, id, 'resubmit')).ticket.stage === 'pending_manager', 'Resubmit → pending_manager');
    ok(must(go(U.mgrSolar, id, 'manager_approve')).ticket.stage === 'pending_gm', 'Manager approve → pending_gm');
    expectErr(as(U.salesSolar, function () {
      return saveItem(id, Object.assign({}, item1, { qty: 99 }), ver(id));
    }), 'FORBIDDEN', 'Sales cannot edit items after Manager approval');

    const g = must(go(U.gm, id, 'gm_approve')).ticket;
    ok(g.status === 'on_process' && g.stage === 'pending_assign', 'GM approve → On Process / pending_assign');
    expectErr(go(U.salesSolar, id, 'cancel'), 'INVALID_STATE', 'Sales cannot cancel after GM approval');
    expectErr(go(U.sr2, id, 'assign', '', { sr_email: U.sr1 }), 'FORBIDDEN', 'Normal SR cannot assign');

    const c = must(go(U.sr1, id, 'claim')).ticket;
    ok(c.stage === 'doc_check' && c.sr_email === U.sr1 && !!c.assigned_at, 'SR claim → doc_check, sr + time recorded');
    ok(checklistOf_(id).length === 6, 'Checklist built from Solar + Inverter + Cable templates (6 rows)');
    expectErr(go(U.sr2, id, 'claim'), 'ALREADY_CLAIMED', 'Second SR cannot claim the same job');
    expectErr(go(U.sr1, id, 'doc_complete'), 'CHECKLIST_INCOMPLETE', 'Cannot finish doc check with unticked items');

    const items = activeItemsOf_(id);
    expectErr(as(U.sr1, function () {
      return saveQuotation({ item_id: items[0].item_id, vendor_name: 'X', unit_price: 1, vat_term: 'ex_vat' });
    }), 'FORBIDDEN', 'Cannot enter prices before documents are checked');

    const ri = must(go(U.sr1, id, 'request_info', 'ขอ datasheet', { missing_items: ['datasheet'] })).ticket;
    ok(ri.stage === 'need_info' && ri.info_request.return_stage === 'doc_check', 'SR request_info → need_info');
    const rs = must(go(U.salesSolar, id, 'respond_info', 'แนบ datasheet แล้ว')).ticket;
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

    const salesView = as(U.salesSolar, function () { return must(getTicket(id)); });
    ok(salesView.items.every(function (it) { return it.quotations.length === 0; }), 'Sales cannot see draft quotations');

    const sub = must(go(U.sr1, id, 'submit_quote')).ticket;
    ok(sub.status === 'completed' && sub.stage === 'awaiting_sales_ack', 'submit_quote → Completed / awaiting_sales_ack');
    expectErr(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 1, vat_term: 'ex_vat' }),
      'FORBIDDEN', 'SR cannot edit prices after submission');
    const salesView2 = as(U.salesSolar, function () { return must(getTicket(id)); });
    ok(salesView2.items[0].quotations.length === 3 && salesView2.items[1].quotations.length === 1, 'Sales sees quotations after submission');

    expectErr(go(U.salesSolar, id, 'request_revision'), 'COMMENT_REQUIRED', 'Revision needs a comment');
    const rev = must(go(U.salesSolar, id, 'request_revision', 'ลูกค้าต่อราคา')).ticket;
    ok(rev.stage === 'sourcing' && rev.revision_count === 1, 'request_revision → sourcing, revision_count = 1');
    must(saveQ({ quote_id: qA.quote_id, item_id: items[0].item_id, vendor_name: 'Vendor A', unit_price: 48500, currency: 'THB', vat_term: 'ex_vat', valid_until: inDays(30) }));
    ok(findAll_(TAB.LOGS, 'ticket_id', id).some(function (l) {
      const m = parseJson_(l.metadata_json, {});
      return l.action === 'quotation_updated' && m.diff && m.diff.unit_price &&
        Number(m.diff.unit_price.old) === 50000 && Number(m.diff.unit_price['new']) === 48500;
    }), 'Price change logged with old → new diff');
    as(U.sr1, function () { must(selectQuotation(qA.quote_id, '')); });
    must(go(U.sr1, id, 'submit_quote'));
    const closed = must(go(U.salesSolar, id, 'accept', 'ตกลง')).ticket;
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
    ok(n.some(function (r) { return r.user_email === U.mgrSolar && r.type === 'approval_required'; }), 'Manager notified of new ticket');
    ok(n.some(function (r) { return r.user_email === U.salesSolar && r.type === 'quote_ready'; }), 'Sales notified when prices are ready');
  });
}
