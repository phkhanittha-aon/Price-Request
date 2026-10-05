# Phase 1 — Database (Google Sheets) + Server Rules (Apps Script)

> MGS Price Request & Sourcing System — เวอร์ชัน `2026.10.06-1`
> Stack: **Google Sheets** (ฐานข้อมูล) · **Google Apps Script** (backend + web app) · **Google Drive** (ไฟล์แนบ) · **Lark Bot API** (แจ้งเตือนรายคน)

## 1. สรุปความเข้าใจ

เปลี่ยนจาก Supabase เป็น Google Sheets + Apps Script โดย**คง business rule เดิมทั้งหมด**
Sheets ไม่มี RLS, constraint หรือ transaction แบบ PostgreSQL หน้าที่เหล่านั้นจึงย้ายมาอยู่ที่ **server layer ของ Apps Script**
(ซึ่งเป็นทางเดียวที่เข้าถึงข้อมูลได้) ตามตารางนี้:

| สิ่งที่เคยทำใน PostgreSQL | ทำใน Sheets + Apps Script ด้วย |
|---|---|
| RLS (`is_ticket_visible` ฯลฯ) | `canSeeTicket_()`, `canViewQuotes_()`, `canEdit*_()` ใน `Auth.gs` — ทุก API เรียกก่อนคืนข้อมูล |
| ห้าม UPDATE status ตรง | ไม่มี API ไหนเขียน status/stage ได้ นอกจาก `transitionTicket()` · staff **ไม่มีสิทธิ์เปิดชีต** · ฟังก์ชันลงท้าย `_` ถูกเรียกจาก browser ไม่ได้ |
| CHECK / UNIQUE / trigger | validate ฝั่ง server ทุกครั้ง (`toNumber_`, `oneOf_`, max 3 vendor, ผู้ชนะ 1 เจ้า) ภายใต้ `LockService` |
| Transaction + row lock | `withLock_()` = script lock ทั้งระบบ — ทุกการเขียนเรียงคิวกัน ไม่มี lost update |
| Optimistic locking | คอลัมน์ `version` + `expected_version` บังคับทุก transition/แก้ไข |
| Sequence เลขที่ใบ | แท็บ `Counters` อ่าน-เพิ่มภายใต้ lock → `PR-YYYY-NNNN` ไม่ซ้ำ ไม่ข้าม รีเซ็ตทุกปี |
| Append-only log (trigger ห้าม UPDATE/DELETE) | ไม่มี API แก้/ลบ log · แท็บถูก protect · **hash chain SHA-256** ทุกแถว → `verifyLogChain()` จับได้ถ้ามีใครแก้/ลบ/แทรกแถว |
| Generated column (VAT/FX) | คำนวณใน `Pricing.gs` ตอนบันทึก แล้วเก็บค่าไว้ในแถว (+ snapshot `vat_rate`) |
| Database webhook → Edge function | แถวใน `Notifications` (status `pending`) → dispatcher ส่ง Lark (Phase 2) |

## 2. Assumptions และการตัดสินใจ

| # | ประเด็น | ทางที่เลือก |
|---|---|---|
| G1 | ยืนยันตัวตน | ทุกคนใช้ **Google Workspace ของบริษัท** · Web app `Execute as: Me` + `Access: Anyone within domain` · อีเมลจาก `Session.getActiveUser()` ฝั่ง server เท่านั้น |
| G2 | ใครเข้าถึงชีตได้ | **เฉพาะบัญชีเจ้าของสคริปต์** (แนะนำบัญชีกลาง เช่น `system@บริษัท`) — staff ใช้งานผ่าน web app อย่างเดียว ถ้าให้สิทธิ์ edit ชีตกับ staff = ข้าม rule ทั้งหมด |
| G3 | Master data (Users, Departments, ProductGroups, Vendors, Settings) | Phase 1: Admin แก้ในชีตโดยตรง (มี dropdown validation) · หน้า Admin ใน web app จะทำใน phase ถัดไป |
| G4 | ลบข้อมูล | ไม่มีการลบแถว — ใช้ `is_deleted` (items, quotations, attachments) และ status `cancelled` (ticket) |
| G5 | Lark | **Bot API** ส่ง DM รายคน (ต้องมี Lark Custom App: App ID/Secret) — ระบบหา open_id จากอีเมลอัตโนมัติ หรือกรอก `lark_open_id` ใน Users |
| G6 | ไฟล์แนบ | เก็บใน Drive โฟลเดอร์ของระบบ (ไม่แชร์) อ้างอิงด้วย file ID · ขีดจำกัด 20 MB จะใช้ chunked upload (Phase 2) |
| G7 | SLA | ชั่วโมงปฏิทินต่อ stage (แท็บ Settings) เตือนที่ 80% · ตรวจด้วย time trigger ทุกชั่วโมง (Phase 2) |
| G8 | Stage `returned`, `cancelled`, SR Lead, การเห็นราคา, need_info กลับคิว SR เดิม, ห้ามแก้ qty หลังอนุมัติ | **เหมือนการออกแบบเดิม** (A1–A18 ของรอบ Supabase) |
| G9 | Concurrency | script lock ทั้งระบบ (รอได้สูงสุด 25 วินาที) — เพียงพอสำหรับ 20–80 คน เพราะแต่ละการบันทึกใช้ < 2 วินาที |
| G10 | ขนาดข้อมูล | Sheets ช้าลงเมื่อแท็บ "ร้อน" เกิน ~20–50k แถว → ประเมิน TicketLogs ~25 แถว/ใบ; ถ้าเกิน ~1,500 ใบ/ปี ให้ archive รายปี (Phase 2 มีฟังก์ชัน archive) |

## 3. โครงสร้างฐานข้อมูล (แท็บ + คอลัมน์)

หัวคอลัมน์แถวที่ 1 คือ **สัญญา** ระหว่างโค้ดกับข้อมูล — โค้ดอ้างคอลัมน์ด้วยชื่อ ไม่ใช่ตำแหน่ง
`setupDatabase()` สร้างแท็บ/คอลัมน์ที่ขาดให้อัตโนมัติ (ไม่ลบ ไม่สลับลำดับ) · 🔑 = primary key

| แท็บ | คอลัมน์ | หมายเหตุ |
|---|---|---|
| **Users** | 🔑email, full_name, role, department_code, is_sr_lead, is_active, lark_open_id, phone, created_at, updated_at, updated_by | role: sales / manager / gm / sr / admin (dropdown) |
| **Departments** | 🔑code, name, manager_email, is_active, created_at, updated_at | manager_email = ผู้อนุมัติขั้น 1 |
| **ProductGroups** | 🔑code, name, name_en, parent_code, checklist_json, sort_order, is_active, … | parent/child เช่น `SOLAR` → `SOLAR-INVERTER` · checklist ลูกได้ของแม่ด้วย |
| **Vendors** | 🔑vendor_id, name, tax_id, country, default_currency, default_vat_term, contact_name, phone, email, note, is_active, … | master สำหรับ autocomplete |
| **Settings** | 🔑key, value (JSON), description, … | vat_rate, sla_hours, sla_warning_ratio, currencies, max_upload_mb, allowed_mime_types |
| **Counters** | 🔑name, last_no, updated_at | `ticket_no_2026` → เลขล่าสุดของปี |
| **Tickets** | 🔑ticket_id, ticket_no, title, description, customer_name, priority, status, stage, requestor_email, department_code, manager_email, gm_email, sr_email, due_date, revision_count, **version**, info_request_json, rejection_reason, stage_entered_at, submitted_at, manager_approved_at, gm_approved_at, assigned_at, doc_checked_at, completed_at, closed_at, rejected_at, cancelled_at, client_key, created_at, updated_at | `client_key` กันกดส่งซ้ำ |
| **TicketItems** | 🔑item_id, ticket_id, line_no, product_group_code, product_name, spec, description, qty, uom, target_price, target_currency, is_deleted, … | |
| **Quotations** | 🔑quote_id, item_id, ticket_id, vendor_id, vendor_name, unit_price, currency, fx_rate, vat_term, **vat_rate**, moq, lead_time_days, payment_term, valid_until, remark, attachment_file_id, is_selected, selection_reason, **net_unit_cost, net_unit_cost_thb, gross_unit_price_thb**, is_deleted, created_by, … | สูงสุด 3 เจ้า/รายการ, ผู้ชนะ 1 เจ้า |
| **Checklist** | 🔑check_id, ticket_id, product_group_code, item_key, label, is_required, sort_order, is_checked, checked_by, checked_at, note, updated_at | สร้างตอน SR รับงาน |
| **Attachments** | 🔑attachment_id, ticket_id, item_id, quote_id, category, file_name, drive_file_id, mime_type, size_bytes, uploaded_by, uploaded_at, is_deleted, deleted_by, deleted_at | |
| **TicketLogs** | 🔑log_id, ts, ticket_id, log_type, actor_email, actor_role, action, from_status, to_status, from_stage, to_stage, comment, metadata_json, stage_duration_sec, app_version, **prev_hash, hash** | append-only + hash chain |
| **Notifications** | 🔑notif_id, user_email, ticket_id, type, title, body, link, is_read, read_at, created_at, lark_status, lark_attempts, lark_error, lark_sent_at | คิวส่ง Lark |
| **SlaAlerts** | 🔑alert_key, ticket_id, stage, stage_entered_at, level, created_at | กันเตือน SLA ซ้ำ |
| **ErrorLog** | ts, fn, user_email, code, message, stack, context_json, app_version | error ระบบทุกครั้ง |

**การคำนวณราคา (Pricing.gs)**

| vat_term | ต้นทุนสุทธิ `net_unit_cost_thb` | ราคาจ่ายจริง `gross_unit_price_thb` |
|---|---|---|
| Ex VAT | price × fx | price × (1 + vat_rate) × fx |
| Include VAT | price ÷ (1 + vat_rate) × fx | price × fx |
| No VAT | price × fx | price × fx |

## 4. State Machine (`transitionTicket`)

```
create ─► pending_manager ──manager_approve──► pending_gm ──gm_approve──► pending_assign ──claim/assign──► doc_check
              │  ▲                                  │                                                    │   ▲
 manager_return│  │resubmit                gm_reject│                                    request_info*   │   │ respond_info*
              ▼  │                                  ▼                                                    ▼   │
            returned                            rejected                                              need_info
                                                                                                         ▲   │
 cancel (pending_manager / returned / pending_gm) ─► cancelled                 doc_complete              │   │
                                                                     doc_check ───────────► sourcing ─────┘◄──┘
                                                                                               │  ▲
                                                                                  submit_quote │  │ request_revision*
                                                                                               ▼  │
                                                                                     awaiting_sales_ack ──accept──► closed
```
`*` = บังคับ comment · status หลัก: Requested (pending_manager, returned, pending_gm) · On Process (pending_assign, doc_check, need_info, sourcing) · Completed (awaiting_sales_ack) · Closed · Rejected (rejected, cancelled)

| Action | ผู้ทำ | เงื่อนไขพิเศษ |
|---|---|---|
| `createTicket` | Sales | ต้องมีแผนก + แผนกมี Manager, ≥ 1 รายการ, ≤ 100 รายการ |
| `resubmit`, `cancel`, `respond_info`, `accept`, `request_revision` | Sales เจ้าของใบ | cancel ได้ก่อน GM อนุมัติเท่านั้น |
| `manager_approve / reject / return` | Manager ของแผนก | ห้ามอนุมัติใบตัวเอง, reject/return ต้องมีเหตุผล |
| `gm_approve / reject` | GM | ไม่ใช่ผู้ขอ และไม่ใช่คนที่อนุมัติขั้น 1 |
| `claim` | SR | งานต้องยังไม่มีคนรับ → สร้าง checklist |
| `assign` | SR Lead / Admin | `payload.sr_email` ต้องเป็น SR ที่ active |
| `request_info` | SR ผู้รับงาน | จาก doc_check หรือ sourcing — Sales ตอบแล้วกลับ stage เดิม |
| `doc_complete` | SR ผู้รับงาน | checklist ที่บังคับต้องติ๊กครบ |
| `submit_quote` | SR ผู้รับงาน | ทุกรายการมี vendor ≥ 1, ผู้ชนะ 1 เจ้า, ไม่ใช่ถูกสุดต้องมีเหตุผล, ราคาผู้ชนะยังไม่หมดอายุ |

## 5. Permission Matrix

สัญลักษณ์: ✅ ได้ · 🔸 ได้ตามเงื่อนไข · ❌ ไม่ได้ — **ทุกช่องตรวจที่ server** (ซ่อนปุ่มเป็นแค่ UX)

### 5.1 ข้อมูล

| ข้อมูล | Sales | Manager | GM | SR | Admin |
|---|---|---|---|---|---|
| ใบขอราคา (อ่าน) | 🔸 ใบตัวเอง | 🔸 ใบของแผนกตัวเอง | ✅ | 🔸 ใบที่ GM อนุมัติแล้ว | ✅ |
| แก้ header / รายการสินค้า | 🔸 ใบตัวเอง เฉพาะ pending_manager, returned | ❌ | ❌ | ❌ | ❌ |
| ราคา vendor (อ่าน) | 🔸 เมื่อ Completed/Closed | 🔸 เมื่อ Completed/Closed | ✅ | ✅ | ✅ |
| ราคา vendor (เพิ่ม/แก้/ลบ/เลือกผู้ชนะ) | ❌ | ❌ | ❌ | 🔸 SR ผู้รับงาน + stage sourcing | ❌ |
| Checklist (ติ๊ก) | ❌ | ❌ | ❌ | 🔸 SR ผู้รับงาน + stage doc_check | ❌ |
| ไฟล์แนบ (อัปโหลด — Phase 2) | 🔸 pending_manager / returned / need_info | ❌ | ❌ | 🔸 SR ผู้รับงาน + On Process | ❌ |
| Timeline (log) | 🔸 ใบที่เห็น | 🔸 | ✅ | 🔸 | ✅ |
| `verifyLogChain()` | ❌ | ❌ | ❌ | ❌ | ✅ |
| ตัวชีต Google Sheets | ❌ | ❌ | ❌ | ❌ | ❌ (เฉพาะบัญชีเจ้าของระบบ) |

### 5.2 Workflow actions

| Action | Sales | Manager | GM | SR | SR Lead | Admin |
|---|---|---|---|---|---|---|
| createTicket | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| resubmit / cancel / respond_info / accept / request_revision | 🔸 เจ้าของ | ❌ | ❌ | ❌ | ❌ | ❌ |
| manager_approve / reject / return | ❌ | 🔸 แผนกตัวเอง | ❌ | ❌ | ❌ | ❌ |
| gm_approve / gm_reject | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| claim | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| assign / re-assign | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| request_info / doc_complete / submit_quote | ❌ | ❌ | ❌ | 🔸 ผู้รับงาน | 🔸 ผู้รับงาน | ❌ |

### 5.3 ฟังก์ชันที่ browser เรียกได้ (public API) และตัวป้องกัน

| ฟังก์ชัน | ตรวจสิทธิ์ด้วย |
|---|---|
| `createTicket`, `transitionTicket`, `getTicket`, `updateTicketRequest`, `saveItem`, `deleteItem`, `updateChecklist`, `saveQuotation`, `deleteQuotation`, `selectQuotation` | `currentUser_()` + `can*_()` ทุกครั้ง |
| `setupDatabase`, `seedMasterData`, `seedDemoData` | `requireOwner_()` — เจ้าของสคริปต์เท่านั้น |
| `runAcceptanceTests`, `verifyLogChain` | `requireAdminOrOwner_()` |

ฟังก์ชันอื่นทั้งหมดลงท้าย `_` → Apps Script ไม่อนุญาตให้เรียกผ่าน `google.script.run`

## 6. Error codes (สำหรับ UI)

ทุก API คืน `{ ok: true, data }` หรือ `{ ok: false, code, error, details }` — `error` เป็นข้อความไทยพร้อมแสดงผู้ใช้

`UNAUTHENTICATED`, `NOT_REGISTERED`, `INACTIVE_USER`, `NOT_FOUND`, `FORBIDDEN`, `SELF_APPROVAL`, `INVALID_STATE`, `INVALID_ACTION`,
`VERSION_REQUIRED`, `VERSION_CONFLICT`, `COMMENT_REQUIRED`, `ALREADY_CLAIMED`, `INVALID_ASSIGNEE`, `SAME_ASSIGNEE`,
`CHECKLIST_INCOMPLETE`, `MISSING_QUOTATION`, `MISSING_WINNER`, `MULTIPLE_WINNERS`, `REASON_REQUIRED`, `QUOTATION_EXPIRED`,
`MAX_VENDORS`, `NO_ITEMS`, `TOO_MANY_ITEMS`, `NO_MANAGER`, `NO_DEPARTMENT`, `VALIDATION`, `BUSY`, `SCHEMA_DRIFT`, `NOT_CONFIGURED`, `SYSTEM_ERROR`

## 7. วิธีติดตั้ง (ทำครั้งเดียว ~15 นาที)

1. ใช้ **บัญชีกลางของบริษัท** (เช่น `system@…`) — บัญชีนี้จะเป็นเจ้าของชีต ไฟล์ และสคริปต์
2. ไปที่ <https://script.google.com> → New project → ตั้งชื่อ `MGS Price Request`
3. Project Settings (⚙️) → ติ๊ก **Show "appsscript.json" manifest file** → เปิด `appsscript.json` แล้ววางเนื้อหาจาก `gas/appsscript.json`
4. สร้างไฟล์สคริปต์ตามชื่อ แล้ววางเนื้อหาจาก repo ให้ครบ: `Config`, `Util`, `Db`, `Audit`, `Auth`, `Pricing`, `Notify`, `Workflow`, `Editing`, `Setup`, `Tests`
5. ใน `Setup.gs` แก้ `DEMO_DOMAIN` เป็นโดเมนบริษัท (ถ้าจะใช้ demo data)
6. เมนู Run → `setupDatabase` → อนุญาตสิทธิ์ → ดู Execution log จะได้ URL ของชีตฐานข้อมูล
7. Run → `runAcceptanceTests` → ต้องเห็น `✅ ALL TESTS PASSED — 79/79 passed` (ใช้ชีตชั่วคราว ไม่แตะข้อมูลจริง)
8. (UAT) Run → `seedDemoData` → ได้ users ทุก role + ใบตัวอย่าง 4 ใบ
   (Production) แทนที่จะ seed demo ให้รัน `seedMasterData` แล้วกรอกแท็บ **Users** และ `manager_email` ในแท็บ **Departments** เอง
9. **ห้ามแชร์ชีตฐานข้อมูลให้ staff** — ทุกคนใช้ผ่าน web app (Phase 2)

ทางเลือกสำหรับนักพัฒนา: ใช้ [clasp](https://github.com/google/clasp) push โฟลเดอร์ `gas/` (ดู `.clasp.json.example`)

## 8. วิธีทดสอบ

| ทดสอบ | วิธี | ผลที่ต้องได้ |
|---|---|---|
| Acceptance ทั้งชุด (Apps Script) | Run `runAcceptanceTests` | `79/79 passed` |
| Acceptance ทั้งชุด (เครื่องนักพัฒนา) | `node dev/gas-local-runner.js tests` | `79/79 passed` (ผ่านแล้วก่อนส่งงานนี้) |
| ข้อมูลตัวอย่าง | Run `seedDemoData` แล้วเปิดชีต | Tickets 4 แถว: Closed / need_info / pending_gm / pending_manager |
| Log ถูกแก้ไขหรือไม่ | แก้ cell ใดก็ได้ใน TicketLogs → Run `verifyLogChain` | `valid: false` พร้อมบอก log_id ที่ถูกแก้ (แล้ว Ctrl+Z คืนค่า) |
| เลขที่ใบเมื่อกดพร้อมกัน | (ทำใน UAT Phase 2) 3–5 คนกดส่งใบพร้อมกัน | เลขไม่ซ้ำ ไม่ข้าม — ตรวจในแท็บ Tickets |

| Acceptance criteria | ผลการทดสอบ |
|---|---|
| Sales คนหนึ่งเปิดใบของ Sales อื่นไม่ได้ แม้เรียก API ตรง | ✅ `getTicket` คืน `NOT_FOUND` |
| เปลี่ยนสถานะตรงไม่ได้ ต้องผ่าน `transitionTicket` | ✅ API แก้ไขรับเฉพาะ field ที่ whitelist; status/stage/sr ถูกเพิกเฉย |
| vendor เจ้าที่ 4 / ผู้ชนะ 2 เจ้า ถูกปฏิเสธ | ✅ `MAX_VENDORS`; เลือกเจ้าใหม่จะแทนที่เจ้าเดิม; ถ้าชีตถูกแก้ให้มี 2 ผู้ชนะ submit จะได้ `MULTIPLE_WINNERS` |
| ทุก transition มี log และแก้ log ไม่ได้ | ✅ 13 transitions = 13 แถว; แก้ cell ใน log แล้ว hash chain ตรวจพบ |
| เลขที่ใบไม่ซ้ำ | ✅ 27 ใบ เลขต่อเนื่องไม่ซ้ำ (script lock serialize การสร้าง) |

## 9. Watch-outs (ความเสี่ยงที่ยอมรับ)

- **ไม่มี transaction จริง**: ถ้าสคริปต์หยุดกลางทาง (timeout / Google ขัดข้อง) ระหว่างเขียน ticket กับ log อาจได้ข้อมูลครึ่งเดียว — ลดความเสี่ยงด้วยการเขียน ticket ก่อนแล้ว log ทันที และ `ErrorLog` จะบันทึกไว้; Phase 2 จะเพิ่ม `runSelfTest()` ตรวจ ticket ที่ไม่มี log
- **เจ้าของชีตแก้ข้อมูลได้เสมอ** (ข้อจำกัดของ Sheets) — hash chain ทำให้ *ตรวจพบ* การแก้ log ได้ แต่ป้องกันไม่ได้ ดังนั้นบัญชีเจ้าของต้องเป็นบัญชีกลางที่มีคนถือรหัสน้อยที่สุด
- **Script lock ทั้งระบบ**: ถ้ามีคนบันทึกพร้อมกันมาก ๆ ผู้ที่รอเกิน 25 วินาทีจะได้ `BUSY` ให้ลองใหม่ — ไม่เกิดที่ 80 คน แต่ควรเฝ้าดู ErrorLog
- **Local test ใช้ mock**: mock ไม่ได้จำลองการแปลงชนิดข้อมูลของ Sheets ทุกกรณี — ต้องรัน `runAcceptanceTests` ใน Apps Script จริงหลังวางโค้ดทุกครั้ง

## 10. สิ่งที่ทำต่อใน Phase 2

- `Code.gs` (`doGet` + routing), HTML shell + เมนูตาม role, รายการใบ/Dashboard API
- Lark dispatcher (Bot API, DM รายคน, retry) + time triggers (ส่งแจ้งเตือนทุก 1 นาที, SLA ทุกชั่วโมง, backup รายสัปดาห์)
- อัปโหลดไฟล์แนบแบบ chunked ≤ 20 MB เข้า Drive
- ขั้นตอน Deploy web app + checklist "New version"
