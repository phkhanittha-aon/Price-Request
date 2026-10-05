-- =============================================================================
-- File: supabase/seed.sql
-- Seed data for MGS Price Request & Sourcing System (DEV / UAT only)
--
-- Run AFTER the migration, in Supabase SQL Editor (runs as role "postgres").
-- All demo users share the password:  Mgs@12345
-- Safe to re-run: users / master data use ON CONFLICT DO NOTHING; demo tickets
-- are only created when no ticket exists yet.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Auth users (auth.users + auth.identities so e-mail/password login works)
-- -----------------------------------------------------------------------------
with u(id, email, full_name) as (
  values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@mgs.test',       'ผู้ดูแลระบบ (Admin)'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'gm@mgs.test',          'คุณสมชาย GM'),
    ('a0000000-0000-4000-8000-000000000011'::uuid, 'mgr.food@mgs.test',    'คุณวิภา Manager Food'),
    ('a0000000-0000-4000-8000-000000000012'::uuid, 'mgr.solar@mgs.test',   'คุณธนา Manager Solar'),
    ('a0000000-0000-4000-8000-000000000013'::uuid, 'mgr.supp@mgs.test',    'คุณมาลี Manager Supplement'),
    ('a0000000-0000-4000-8000-000000000021'::uuid, 'sales.food1@mgs.test', 'คุณกานต์ Sales Food'),
    ('a0000000-0000-4000-8000-000000000022'::uuid, 'sales.food2@mgs.test', 'คุณปอ Sales Food'),
    ('a0000000-0000-4000-8000-000000000023'::uuid, 'sales.solar1@mgs.test','คุณภูมิ Sales Solar'),
    ('a0000000-0000-4000-8000-000000000024'::uuid, 'sales.supp1@mgs.test', 'คุณแพร Sales Supplement'),
    ('a0000000-0000-4000-8000-000000000031'::uuid, 'sr.lead@mgs.test',     'คุณอร SR Lead'),
    ('a0000000-0000-4000-8000-000000000032'::uuid, 'sr1@mgs.test',         'คุณบอย SR'),
    ('a0000000-0000-4000-8000-000000000033'::uuid, 'sr2@mgs.test',         'คุณนุ่น SR')
)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('Mgs@12345', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('full_name', u.full_name), now(), now(),
       '', '', '', ''
from u
on conflict (id) do nothing;

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id, u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
from auth.users u
where u.email like '%@mgs.test'
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Departments
-- -----------------------------------------------------------------------------
insert into public.departments (id, code, name) values
  ('d0000000-0000-4000-8000-000000000001', 'SALES-FOOD',  'ฝ่ายขาย Frozen Seafood & Food'),
  ('d0000000-0000-4000-8000-000000000002', 'SALES-SOLAR', 'ฝ่ายขาย Solar & Mechanical'),
  ('d0000000-0000-4000-8000-000000000003', 'SALES-SUPP',  'ฝ่ายขาย Dietary Supplements'),
  ('d0000000-0000-4000-8000-000000000004', 'SOURCING',    'ฝ่ายจัดหา (Sourcing)'),
  ('d0000000-0000-4000-8000-000000000005', 'MGMT',        'ผู้บริหาร / Admin')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Profiles (created by trigger; set role / department / activate)
-- -----------------------------------------------------------------------------
update public.profiles p set
  role          = v.role::public.user_role,
  department_id = v.dept,
  is_sr_lead    = v.lead,
  is_active     = true
from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin',   'd0000000-0000-4000-8000-000000000005'::uuid, false),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'gm',      'd0000000-0000-4000-8000-000000000005'::uuid, false),
  ('a0000000-0000-4000-8000-000000000011'::uuid, 'manager', 'd0000000-0000-4000-8000-000000000001'::uuid, false),
  ('a0000000-0000-4000-8000-000000000012'::uuid, 'manager', 'd0000000-0000-4000-8000-000000000002'::uuid, false),
  ('a0000000-0000-4000-8000-000000000013'::uuid, 'manager', 'd0000000-0000-4000-8000-000000000003'::uuid, false),
  ('a0000000-0000-4000-8000-000000000021'::uuid, 'sales',   'd0000000-0000-4000-8000-000000000001'::uuid, false),
  ('a0000000-0000-4000-8000-000000000022'::uuid, 'sales',   'd0000000-0000-4000-8000-000000000001'::uuid, false),
  ('a0000000-0000-4000-8000-000000000023'::uuid, 'sales',   'd0000000-0000-4000-8000-000000000002'::uuid, false),
  ('a0000000-0000-4000-8000-000000000024'::uuid, 'sales',   'd0000000-0000-4000-8000-000000000003'::uuid, false),
  ('a0000000-0000-4000-8000-000000000031'::uuid, 'sr',      'd0000000-0000-4000-8000-000000000004'::uuid, true),
  ('a0000000-0000-4000-8000-000000000032'::uuid, 'sr',      'd0000000-0000-4000-8000-000000000004'::uuid, false),
  ('a0000000-0000-4000-8000-000000000033'::uuid, 'sr',      'd0000000-0000-4000-8000-000000000004'::uuid, false)
) as v(id, role, dept, lead)
where p.id = v.id;

update public.departments d set manager_id = v.mgr
from (values
  ('d0000000-0000-4000-8000-000000000001'::uuid, 'a0000000-0000-4000-8000-000000000011'::uuid),
  ('d0000000-0000-4000-8000-000000000002'::uuid, 'a0000000-0000-4000-8000-000000000012'::uuid),
  ('d0000000-0000-4000-8000-000000000003'::uuid, 'a0000000-0000-4000-8000-000000000013'::uuid)
) as v(id, mgr)
where d.id = v.id;

-- -----------------------------------------------------------------------------
-- 4. Product groups (parent → child) + checklist templates
--    Child templates ADD to the parent template (both are generated for the SR).
-- -----------------------------------------------------------------------------
insert into public.product_groups (id, code, name, name_en, parent_id, sort_order, checklist_template) values
  -- Frozen Seafood & Food
  ('c0000000-0000-4000-8000-000000000100', 'FOOD', 'อาหารทะเลแช่แข็ง & อาหาร', 'Frozen Seafood & Food', null, 100,
   '[{"key":"spec","label":"Spec สินค้า (ชนิด/สายพันธุ์)","required":true},
     {"key":"size_grade","label":"ขนาด / เกรด","required":true},
     {"key":"packing","label":"รูปแบบบรรจุ (Packing / น้ำหนักต่อแพ็ค)","required":true},
     {"key":"origin","label":"ประเทศต้นทาง","required":false},
     {"key":"shelf_life","label":"อายุสินค้า / เงื่อนไขการเก็บรักษา","required":false}]'),
  ('c0000000-0000-4000-8000-000000000101', 'FOOD-SHRIMP', 'กุ้ง', 'Shrimp', 'c0000000-0000-4000-8000-000000000100', 101,
   '[{"key":"glazing","label":"% Glazing / น้ำหนักสุทธิ (NW)","required":true}]'),
  ('c0000000-0000-4000-8000-000000000102', 'FOOD-FISH', 'ปลา (แซลมอน / ซาบะ / อื่นๆ)', 'Fish', 'c0000000-0000-4000-8000-000000000100', 102,
   '[{"key":"cut_type","label":"รูปแบบการตัดแต่ง (Fillet / Steak / Whole)","required":true}]'),
  ('c0000000-0000-4000-8000-000000000103', 'FOOD-CEPHALOPOD', 'หมึก / ปลาหมึก', 'Squid & Octopus', 'c0000000-0000-4000-8000-000000000100', 103, '[]'),
  ('c0000000-0000-4000-8000-000000000104', 'FOOD-PROCESSED', 'อาหารแปรรูป / Global Food', 'Processed & Global Food', 'c0000000-0000-4000-8000-000000000100', 104,
   '[{"key":"ingredients","label":"ส่วนประกอบ / ฉลาก","required":true}]'),

  -- Solar & Mechanical
  ('c0000000-0000-4000-8000-000000000200', 'SOLAR', 'Solar & Mechanical', 'Solar & Mechanical', null, 200,
   '[{"key":"datasheet","label":"Datasheet / Catalogue","required":true},
     {"key":"model_rating","label":"รุ่น / พิกัด (kW, V, A)","required":true},
     {"key":"qty_confirmed","label":"ยืนยันจำนวนและหน่วย","required":true},
     {"key":"site_info","label":"ข้อมูลหน้างาน / Single line diagram","required":false}]'),
  ('c0000000-0000-4000-8000-000000000201', 'SOLAR-INVERTER', 'Inverter', 'Inverter', 'c0000000-0000-4000-8000-000000000200', 201,
   '[{"key":"grid_phase","label":"ระบบไฟ 1 เฟส / 3 เฟส, On-grid / Hybrid","required":true}]'),
  ('c0000000-0000-4000-8000-000000000202', 'SOLAR-PV', 'แผงโซลาร์ (PV Module)', 'PV Module', 'c0000000-0000-4000-8000-000000000200', 202, '[]'),
  ('c0000000-0000-4000-8000-000000000203', 'SOLAR-MOUNTING', 'Mounting System', 'Mounting System', 'c0000000-0000-4000-8000-000000000200', 203,
   '[{"key":"roof_type","label":"ประเภทหลังคา / แบบติดตั้ง (Drawing)","required":true}]'),
  ('c0000000-0000-4000-8000-000000000204', 'SOLAR-CABLE', 'สายไฟ / Cable', 'Cable', 'c0000000-0000-4000-8000-000000000200', 204,
   '[{"key":"cable_spec","label":"ขนาดสาย (sq.mm) / ความยาว / มาตรฐาน","required":true}]'),
  ('c0000000-0000-4000-8000-000000000205', 'SOLAR-EV', 'EV Charger', 'EV Charger', 'c0000000-0000-4000-8000-000000000200', 205,
   '[{"key":"connector","label":"กำลังไฟ (kW) / หัวชาร์จ (Type 2 / CCS2)","required":true}]'),
  ('c0000000-0000-4000-8000-000000000206', 'SOLAR-ESS', 'ESS / Battery', 'Energy Storage', 'c0000000-0000-4000-8000-000000000200', 206,
   '[{"key":"capacity","label":"ความจุ (kWh) / Compatible inverter","required":true}]'),

  -- Dietary Supplements
  ('c0000000-0000-4000-8000-000000000300', 'SUPP', 'ผลิตภัณฑ์เสริมอาหาร', 'Dietary Supplements', null, 300,
   '[{"key":"formula","label":"สูตร / ส่วนประกอบ","required":true},
     {"key":"fda_reg","label":"เลข อย. / ทะเบียนผลิตภัณฑ์","required":true},
     {"key":"coa","label":"COA / Specification","required":true},
     {"key":"packaging","label":"รูปแบบบรรจุภัณฑ์ (แคปซูล/ซอง/ขวด)","required":false}]'),
  ('c0000000-0000-4000-8000-000000000301', 'SUPP-PROBIOTIC', 'โพรไบโอติก', 'Probiotics', 'c0000000-0000-4000-8000-000000000300', 301,
   '[{"key":"strain_cfu","label":"สายพันธุ์ (Strain) / ปริมาณ CFU","required":true}]'),
  ('c0000000-0000-4000-8000-000000000302', 'SUPP-VITAMIN', 'วิตามิน / แร่ธาตุ', 'Vitamins & Minerals', 'c0000000-0000-4000-8000-000000000300', 302, '[]')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Vendors (optional master)
-- -----------------------------------------------------------------------------
insert into public.vendors (id, name, country, default_currency, default_vat_term, created_by) values
  ('e0000000-0000-4000-8000-000000000001', 'Sungrow Power Supply (Thailand)', 'TH', 'THB', 'ex_vat',      'a0000000-0000-4000-8000-000000000031'),
  ('e0000000-0000-4000-8000-000000000002', 'Hefei Solar Trading Co., Ltd.',    'CN', 'USD', 'no_vat',      'a0000000-0000-4000-8000-000000000031'),
  ('e0000000-0000-4000-8000-000000000003', 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด',    'TH', 'THB', 'include_vat', 'a0000000-0000-4000-8000-000000000031'),
  ('e0000000-0000-4000-8000-000000000004', 'Andaman Seafood Co., Ltd.',        'TH', 'THB', 'no_vat',      'a0000000-0000-4000-8000-000000000031'),
  ('e0000000-0000-4000-8000-000000000005', 'Nordic Salmon AS',                 'NO', 'EUR', 'no_vat',      'a0000000-0000-4000-8000-000000000031'),
  ('e0000000-0000-4000-8000-000000000006', 'BioCulture Ingredients Ltd.',      'CN', 'CNY', 'no_vat',      'a0000000-0000-4000-8000-000000000031')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Demo tickets — driven through the real workflow functions by impersonating
--    users (sets request.jwt.claims the same way PostgREST does).
-- -----------------------------------------------------------------------------
do $$
declare
  c_sales_food   constant uuid := 'a0000000-0000-4000-8000-000000000021';
  c_sales_solar  constant uuid := 'a0000000-0000-4000-8000-000000000023';
  c_sales_supp   constant uuid := 'a0000000-0000-4000-8000-000000000024';
  c_mgr_food     constant uuid := 'a0000000-0000-4000-8000-000000000011';
  c_mgr_solar    constant uuid := 'a0000000-0000-4000-8000-000000000012';
  c_mgr_supp     constant uuid := 'a0000000-0000-4000-8000-000000000013';
  c_gm           constant uuid := 'a0000000-0000-4000-8000-000000000002';
  c_sr_lead      constant uuid := 'a0000000-0000-4000-8000-000000000031';
  c_sr1          constant uuid := 'a0000000-0000-4000-8000-000000000032';
  t  public.tickets;
  v_item uuid;
  v_q uuid;
  v_c record;
begin
  if exists (select 1 from public.tickets) then
    raise notice 'Tickets already exist — skip demo tickets';
    return;
  end if;

  -- (A) Solar ticket: full cycle → Closed --------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_sales_solar, 'role', 'authenticated')::text, true);
  t := public.create_ticket(
    '{"title":"Inverter + Mounting โครงการหลังคาโรงงาน 500kW","customer_name":"บจก. ไทยแพ็คเกจจิ้ง","priority":"high"}',
    '[{"product_group_id":"c0000000-0000-4000-8000-000000000201","product_name":"Sungrow SG110CX","spec":"110kW 3-phase On-grid","qty":4,"uom":"เครื่อง"},
      {"product_group_id":"c0000000-0000-4000-8000-000000000203","product_name":"Mounting Metal Sheet","spec":"สำหรับหลังคา Metal sheet","qty":1000,"uom":"ชุด"}]');

  perform set_config('request.jwt.claims', json_build_object('sub', c_mgr_solar)::text, true);
  t := public.transition_ticket(t.id, 'manager_approve', 'อนุมัติ', jsonb_build_object('expected_version', t.version));
  perform set_config('request.jwt.claims', json_build_object('sub', c_gm)::text, true);
  t := public.transition_ticket(t.id, 'gm_approve', null, jsonb_build_object('expected_version', t.version));
  perform set_config('request.jwt.claims', json_build_object('sub', c_sr1)::text, true);
  t := public.transition_ticket(t.id, 'claim', null, jsonb_build_object('expected_version', t.version));
  update public.ticket_checklist set is_checked = true where ticket_id = t.id;
  t := public.transition_ticket(t.id, 'doc_complete', null, jsonb_build_object('expected_version', t.version));

  for v_c in select i.id, i.line_no from public.ticket_items i where i.ticket_id = t.id order by i.line_no loop
    if v_c.line_no = 1 then
      insert into public.vendor_quotations (item_id, ticket_id, vendor_id, vendor_name, unit_price, currency, fx_rate, vat_term, moq, lead_time_days, payment_term, valid_until)
      values (v_c.id, t.id, 'e0000000-0000-4000-8000-000000000001', 'Sungrow Power Supply (Thailand)', 98000, 'THB', 1, 'ex_vat', 1, 14, 'Credit 30 วัน', current_date + 30)
      returning id into v_q;
      insert into public.vendor_quotations (item_id, ticket_id, vendor_id, vendor_name, unit_price, currency, fx_rate, vat_term, moq, lead_time_days, payment_term, valid_until)
      values (v_c.id, t.id, 'e0000000-0000-4000-8000-000000000002', 'Hefei Solar Trading Co., Ltd.', 2650, 'USD', 36.20, 'no_vat', 10, 45, 'T/T 30% deposit', current_date + 20);
      insert into public.vendor_quotations (item_id, ticket_id, vendor_id, vendor_name, unit_price, currency, fx_rate, vat_term, moq, lead_time_days, payment_term, valid_until)
      values (v_c.id, t.id, 'e0000000-0000-4000-8000-000000000003', 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด', 104000, 'THB', 1, 'include_vat', 1, 7, 'เงินสด', current_date + 15);
      -- Net cost THB: Sungrow 98,000 | Hefei 2,650 × 36.20 = 95,930 (cheapest) | Thai Solar 104,000 / 1.07 = 97,196
      -- Winner is Sungrow (not the cheapest) → selection reason is mandatory.
      perform public.select_quotation(v_q, 'ตัวแทนจำหน่ายอย่างเป็นทางการ รับประกันศูนย์ 10 ปี');
    else
      insert into public.vendor_quotations (item_id, ticket_id, vendor_name, unit_price, currency, fx_rate, vat_term, lead_time_days, payment_term, valid_until)
      values (v_c.id, t.id, 'บริษัท ไทยโซลาร์ซัพพลาย จำกัด', 850, 'THB', 1, 'include_vat', 10, 'Credit 30 วัน', current_date + 30)
      returning id into v_q;
      perform public.select_quotation(v_q, null);
    end if;
  end loop;
  select * into t from public.tickets where id = t.id;
  t := public.transition_ticket(t.id, 'submit_quote', null, jsonb_build_object('expected_version', t.version));
  perform set_config('request.jwt.claims', json_build_object('sub', c_sales_solar)::text, true);
  t := public.transition_ticket(t.id, 'accept', 'ตกลงตามราคานี้', jsonb_build_object('expected_version', t.version));

  -- (B) Seafood ticket: SR asked for more info → waiting for Sales ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_sales_food)::text, true);
  t := public.create_ticket(
    '{"title":"กุ้งขาวแช่แข็ง + แซลมอนฟิเล่ สำหรับร้านอาหารญี่ปุ่น","customer_name":"ร้านซูชิ ABC","priority":"normal"}',
    '[{"product_group_id":"c0000000-0000-4000-8000-000000000101","product_name":"กุ้งขาว Vannamei HLSO","spec":"Size 31/40","qty":500,"uom":"กก."},
      {"product_group_id":"c0000000-0000-4000-8000-000000000102","product_name":"Salmon Fillet Trim D","qty":300,"uom":"กก."}]');
  perform set_config('request.jwt.claims', json_build_object('sub', c_mgr_food)::text, true);
  t := public.transition_ticket(t.id, 'manager_approve', null, jsonb_build_object('expected_version', t.version));
  perform set_config('request.jwt.claims', json_build_object('sub', c_gm)::text, true);
  t := public.transition_ticket(t.id, 'gm_approve', null, jsonb_build_object('expected_version', t.version));
  perform set_config('request.jwt.claims', json_build_object('sub', c_sr_lead)::text, true);
  t := public.transition_ticket(t.id, 'assign', null, jsonb_build_object('expected_version', t.version, 'sr_id', c_sr1));
  perform set_config('request.jwt.claims', json_build_object('sub', c_sr1)::text, true);
  t := public.transition_ticket(t.id, 'request_info', 'ขอ % glazing และรูปแบบ packing ของกุ้ง',
         jsonb_build_object('expected_version', t.version, 'missing_items', jsonb_build_array('glazing', 'packing')));

  -- (C) Supplement ticket: waiting for GM ----------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_sales_supp)::text, true);
  t := public.create_ticket(
    '{"title":"Probiotic powder สำหรับผลิตภัณฑ์ใหม่","priority":"urgent"}',
    '[{"product_group_id":"c0000000-0000-4000-8000-000000000301","product_name":"Lactobacillus plantarum","spec":"100B CFU/g","qty":25,"uom":"กก."}]');
  perform set_config('request.jwt.claims', json_build_object('sub', c_mgr_supp)::text, true);
  t := public.transition_ticket(t.id, 'manager_approve', null, jsonb_build_object('expected_version', t.version));

  -- (D) Seafood ticket: just created, waiting for Manager -------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', c_sales_food)::text, true);
  t := public.create_ticket(
    '{"title":"หมึกกล้วยแช่แข็ง ล็อตเดือนหน้า","priority":"low"}',
    '[{"product_group_id":"c0000000-0000-4000-8000-000000000103","product_name":"หมึกกล้วย IQF","spec":"U/10","qty":1000,"uom":"กก."}]');

  perform set_config('request.jwt.claims', '', true);
end;
$$;

commit;

-- Quick check
select ticket_no, title, status, stage_label, requestor_name, sr_name
from public.v_ticket_list order by ticket_no;
