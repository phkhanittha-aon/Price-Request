# Phase 4 — ฟอร์มขอราคา Food · Dashboard แบบง่าย · สายอนุมัติใหม่

> เวอร์ชัน `2026.10.06-3` — เอกสารนี้แทนที่ส่วน role / permission / workflow ในเอกสาร Phase 1–3 ที่ขัดกัน
> Prototype (ไฟล์เดียว เปิดในเบราว์เซอร์ได้ทันที): `prototype/mgs-food-price-request.html`

## 1. ขอบเขต
**เฉพาะ Food** — กลุ่มสินค้า: กุ้ง · ปลา · หมึก · อาหารแปรรูป (Others ถูกตัดออก) · แผนกขาย: `SALES-FOOD`

## 2. โครงสร้างองค์กรและสายอนุมัติ
```
ขอราคา :  Sales ──► Sales Manager ──► GM ──► (SR หาราคา)
                    └─ ข้ามได้: ถ้าแผนกยังไม่มี Sales Manager ใบจะวิ่งตรงถึง GM
อนุมัติราคา: SR ──► SR Manager ──► GM ──► ส่งถึง Sales      (ห้ามข้ามขั้น)
```

| Role | ทำอะไร | เห็นอะไร |
|---|---|---|
| Sales | สร้าง/แก้ใบ (ก่อนอนุมัติ), รับทราบราคา / ขอปรับราคา | ใบของตัวเอง |
| Sales Manager (`manager`) | อนุมัติ/ไม่อนุมัติ/ส่งกลับ ใบของแผนกที่ตัวเองเป็น `manager_email` | **ทุกใบ** |
| GM | อนุมัติคำขอ + **อนุมัติราคา** (หรือส่งกลับให้ SR แก้) | ทุกใบ |
| SR | รับงาน, ตรวจเอกสาร, หาราคา, ส่งราคาให้ SR Manager | ใบที่ GM อนุมัติแล้ว (Dashboard = งานของตัวเอง) |
| SR Manager (`sr_manager`) — **role ใหม่ แทน SR Lead** | มอบหมายงาน SR, **ตรวจ/อนุมัติราคา** หรือส่งกลับให้ SR แก้ | ใบที่ GM อนุมัติแล้ว (ทุกคน) |
| Admin | จัดการ master data, ตรวจ log | ทุกใบ |

**ข้าม Sales Manager**: ระบบดูที่แท็บ Departments → `SALES-FOOD.manager_email` — ถ้าว่าง หรือผู้ใช้นั้นไม่ใช่ role `manager` / ถูกปิดใช้งาน ใบจะไปขั้น "รอ GM อนุมัติ" ทันที (บันทึก `sales_manager_skipped: true` ใน log) · เมื่อมี Sales Manager แล้ว ใส่อีเมลในช่องนี้ ระบบจะใช้ขั้นนี้ทันที
**ห้ามข้ามขั้นราคา**: GM อนุมัติราคาได้เฉพาะเมื่อ SR Manager อนุมัติแล้ว · ถ้า SR Manager หรือ GM ส่งกลับ SR ต้องส่งใหม่เข้า SR Manager ทุกครั้ง · ผู้หาราคาอนุมัติราคาของตัวเองไม่ได้

| ขั้นตอน (stage) ใหม่ | Main status | ผู้รับผิดชอบ | SLA เริ่มต้น |
|---|---|---|---|
| `pending_sr_manager` รอ SR Manager ตรวจราคา | On Process | SR Manager | 8 ชม. |
| `pending_gm_price` รอ GM อนุมัติราคา | On Process | GM | 8 ชม. |

Action ใหม่: `srm_approve`, `srm_return` (บังคับเหตุผล), `gm_price_approve`, `gm_price_return` (บังคับเหตุผล) · Sales เห็นราคาเมื่อ GM อนุมัติราคาแล้วเท่านั้น

## 3. แบบฟอร์มขอราคา (Price Request – Food)
เรียงตาม Lark form เดิม · `*` = บังคับ (ตรวจทั้งหน้าจอและ server)

| ช่อง | เก็บที่ | หมายเหตุ |
|---|---|---|
| ชื่อลูกค้า (Customer) * | `Tickets.customer_name` | |
| ชื่อสินค้า (Product) * | `TicketItems.product_name` | เพิ่มได้หลายสินค้าในใบเดียว |
| ประเภทสินค้า | `TicketItems.product_group_code` | ไม่บังคับ (ค่าเริ่มต้น FOOD) — ใช้เลือก checklist ของ SR |
| รูปภาพสินค้า (Picture) | `Attachments` (ผูกกับสินค้า) | รูป/PDF ≤ 20 MB, ลากวางได้ |
| น้ำหนักสุทธิ (% Net Weight) * | `TicketItems.net_weight` | ไม่รวมน้ำแข็ง |
| ขนาด (Size) * | `TicketItems.size` | |
| ขนาดของแพคย่อย (Packing Size) * | `TicketItems.packing_size` | เช่น 1Kg/Pack, 500g |
| ปริมาณที่ลูกค้าต้องการต่อเดือน (Qty) * | `TicketItems.qty` | > 0 |
| หน่วย (Unit) * | `TicketItems.uom` | เลือกจากรายการ |
| ราคาเป้าหมาย (THB/Kg) * | `TicketItems.target_price` | ไม่มีให้ใส่ 0 |
| เอกสารที่ต้องการประกอบ | `Tickets.documents_needed` | ว่าง = ไม่ต้องการ |
| วันที่ต้องการให้ตอบกลับราคา * | `Tickets.due_date` | ห้ามเป็นวันที่ผ่านมา |
| ผู้ร้องขอ (Requester) * | `Tickets.requestor_email` | **ใช้บัญชีที่ login อัตโนมัติ** (กันการส่งในนามคนอื่น) |
| หมายเหตุ (Remark) | `Tickets.description` | |

ชื่อใบสร้างให้อัตโนมัติ: `ลูกค้า — สินค้าแรก และอีก N รายการ` · หัวฟอร์มแสดงเส้นทางอนุมัติของผู้ใช้คนนั้น

## 4. Dashboard (แบบง่าย)
- 4 ช่องสรุป: **ทั้งหมด · ✓ เสนอราคาจบแล้ว** (Completed + Closed) **· ⏳ ยังไม่จบ** (+ จำนวนเกิน SLA) **· ✕ ไม่อนุมัติ/ยกเลิก** พร้อม % และแถบสัดส่วน
- **สถานะงาน**: ทุกขั้นตอนเรียงตาม workflow พร้อมจำนวน
- **อัปเดตล่าสุด** 10 ใบ
- **แยกตาม Sales** และ **แยกตาม SR**: ทั้งหมด / จบ / ไม่จบ / ไม่อนุมัติ
- แตะตัวเลขใดก็ได้ → ไปหน้ารายการที่กรองไว้แล้ว · ช่วงเวลา: ทั้งหมด / 30 วัน / 90 วัน / ปีนี้

| ผู้ดู | เห็นข้อมูล |
|---|---|
| Sales | เฉพาะใบของตัวเอง |
| SR | เฉพาะงานที่ตัวเองรับผิดชอบ |
| Sales Manager · GM · SR Manager · Admin | ทุกคน |

## 5. สิ่งที่ต้องทำหลังวางโค้ดชุดใหม่
1. วางไฟล์ `gas/` ทั้งหมดทับ (ไฟล์ที่เปลี่ยน: Config, Auth, Notify, Workflow, Editing, Api, Code, Setup, Tests, App, Index, PageForm, PageDashboard, PageTicket, PageTickets, PagePricing)
2. Run `setupDatabase` → เพิ่มคอลัมน์ใหม่อัตโนมัติ (Tickets 5, TicketItems 3) และ dropdown role ใหม่ในแท็บ Users
3. แท็บ **Users**: เปลี่ยน role ของหัวหน้า SR จาก `sr` เป็น **`sr_manager`** (คอลัมน์ `is_sr_lead` เดิมไม่ใช้แล้ว ลบได้)
4. แท็บ **Departments**: `SALES-FOOD.manager_email` ว่างไว้ = ข้าม Sales Manager · ตั้ง `is_active = FALSE` ให้กลุ่มสินค้า / แผนกที่ไม่ใช่ Food
5. Settings `sla_hours`: `setupDatabase` เติม `pending_sr_manager` และ `pending_gm_price` (8 ชม.) ให้อัตโนมัติ โดยไม่แตะค่าที่ Admin ตั้งไว้
6. Run `runAcceptanceTests` → **188/188** → Deploy **New version**

## 6. ผลทดสอบ
| ชุด | ผล |
|---|---|
| Server acceptance | **188/188** — ใหม่: ฟอร์ม Food (ทุกช่องบังคับ, หน่วยจากรายการ, target 0, วันที่ย้อนหลัง), ข้าม Sales Manager (ไม่มี/ปิดใช้งาน/มี), สายราคา SR → SR Manager → GM (ส่งกลับ 2 แบบ, ห้ามข้าม, ห้ามอนุมัติของตัวเอง, แจ้งเตือนครบ), Dashboard ตามสิทธิ์ทุก role |
| Browser (Chromium, prototype) | กรอกฟอร์มครบ + แนบรูป → ไปถึง GM ทันที · Dashboard GM + กดดูรายการ "ยังไม่จบ" · SR Manager อนุมัติ → GM อนุมัติราคา → ถึง Sales · มือถือ 390px ไม่ล้นจอ · ไม่มี JavaScript error |
