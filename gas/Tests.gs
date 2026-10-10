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
    runAdminCases_(results);
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
      const maxM = k === 'admin' ? 7 : 5;   // Admin can act for everyone → a few more entries
      ok(menu.length <= maxM && menu[0].key === 'home' && menu.some(function (m) { return m.key === 'tickets'; }), 'Menu for ' + k + ': ' + menu.length + ' items (≤ ' + maxM + '), homepage first');
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
      expectErr(go(U.mgrFood, id, 'gm_approve', '', { sr_email: U.sr1 }), 'FORBIDDEN', 'FPR: Sales Manager cannot approve GM_REVIEW');
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
      const own = newReq(U.salesFood2, 'ลูกค้าเจ้าของคำขอ');
      const sub = botLog_(own.ticket_id, 'submitted')[0].summary;
      ok(/👤 เจ้าของคำขอ: <at email=sales\.food2@/.test(sub) && /ผู้ต้องดำเนินการ: <at email=gm@/.test(sub), 'Owner tag: every card tags the requester as owner + who must act');
      must(go(U.gm, own.ticket_id, 'gm_return', 'ขอรายละเอียดเพิ่ม'));
      const ret = botLog_(own.ticket_id, 'returned')[0].summary;
      ok((ret.match(/<at email=sales\.food2@/g) || []).length === 1 && /ผู้ต้องดำเนินการ: เจ้าของคำขอ/.test(ret), 'Owner tag: requester tagged once when they are also the one to act');
      withLock_(function () { updateRow_(TAB.TICKETS, own.ticket_id, { stage_entered_at: new Date(Date.now() - 20 * 86400000), last_reminded_at: '' }); });
      must(go(U.salesFood2, own.ticket_id, 'resubmit'));
      withLock_(function () { updateRow_(TAB.TICKETS, own.ticket_id, { stage_entered_at: new Date(Date.now() - 20 * 86400000), last_reminded_at: '' }); });
      as(U.admin, function () { return sendSlaReminders(); });
      const rm = botLog_(own.ticket_id).filter(function (n) { return n.bot === 'FPR Reminder'; }).pop();
      ok(rm && /เจ้าของคำขอ: <at email=sales\.food2@/.test(rm.summary), 'Owner tag: SLA reminder tags the owner too');
      setTestSettings_({ fpr_mention_owner: 'false' });
      const off = newReq(U.salesFood2, 'ลูกค้าปิดแท็ก');
      ok(!/เจ้าของคำขอ/.test(botLog_(off.ticket_id, 'submitted')[0].summary), 'Owner tag: Settings fpr_mention_owner=false turns it off');
      setTestSettings_({ fpr_mention_owner: 'true' });
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

// ===================================================================== Admin: every step, delete / restore, bot settings
function runAdminCases_(results) {
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
  const A = function (fn) { return as(U.admin, fn); };
  const go = function (email, id, action, comment, extra) {
    return as(email, function () { return transitionTicket(id, action, comment || '', Object.assign({ expected_version: ticketById_(id).version }, extra || {})); });
  };
  const inDays = function (n) { return fmtDate_(new Date(Date.now() + n * 86400000)); };
  const wrap = function (name, fn) {
    try { fn(); } catch (e) { results.push(String(e.message).indexOf('FAIL:') === 0 ? e.message : 'FAIL: ' + name + ' — ' + e.message + '\n' + e.stack); }
  };
  const form = function (extra) {
    return Object.assign({ customer_group: 'ร้านอาหาร', customer_name: 'ลูกค้า Admin', due_date: inDays(3), items: [
      { product_name: 'ปลาแซลมอน Fillet', net_weight: '100%', size: '1-2 kg', packing_size: '1 kg', qty: 100, uom: 'กก.', target_price: 0 }] }, extra || {});
  };
  const lastLog = function (id, action) { return findAll_(TAB.LOGS, 'ticket_id', id).filter(function (l) { return l.action === action; }).pop(); };
  TEST_HTTP_ = fakeHttp_();
  TEST_BOTS_ = { fpr: { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/fpr', secret: 'sec-a' }, reminder: { url: '', secret: '' } };
  setTestSettings_({ sales_manager_step: 'false', gm_assigns_sr: 'true', min_suppliers: '3' });
  try {
    wrap('ADMIN_FLOW', function () {
      expectErr(A(function () { return createTicket(form()); }), 'VALIDATION', 'Admin: creating a request needs the Sales it is for');
      expectErr(A(function () { return createTicket(form({ requestor_email: U.sr1 })); }), 'VALIDATION', 'Admin: the requester must be an active Sales');
      const t = must(A(function () { return createTicket(form({ requestor_email: U.salesFood2 })); })).ticket;
      const id = t.ticket_id;
      const c = lastLog(id, 'create');
      ok(t.requestor_email === U.salesFood2 && c.actor_email === U.admin && parseJson_(c.metadata_json, {}).on_behalf_of === U.salesFood2,
        'Admin: creates a request for Sales (owned by that Sales, log says Admin on behalf of)');
      ok(as(U.salesFood2, function () { return getTicket(id).ok; }), 'Admin: the Sales sees the request created for them');
      const acts = must(A(function () { return getTicket(id); })).permissions.actions;
      ok(['gm_approve', 'gm_return', 'gm_reject', 'cancel', 'admin_cancel', 'admin_delete'].every(function (a) { return acts.indexOf(a) !== -1; }),
        'Admin: gets GM + Sales + Admin buttons at GM_REVIEW (' + acts.join(', ') + ')');
      ok(must(A(function () { return getTicket(id); })).permissions.can_edit_request, 'Admin: can edit the request before GM approval');
      must(A(function () { return updateTicketRequest(id, { customer_name: 'ลูกค้า Admin (แก้)' }, ticketById_(id).version); }));
      ok(ticketById_(id).customer_name === 'ลูกค้า Admin (แก้)', 'Admin: edit saved');
      expectErr(go(U.admin, id, 'gm_approve'), 'INVALID_ASSIGNEE', 'Admin approving for GM still has to pick the Sourcing person');
      must(go(U.admin, id, 'gm_approve', '', { sr_email: U.sr2 }));
      const g = lastLog(id, 'gm_approve');
      ok(ticketById_(id).stage === 'doc_check' && g.actor_email === U.admin && parseJson_(g.metadata_json, {}).on_behalf_of === U.gm,
        'Admin: approves for GM → ASSIGNED, log = Admin on behalf of GM');
      ok(must(A(function () { return getTicket(id); })).timeline.some(function (l) { return l.action === 'gm_approve' && /GM/.test(l.on_behalf_name || ''); }),
        'Admin: timeline shows “(แทน GM)”');
      A(function () { checklistOf_(id).filter(function (x) { return x.is_required; }).forEach(function (x) { must(updateChecklist(x.check_id, true, '')); }); });
      must(go(U.admin, id, 'doc_complete'));
      ok(ticketById_(id).stage === 'sourcing' && ticketById_(id).sr_email === U.sr2, 'Admin: confirms documents for the SR (SR stays the owner)');
      const it = activeItemsOf_(id)[0];
      const qs = ['A', 'B', 'C'].map(function (n, i) { return { quote_id: Utilities.getUuid(), vendor_name: 'Admin Supplier ' + n, unit_price: 300 + i, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat', valid_until: inDays(20) }; });
      must(A(function () { return saveSourcingDraft(id, [{ item_id: it.item_id, quotes: qs, winner_quote_id: qs[0].quote_id }]); }));
      ok(activeQuotesOfItem_(it.item_id).length === 3, 'Admin: enters supplier prices for the SR');
      must(go(U.admin, id, 'submit_quote'));
      must(go(U.admin, id, 'srm_approve'));
      must(go(U.admin, id, 'gm_price_approve'));
      ok(ticketById_(id).stage === 'awaiting_sales_ack', 'Admin: submits, approves for SR Manager and GM → APPROVED');
      must(go(U.admin, id, 'accept'));
      ok(ticketById_(id).stage === 'closed' && parseJson_(lastLog(id, 'accept').metadata_json, {}).on_behalf_of === U.salesFood2, 'Admin: accepts the price for Sales → closed');
      ok(botLog_(id).some(function (n) { return n.event === 'approved'; }), 'Admin actions still post the group cards');
    });

    wrap('ADMIN_DELETE', function () {
      const id = must(as(U.salesFood1, function () { return createTicket(form({ customer_name: 'ลูกค้าจะลบ' })); })).ticket.ticket_id;
      expectErr(go(U.gm, id, 'admin_delete', 'x'), 'FORBIDDEN', 'Delete: GM cannot delete');
      expectErr(go(U.salesFood1, id, 'admin_delete', 'x'), 'FORBIDDEN', 'Delete: Sales cannot delete');
      expectErr(go(U.admin, id, 'admin_delete'), 'COMMENT_REQUIRED', 'Delete: reason required');
      const n0 = botLog_(id).length;
      must(go(U.admin, id, 'admin_delete', 'ใบทดสอบ'));
      ok(ticketById_(id).stage === 'deleted' && ticketById_(id).status === 'deleted', 'Delete: Admin deletes (soft delete, rows kept)');
      ok(activeItemsOf_(id).length === 1, 'Delete: items are kept for audit / restore');
      ok(botLog_(id).length === n0, 'Delete: no group card');
      expectErr(as(U.salesFood1, function () { return getTicket(id); }), 'NOT_FOUND', 'Delete: the Sales no longer sees it');
      expectErr(as(U.gm, function () { return getTicket(id); }), 'NOT_FOUND', 'Delete: GM no longer sees it');
      ok(!as(U.gm, function () { return must(listTicketBoard()); }).rows.some(function (r) { return r.ticket_id === id; }), 'Delete: gone from GM list');
      const ad = must(A(function () { return getTicket(id); }));
      ok(ad.permissions.actions.join() === 'admin_restore', 'Delete: Admin still opens it, only “กู้คืน” is offered');
      expectErr(go(U.admin, id, 'gm_approve', '', { sr_email: U.sr1 }), 'INVALID_STATE', 'Delete: no workflow step on a deleted request');
      ok(A(function () { return must(listTicketBoard()); }).rows.some(function (r) { return r.ticket_id === id && r.stage === 'deleted'; }), 'Delete: Admin list has it (tab “🗑 ถูกลบ”)');
      const dash = A(function () { return must(getDashboard({})); });
      ok(!JSON.stringify(dash.by_stage).match(/"deleted"/), 'Delete: not counted in reports');
      must(go(U.admin, id, 'admin_restore'));
      ok(ticketById_(id).stage === 'pending_gm' && as(U.salesFood1, function () { return getTicket(id).ok; }), 'Restore: back to the step it was in, visible again');
    });

    wrap('ADMIN_BOT_SETTINGS', function () {
      const P = PropertiesService.getScriptProperties();
      const keys = ['FPR_BOT_URL', 'FPR_BOT_SECRET', 'FPR_REMINDER_URL', 'FPR_REMINDER_SECRET', 'WEBAPP_URL'];
      const snap = {};
      keys.forEach(function (k) { snap[k] = P.getProperty(k); });
      TEST_BOTS_ = null;   // read the real Script Properties in this block (restored below)
      try {
        expectErr(as(U.gm, function () { return getBotSettings(); }), 'FORBIDDEN', 'Bot settings: Admin only (GM refused)');
        expectErr(as(U.salesFood1, function () { return saveBotSettings('fpr', { url: 'https://open.larksuite.com/open-apis/bot/v2/hook/abcdefgh12' }); }), 'FORBIDDEN', 'Bot settings: Sales cannot save');
        expectErr(A(function () { return saveBotSettings('fpr', { url: 'https://evil.example.com/hook/abcdefgh12' }); }), 'VALIDATION', 'Bot settings: only a Lark webhook URL is accepted');
        const url = 'https://open.larksuite.com/open-apis/bot/v2/hook/0a1b2c3d-4e5f-6789-abcd-ef0123456789';
        must(A(function () { return saveBotSettings('fpr', { url: url, secret: 'TopSecret123' }); }));
        ok(P.getProperty('FPR_BOT_URL') === url && P.getProperty('FPR_BOT_SECRET') === 'TopSecret123', 'Bot settings: saved to Script Properties');
        const g = must(A(function () { return getBotSettings(); }));
        const fpr = g.bots.filter(function (b) { return b.key === 'fpr'; })[0];
        ok(fpr.url_set && fpr.secret_set && JSON.stringify(g).indexOf('TopSecret123') === -1 && JSON.stringify(g).indexOf('0a1b2c3d') === -1,
          'Bot settings: page shows ✓ only — Secret and full URL never sent to the browser (' + fpr.url_masked + ')');
        ok(!rows_(TAB.SETTINGS).some(function (r) { return /TopSecret123|0a1b2c3d/.test(String(r.value)); }) &&
          !rows_(TAB.NOTIF_LOG).some(function (r) { return /TopSecret123|0a1b2c3d/.test(String(r.summary) + String(r.response)); }), 'Bot settings: nothing secret written to the Sheet');
        must(A(function () { return saveBotSettings('fpr', { secret: 'NewSecret456' }); }));
        ok(P.getProperty('FPR_BOT_URL') === url && P.getProperty('FPR_BOT_SECRET') === 'NewSecret456', 'Bot settings: blank URL keeps the current one');
        const t = must(A(function () { return testBotSend('fpr'); }));
        ok(t.status === 'sent', 'Bot settings: “ส่งการ์ดทดสอบ” goes out through the saved webhook');
        const tr = must(A(function () { return testBotSend('reminder'); }));
        ok(tr.status === 'not_configured' && /ยังไม่ได้ใส่/.test(tr.hint), 'Bot settings: test on an unset bot explains what is missing');
        expectErr(A(function () { return saveWebappUrl('https://example.com/x'); }), 'VALIDATION', 'Web app URL: must be a script.google.com /exec link');
        must(A(function () { return saveWebappUrl('https://script.google.com/a/macros/mglobalsourcing.net/s/AKfycbx123/exec'); }));
        ok(fprLink_({ ticket_no: 'FPR-2610-0001' }) === 'https://script.google.com/a/macros/mglobalsourcing.net/s/AKfycbx123/exec?page=ticket&id=FPR-2610-0001', 'Web app URL: card button uses it');
        must(A(function () { return saveBotSettings('fpr', { clear: true }); }));
        ok(!P.getProperty('FPR_BOT_URL') && !P.getProperty('FPR_BOT_SECRET'), 'Bot settings: “ลบค่า” removes URL + Secret');
        ok(menuFor_(userByEmail_(U.admin)).some(function (m) { return m.key === 'admin'; }) && !menuFor_(userByEmail_(U.gm)).some(function (m) { return m.key === 'admin'; }),
          'Menu: “⚙️ ตั้งค่า Lark Bot” for Admin only');
      } finally {
        keys.forEach(function (k) { if (snap[k] === null || snap[k] === undefined) P.deleteProperty(k); else P.setProperty(k, snap[k]); });
      }
    });
  } finally {
    setTestSettings_({ sales_manager_step: 'true', gm_assigns_sr: 'false', min_suppliers: '1' });
    TEST_BOTS_ = null;
  }
}
