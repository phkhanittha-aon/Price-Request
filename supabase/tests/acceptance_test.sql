-- =============================================================================
-- File: supabase/tests/acceptance_test.sql
-- Acceptance tests for Phase 1 (database). Requires migration + seed.sql.
--
-- Run in Supabase SQL Editor (or psql). Everything runs inside ONE transaction
-- and is ROLLED BACK at the end — no data is left behind.
-- Expected result: a list of "PASS ..." notices and finally "ALL TESTS PASSED".
-- Any failure aborts with "FAIL ...".
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Test helpers (temporary, disappear at end of session)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.login(p_user uuid) returns void
language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

create or replace function pg_temp.ok(p_cond boolean, p_name text) returns void
language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'PASS: %', p_name;
end;
$$;

-- Runs p_sql and expects it to fail with a hint (business code) or SQLSTATE = p_expect.
create or replace function pg_temp.expect_error(p_sql text, p_expect text, p_name text) returns void
language plpgsql as $$
declare
  v_state text;
  v_hint  text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_msg = message_text;
    if v_state = p_expect or v_hint = p_expect then
      raise notice 'PASS: % → [%] %', p_name, coalesce(nullif(v_hint, ''), v_state), v_msg;
      return;
    end if;
    raise exception 'FAIL: % → expected %, got [% / %] %', p_name, p_expect, v_state, v_hint, v_msg;
  end;
  raise exception 'FAIL: % → statement succeeded but should have been rejected', p_name;
end;
$$;

-- Execute transition_ticket using the ticket's current version.
create or replace function pg_temp.go(p_ticket uuid, p_action text, p_comment text default null, p_extra jsonb default '{}')
returns public.tickets
language plpgsql as $$
declare v_ver int;
begin
  select version into v_ver from public.tickets where id = p_ticket;
  return public.transition_ticket(p_ticket, p_action, p_comment, p_extra || jsonb_build_object('expected_version', v_ver));
end;
$$;

-- Fixed seed IDs
select set_config('t.sales_food1',  'a0000000-0000-4000-8000-000000000021', true),
       set_config('t.sales_food2',  'a0000000-0000-4000-8000-000000000022', true),
       set_config('t.sales_solar',  'a0000000-0000-4000-8000-000000000023', true),
       set_config('t.mgr_food',     'a0000000-0000-4000-8000-000000000011', true),
       set_config('t.mgr_solar',    'a0000000-0000-4000-8000-000000000012', true),
       set_config('t.gm',           'a0000000-0000-4000-8000-000000000002', true),
       set_config('t.sr_lead',      'a0000000-0000-4000-8000-000000000031', true),
       set_config('t.sr1',          'a0000000-0000-4000-8000-000000000032', true),
       set_config('t.sr2',          'a0000000-0000-4000-8000-000000000033', true),
       set_config('t.grp_inverter', 'c0000000-0000-4000-8000-000000000201', true),
       set_config('t.grp_cable',    'c0000000-0000-4000-8000-000000000204', true);

-- From here on we act as the API role "authenticated" (exactly like PostgREST).
set local role authenticated;

-- =============================================================================
-- AC-1  Sales cannot see other Sales' tickets (even via direct API)
-- =============================================================================
do $$
declare v_food1_ticket uuid;
begin
  perform pg_temp.login(current_setting('t.sales_food1')::uuid);
  select id into v_food1_ticket from public.tickets where stage = 'pending_manager' limit 1;
  perform pg_temp.ok(v_food1_ticket is not null, 'AC-1 Sales food1 sees own ticket');
  perform set_config('t.food1_ticket', v_food1_ticket::text, true);

  perform pg_temp.login(current_setting('t.sales_food2')::uuid);
  perform pg_temp.ok((select count(*) from public.tickets) = 0, 'AC-1 Sales food2 sees 0 tickets (table)');
  perform pg_temp.ok((select count(*) from public.v_ticket_list) = 0, 'AC-1 Sales food2 sees 0 tickets (view)');
  perform pg_temp.ok((select count(*) from public.ticket_items where ticket_id = v_food1_ticket) = 0, 'AC-1 … and 0 items');
  perform pg_temp.ok((select count(*) from public.ticket_logs where ticket_id = v_food1_ticket) = 0, 'AC-1 … and 0 logs');
  perform pg_temp.ok(not public.is_ticket_visible(v_food1_ticket), 'AC-1 is_ticket_visible() = false');

  perform pg_temp.login(current_setting('t.mgr_solar')::uuid);
  perform pg_temp.ok((select count(*) from public.tickets where id = v_food1_ticket) = 0, 'Manager Solar cannot see Food ticket');

  perform pg_temp.login(current_setting('t.sr1')::uuid);
  perform pg_temp.ok((select count(*) from public.tickets where gm_approved_at is null) = 0, 'SR cannot see tickets before GM approval');

  perform pg_temp.login(current_setting('t.gm')::uuid);
  perform pg_temp.ok((select count(*) from public.tickets) >= 4, 'GM sees all tickets');
end;
$$;

-- =============================================================================
-- AC-2  Status can only change through transition_ticket()
-- =============================================================================
select pg_temp.login(current_setting('t.sales_food1')::uuid);
select pg_temp.expect_error(
  format($q$update public.tickets set status = 'closed', stage = 'closed' where id = %L$q$, current_setting('t.food1_ticket')),
  '42501', 'AC-2 Owner cannot UPDATE status directly');
select pg_temp.expect_error(
  format($q$update public.tickets set sr_id = %L where id = %L$q$, current_setting('t.sr1'), current_setting('t.food1_ticket')),
  '42501', 'AC-2 Owner cannot set sr_id directly');
select pg_temp.expect_error(
  $q$insert into public.tickets (ticket_no, title, requestor_id, department_id) values ('PR-X', 'hack', auth.uid(), 'd0000000-0000-4000-8000-000000000001')$q$,
  '42501', 'AC-2 Cannot INSERT ticket directly');

do $$
declare v_before int; v_after int;
begin
  select version into v_before from public.tickets where id = current_setting('t.food1_ticket')::uuid;
  update public.tickets set title = 'หมึกกล้วยแช่แข็ง (แก้ไขชื่อ)' where id = current_setting('t.food1_ticket')::uuid;
  select version into v_after from public.tickets where id = current_setting('t.food1_ticket')::uuid;
  perform pg_temp.ok(v_after = v_before + 1, 'AC-2 Owner may edit title before approval; version bumped');
  perform pg_temp.ok(exists (select 1 from public.ticket_logs
                             where ticket_id = current_setting('t.food1_ticket')::uuid and action = 'ticket_updated'),
                     'AC-2 Header edit is logged with diff');
end;
$$;

-- service_role (bypasses RLS) is still blocked by the guard trigger
reset role;
set local role service_role;
select pg_temp.expect_error(
  format($q$update public.tickets set status = 'closed', stage = 'closed' where id = %L$q$, current_setting('t.food1_ticket')),
  'DIRECT_UPDATE_FORBIDDEN', 'AC-2 Even service_role cannot UPDATE status directly');
reset role;
set local role authenticated;

-- Workflow rules
select pg_temp.login(current_setting('t.mgr_food')::uuid);
select pg_temp.expect_error(
  format($q$select public.transition_ticket(%L, 'manager_approve', null, '{"expected_version": 1}')$q$, current_setting('t.food1_ticket')),
  'VERSION_CONFLICT', 'Optimistic lock: stale version rejected');
select pg_temp.expect_error(
  format($q$select pg_temp.go(%L, 'manager_reject')$q$, current_setting('t.food1_ticket')),
  'COMMENT_REQUIRED', 'Reject without reason rejected');
select pg_temp.expect_error(
  format($q$select pg_temp.go(%L, 'gm_approve')$q$, current_setting('t.food1_ticket')),
  'FORBIDDEN', 'Manager cannot perform GM approval');
select pg_temp.login(current_setting('t.mgr_solar')::uuid);
select pg_temp.expect_error(
  format($q$select pg_temp.go(%L, 'manager_approve')$q$, current_setting('t.food1_ticket')),
  'NOT_FOUND', 'Manager of another department cannot approve');

-- =============================================================================
-- Full workflow on a new ticket + AC-3 (vendor limits) + AC-4 (logs)
-- =============================================================================
do $$
declare
  t public.tickets;
  v_rows int;
begin
  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  t := public.create_ticket(
    '{"title":"ทดสอบ Inverter 50kW + สายไฟ","priority":"normal"}',
    jsonb_build_array(
      jsonb_build_object('product_group_id', current_setting('t.grp_inverter'), 'product_name', 'Inverter 50kW', 'qty', 2, 'uom', 'เครื่อง'),
      jsonb_build_object('product_group_id', current_setting('t.grp_cable'), 'product_name', 'PV1-F 6 sq.mm', 'qty', 500, 'uom', 'เมตร')));
  perform set_config('t.flow', t.id::text, true);
  perform pg_temp.ok(t.ticket_no ~ ('^PR-' || extract(year from now() at time zone 'Asia/Bangkok') || '-\d{4,}$'), 'Ticket number format PR-YYYY-NNNN: ' || t.ticket_no);
  perform pg_temp.ok(t.status = 'requested' and t.stage = 'pending_manager', 'New ticket = Requested / pending_manager');

  -- Sales must not approve anything
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'manager_approve')$q$, t.id), 'FORBIDDEN', 'Sales cannot approve');

  perform pg_temp.login(current_setting('t.mgr_solar')::uuid);
  t := pg_temp.go(t.id, 'manager_return', 'กรุณาระบุรุ่นที่ต้องการ');
  perform pg_temp.ok(t.stage = 'returned', 'Manager return → returned');

  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  update public.ticket_items set spec = 'Sungrow SG50CX' where ticket_id = t.id and line_no = 1;
  t := pg_temp.go(t.id, 'resubmit');
  perform pg_temp.ok(t.stage = 'pending_manager', 'Sales resubmit → pending_manager');

  perform pg_temp.login(current_setting('t.mgr_solar')::uuid);
  t := pg_temp.go(t.id, 'manager_approve');
  perform pg_temp.ok(t.stage = 'pending_gm', 'Manager approve → pending_gm');

  -- RLS filters the rows silently: the UPDATE succeeds but touches 0 rows.
  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  update public.ticket_items set qty = 99 where ticket_id = t.id;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0, 'Sales cannot edit items after Manager approval (0 rows updated)');
end;
$$;

do $$
declare
  t public.tickets;
  v_item1 uuid; v_item2 uuid;
  q1 uuid; q2 uuid; q3 uuid;
  v_rows int;
begin
  select * into t from public.tickets where id = current_setting('t.flow')::uuid;
  perform pg_temp.ok((select qty from public.ticket_items where ticket_id = t.id and line_no = 1) = 2, 'Item qty unchanged after approval');

  perform pg_temp.login(current_setting('t.gm')::uuid);
  t := pg_temp.go(t.id, 'gm_approve');
  perform pg_temp.ok(t.status = 'on_process' and t.stage = 'pending_assign', 'GM approve → On Process / pending_assign');

  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'cancel')$q$, t.id), 'INVALID_STATE', 'Sales cannot cancel after GM approval');

  perform pg_temp.login(current_setting('t.sr2')::uuid);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'assign', null, %L::jsonb)$q$, t.id,
                               json_build_object('sr_id', current_setting('t.sr1'))), 'FORBIDDEN', 'Normal SR cannot assign');
  perform pg_temp.login(current_setting('t.sr1')::uuid);
  t := pg_temp.go(t.id, 'claim');
  perform pg_temp.ok(t.stage = 'doc_check' and t.sr_id = current_setting('t.sr1')::uuid and t.assigned_at is not null,
                     'SR claim → doc_check, sr_id + assigned_at recorded');
  perform pg_temp.ok((select count(*) from public.ticket_checklist where ticket_id = t.id) = 6,
                     'Checklist generated from Solar + Inverter + Cable templates (6 rows)');

  perform pg_temp.login(current_setting('t.sr2')::uuid);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'claim')$q$, t.id), 'ALREADY_CLAIMED', 'Second SR cannot claim the same job');

  perform pg_temp.login(current_setting('t.sr1')::uuid);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'doc_complete')$q$, t.id), 'CHECKLIST_INCOMPLETE', 'Cannot finish doc check with unticked items');

  select id into v_item1 from public.ticket_items where ticket_id = t.id and line_no = 1;
  select id into v_item2 from public.ticket_items where ticket_id = t.id and line_no = 2;
  perform pg_temp.expect_error(
    format($q$insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price) values (%L, %L, 'X', 1)$q$, v_item1, t.id),
    '42501', 'Cannot enter prices before documents are checked');

  -- need_info round-trip
  t := pg_temp.go(t.id, 'request_info', 'ขอ datasheet', '{"missing_items":["datasheet"]}');
  perform pg_temp.ok(t.stage = 'need_info' and t.info_request ->> 'return_stage' = 'doc_check', 'SR request_info → need_info');
  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  t := pg_temp.go(t.id, 'respond_info', 'แนบ datasheet แล้ว');
  perform pg_temp.ok(t.stage = 'doc_check' and t.sr_id = current_setting('t.sr1')::uuid and t.info_request is null,
                     'Sales respond_info → back to same SR queue (doc_check)');

  perform pg_temp.login(current_setting('t.sr1')::uuid);
  update public.ticket_checklist set is_checked = true where ticket_id = t.id and is_required;
  perform pg_temp.ok((select bool_and(checked_by = auth.uid() and checked_at is not null)
                      from public.ticket_checklist where ticket_id = t.id and is_required), 'checked_by / checked_at stamped');
  t := pg_temp.go(t.id, 'doc_complete');
  perform pg_temp.ok(t.stage = 'sourcing', 'doc_complete → sourcing');

  -- AC-3: max 3 vendors per item
  insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, currency, fx_rate, vat_term)
    values (v_item1, t.id, 'Vendor A', 50000, 'THB', 1, 'ex_vat') returning id into q1;          -- net 50,000
  insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, currency, fx_rate, vat_term)
    values (v_item1, t.id, 'Vendor B', 52430, 'THB', 1, 'include_vat') returning id into q2;     -- net 49,000 (cheapest)
  insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, currency, fx_rate, vat_term)
    values (v_item1, t.id, 'Vendor C', 1400, 'USD', 36.5, 'no_vat') returning id into q3;        -- net 51,100
  perform pg_temp.ok((select net_unit_cost_thb from public.vendor_quotations where id = q2) = 49000,
                     'VAT normalise: Include VAT 52,430 / 1.07 = 49,000');
  perform pg_temp.ok((select gross_unit_price_thb from public.vendor_quotations where id = q1) = 53500,
                     'VAT normalise: Ex VAT 50,000 × 1.07 = 53,500 gross');
  perform pg_temp.ok((select net_unit_cost_thb from public.vendor_quotations where id = q3) = 51100,
                     'FX normalise: 1,400 USD × 36.5 = 51,100');
  perform pg_temp.ok((select is_cheapest from public.v_quotation_compare where id = q2), 'v_quotation_compare marks cheapest');

  perform pg_temp.expect_error(
    format($q$insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price) values (%L, %L, 'Vendor D', 1)$q$, v_item1, t.id),
    'MAX_VENDORS', 'AC-3 4th vendor on same item rejected');
  perform pg_temp.expect_error(
    format($q$insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, currency, fx_rate) values (%L, %L, 'Bad FX', 1, 'THB', 2)$q$, v_item2, t.id),
    '23514', 'THB must have fx_rate = 1');
  perform pg_temp.expect_error(
    format($q$insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price) values (%L, %L, 'Neg', -1)$q$, v_item2, t.id),
    '23514', 'Negative price rejected');

  -- AC-3: only one winner per item
  update public.vendor_quotations set is_selected = true where id = q1;
  perform pg_temp.expect_error(
    format($q$update public.vendor_quotations set is_selected = true where id = %L$q$, q3),
    '23505', 'AC-3 Second winner on same item rejected');

  -- Submit validations
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'submit_quote')$q$, t.id), 'MISSING_QUOTATION', 'Submit blocked: item 2 has no vendor');
  insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, vat_term)
    values (v_item2, t.id, 'Cable Co', 28, 'ex_vat');
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'submit_quote')$q$, t.id), 'MISSING_WINNER', 'Submit blocked: item 2 has no winner');
  perform public.select_quotation((select id from public.vendor_quotations where item_id = v_item2), null);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'submit_quote')$q$, t.id), 'REASON_REQUIRED',
                               'Submit blocked: winner is not cheapest and no reason');
  perform public.select_quotation(q1, 'Lead time สั้นกว่า 3 สัปดาห์');
  perform pg_temp.ok((select count(*) from public.vendor_quotations where item_id = v_item1 and is_selected) = 1, 'select_quotation keeps exactly 1 winner');

  -- Sales cannot see quotations before submission
  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  perform pg_temp.ok((select count(*) from public.vendor_quotations where ticket_id = t.id) = 0, 'Sales cannot see draft quotations');

  perform pg_temp.login(current_setting('t.sr1')::uuid);
  t := pg_temp.go(t.id, 'submit_quote');
  perform pg_temp.ok(t.status = 'completed' and t.stage = 'awaiting_sales_ack', 'submit_quote → Completed / awaiting_sales_ack');
  update public.vendor_quotations set unit_price = 1 where id = q1;
  get diagnostics v_rows = row_count;
  perform pg_temp.ok(v_rows = 0, 'SR cannot edit prices after submission (0 rows updated)');
end;
$$;

do $$
declare
  t public.tickets;
  v_logs bigint;
begin
  select * into t from public.tickets where id = current_setting('t.flow')::uuid;
  perform pg_temp.ok((select unit_price from public.vendor_quotations where ticket_id = t.id and vendor_name = 'Vendor A') = 50000,
                     'Price unchanged after submission');

  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  perform pg_temp.ok((select count(*) from public.vendor_quotations where ticket_id = t.id) = 4, 'Sales sees quotations after submission');
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'request_revision')$q$, t.id), 'COMMENT_REQUIRED', 'Revision needs a comment');
  t := pg_temp.go(t.id, 'request_revision', 'ลูกค้าต่อราคา ขอลองต่อรอง Vendor A');
  perform pg_temp.ok(t.stage = 'sourcing' and t.revision_count = 1, 'request_revision → sourcing, revision_count = 1');

  perform pg_temp.login(current_setting('t.sr1')::uuid);
  update public.vendor_quotations set unit_price = 48500 where ticket_id = t.id and vendor_name = 'Vendor A';
  perform pg_temp.ok(exists (select 1 from public.ticket_logs where ticket_id = t.id and action = 'quotation_updated'
                             and metadata -> 'diff' -> 'unit_price' ->> 'old' = '50000.0000'
                             and metadata -> 'diff' -> 'unit_price' ->> 'new' = '48500.0000'),
                     'Price change logged with old/new jsonb diff');
  update public.vendor_quotations set selection_reason = null where ticket_id = t.id and vendor_name = 'Vendor A';
  t := pg_temp.go(t.id, 'submit_quote');   -- Vendor A is now cheapest → no reason needed

  perform pg_temp.login(current_setting('t.sales_solar')::uuid);
  t := pg_temp.go(t.id, 'accept', 'ตกลง');
  perform pg_temp.ok(t.status = 'closed' and t.closed_at is not null, 'accept → Closed');

  -- AC-4: every transition is logged
  select count(*) into v_logs from public.ticket_logs where ticket_id = t.id and log_type = 'transition';
  perform pg_temp.ok(v_logs = 13, 'AC-4 13 transitions → 13 transition log rows (got ' || v_logs || ')');
  perform pg_temp.ok(not exists (select 1 from public.ticket_logs
                                 where ticket_id = t.id and log_type = 'transition' and action <> 'create'
                                   and (actor_id is null or actor_role is null or to_stage is null)),
                     'AC-4 Every transition row has actor, role, from/to');
  perform set_config('t.log_id', (select min(id)::text from public.ticket_logs where ticket_id = t.id), true);
end;
$$;

-- AC-4: logs cannot be changed — as API user …
select pg_temp.expect_error(format('update public.ticket_logs set comment = %L where id = %s', 'hacked', current_setting('t.log_id')),
                            '42501', 'AC-4 authenticated cannot UPDATE ticket_logs');
select pg_temp.expect_error(format('delete from public.ticket_logs where id = %s', current_setting('t.log_id')),
                            '42501', 'AC-4 authenticated cannot DELETE ticket_logs');
-- … nor as service_role …
reset role;
set local role service_role;
select pg_temp.expect_error(format('update public.ticket_logs set comment = %L where id = %s', 'hacked', current_setting('t.log_id')),
                            '42501', 'AC-4 service_role cannot UPDATE ticket_logs');
select pg_temp.expect_error(format('delete from public.ticket_logs where id = %s', current_setting('t.log_id')),
                            '42501', 'AC-4 service_role cannot DELETE ticket_logs');
-- … nor as table owner (trigger)
reset role;
select pg_temp.expect_error(format('update public.ticket_logs set comment = %L where id = %s', 'hacked', current_setting('t.log_id')),
                            'LOG_IMMUTABLE', 'AC-4 owner cannot UPDATE ticket_logs (trigger)');
select pg_temp.expect_error('truncate public.ticket_logs cascade', 'LOG_IMMUTABLE', 'AC-4 TRUNCATE ticket_logs blocked');
set local role authenticated;

-- =============================================================================
-- AC-5  Ticket numbers unique (sequential creation; see docs for concurrency test)
-- =============================================================================
do $$
declare
  i int;
  t public.tickets;
begin
  perform pg_temp.login(current_setting('t.sales_food2')::uuid);
  for i in 1..20 loop
    t := public.create_ticket('{"title":"เลขที่ใบทดสอบ"}',
           '[{"product_group_id":"c0000000-0000-4000-8000-000000000101","product_name":"กุ้ง","qty":1,"uom":"กก."}]');
  end loop;
  perform pg_temp.login(current_setting('t.gm')::uuid);
  perform pg_temp.ok((select count(*) = count(distinct ticket_no) from public.tickets), 'AC-5 All ticket numbers are unique');

  -- Self-approval guard: Sales food2's ticket cannot be approved by a non-manager role
  perform pg_temp.login(current_setting('t.sales_food2')::uuid);
  perform pg_temp.expect_error(format($q$select pg_temp.go(%L, 'manager_approve')$q$, t.id), 'FORBIDDEN', 'Sales cannot approve own ticket');
  t := pg_temp.go(t.id, 'cancel', 'สร้างซ้ำ');
  perform pg_temp.ok(t.status = 'rejected' and t.stage = 'cancelled', 'Sales cancel before GM → Rejected / cancelled');
end;
$$;

-- =============================================================================
-- Dashboard RPCs return data (scoped by RLS)
-- =============================================================================
do $$
begin
  perform pg_temp.login(current_setting('t.gm')::uuid);
  perform pg_temp.ok((select count(*) from public.dashboard_status_summary()) > 0, 'dashboard_status_summary');
  perform pg_temp.ok((select count(*) from public.dashboard_requests_by_sales()) > 0, 'dashboard_requests_by_sales');
  perform pg_temp.ok((select count(*) from public.dashboard_sr_workload()) = 3, 'dashboard_sr_workload (3 SRs)');
  perform pg_temp.ok((select count(*) from public.dashboard_stage_cycle_time()) > 0, 'dashboard_stage_cycle_time');
  perform pg_temp.ok((select count(*) from public.dashboard_sla_overview()) > 0, 'dashboard_sla_overview');
  perform pg_temp.ok((select count(*) from public.dashboard_aging_buckets()) = 4, 'dashboard_aging_buckets (4 buckets)');
  perform pg_temp.ok((select count(*) from public.dashboard_top_vendors()) > 0, 'dashboard_top_vendors');
  perform pg_temp.ok((select count(*) from public.dashboard_product_group_share()) > 0, 'dashboard_product_group_share');

  perform pg_temp.login(current_setting('t.sales_food2')::uuid);
  perform pg_temp.ok((select coalesce(sum(total), 0) from public.dashboard_requests_by_sales())
                     = (select count(*) from public.tickets where requestor_id = auth.uid()),
                     'Dashboard for Sales only counts own tickets');
  perform pg_temp.ok((select count(*) from public.notifications where user_id <> auth.uid()) = 0, 'Notifications: only own rows visible');
end;
$$;

do $$ begin raise notice '=========== ALL TESTS PASSED ==========='; end $$;

rollback;
