-- =============================================================================
-- File: supabase/migrations/20261005000000_init_price_request.sql
-- MGS Enterprise Price Request & Sourcing System — Phase 1 (Database)
--
-- Run ONCE on a fresh Supabase project:
--   * Supabase Dashboard → SQL Editor → paste this whole file → Run
--   * or `supabase db push` (Supabase CLI)
-- Then run supabase/seed.sql, then (optional) supabase/tests/acceptance_test.sql
--
-- Design principles
--   1. tickets.status/stage can only change through public.transition_ticket()
--      (column privileges + guard trigger + SECURITY DEFINER function).
--   2. ticket_logs is append-only (no grants + triggers block UPDATE/DELETE/TRUNCATE).
--   3. Every business rule is enforced in the database; the UI only mirrors it.
--   4. RLS on every table, built on helper functions auth_role() / is_ticket_visible().
-- =============================================================================

begin;

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- =============================================================================
-- 1. ENUM TYPES
-- =============================================================================
create type public.user_role as enum ('sales', 'manager', 'gm', 'sr', 'admin');

create type public.ticket_status as enum ('requested', 'on_process', 'completed', 'closed', 'rejected');

-- Sub-stage: tells WHO the ticket is waiting for, without adding main statuses.
--   requested : pending_manager, returned, pending_gm
--   on_process: pending_assign, doc_check, need_info, sourcing
--   completed : awaiting_sales_ack
--   closed    : closed
--   rejected  : rejected, cancelled
create type public.ticket_stage as enum (
  'pending_manager', 'returned', 'pending_gm',
  'pending_assign', 'doc_check', 'need_info', 'sourcing',
  'awaiting_sales_ack',
  'closed',
  'rejected', 'cancelled'
);

create type public.vat_term as enum ('ex_vat', 'no_vat', 'include_vat');

create type public.ticket_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.log_type as enum ('transition', 'data_change', 'system');

-- =============================================================================
-- 2. PURE HELPERS (needed by table constraints)
-- =============================================================================
create or replace function public.stage_status(p_stage public.ticket_stage)
returns public.ticket_status
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_stage
    when 'pending_manager'    then 'requested'::public.ticket_status
    when 'returned'           then 'requested'::public.ticket_status
    when 'pending_gm'         then 'requested'::public.ticket_status
    when 'pending_assign'     then 'on_process'::public.ticket_status
    when 'doc_check'          then 'on_process'::public.ticket_status
    when 'need_info'          then 'on_process'::public.ticket_status
    when 'sourcing'           then 'on_process'::public.ticket_status
    when 'awaiting_sales_ack' then 'completed'::public.ticket_status
    when 'closed'             then 'closed'::public.ticket_status
    when 'rejected'           then 'rejected'::public.ticket_status
    when 'cancelled'          then 'rejected'::public.ticket_status
  end
$$;

create or replace function public.stage_label_th(p_stage public.ticket_stage)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_stage
    when 'pending_manager'    then 'รอ Manager อนุมัติ'
    when 'returned'           then 'ส่งกลับให้ Sales แก้ไข'
    when 'pending_gm'         then 'รอ GM อนุมัติ'
    when 'pending_assign'     then 'รอ SR รับงาน'
    when 'doc_check'          then 'SR ตรวจเอกสาร'
    when 'need_info'          then 'รอ Sales ส่งข้อมูลเพิ่ม'
    when 'sourcing'           then 'SR กำลังหาราคา'
    when 'awaiting_sales_ack' then 'รอ Sales รับทราบราคา'
    when 'closed'             then 'ปิดงาน'
    when 'rejected'           then 'ไม่อนุมัติ'
    when 'cancelled'          then 'ยกเลิก'
  end
$$;

create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

-- Raise a business error. message = Thai text for end users, hint = machine code.
create or replace function public.app_error(p_code text, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end;
$$;

-- Returns {field: {old, new}} for keys whose value differs.
create or replace function public.jsonb_diff(p_old jsonb, p_new jsonb, p_exclude text[] default '{}')
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k)), '{}'::jsonb)
  from (
    select key as k from jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as key
  ) keys
  where not (k = any (p_exclude))
    and (p_old -> k) is distinct from (p_new -> k)
$$;

create or replace function public.bkk_day_start(p_date date)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (p_date::timestamp at time zone 'Asia/Bangkok')
$$;

-- =============================================================================
-- 3. TABLES
-- =============================================================================

-- 3.1 profiles (1:1 with auth.users)
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text,
  full_name     text not null default '',
  role          public.user_role not null default 'sales',
  department_id uuid,
  is_sr_lead    boolean not null default false,
  is_active     boolean not null default false,
  lark_user_id  text,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_sr_lead_chk check (not is_sr_lead or role = 'sr')
);
comment on column public.profiles.is_active is 'New sign-ups are inactive until an Admin activates them and sets the role.';
comment on column public.profiles.is_sr_lead is 'SR Lead may assign/re-assign tickets to other SRs.';

-- 3.2 departments
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  manager_id  uuid references public.profiles (id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_department_fk foreign key (department_id)
  references public.departments (id) on delete set null;

-- 3.3 product_groups (tree: parent → child, e.g. Solar > Inverter)
create table public.product_groups (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null,
  name_en            text,
  parent_id          uuid references public.product_groups (id) on delete restrict,
  checklist_template jsonb not null default '[]'::jsonb,
  sort_order         int not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint product_groups_template_is_array check (jsonb_typeof(checklist_template) = 'array'),
  constraint product_groups_not_self_parent check (parent_id is null or parent_id <> id)
);
comment on column public.product_groups.checklist_template is
  'JSON array: [{"key":"spec","label":"Spec สินค้า","required":true}]. Child groups inherit parent templates.';

-- 3.4 vendors (optional master for autocomplete & history)
create table public.vendors (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) > 0),
  tax_id            text,
  contact_name      text,
  phone             text,
  email             text,
  country           text,
  default_currency  char(3) not null default 'THB' check (default_currency ~ '^[A-Z]{3}$'),
  default_vat_term  public.vat_term,
  note              text,
  is_active         boolean not null default true,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index vendors_name_uidx on public.vendors (lower(btrim(name)));

-- 3.5 app_settings (vat_rate, sla_hours, ...)
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- 3.6 ticket number counter (one row per year, row-locked by upsert → no duplicates)
create table public.ticket_counters (
  year    int primary key,
  last_no int not null default 0
);

-- 3.7 tickets
create table public.tickets (
  id                  uuid primary key default gen_random_uuid(),
  ticket_no           text not null unique,
  title               text not null check (char_length(btrim(title)) between 3 and 200),
  description         text,
  customer_name       text,
  priority            public.ticket_priority not null default 'normal',
  status              public.ticket_status not null default 'requested',
  stage               public.ticket_stage not null default 'pending_manager',
  requestor_id        uuid not null references public.profiles (id),
  department_id       uuid not null references public.departments (id),
  manager_id          uuid references public.profiles (id),
  gm_id               uuid references public.profiles (id),
  sr_id               uuid references public.profiles (id),
  due_date            date,
  revision_count      int not null default 0 check (revision_count >= 0),
  version             int not null default 1,
  info_request        jsonb,
  rejection_reason    text,
  stage_entered_at    timestamptz not null default now(),
  submitted_at        timestamptz not null default now(),
  manager_approved_at timestamptz,
  gm_approved_at      timestamptz,
  assigned_at         timestamptz,
  doc_checked_at      timestamptz,
  completed_at        timestamptz,
  closed_at           timestamptz,
  rejected_at         timestamptz,
  cancelled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tickets_status_stage_chk check (status = public.stage_status(stage))
);
comment on column public.tickets.version is 'Optimistic lock. Incremented on every UPDATE.';
comment on column public.tickets.info_request is 'Open "need_info" request from SR: {items, comment, requested_by, requested_at, return_stage}.';

-- 3.8 ticket_items
create table public.ticket_items (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         uuid not null references public.tickets (id) on delete cascade,
  line_no           int not null check (line_no > 0),
  product_group_id  uuid not null references public.product_groups (id),
  product_name      text not null check (char_length(btrim(product_name)) > 0),
  spec              text,
  description       text,
  qty               numeric(18, 4) not null check (qty > 0),
  uom               text not null check (char_length(btrim(uom)) > 0),
  target_price      numeric(18, 4) check (target_price >= 0),
  target_currency   char(3) not null default 'THB' check (target_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ticket_items_line_uq unique (ticket_id, line_no)
);

-- 3.9 vendor_quotations (max 3 per item, max 1 winner per item)
create table public.vendor_quotations (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references public.ticket_items (id) on delete cascade,
  ticket_id             uuid not null references public.tickets (id) on delete cascade,
  vendor_id             uuid references public.vendors (id) on delete set null,
  vendor_name           text not null check (char_length(btrim(vendor_name)) > 0),
  unit_price            numeric(18, 4) not null check (unit_price >= 0),
  currency              char(3) not null default 'THB' check (currency ~ '^[A-Z]{3}$'),
  fx_rate               numeric(18, 6) not null default 1 check (fx_rate > 0),
  vat_term              public.vat_term not null default 'ex_vat',
  vat_rate              numeric(6, 4) not null default 0.07 check (vat_rate >= 0 and vat_rate < 1),
  moq                   numeric(18, 4) check (moq >= 0),
  lead_time_days        int check (lead_time_days >= 0),
  payment_term          text,
  valid_until           date,
  remark                text,
  attachment_path       text,
  is_selected           boolean not null default false,
  selection_reason      text,
  -- Normalised cost (VAT rate snapshot is copied from app_settings on INSERT,
  -- so historical comparisons never change when the rate changes).
  -- ex_vat     : net = price               (input VAT 7% is reclaimable)
  -- include_vat: net = price / (1 + rate)
  -- no_vat     : net = price               (vendor not VAT-registered, nothing to reclaim)
  net_unit_cost         numeric(20, 6) generated always as (
                          case when vat_term = 'include_vat' then unit_price / (1 + vat_rate) else unit_price end
                        ) stored,
  net_unit_cost_thb     numeric(20, 6) generated always as (
                          (case when vat_term = 'include_vat' then unit_price / (1 + vat_rate) else unit_price end) * fx_rate
                        ) stored,
  -- Cash price incl. VAT where the vendor charges VAT
  gross_unit_price_thb  numeric(20, 6) generated always as (
                          (case when vat_term = 'ex_vat' then unit_price * (1 + vat_rate) else unit_price end) * fx_rate
                        ) stored,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vq_thb_fx_chk check (currency <> 'THB' or fx_rate = 1),
  constraint vq_reason_only_when_selected check (is_selected or selection_reason is null)
);
create unique index vq_one_winner_per_item on public.vendor_quotations (item_id) where is_selected;

-- 3.10 ticket_checklist (generated from product group templates when SR takes the job)
create table public.ticket_checklist (
  id               uuid primary key default gen_random_uuid(),
  ticket_id        uuid not null references public.tickets (id) on delete cascade,
  product_group_id uuid references public.product_groups (id),
  item_key         text not null,
  label            text not null,
  is_required      boolean not null default true,
  sort_order       int not null default 0,
  is_checked       boolean not null default false,
  checked_by       uuid references public.profiles (id),
  checked_at       timestamptz,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ticket_checklist_uq unique nulls not distinct (ticket_id, product_group_id, item_key)
);

-- 3.11 ticket_attachments (metadata of files in Storage bucket "ticket-files")
create table public.ticket_attachments (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.tickets (id) on delete cascade,
  item_id       uuid references public.ticket_items (id) on delete set null,
  quotation_id  uuid references public.vendor_quotations (id) on delete set null,
  category      text not null default 'request'
                check (category in ('request', 'info_response', 'quotation', 'other')),
  file_name     text not null,
  file_path     text not null unique,
  mime_type     text,
  size_bytes    bigint check (size_bytes >= 0 and size_bytes <= 20971520),
  uploaded_by   uuid not null references public.profiles (id),
  created_at    timestamptz not null default now(),
  constraint ticket_attachments_path_chk check (file_path like 'tickets/' || ticket_id::text || '/%')
);

-- 3.12 ticket_logs (APPEND-ONLY audit trail)
create table public.ticket_logs (
  id                     bigint generated always as identity primary key,
  ticket_id              uuid not null references public.tickets (id) on delete restrict,
  log_type               public.log_type not null,
  actor_id               uuid references public.profiles (id),
  actor_role             public.user_role,
  action                 text not null,
  from_status            public.ticket_status,
  to_status              public.ticket_status,
  from_stage             public.ticket_stage,
  to_stage               public.ticket_stage,
  comment                text,
  metadata               jsonb not null default '{}'::jsonb,
  stage_duration_seconds numeric(14, 2),
  created_at             timestamptz not null default now()
);
comment on column public.ticket_logs.stage_duration_seconds is
  'Time spent in from_stage (set on transitions that change stage). Used for cycle-time / bottleneck analytics.';

-- 3.13 notifications (in-app; INSERT is relayed to Lark/Email via Database Webhook → Edge Function)
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  ticket_id   uuid references public.tickets (id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  read_at     timestamptz,
  delivery    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
comment on column public.notifications.delivery is 'External channel delivery status written by the Edge Function, e.g. {"lark":"sent","email":"failed"}.';

-- 3.14 sla_alerts (dedupe: one warning + one breach per ticket per stage visit)
create table public.sla_alerts (
  id               bigint generated always as identity primary key,
  ticket_id        uuid not null references public.tickets (id) on delete cascade,
  stage            public.ticket_stage not null,
  stage_entered_at timestamptz not null,
  level            text not null check (level in ('warning', 'breach')),
  created_at       timestamptz not null default now(),
  constraint sla_alerts_uq unique (ticket_id, stage, stage_entered_at, level)
);

-- =============================================================================
-- 4. INDEXES
-- =============================================================================
create index profiles_role_idx            on public.profiles (role) where is_active;
create index profiles_department_idx      on public.profiles (department_id);
create index departments_manager_idx      on public.departments (manager_id);
create index product_groups_parent_idx    on public.product_groups (parent_id);
create index vendors_created_by_idx       on public.vendors (created_by);
create index vendors_name_trgm_idx        on public.vendors using gin (name extensions.gin_trgm_ops);

create index tickets_status_stage_idx     on public.tickets (status, stage);
create index tickets_requestor_idx        on public.tickets (requestor_id, created_at desc);
create index tickets_department_idx       on public.tickets (department_id);
create index tickets_manager_idx          on public.tickets (manager_id);
create index tickets_gm_idx               on public.tickets (gm_id);
create index tickets_sr_idx               on public.tickets (sr_id, status);
create index tickets_created_idx          on public.tickets (created_at desc);
create index tickets_completed_idx        on public.tickets (completed_at) where completed_at is not null;
create index tickets_priority_idx         on public.tickets (priority);
create index tickets_title_trgm_idx       on public.tickets using gin (title extensions.gin_trgm_ops);
create index tickets_open_stage_idx       on public.tickets (stage, stage_entered_at)
  where status in ('requested', 'on_process', 'completed');

create index ticket_items_ticket_idx      on public.ticket_items (ticket_id);
create index ticket_items_group_idx       on public.ticket_items (product_group_id);
create index ticket_items_name_trgm_idx   on public.ticket_items using gin (product_name extensions.gin_trgm_ops);

create index vq_item_idx                  on public.vendor_quotations (item_id);
create index vq_ticket_idx                on public.vendor_quotations (ticket_id);
create index vq_vendor_idx                on public.vendor_quotations (vendor_id);
create index vq_created_by_idx            on public.vendor_quotations (created_by);
create index vq_selected_idx              on public.vendor_quotations (ticket_id) where is_selected;

create index ticket_checklist_ticket_idx  on public.ticket_checklist (ticket_id);
create index ticket_checklist_group_idx   on public.ticket_checklist (product_group_id);
create index ticket_checklist_checker_idx on public.ticket_checklist (checked_by);

create index ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);
create index ticket_attachments_item_idx   on public.ticket_attachments (item_id);
create index ticket_attachments_quote_idx  on public.ticket_attachments (quotation_id);
create index ticket_attachments_user_idx   on public.ticket_attachments (uploaded_by);

create index ticket_logs_ticket_idx       on public.ticket_logs (ticket_id, created_at);
create index ticket_logs_actor_idx        on public.ticket_logs (actor_id);
create index ticket_logs_transition_idx   on public.ticket_logs (created_at, from_stage)
  where log_type = 'transition';

create index notifications_user_idx       on public.notifications (user_id, is_read, created_at desc);
create index notifications_ticket_idx     on public.notifications (ticket_id);
create index sla_alerts_ticket_idx        on public.sla_alerts (ticket_id);

-- =============================================================================
-- 5. SECURITY HELPER FUNCTIONS (used by RLS)
-- =============================================================================
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'admin', false)
$$;

create or replace function public.is_sr_lead()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_sr_lead from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'sr'
  ), false)
$$;

-- Single source of truth for "who can see which ticket".
create or replace function public.is_ticket_visible(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case public.auth_role()
      when 'admin'   then true
      when 'gm'      then true
      when 'sales'   then t.requestor_id = (select auth.uid())
      when 'manager' then t.manager_id = (select auth.uid())
                          or exists (select 1 from public.departments d
                                     where d.id = t.department_id and d.manager_id = (select auth.uid()))
      when 'sr'      then t.gm_approved_at is not null
      else false
    end
    from public.tickets t
    where t.id = p_ticket_id
  ), false)
$$;

-- Sales may edit header/items only before Manager approval (or after Manager returned it).
create or replace function public.can_edit_ticket_request(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and t.requestor_id = (select auth.uid())
      and t.stage in ('pending_manager', 'returned')
      and public.auth_role() = 'sales'
  )
$$;

create or replace function public.can_upload_ticket_files(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and (
        (public.auth_role() = 'sales' and t.requestor_id = (select auth.uid())
          and t.stage in ('pending_manager', 'returned', 'need_info'))
        or
        (public.auth_role() = 'sr' and t.sr_id = (select auth.uid()) and t.status = 'on_process')
      )
  )
$$;

-- Quotations: SR / GM / Admin always; Sales & Manager only once prices are submitted.
create or replace function public.can_view_quotations(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_ticket_visible(p_ticket_id) and (
    public.auth_role() in ('admin', 'gm', 'sr')
    or exists (select 1 from public.tickets t
               where t.id = p_ticket_id and t.status in ('completed', 'closed'))
  )
$$;

create or replace function public.can_edit_quotations(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and t.sr_id = (select auth.uid())
      and t.stage = 'sourcing'
      and public.auth_role() = 'sr'
  )
$$;

create or replace function public.can_edit_checklist(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and t.sr_id = (select auth.uid())
      and t.stage = 'doc_check'
      and public.auth_role() = 'sr'
  )
$$;

-- =============================================================================
-- 6. SETTINGS / UTILITY FUNCTIONS
-- =============================================================================
create or replace function public.get_setting(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.value from public.app_settings s where s.key = p_key
$$;

create or replace function public.current_vat_rate()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((public.get_setting('vat_rate') #>> '{}')::numeric, 0.07)
$$;

create or replace function public.next_ticket_no()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from (now() at time zone 'Asia/Bangkok'))::int;
  v_no   int;
begin
  -- The upsert takes a row lock on the year row, serialising concurrent callers.
  insert into public.ticket_counters as c (year, last_no)
  values (v_year, 1)
  on conflict (year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;

  return format('PR-%s-%s', v_year, lpad(v_no::text, 4, '0'));
end;
$$;

-- Users responsible for acting on a ticket in its current stage.
create or replace function public.stage_assignees(p_ticket public.tickets)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case p_ticket.stage
    when 'pending_manager'    then array[coalesce(
                                   (select d.manager_id from public.departments d where d.id = p_ticket.department_id),
                                   p_ticket.manager_id)]
    when 'returned'           then array[p_ticket.requestor_id]
    when 'pending_gm'         then (select array_agg(p.id) from public.profiles p where p.role = 'gm' and p.is_active)
    when 'pending_assign'     then (select array_agg(p.id) from public.profiles p where p.role = 'sr' and p.is_active)
    when 'doc_check'          then array[p_ticket.sr_id]
    when 'sourcing'           then array[p_ticket.sr_id]
    when 'need_info'          then array[p_ticket.requestor_id]
    when 'awaiting_sales_ack' then array[p_ticket.requestor_id]
    else null
  end, '{}'::uuid[])
$$;

-- Supervisors to escalate to when an SLA is breached.
create or replace function public.stage_escalation(p_ticket public.tickets)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(case
    when p_ticket.stage = 'pending_manager'
      then (select array_agg(p.id) from public.profiles p where p.role = 'gm' and p.is_active)
    when p_ticket.stage in ('pending_assign', 'doc_check', 'sourcing')
      then (select array_agg(p.id) from public.profiles p where p.role = 'sr' and p.is_sr_lead and p.is_active)
    when p_ticket.stage in ('returned', 'need_info', 'awaiting_sales_ack')
      then (select array_agg(d.manager_id) from public.departments d
            where d.id = p_ticket.department_id and d.manager_id is not null)
    else null
  end, '{}'::uuid[])
$$;

create or replace function public._notify(
  p_user_ids uuid[], p_ticket_id uuid, p_type text, p_title text, p_body text, p_link text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, ticket_id, type, title, body, link)
  select distinct u, p_ticket_id, p_type, p_title, p_body, p_link
  from unnest(p_user_ids) as u
  join public.profiles p on p.id = u and p.is_active
  where u is not null
    and u is distinct from (select auth.uid())
$$;

-- Build the checklist for a ticket from the templates of its items' product groups
-- (including every ancestor group, e.g. Solar template + Inverter template).
create or replace function public._generate_checklist(p_ticket_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with recursive item_groups as (
    select distinct i.product_group_id as id
    from public.ticket_items i
    where i.ticket_id = p_ticket_id
  ),
  tree as (
    select g.id, g.parent_id, g.checklist_template, g.sort_order, 0 as depth
    from public.product_groups g
    join item_groups ig on ig.id = g.id
    union all
    select p.id, p.parent_id, p.checklist_template, p.sort_order, tree.depth + 1
    from public.product_groups p
    join tree on p.id = tree.parent_id
    where tree.depth < 10
  ),
  groups as (
    select id, checklist_template, min(depth) as depth
    from tree
    group by id, checklist_template
  )
  insert into public.ticket_checklist (ticket_id, product_group_id, item_key, label, is_required, sort_order)
  select p_ticket_id,
         g.id,
         e.elem ->> 'key',
         coalesce(nullif(e.elem ->> 'label', ''), e.elem ->> 'key'),
         coalesce((e.elem ->> 'required')::boolean, true),
         ((10 - g.depth) * 1000 + e.ord)::int
  from groups g
  cross join lateral jsonb_array_elements(g.checklist_template) with ordinality as e(elem, ord)
  where coalesce(e.elem ->> 'key', '') <> ''
  on conflict on constraint ticket_checklist_uq do nothing
$$;

-- =============================================================================
-- 7. TRIGGER FUNCTIONS
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- New auth user → inactive Sales profile (role from metadata is NOT trusted).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only Admin may change role / department / activation / SR lead flag.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_admin() then
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.department_id is distinct from old.department_id
       or new.is_sr_lead is distinct from old.is_sr_lead
       or new.is_active is distinct from old.is_active then
      perform public.app_error('FORBIDDEN', 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยน role / แผนก / สถานะผู้ใช้ได้');
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.departments_validate_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.manager_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.manager_id and p.role = 'manager'
  ) then
    perform public.app_error('INVALID_MANAGER', 'ผู้จัดการแผนกต้องเป็นผู้ใช้ที่มี role = Manager');
  end if;
  return new;
end;
$$;

create or replace function public.product_groups_prevent_cycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and exists (
    with recursive anc as (
      select g.id, g.parent_id from public.product_groups g where g.id = new.parent_id
      union all
      select g.id, g.parent_id from public.product_groups g join anc on g.id = anc.parent_id
    )
    select 1 from anc where anc.id = new.id
  ) then
    perform public.app_error('INVALID_PARENT', 'โครงสร้างกลุ่มสินค้าวนซ้ำ (parent เป็นลูกของตัวเอง)');
  end if;
  return new;
end;
$$;

create or replace function public.app_settings_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  if new.key = 'vat_rate' and ((new.value #>> '{}')::numeric < 0 or (new.value #>> '{}')::numeric >= 1) then
    perform public.app_error('INVALID_SETTING', 'vat_rate ต้องอยู่ระหว่าง 0 ถึง 1 (เช่น 0.07)');
  end if;
  return new;
end;
$$;

-- tickets: status / stage / ownership columns can only change inside transition_ticket().
create or replace function public.tickets_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_editable constant text[] := array['title', 'description', 'customer_name', 'priority', 'due_date'];
  v_ignore   constant text[] := array['title', 'description', 'customer_name', 'priority', 'due_date', 'updated_at', 'version'];
  v_in_tx    boolean := coalesce(current_setting('app.transition_ctx', true), '') = 'on';
  v_diff     jsonb;
begin
  if tg_op = 'INSERT' then
    if not v_in_tx then
      perform public.app_error('DIRECT_INSERT_FORBIDDEN', 'ต้องสร้างใบขอราคาผ่านฟังก์ชัน create_ticket เท่านั้น');
    end if;
    return new;
  end if;

  if not v_in_tx and (to_jsonb(new) - v_ignore) is distinct from (to_jsonb(old) - v_ignore) then
    perform public.app_error('DIRECT_UPDATE_FORBIDDEN',
      'ไม่อนุญาตให้แก้ไขสถานะหรือผู้รับผิดชอบโดยตรง ต้องทำผ่าน transition_ticket เท่านั้น');
  end if;

  new.version    := old.version + 1;
  new.updated_at := now();

  if not v_in_tx then
    v_diff := public.jsonb_diff(
      (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_editable) k),
      (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_editable) k));
    if v_diff <> '{}'::jsonb then
      insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
      values (new.id, 'data_change', (select auth.uid()), public.auth_role(), 'ticket_updated',
              jsonb_build_object('diff', v_diff));
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.ticket_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001',
    message = 'ประวัติการทำรายการ (ticket_logs) แก้ไขหรือลบไม่ได้',
    hint = 'LOG_IMMUTABLE';
end;
$$;

create or replace function public.ticket_items_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.ticket_id is distinct from old.ticket_id then
    perform public.app_error('IMMUTABLE_FIELD', 'ย้ายรายการสินค้าไปใบอื่นไม่ได้');
  end if;

  if (tg_op = 'INSERT' or new.product_group_id is distinct from old.product_group_id)
     and not exists (select 1 from public.product_groups g where g.id = new.product_group_id and g.is_active) then
    perform public.app_error('INVALID_PRODUCT_GROUP', 'กลุ่มสินค้าไม่ถูกต้องหรือถูกปิดใช้งาน');
  end if;

  if tg_op = 'INSERT' and new.line_no is null then
    perform 1 from public.tickets t where t.id = new.ticket_id for update;
    select coalesce(max(i.line_no), 0) + 1 into new.line_no
    from public.ticket_items i where i.ticket_id = new.ticket_id;
  end if;

  return new;
end;
$$;

create or replace function public.ticket_items_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex constant text[] := array['created_at', 'updated_at'];
  v_diff jsonb;
begin
  -- Items created inside create_ticket() are covered by the "create" log.
  if coalesce(current_setting('app.transition_ctx', true), '') = 'on' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'item_added',
            jsonb_build_object('item_id', new.id, 'line_no', new.line_no, 'new', to_jsonb(new) - v_ex));
  elsif tg_op = 'UPDATE' then
    v_diff := public.jsonb_diff(to_jsonb(old), to_jsonb(new), v_ex);
    if v_diff <> '{}'::jsonb then
      insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
      values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'item_updated',
              jsonb_build_object('item_id', new.id, 'line_no', new.line_no, 'diff', v_diff));
    end if;
  else
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (old.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'item_deleted',
            jsonb_build_object('item_id', old.id, 'line_no', old.line_no, 'old', to_jsonb(old) - v_ex));
  end if;
  return null;
end;
$$;

create or replace function public.vendor_quotations_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if tg_op = 'INSERT' then
    -- Lock the parent item so two concurrent inserts cannot both pass the "< 3" check.
    select i.ticket_id into new.ticket_id
    from public.ticket_items i where i.id = new.item_id
    for update;
    if new.ticket_id is null then
      perform public.app_error('ITEM_NOT_FOUND', 'ไม่พบรายการสินค้า');
    end if;

    select count(*) into v_count from public.vendor_quotations q where q.item_id = new.item_id;
    if v_count >= 3 then
      perform public.app_error('MAX_VENDORS', 'แต่ละรายการสินค้าใส่ราคา vendor ได้ไม่เกิน 3 เจ้า');
    end if;

    new.vat_rate   := public.current_vat_rate();
    new.created_by := coalesce((select auth.uid()), new.created_by);
  else
    if new.item_id is distinct from old.item_id or new.ticket_id is distinct from old.ticket_id then
      perform public.app_error('IMMUTABLE_FIELD', 'ย้ายใบเสนอราคาไปยังรายการอื่นไม่ได้');
    end if;
    new.vat_rate   := old.vat_rate;
    new.created_by := old.created_by;
  end if;

  new.vendor_name := btrim(new.vendor_name);
  if new.vendor_id is null then
    select v.id into new.vendor_id from public.vendors v
    where lower(btrim(v.name)) = lower(new.vendor_name) limit 1;
  end if;

  if not new.is_selected then
    new.selection_reason := null;
  else
    new.selection_reason := nullif(btrim(coalesce(new.selection_reason, '')), '');
  end if;

  if new.attachment_path is not null
     and new.attachment_path not like 'tickets/' || new.ticket_id::text || '/%' then
    perform public.app_error('INVALID_PATH', 'ไฟล์ใบเสนอราคาต้องอยู่ในโฟลเดอร์ของใบขอราคานี้');
  end if;

  return new;
end;
$$;

create or replace function public.vendor_quotations_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex constant text[] := array['created_at', 'updated_at', 'net_unit_cost', 'net_unit_cost_thb', 'gross_unit_price_thb'];
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'quotation_added',
            jsonb_build_object('item_id', new.item_id, 'quotation_id', new.id, 'new', to_jsonb(new) - v_ex));
  elsif tg_op = 'UPDATE' then
    v_diff := public.jsonb_diff(to_jsonb(old), to_jsonb(new), v_ex);
    if v_diff <> '{}'::jsonb then
      insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
      values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'quotation_updated',
              jsonb_build_object('item_id', new.item_id, 'quotation_id', new.id, 'vendor_name', new.vendor_name, 'diff', v_diff));
    end if;
  else
    -- Skip when the whole ticket/item is being cascaded away.
    if exists (select 1 from public.tickets t where t.id = old.ticket_id) then
      insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
      values (old.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'quotation_deleted',
              jsonb_build_object('item_id', old.item_id, 'quotation_id', old.id, 'old', to_jsonb(old) - v_ex));
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.ticket_checklist_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_checked is distinct from old.is_checked then
    if new.is_checked then
      new.checked_by := (select auth.uid());
      new.checked_at := now();
    else
      new.checked_by := null;
      new.checked_at := null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.ticket_checklist_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_checked is distinct from old.is_checked or new.note is distinct from old.note then
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'checklist_updated',
            jsonb_build_object('item_key', new.item_key, 'label', new.label,
                               'diff', public.jsonb_diff(
                                 jsonb_build_object('is_checked', old.is_checked, 'note', old.note),
                                 jsonb_build_object('is_checked', new.is_checked, 'note', new.note))));
  end if;
  return null;
end;
$$;

create or replace function public.ticket_attachments_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.uploaded_by := coalesce((select auth.uid()), new.uploaded_by);

  if new.item_id is not null and not exists (
    select 1 from public.ticket_items i where i.id = new.item_id and i.ticket_id = new.ticket_id
  ) then
    perform public.app_error('INVALID_ITEM', 'รายการสินค้าไม่ได้อยู่ในใบขอราคานี้');
  end if;

  if new.quotation_id is not null and not exists (
    select 1 from public.vendor_quotations q where q.id = new.quotation_id and q.ticket_id = new.ticket_id
  ) then
    perform public.app_error('INVALID_QUOTATION', 'ใบเสนอราคาไม่ได้อยู่ในใบขอราคานี้');
  end if;

  return new;
end;
$$;

create or replace function public.ticket_attachments_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (new.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'attachment_added',
            jsonb_build_object('attachment_id', new.id, 'file_name', new.file_name, 'file_path', new.file_path,
                               'category', new.category, 'item_id', new.item_id));
  elsif exists (select 1 from public.tickets t where t.id = old.ticket_id) then
    insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, metadata)
    values (old.ticket_id, 'data_change', (select auth.uid()), public.auth_role(), 'attachment_removed',
            jsonb_build_object('attachment_id', old.id, 'file_name', old.file_name, 'file_path', old.file_path,
                               'category', old.category, 'item_id', old.item_id));
  end if;
  return null;
end;
$$;

-- =============================================================================
-- 8. TRIGGERS
-- =============================================================================
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at        before update on public.profiles        for each row execute function public.set_updated_at();
create trigger profiles_guard_trg         before update on public.profiles        for each row execute function public.profiles_guard();
create trigger departments_updated_at     before update on public.departments     for each row execute function public.set_updated_at();
create trigger departments_manager_trg    before insert or update of manager_id on public.departments
  for each row execute function public.departments_validate_manager();
create trigger product_groups_updated_at  before update on public.product_groups  for each row execute function public.set_updated_at();
create trigger product_groups_cycle_trg   before insert or update of parent_id on public.product_groups
  for each row execute function public.product_groups_prevent_cycle();
create trigger vendors_updated_at         before update on public.vendors         for each row execute function public.set_updated_at();
create trigger app_settings_stamp_trg     before insert or update on public.app_settings for each row execute function public.app_settings_stamp();

create trigger tickets_guard_trg          before insert or update on public.tickets for each row execute function public.tickets_guard();

create trigger ticket_items_updated_at    before update on public.ticket_items    for each row execute function public.set_updated_at();
create trigger ticket_items_before_trg    before insert or update on public.ticket_items for each row execute function public.ticket_items_before();
create trigger ticket_items_log_trg       after insert or update or delete on public.ticket_items for each row execute function public.ticket_items_log();

create trigger vq_updated_at              before update on public.vendor_quotations for each row execute function public.set_updated_at();
create trigger vq_before_trg              before insert or update on public.vendor_quotations for each row execute function public.vendor_quotations_before();
create trigger vq_log_trg                 after insert or update or delete on public.vendor_quotations for each row execute function public.vendor_quotations_log();

create trigger ticket_checklist_updated_at before update on public.ticket_checklist for each row execute function public.set_updated_at();
create trigger ticket_checklist_before_trg before update on public.ticket_checklist for each row execute function public.ticket_checklist_before();
create trigger ticket_checklist_log_trg    after update on public.ticket_checklist for each row execute function public.ticket_checklist_log();

create trigger ticket_attachments_before_trg before insert on public.ticket_attachments for each row execute function public.ticket_attachments_before();
create trigger ticket_attachments_log_trg    after insert or delete on public.ticket_attachments for each row execute function public.ticket_attachments_log();

create trigger ticket_logs_no_update   before update or delete on public.ticket_logs for each row execute function public.ticket_logs_immutable();
create trigger ticket_logs_no_truncate before truncate on public.ticket_logs for each statement execute function public.ticket_logs_immutable();

-- =============================================================================
-- 9. WORKFLOW RPCs
-- =============================================================================

-- 9.1 create_ticket — the only way to insert a ticket.
-- p_header: {title, description?, customer_name?, priority?, due_date?}
-- p_items : [{product_group_id, product_name, spec?, description?, qty, uom, target_price?, target_currency?}]
create or replace function public.create_ticket(p_header jsonb, p_items jsonb)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_profile public.profiles;
  v_manager uuid;
  v_ticket  public.tickets;
  v_item    jsonb;
  v_line    int := 0;
begin
  if v_uid is null then
    perform public.app_error('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อนทำรายการ');
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid and p.is_active;
  if v_profile.id is null or v_profile.role <> 'sales' then
    perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เท่านั้นที่สร้างใบขอราคาได้');
  end if;
  if v_profile.department_id is null then
    perform public.app_error('NO_DEPARTMENT', 'บัญชีของคุณยังไม่ได้ผูกกับแผนก กรุณาติดต่อผู้ดูแลระบบ');
  end if;

  select d.manager_id into v_manager from public.departments d
  where d.id = v_profile.department_id and d.is_active;
  if v_manager is null then
    perform public.app_error('NO_MANAGER', 'แผนกของคุณยังไม่ได้กำหนด Manager ผู้อนุมัติ กรุณาติดต่อผู้ดูแลระบบ');
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    perform public.app_error('NO_ITEMS', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
  end if;
  if jsonb_array_length(p_items) > 100 then
    perform public.app_error('TOO_MANY_ITEMS', 'ใบขอราคา 1 ใบมีได้ไม่เกิน 100 รายการ');
  end if;

  perform set_config('app.transition_ctx', 'on', true);

  insert into public.tickets (ticket_no, title, description, customer_name, priority, due_date,
                              requestor_id, department_id, manager_id)
  values (
    public.next_ticket_no(),
    btrim(coalesce(p_header ->> 'title', '')),
    nullif(btrim(coalesce(p_header ->> 'description', '')), ''),
    nullif(btrim(coalesce(p_header ->> 'customer_name', '')), ''),
    coalesce(nullif(p_header ->> 'priority', '')::public.ticket_priority, 'normal'),
    nullif(p_header ->> 'due_date', '')::date,
    v_uid, v_profile.department_id, v_manager
  )
  returning * into v_ticket;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    insert into public.ticket_items (ticket_id, line_no, product_group_id, product_name, spec, description,
                                     qty, uom, target_price, target_currency)
    values (
      v_ticket.id, v_line,
      (v_item ->> 'product_group_id')::uuid,
      btrim(coalesce(v_item ->> 'product_name', '')),
      nullif(btrim(coalesce(v_item ->> 'spec', '')), ''),
      nullif(btrim(coalesce(v_item ->> 'description', '')), ''),
      (v_item ->> 'qty')::numeric,
      btrim(coalesce(v_item ->> 'uom', '')),
      nullif(v_item ->> 'target_price', '')::numeric,
      coalesce(nullif(v_item ->> 'target_currency', ''), 'THB')
    );
  end loop;

  insert into public.ticket_logs (ticket_id, log_type, actor_id, actor_role, action, to_status, to_stage, metadata)
  values (v_ticket.id, 'transition', v_uid, 'sales', 'create', v_ticket.status, v_ticket.stage,
          jsonb_build_object('ticket_no', v_ticket.ticket_no, 'item_count', v_line));

  perform set_config('app.transition_ctx', 'off', true);

  perform public._notify(public.stage_assignees(v_ticket), v_ticket.id, 'approval_required',
    format('[%s] ใบขอราคาใหม่รออนุมัติ', v_ticket.ticket_no),
    format('%s — %s', v_ticket.title, v_profile.full_name),
    '/tickets/' || v_ticket.id);

  return v_ticket;
end;
$$;

-- 9.2 transition_ticket — the ONLY way to change status / stage / assignee.
--
-- Actions (role → allowed from-stage → to-stage):
--   resubmit          sales(owner)     returned                         → pending_manager
--   cancel            sales(owner)     pending_manager|returned|pending_gm → cancelled      (comment optional)
--   manager_approve   manager(dept)    pending_manager                  → pending_gm
--   manager_reject    manager(dept)    pending_manager                  → rejected       (comment required)
--   manager_return    manager(dept)    pending_manager                  → returned       (comment required)
--   gm_approve        gm               pending_gm                       → pending_assign
--   gm_reject         gm               pending_gm                       → rejected       (comment required)
--   claim             sr               pending_assign                   → doc_check
--   assign            sr lead | admin  pending_assign|doc_check|need_info|sourcing → (doc_check | same)
--                     payload.sr_id required
--   request_info      sr(assigned)     doc_check|sourcing               → need_info      (comment required,
--                     payload.missing_items: text[] optional)
--   respond_info      sales(owner)     need_info                        → stage SR asked from (comment required)
--   doc_complete      sr(assigned)     doc_check                        → sourcing  (all required checklist ticked)
--   submit_quote      sr(assigned)     sourcing                         → awaiting_sales_ack
--   accept            sales(owner)     awaiting_sales_ack               → closed
--   request_revision  sales(owner)     awaiting_sales_ack               → sourcing       (comment required)
--
-- p_payload.expected_version (int) is REQUIRED — optimistic locking.
create or replace function public.transition_ticket(
  p_ticket_id uuid,
  p_action    text,
  p_comment   text default null,
  p_payload   jsonb default '{}'::jsonb
)
returns public.tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_role      public.user_role;
  v_is_lead   boolean;
  v_comment   text := nullif(btrim(coalesce(p_comment, '')), '');
  v_payload   jsonb := coalesce(p_payload, '{}'::jsonb);
  v_now       timestamptz := now();
  v_expected  int;
  t           public.tickets;   -- before
  n           public.tickets;   -- after
  v_meta      jsonb := '{}'::jsonb;
  v_target_sr uuid;
  v_list      text;
  v_dept_mgr  uuid;
  v_title     text;
  v_body      text;
  v_type      text := 'status_changed';
  v_link      text;
  v_extra     uuid[] := '{}'::uuid[];
begin
  if v_uid is null then
    perform public.app_error('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อนทำรายการ');
  end if;

  select p.role, p.is_sr_lead into v_role, v_is_lead
  from public.profiles p where p.id = v_uid and p.is_active;
  if v_role is null then
    perform public.app_error('INACTIVE_USER', 'บัญชีผู้ใช้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if t.id is null or not public.is_ticket_visible(p_ticket_id) then
    perform public.app_error('NOT_FOUND', 'ไม่พบใบขอราคา หรือคุณไม่มีสิทธิ์เข้าถึง');
  end if;

  if not (v_payload ? 'expected_version') then
    perform public.app_error('VERSION_REQUIRED', 'ข้อมูลไม่ครบ (expected_version) กรุณารีเฟรชหน้าจอแล้วลองใหม่');
  end if;
  v_expected := (v_payload ->> 'expected_version')::int;
  if v_expected <> t.version then
    perform public.app_error('VERSION_CONFLICT',
      'ใบขอราคานี้ถูกอัปเดตโดยผู้ใช้อื่นแล้ว กรุณารีเฟรชหน้าจอแล้วลองใหม่');
  end if;

  n := t;

  case p_action
  -- ---------------------------------------------------------------- Sales
  when 'resubmit' then
    if v_role <> 'sales' or t.requestor_id <> v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เจ้าของใบเท่านั้นที่ส่งใบขอราคาใหม่ได้');
    end if;
    if t.stage <> 'returned' then
      perform public.app_error('INVALID_STATE', format('ส่งใหม่ไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    if not exists (select 1 from public.ticket_items i where i.ticket_id = t.id) then
      perform public.app_error('NO_ITEMS', 'ต้องมีรายการสินค้าอย่างน้อย 1 รายการ');
    end if;
    select d.manager_id into v_dept_mgr from public.departments d where d.id = t.department_id;
    if v_dept_mgr is null then
      perform public.app_error('NO_MANAGER', 'แผนกของคุณยังไม่ได้กำหนด Manager ผู้อนุมัติ');
    end if;
    n.manager_id   := v_dept_mgr;
    n.stage        := 'pending_manager';
    n.submitted_at := v_now;

  when 'cancel' then
    if v_role <> 'sales' or t.requestor_id <> v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เจ้าของใบเท่านั้นที่ยกเลิกได้');
    end if;
    if t.stage not in ('pending_manager', 'returned', 'pending_gm') then
      perform public.app_error('INVALID_STATE', 'ยกเลิกได้เฉพาะก่อน GM อนุมัติเท่านั้น');
    end if;
    v_extra            := public.stage_assignees(t);   -- tell the approver who was waiting
    n.stage            := 'cancelled';
    n.cancelled_at     := v_now;
    n.rejection_reason := v_comment;

  -- ---------------------------------------------------------------- Manager
  when 'manager_approve', 'manager_reject', 'manager_return' then
    if v_role <> 'manager' then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Manager เท่านั้นที่ทำรายการนี้ได้');
    end if;
    if not exists (select 1 from public.departments d where d.id = t.department_id and d.manager_id = v_uid) then
      perform public.app_error('FORBIDDEN', 'คุณไม่ใช่ Manager ของแผนกผู้ขอราคา');
    end if;
    if t.requestor_id = v_uid then
      perform public.app_error('SELF_APPROVAL', 'ไม่สามารถอนุมัติใบขอราคาของตัวเองได้');
    end if;
    if t.stage <> 'pending_manager' then
      perform public.app_error('INVALID_STATE', format('ทำรายการไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    n.manager_id := v_uid;
    if p_action = 'manager_approve' then
      n.stage               := 'pending_gm';
      n.manager_approved_at := v_now;
      v_type                := 'approval_required';
    elsif p_action = 'manager_reject' then
      if v_comment is null then
        perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
      end if;
      n.stage            := 'rejected';
      n.rejected_at      := v_now;
      n.rejection_reason := v_comment;
    else
      if v_comment is null then
        perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุสิ่งที่ต้องการให้ Sales แก้ไข');
      end if;
      n.stage := 'returned';
    end if;

  -- ---------------------------------------------------------------- GM
  when 'gm_approve', 'gm_reject' then
    if v_role <> 'gm' then
      perform public.app_error('FORBIDDEN', 'เฉพาะ GM เท่านั้นที่ทำรายการนี้ได้');
    end if;
    if t.requestor_id = v_uid or t.manager_id = v_uid then
      perform public.app_error('SELF_APPROVAL', 'ไม่สามารถอนุมัติซ้ำหรืออนุมัติใบของตัวเองได้');
    end if;
    if t.stage <> 'pending_gm' then
      perform public.app_error('INVALID_STATE', format('ทำรายการไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    n.gm_id := v_uid;
    if p_action = 'gm_approve' then
      n.stage          := 'pending_assign';
      n.gm_approved_at := v_now;
      v_type           := 'job_available';
    else
      if v_comment is null then
        perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
      end if;
      n.stage            := 'rejected';
      n.rejected_at      := v_now;
      n.rejection_reason := v_comment;
    end if;

  -- ---------------------------------------------------------------- SR
  when 'claim' then
    if v_role <> 'sr' then
      perform public.app_error('FORBIDDEN', 'เฉพาะ SR เท่านั้นที่รับงานได้');
    end if;
    if t.stage <> 'pending_assign' then
      perform public.app_error('ALREADY_CLAIMED', 'งานนี้ถูกรับไปแล้วหรือไม่อยู่ในคิวรอรับงาน');
    end if;
    n.sr_id       := v_uid;
    n.stage       := 'doc_check';
    n.assigned_at := v_now;

  when 'assign' then
    if not (v_role = 'admin' or (v_role = 'sr' and v_is_lead)) then
      perform public.app_error('FORBIDDEN', 'เฉพาะ SR Lead หรือ Admin เท่านั้นที่มอบหมายงานได้');
    end if;
    if t.stage not in ('pending_assign', 'doc_check', 'need_info', 'sourcing') then
      perform public.app_error('INVALID_STATE', format('มอบหมายงานไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    v_target_sr := public.try_uuid(v_payload ->> 'sr_id');
    if v_target_sr is null or not exists (
      select 1 from public.profiles p where p.id = v_target_sr and p.role = 'sr' and p.is_active
    ) then
      perform public.app_error('INVALID_ASSIGNEE', 'ผู้รับงานต้องเป็น SR ที่ใช้งานอยู่');
    end if;
    if v_target_sr = t.sr_id then
      perform public.app_error('SAME_ASSIGNEE', 'งานนี้มอบหมายให้ SR คนนี้อยู่แล้ว');
    end if;
    v_meta        := jsonb_build_object('from_sr_id', t.sr_id, 'to_sr_id', v_target_sr);
    v_extra       := array[v_target_sr, t.sr_id];
    v_type        := 'job_assigned';
    n.sr_id       := v_target_sr;
    n.assigned_at := v_now;
    if t.stage = 'pending_assign' then
      n.stage := 'doc_check';
    end if;

  when 'request_info' then
    if v_role <> 'sr' or t.sr_id is distinct from v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ SR ผู้รับงานเท่านั้นที่ขอข้อมูลเพิ่มได้');
    end if;
    if t.stage not in ('doc_check', 'sourcing') then
      perform public.app_error('INVALID_STATE', format('ขอข้อมูลเพิ่มไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    if v_comment is null then
      perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุข้อมูล/เอกสารที่ต้องการเพิ่ม');
    end if;
    if v_payload ? 'missing_items' and jsonb_typeof(v_payload -> 'missing_items') <> 'array' then
      perform public.app_error('INVALID_PAYLOAD', 'missing_items ต้องเป็นรายการ (array)');
    end if;
    n.info_request := jsonb_build_object(
      'items',        coalesce(v_payload -> 'missing_items', '[]'::jsonb),
      'comment',      v_comment,
      'requested_by', v_uid,
      'requested_at', v_now,
      'return_stage', t.stage);
    n.stage := 'need_info';
    v_type  := 'info_requested';
    v_meta  := jsonb_build_object('missing_items', coalesce(v_payload -> 'missing_items', '[]'::jsonb));

  when 'respond_info' then
    if v_role <> 'sales' or t.requestor_id <> v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เจ้าของใบเท่านั้นที่ตอบกลับได้');
    end if;
    if t.stage <> 'need_info' then
      perform public.app_error('INVALID_STATE', 'ใบนี้ไม่ได้อยู่ในสถานะรอข้อมูลเพิ่ม');
    end if;
    if v_comment is null then
      perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุคำตอบหรือรายละเอียดที่ส่งเพิ่ม');
    end if;
    v_meta         := jsonb_build_object('info_request', t.info_request);
    n.stage        := coalesce((t.info_request ->> 'return_stage')::public.ticket_stage, 'doc_check');
    n.info_request := null;
    v_type         := 'info_provided';

  when 'doc_complete' then
    if v_role <> 'sr' or t.sr_id is distinct from v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ SR ผู้รับงานเท่านั้นที่ยืนยันเอกสารได้');
    end if;
    if t.stage <> 'doc_check' then
      perform public.app_error('INVALID_STATE', format('ทำรายการไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;
    select string_agg(c.label, ', ' order by c.sort_order) into v_list
    from public.ticket_checklist c
    where c.ticket_id = t.id and c.is_required and not c.is_checked;
    if v_list is not null then
      perform public.app_error('CHECKLIST_INCOMPLETE', 'ยังตรวจเอกสารไม่ครบ: ' || v_list);
    end if;
    n.stage          := 'sourcing';
    n.doc_checked_at := v_now;

  when 'submit_quote' then
    if v_role <> 'sr' or t.sr_id is distinct from v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ SR ผู้รับงานเท่านั้นที่ส่งราคาได้');
    end if;
    if t.stage <> 'sourcing' then
      perform public.app_error('INVALID_STATE', format('ส่งราคาไม่ได้ในสถานะ "%s"', public.stage_label_th(t.stage)));
    end if;

    select string_agg(i.line_no::text, ', ' order by i.line_no) into v_list
    from public.ticket_items i
    where i.ticket_id = t.id
      and not exists (select 1 from public.vendor_quotations q where q.item_id = i.id);
    if v_list is not null then
      perform public.app_error('MISSING_QUOTATION', 'รายการที่ยังไม่มีราคา vendor: ลำดับที่ ' || v_list);
    end if;

    select string_agg(i.line_no::text, ', ' order by i.line_no) into v_list
    from public.ticket_items i
    where i.ticket_id = t.id
      and not exists (select 1 from public.vendor_quotations q where q.item_id = i.id and q.is_selected);
    if v_list is not null then
      perform public.app_error('MISSING_WINNER', 'รายการที่ยังไม่ได้เลือกผู้ชนะ: ลำดับที่ ' || v_list);
    end if;

    -- Winner is not the lowest net cost → reason required.
    select string_agg(i.line_no::text, ', ' order by i.line_no) into v_list
    from public.ticket_items i
    join public.vendor_quotations w on w.item_id = i.id and w.is_selected
    where i.ticket_id = t.id
      and w.selection_reason is null
      and w.net_unit_cost_thb > (select min(q.net_unit_cost_thb) from public.vendor_quotations q where q.item_id = i.id);
    if v_list is not null then
      perform public.app_error('REASON_REQUIRED',
        'เลือกผู้ชนะที่ไม่ใช่ราคาต่ำสุด ต้องระบุเหตุผล: ลำดับที่ ' || v_list);
    end if;

    select string_agg(i.line_no::text, ', ' order by i.line_no) into v_list
    from public.ticket_items i
    join public.vendor_quotations w on w.item_id = i.id and w.is_selected
    where i.ticket_id = t.id
      and w.valid_until is not null
      and w.valid_until < (v_now at time zone 'Asia/Bangkok')::date;
    if v_list is not null then
      perform public.app_error('QUOTATION_EXPIRED', 'ราคาผู้ชนะหมดอายุแล้ว: ลำดับที่ ' || v_list);
    end if;

    select jsonb_build_object(
             'winners', jsonb_agg(jsonb_build_object(
               'item_id', i.id, 'line_no', i.line_no, 'quotation_id', w.id,
               'vendor_name', w.vendor_name, 'net_unit_cost_thb', w.net_unit_cost_thb,
               'total_cost_thb', round(w.net_unit_cost_thb * i.qty, 2)) order by i.line_no),
             'grand_total_cost_thb', round(sum(w.net_unit_cost_thb * i.qty), 2))
      into v_meta
    from public.ticket_items i
    join public.vendor_quotations w on w.item_id = i.id and w.is_selected
    where i.ticket_id = t.id;

    n.stage        := 'awaiting_sales_ack';
    n.completed_at := v_now;
    v_type         := 'quote_ready';

  -- ---------------------------------------------------------------- Sales ack
  when 'accept' then
    if v_role <> 'sales' or t.requestor_id <> v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เจ้าของใบเท่านั้นที่รับทราบราคาได้');
    end if;
    if t.stage <> 'awaiting_sales_ack' then
      perform public.app_error('INVALID_STATE', 'ใบนี้ไม่ได้อยู่ในสถานะรอรับทราบราคา');
    end if;
    v_extra     := array[t.sr_id];
    n.stage     := 'closed';
    n.closed_at := v_now;

  when 'request_revision' then
    if v_role <> 'sales' or t.requestor_id <> v_uid then
      perform public.app_error('FORBIDDEN', 'เฉพาะ Sales เจ้าของใบเท่านั้นที่ขอแก้ไขราคาได้');
    end if;
    if t.stage <> 'awaiting_sales_ack' then
      perform public.app_error('INVALID_STATE', 'ใบนี้ไม่ได้อยู่ในสถานะรอรับทราบราคา');
    end if;
    if v_comment is null then
      perform public.app_error('COMMENT_REQUIRED', 'กรุณาระบุสิ่งที่ต้องการให้ SR ปรับราคา');
    end if;
    n.stage          := 'sourcing';
    n.revision_count := t.revision_count + 1;
    v_type           := 'revision_requested';
    v_meta           := jsonb_build_object('revision_no', n.revision_count);

  else
    perform public.app_error('INVALID_ACTION', format('ไม่รู้จักคำสั่ง "%s"', p_action));
  end case;

  n.status := public.stage_status(n.stage);
  if n.stage is distinct from t.stage then
    n.stage_entered_at := v_now;
  end if;

  perform set_config('app.transition_ctx', 'on', true);
  update public.tickets set
    status              = n.status,
    stage               = n.stage,
    manager_id          = n.manager_id,
    gm_id               = n.gm_id,
    sr_id               = n.sr_id,
    revision_count      = n.revision_count,
    info_request        = n.info_request,
    rejection_reason    = n.rejection_reason,
    stage_entered_at    = n.stage_entered_at,
    submitted_at        = n.submitted_at,
    manager_approved_at = n.manager_approved_at,
    gm_approved_at      = n.gm_approved_at,
    assigned_at         = n.assigned_at,
    doc_checked_at      = n.doc_checked_at,
    completed_at        = n.completed_at,
    closed_at           = n.closed_at,
    rejected_at         = n.rejected_at,
    cancelled_at        = n.cancelled_at
  where id = t.id
  returning * into n;
  perform set_config('app.transition_ctx', 'off', true);

  if t.stage = 'pending_assign' and n.stage = 'doc_check' then
    perform public._generate_checklist(n.id);
  end if;

  insert into public.ticket_logs (
    ticket_id, log_type, actor_id, actor_role, action,
    from_status, to_status, from_stage, to_stage, comment, metadata, stage_duration_seconds
  ) values (
    t.id, 'transition', v_uid, v_role, p_action,
    t.status, n.status, t.stage, n.stage, v_comment, v_meta,
    case when n.stage is distinct from t.stage
         then round(extract(epoch from (v_now - t.stage_entered_at))::numeric, 2) end
  );

  -- Notify whoever must act next (+ action-specific extras), never the actor.
  v_title := format('[%s] %s', n.ticket_no, public.stage_label_th(n.stage));
  v_body  := n.title || coalesce(E'\n' || v_comment, '');
  v_link  := case when n.status = 'on_process' and n.stage <> 'need_info'
                  then '/sr/tickets/' || n.id || '/pricing'
                  else '/tickets/' || n.id end;
  if n.stage in ('rejected', 'closed') then
    v_extra := v_extra || array[n.requestor_id];
  end if;
  perform public._notify(public.stage_assignees(n) || v_extra, n.id, v_type, v_title, v_body, v_link);

  return n;
end;
$$;

-- 9.3 select_quotation — atomically pick the single winner of an item.
-- SECURITY INVOKER: RLS on vendor_quotations decides whether the caller may edit.
create or replace function public.select_quotation(p_quotation_id uuid, p_reason text default null)
returns public.vendor_quotations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item uuid;
  v_row  public.vendor_quotations;
begin
  select q.item_id into v_item from public.vendor_quotations q where q.id = p_quotation_id;
  if v_item is null then
    perform public.app_error('NOT_FOUND', 'ไม่พบใบเสนอราคา');
  end if;

  update public.vendor_quotations
     set is_selected = false, selection_reason = null
   where item_id = v_item and is_selected and id <> p_quotation_id;

  update public.vendor_quotations
     set is_selected = true, selection_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_quotation_id
  returning * into v_row;

  if v_row.id is null then
    perform public.app_error('FORBIDDEN', 'คุณไม่มีสิทธิ์แก้ไขราคาในสถานะนี้');
  end if;
  return v_row;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns int
language sql
security invoker
set search_path = ''
as $$
  with u as (
    update public.notifications
       set is_read = true, read_at = now()
     where user_id = (select auth.uid())
       and not is_read
       and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::int from u
$$;

-- 9.4 SLA alerts — call hourly (pg_cron, see bottom of file).
create or replace function public.check_sla_alerts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sla   jsonb := coalesce(public.get_setting('sla_hours'), '{}'::jsonb);
  v_warn  numeric := coalesce((public.get_setting('sla_warning_ratio') #>> '{}')::numeric, 0.8);
  r       record;
  t       public.tickets;
  v_count int := 0;
begin
  for r in
    with lv as (
      select tk.id, tk.stage, tk.stage_entered_at,
             extract(epoch from (now() - tk.stage_entered_at)) / 3600 as age_h,
             (v_sla ->> tk.stage::text)::numeric as sla_h
      from public.tickets tk
      where tk.status in ('requested', 'on_process', 'completed')
    )
    insert into public.sla_alerts (ticket_id, stage, stage_entered_at, level)
    select lv.id, lv.stage, lv.stage_entered_at,
           case when lv.age_h >= lv.sla_h then 'breach' else 'warning' end
    from lv
    where lv.sla_h > 0 and lv.age_h >= lv.sla_h * v_warn
    on conflict on constraint sla_alerts_uq do nothing
    returning ticket_id, level
  loop
    select * into t from public.tickets where id = r.ticket_id;
    perform public._notify(
      public.stage_assignees(t) || case when r.level = 'breach' then public.stage_escalation(t) else '{}'::uuid[] end,
      t.id,
      'sla_' || r.level,
      format('[%s] %s: %s', t.ticket_no,
             case when r.level = 'breach' then 'เกิน SLA' else 'ใกล้ครบ SLA' end,
             public.stage_label_th(t.stage)),
      t.title,
      '/tickets/' || t.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =============================================================================
-- 10. VIEWS (security_invoker → RLS of the caller applies)
-- =============================================================================
create or replace view public.v_product_group_tree
with (security_invoker = true) as
with recursive tree as (
  select g.id, g.parent_id, g.id as root_id, g.name, g.name::text as path, 0 as depth
  from public.product_groups g
  where g.parent_id is null
  union all
  select c.id, c.parent_id, tree.root_id, c.name, tree.path || ' > ' || c.name, tree.depth + 1
  from public.product_groups c
  join tree on c.parent_id = tree.id
)
select tree.id, tree.parent_id, tree.root_id, tree.name, tree.path, tree.depth,
       g.code, g.is_active, g.sort_order
from tree
join public.product_groups g on g.id = tree.id;

create or replace view public.v_quotation_compare
with (security_invoker = true) as
select q.id, q.item_id, q.ticket_id, q.vendor_id, q.vendor_name, q.unit_price, q.currency, q.fx_rate,
       q.vat_term, q.vat_rate, q.moq, q.lead_time_days, q.payment_term, q.valid_until, q.remark,
       q.attachment_path, q.is_selected, q.selection_reason,
       q.net_unit_cost, q.net_unit_cost_thb, q.gross_unit_price_thb,
       q.created_by, q.created_at, q.updated_at,
       i.line_no, i.product_name, i.qty, i.uom,
       round(q.net_unit_cost_thb * i.qty, 2)    as total_cost_thb,
       round(q.gross_unit_price_thb * i.qty, 2) as total_gross_thb,
       rank() over (partition by q.item_id order by q.net_unit_cost_thb) as cost_rank,
       q.net_unit_cost_thb = min(q.net_unit_cost_thb) over (partition by q.item_id) as is_cheapest
from public.vendor_quotations q
join public.ticket_items i on i.id = q.item_id;

create or replace view public.v_ticket_list
with (security_invoker = true) as
select t.id, t.ticket_no, t.title, t.description, t.customer_name, t.priority, t.status, t.stage,
       public.stage_label_th(t.stage) as stage_label,
       t.requestor_id, rq.full_name as requestor_name,
       t.department_id, d.name as department_name,
       t.manager_id, mg.full_name as manager_name,
       t.gm_id, gm.full_name as gm_name,
       t.sr_id, sr.full_name as sr_name,
       t.due_date, t.revision_count, t.version, t.info_request, t.rejection_reason,
       t.stage_entered_at, t.submitted_at, t.manager_approved_at, t.gm_approved_at, t.assigned_at,
       t.doc_checked_at, t.completed_at, t.closed_at, t.rejected_at, t.cancelled_at,
       t.created_at, t.updated_at,
       coalesce(it.item_count, 0) as item_count,
       coalesce(it.product_group_ids, '{}'::uuid[]) as product_group_ids,
       coalesce(it.root_group_ids, '{}'::uuid[]) as root_group_ids,
       it.item_names,
       floor(extract(epoch from (coalesce(t.closed_at, t.rejected_at, t.cancelled_at, now()) - t.created_at)) / 86400)::int as age_days,
       round((extract(epoch from (now() - t.stage_entered_at)) / 3600)::numeric, 1) as stage_age_hours,
       s.sla_hours,
       case
         when t.status in ('closed', 'rejected') then 'done'
         when s.sla_hours is null or s.sla_hours <= 0 then 'none'
         when extract(epoch from (now() - t.stage_entered_at)) / 3600 >= s.sla_hours then 'breach'
         when extract(epoch from (now() - t.stage_entered_at)) / 3600 >= s.sla_hours * s.warn_ratio then 'warning'
         else 'ok'
       end as sla_status
from public.tickets t
join public.profiles rq on rq.id = t.requestor_id
join public.departments d on d.id = t.department_id
left join public.profiles mg on mg.id = t.manager_id
left join public.profiles gm on gm.id = t.gm_id
left join public.profiles sr on sr.id = t.sr_id
left join lateral (
  select count(*) as item_count,
         array_agg(distinct i.product_group_id) as product_group_ids,
         array_agg(distinct pt.root_id) as root_group_ids,
         string_agg(i.product_name, ' | ' order by i.line_no) as item_names
  from public.ticket_items i
  left join public.v_product_group_tree pt on pt.id = i.product_group_id
  where i.ticket_id = t.id
) it on true
cross join lateral (
  select (public.get_setting('sla_hours') ->> t.stage::text)::numeric as sla_hours,
         coalesce((public.get_setting('sla_warning_ratio') #>> '{}')::numeric, 0.8) as warn_ratio
) s;

create or replace view public.v_ticket_timeline
with (security_invoker = true) as
select l.id, l.ticket_id, l.log_type, l.action, l.actor_id, p.full_name as actor_name, l.actor_role,
       l.from_status, l.to_status, l.from_stage, l.to_stage, l.comment, l.metadata,
       l.stage_duration_seconds, l.created_at,
       to_char(l.created_at at time zone 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS') as created_at_bkk
from public.ticket_logs l
left join public.profiles p on p.id = l.actor_id;

-- =============================================================================
-- 11. DASHBOARD RPCs (aggregate in DB; SECURITY INVOKER so each role sees its own scope)
-- =============================================================================
create or replace function public.dashboard_status_summary(p_from date default null, p_to date default null)
returns table (status public.ticket_status, stage public.ticket_stage, stage_label text, ticket_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.status, t.stage, public.stage_label_th(t.stage), count(*)
  from public.tickets t
  where (p_from is null or t.created_at >= public.bkk_day_start(p_from))
    and (p_to   is null or t.created_at <  public.bkk_day_start(p_to + 1))
  group by t.status, t.stage
  order by t.status, t.stage
$$;

create or replace function public.dashboard_requests_by_sales(p_from date default null, p_to date default null)
returns table (requestor_id uuid, requestor_name text, department_name text,
               total bigint, open_count bigint, closed_count bigint, rejected_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.requestor_id, p.full_name, d.name,
         count(*),
         count(*) filter (where t.status in ('requested', 'on_process', 'completed')),
         count(*) filter (where t.status = 'closed'),
         count(*) filter (where t.status = 'rejected')
  from public.tickets t
  join public.profiles p on p.id = t.requestor_id
  join public.departments d on d.id = t.department_id
  where (p_from is null or t.created_at >= public.bkk_day_start(p_from))
    and (p_to   is null or t.created_at <  public.bkk_day_start(p_to + 1))
  group by t.requestor_id, p.full_name, d.name
  order by count(*) desc
$$;

create or replace function public.dashboard_sr_workload(p_from date default null, p_to date default null)
returns table (sr_id uuid, sr_name text, in_progress bigint, need_info bigint, awaiting_ack bigint,
               completed_in_period bigint, avg_hours_to_complete numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, p.full_name,
         count(t.id) filter (where t.stage in ('doc_check', 'sourcing')),
         count(t.id) filter (where t.stage = 'need_info'),
         count(t.id) filter (where t.stage = 'awaiting_sales_ack'),
         count(t.id) filter (where t.completed_at is not null
                               and t.status in ('completed', 'closed')
                               and (p_from is null or t.completed_at >= public.bkk_day_start(p_from))
                               and (p_to   is null or t.completed_at <  public.bkk_day_start(p_to + 1))),
         round(avg(extract(epoch from (t.completed_at - t.assigned_at)) / 3600)
               filter (where t.completed_at is not null
                         and t.status in ('completed', 'closed')
                         and (p_from is null or t.completed_at >= public.bkk_day_start(p_from))
                         and (p_to   is null or t.completed_at <  public.bkk_day_start(p_to + 1)))::numeric, 1)
  from public.profiles p
  left join public.tickets t on t.sr_id = p.id
  where p.role = 'sr' and p.is_active
  group by p.id, p.full_name
  order by p.full_name
$$;

-- Time spent in each stage (from transition logs) → bottleneck analysis.
create or replace function public.dashboard_stage_cycle_time(p_from date default null, p_to date default null)
returns table (stage public.ticket_stage, stage_label text, owner_role text, transitions bigint,
               avg_hours numeric, median_hours numeric, p90_hours numeric, max_hours numeric,
               sla_hours numeric, breach_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.from_stage,
         public.stage_label_th(l.from_stage),
         case l.from_stage
           when 'pending_manager' then 'manager'
           when 'pending_gm' then 'gm'
           when 'returned' then 'sales'
           when 'need_info' then 'sales'
           when 'awaiting_sales_ack' then 'sales'
           else 'sr'
         end,
         count(*),
         round(avg(l.stage_duration_seconds) / 3600, 1),
         round((percentile_cont(0.5) within group (order by l.stage_duration_seconds) / 3600)::numeric, 1),
         round((percentile_cont(0.9) within group (order by l.stage_duration_seconds) / 3600)::numeric, 1),
         round(max(l.stage_duration_seconds) / 3600, 1),
         (public.get_setting('sla_hours') ->> l.from_stage::text)::numeric,
         count(*) filter (where l.stage_duration_seconds / 3600
                                > coalesce((public.get_setting('sla_hours') ->> l.from_stage::text)::numeric, 'infinity'))
  from public.ticket_logs l
  where l.log_type = 'transition'
    and l.from_stage is not null
    and l.stage_duration_seconds is not null
    and (p_from is null or l.created_at >= public.bkk_day_start(p_from))
    and (p_to   is null or l.created_at <  public.bkk_day_start(p_to + 1))
  group by l.from_stage
  order by l.from_stage
$$;

-- Currently open tickets vs SLA, per stage.
create or replace function public.dashboard_sla_overview()
returns table (stage public.ticket_stage, stage_label text, sla_hours numeric,
               open_count bigint, warning_count bigint, breach_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select v.stage, v.stage_label, max(v.sla_hours),
         count(*),
         count(*) filter (where v.sla_status = 'warning'),
         count(*) filter (where v.sla_status = 'breach')
  from public.v_ticket_list v
  where v.status in ('requested', 'on_process', 'completed')
  group by v.stage, v.stage_label
  order by v.stage
$$;

create or replace function public.dashboard_aging_buckets()
returns table (bucket text, sort_order int, ticket_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with b(bucket, sort_order, lo, hi) as (
    values ('0–2 วัน', 1, 0, 2), ('3–5 วัน', 2, 3, 5), ('6–10 วัน', 3, 6, 10), ('>10 วัน', 4, 11, 1000000)
  )
  select b.bucket, b.sort_order, count(t.id)
  from b
  left join public.tickets t
    on t.status in ('requested', 'on_process', 'completed')
   and floor(extract(epoch from (now() - t.created_at)) / 86400) between b.lo and b.hi
  group by b.bucket, b.sort_order
  order by b.sort_order
$$;

create or replace function public.dashboard_top_vendors(p_from date default null, p_to date default null, p_limit int default 10)
returns table (vendor_key text, vendor_name text, win_count bigint, ticket_count bigint, total_cost_thb numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(q.vendor_id::text, lower(q.vendor_name)),
         coalesce(max(v.name), max(q.vendor_name)),
         count(*),
         count(distinct q.ticket_id),
         round(sum(q.net_unit_cost_thb * i.qty), 2)
  from public.vendor_quotations q
  join public.ticket_items i on i.id = q.item_id
  join public.tickets t on t.id = q.ticket_id
  left join public.vendors v on v.id = q.vendor_id
  where q.is_selected
    and t.status in ('completed', 'closed')
    and (p_from is null or t.completed_at >= public.bkk_day_start(p_from))
    and (p_to   is null or t.completed_at <  public.bkk_day_start(p_to + 1))
  group by coalesce(q.vendor_id::text, lower(q.vendor_name))
  order by count(*) desc, sum(q.net_unit_cost_thb * i.qty) desc
  limit greatest(coalesce(p_limit, 10), 1)
$$;

create or replace function public.dashboard_product_group_share(p_from date default null, p_to date default null)
returns table (root_group_id uuid, root_group_name text, item_count bigint, ticket_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select pt.root_id, r.name, count(*), count(distinct i.ticket_id)
  from public.ticket_items i
  join public.tickets t on t.id = i.ticket_id
  join public.v_product_group_tree pt on pt.id = i.product_group_id
  join public.product_groups r on r.id = pt.root_id
  where (p_from is null or t.created_at >= public.bkk_day_start(p_from))
    and (p_to   is null or t.created_at <  public.bkk_day_start(p_to + 1))
  group by pt.root_id, r.name
  order by count(*) desc
$$;

-- =============================================================================
-- 12. ROW LEVEL SECURITY
-- =============================================================================
alter table public.profiles           enable row level security;
alter table public.departments        enable row level security;
alter table public.product_groups     enable row level security;
alter table public.vendors            enable row level security;
alter table public.app_settings       enable row level security;
alter table public.ticket_counters    enable row level security;
alter table public.tickets            enable row level security;
alter table public.ticket_items       enable row level security;
alter table public.vendor_quotations  enable row level security;
alter table public.ticket_checklist   enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_logs        enable row level security;
alter table public.notifications      enable row level security;
alter table public.sla_alerts         enable row level security;

-- profiles
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- departments / product_groups / app_settings: everyone reads, Admin writes
create policy departments_select on public.departments for select to authenticated using (true);
create policy departments_admin_insert on public.departments for insert to authenticated with check (public.is_admin());
create policy departments_admin_update on public.departments for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy departments_admin_delete on public.departments for delete to authenticated using (public.is_admin());

create policy product_groups_select on public.product_groups for select to authenticated using (true);
create policy product_groups_admin_insert on public.product_groups for insert to authenticated with check (public.is_admin());
create policy product_groups_admin_update on public.product_groups for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy product_groups_admin_delete on public.product_groups for delete to authenticated using (public.is_admin());

create policy app_settings_select on public.app_settings for select to authenticated using (true);
create policy app_settings_admin_insert on public.app_settings for insert to authenticated with check (public.is_admin());
create policy app_settings_admin_update on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- vendors: everyone reads, SR/Admin maintain
create policy vendors_select on public.vendors for select to authenticated using (true);
create policy vendors_insert on public.vendors for insert to authenticated
  with check (public.auth_role() in ('sr', 'admin'));
create policy vendors_update on public.vendors for update to authenticated
  using (public.auth_role() in ('sr', 'admin')) with check (public.auth_role() in ('sr', 'admin'));

-- ticket_counters: no client access at all (only next_ticket_no()).

-- tickets: read by visibility; Sales may edit header columns before approval.
create policy tickets_select on public.tickets
  for select to authenticated using (public.is_ticket_visible(id));
create policy tickets_update_request on public.tickets
  for update to authenticated
  using (public.can_edit_ticket_request(id))
  with check (public.can_edit_ticket_request(id));

-- ticket_items
create policy ticket_items_select on public.ticket_items
  for select to authenticated using (public.is_ticket_visible(ticket_id));
create policy ticket_items_insert on public.ticket_items
  for insert to authenticated with check (public.can_edit_ticket_request(ticket_id));
create policy ticket_items_update on public.ticket_items
  for update to authenticated
  using (public.can_edit_ticket_request(ticket_id))
  with check (public.can_edit_ticket_request(ticket_id));
create policy ticket_items_delete on public.ticket_items
  for delete to authenticated using (public.can_edit_ticket_request(ticket_id));

-- vendor_quotations (ticket_id is forced from item_id by trigger before WITH CHECK runs)
create policy vq_select on public.vendor_quotations
  for select to authenticated using (public.can_view_quotations(ticket_id));
create policy vq_insert on public.vendor_quotations
  for insert to authenticated with check (public.can_edit_quotations(ticket_id));
create policy vq_update on public.vendor_quotations
  for update to authenticated
  using (public.can_edit_quotations(ticket_id))
  with check (public.can_edit_quotations(ticket_id));
create policy vq_delete on public.vendor_quotations
  for delete to authenticated using (public.can_edit_quotations(ticket_id));

-- ticket_checklist
create policy ticket_checklist_select on public.ticket_checklist
  for select to authenticated using (public.is_ticket_visible(ticket_id));
create policy ticket_checklist_update on public.ticket_checklist
  for update to authenticated
  using (public.can_edit_checklist(ticket_id))
  with check (public.can_edit_checklist(ticket_id));

-- ticket_attachments (quotation files hidden from Sales/Manager until prices are submitted)
create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (case when category = 'quotation' then public.can_view_quotations(ticket_id)
              else public.is_ticket_visible(ticket_id) end);
create policy ticket_attachments_insert on public.ticket_attachments
  for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and public.can_upload_ticket_files(ticket_id));
create policy ticket_attachments_delete on public.ticket_attachments
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) and public.can_upload_ticket_files(ticket_id));

-- ticket_logs: read-only by visibility (writes only via SECURITY DEFINER functions/triggers)
create policy ticket_logs_select on public.ticket_logs
  for select to authenticated using (public.is_ticket_visible(ticket_id));

-- notifications: own rows only
create policy notifications_select on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- sla_alerts: Admin / GM may read
create policy sla_alerts_select on public.sla_alerts
  for select to authenticated using (public.auth_role() in ('admin', 'gm'));

-- =============================================================================
-- 13. PRIVILEGES (Supabase grants ALL to anon/authenticated by default — tighten)
-- =============================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.profiles, public.departments, public.product_groups, public.vendors, public.app_settings
  to authenticated;
-- profile admin-only columns are guarded by profiles_guard()
grant update (full_name, phone, lark_user_id, role, department_id, is_sr_lead, is_active) on public.profiles to authenticated;
grant insert, update, delete on public.departments, public.product_groups to authenticated;
grant insert, update on public.app_settings to authenticated;
grant insert, update on public.vendors to authenticated;

grant select on public.tickets to authenticated;
grant update (title, description, customer_name, priority, due_date) on public.tickets to authenticated;

grant select, insert, update, delete on public.ticket_items to authenticated;
grant select, insert, delete on public.vendor_quotations to authenticated;
grant update (vendor_id, vendor_name, unit_price, currency, fx_rate, vat_term, moq, lead_time_days,
              payment_term, valid_until, remark, attachment_path, is_selected, selection_reason)
  on public.vendor_quotations to authenticated;

grant select on public.ticket_checklist to authenticated;
grant update (is_checked, note) on public.ticket_checklist to authenticated;

grant select, insert, delete on public.ticket_attachments to authenticated;
grant select on public.ticket_logs to authenticated;

grant select on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;

grant select on public.sla_alerts to authenticated;

grant select on public.v_product_group_tree, public.v_quotation_compare, public.v_ticket_list, public.v_ticket_timeline
  to authenticated;

-- Even service_role must not rewrite history.
revoke update, delete, truncate on public.ticket_logs from service_role;

grant execute on function
  public.stage_status(public.ticket_stage),
  public.stage_label_th(public.ticket_stage),
  public.try_uuid(text),
  public.app_error(text, text),
  public.jsonb_diff(jsonb, jsonb, text[]),
  public.bkk_day_start(date),
  public.auth_role(),
  public.is_admin(),
  public.is_sr_lead(),
  public.is_ticket_visible(uuid),
  public.can_edit_ticket_request(uuid),
  public.can_upload_ticket_files(uuid),
  public.can_view_quotations(uuid),
  public.can_edit_quotations(uuid),
  public.can_edit_checklist(uuid),
  public.get_setting(text),
  public.current_vat_rate(),
  public.create_ticket(jsonb, jsonb),
  public.transition_ticket(uuid, text, text, jsonb),
  public.select_quotation(uuid, text),
  public.mark_notifications_read(uuid[]),
  public.dashboard_status_summary(date, date),
  public.dashboard_requests_by_sales(date, date),
  public.dashboard_sr_workload(date, date),
  public.dashboard_stage_cycle_time(date, date),
  public.dashboard_sla_overview(),
  public.dashboard_aging_buckets(),
  public.dashboard_top_vendors(date, date, int),
  public.dashboard_product_group_share(date, date)
to authenticated;

-- Internal-only functions stay callable only by owner / service_role.
grant execute on function public.check_sla_alerts() to service_role;

-- =============================================================================
-- 14. STORAGE (private bucket + policies)
-- Path convention:
--   tickets/{ticket_id}/{filename}                   request files (Sales)
--   tickets/{ticket_id}/{item_id}/{filename}         request files per item
--   tickets/{ticket_id}/quotations/{item_id}/{file}  vendor quotation files (SR)
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-files', 'ticket-files', false, 20971520,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy ticket_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-files'
    and (storage.foldername(name))[1] = 'tickets'
    and case when (storage.foldername(name))[3] = 'quotations'
             then public.can_view_quotations(public.try_uuid((storage.foldername(name))[2]))
             else public.is_ticket_visible(public.try_uuid((storage.foldername(name))[2]))
        end
  );

create policy ticket_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-files'
    and (storage.foldername(name))[1] = 'tickets'
    and public.can_upload_ticket_files(public.try_uuid((storage.foldername(name))[2]))
  );

create policy ticket_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-files'
    and owner_id = (select auth.uid())::text
    and public.can_upload_ticket_files(public.try_uuid((storage.foldername(name))[2]))
  );

-- =============================================================================
-- 15. REALTIME (in-app notification badge)
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- =============================================================================
-- 16. DEFAULT SETTINGS
-- =============================================================================
insert into public.app_settings (key, value, description) values
  ('vat_rate', '0.07'::jsonb, 'อัตรา VAT (0.07 = 7%) ใช้เป็น snapshot ตอนบันทึกราคา vendor'),
  ('sla_hours', jsonb_build_object(
      'pending_manager', 24, 'returned', 48, 'pending_gm', 24,
      'pending_assign', 8, 'doc_check', 16, 'need_info', 48, 'sourcing', 72,
      'awaiting_sales_ack', 48), 'SLA (ชั่วโมงปฏิทิน) ของแต่ละ stage'),
  ('sla_warning_ratio', '0.8'::jsonb, 'แจ้งเตือนเมื่อใช้เวลาเกินสัดส่วนนี้ของ SLA (0.8 = 80%)'),
  ('currencies', '["THB","USD","CNY","EUR","JPY","SGD"]'::jsonb, 'สกุลเงินที่แสดงใน dropdown')
on conflict (key) do nothing;

commit;

-- =============================================================================
-- 17. OPTIONAL: hourly SLA check with pg_cron
-- (Outside the main transaction so a missing extension never breaks the migration.
--  On Supabase: Dashboard → Database → Extensions → enable "pg_cron" first.)
-- =============================================================================
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mgs-sla-check', '5 * * * *', 'select public.check_sla_alerts()');
  else
    raise notice 'pg_cron not enabled — skip SLA schedule. Enable it, then run: select cron.schedule(''mgs-sla-check'', ''5 * * * *'', ''select public.check_sla_alerts()'');';
  end if;
exception when others then
  raise notice 'Could not schedule SLA check: %', sqlerrm;
end;
$$;
