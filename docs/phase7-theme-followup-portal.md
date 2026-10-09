# Phase 7 — ธีมเขียว · ติดตามการขายแบบ Sales app · หน้ารวมผู้บริหาร Food + Mech

เวอร์ชัน `2026.10.09-1` · ขั้นตอนขอราคาและรายละเอียดราคาฝั่ง Food **ไม่เปลี่ยน** (ฟอร์ม, สายอนุมัติ, ต้นทุน + ค่าเคลียร์ + GP, สิทธิ์การเห็นราคา)

## 1. วิเคราะห์ไฟล์ระบบ Mech (MGS Project Pricing v4.2) ที่ใช้เป็นต้นแบบ
| ส่วน | ระบบ Mech (Code.gs + Sales.html) | ใน Food (ทำแล้ว) |
|---|---|---|
| แอป Sales | ไฟล์ HTML แยก `Sales.html` (`?app=sales`) | **ไม่แยกไฟล์** — อยู่ในเว็บเดียว เมนู 🎯 ติดตามการขาย |
| ขั้นตอนที่ Sales เห็น | stageOf(): รอ Sourcing → กำลังทำราคา → รอผู้บริหารอนุมัติ → อนุมัติแล้ว รอปล่อยราคา → ราคาพร้อม · ติดตามลูกค้า → ปิดการขายได้ / ปิดงาน | ใบขอราคา (stage เดิม) + ผลการขายต่อรายการ: รอติดตาม · กำลังติดตาม · ส่งตัวอย่าง · ปิดการขายได้ · ไม่ได้งาน |
| อัปเดตความคืบหน้า | `salesPatch` → salesUpdate {stage, note, next} + followUpDate | `updateDeal` → **สถานะกับลูกค้า** (deal_stage) + **สิ่งที่คุย** (deal_note) + **ขั้นตอนถัดไป** (deal_next_step) + **วันนัด** (deal_next_date) + เหตุผลถ้าไม่ได้งาน |
| กติกาต้องอัปเดต | ราคาอยู่ที่ Sales และไม่ได้อัปเดต ≥ 7 วัน หรือเลยวันนัด | เหมือนกัน: งานที่ยังเปิด ไม่ได้อัปเดต ≥ `deal_follow_days` (7) วันนับจากได้ราคา/อัปเดตล่าสุด หรือถึงวันนัด |
| หน้าจอ | KPI 5 ช่อง (กดเพื่อกรอง) · การ์ดงาน · ทีมขาย (การ์ดต่อคน) · คัดลอกราคาเป็นข้อความ | เหมือนกัน (KPI: งานที่เปิดอยู่ · ต้องอัปเดต · ปิดได้ · ไม่ได้งาน · อัตราปิด) |
| สิทธิ์ | Sales ไม่ได้รับต้นทุน (stripCost_) · Sales Manager เห็นทั้งทีม | Sales เห็นเฉพาะของตัวเอง ไม่มีต้นทุน · Sales Manager / GM / Admin / SR Manager เห็นทีม |
| ตัวเลือกใน dropdown | CUST_STAGES / NEXT_STEPS ในโค้ด | Settings `deal_customer_stages` / `deal_next_steps` (แก้ได้ไม่ต้องแก้โค้ด) |

## 2. ธีม
- โทนเขียวจากภาพ (เขียว #13A889 → teal #0B6377) · พื้นหลังสีอ่อน `#F3F8F6` · การ์ดขาว มุมโค้ง 14–16 px · tag แบบ pill · ปุ่มมุมโค้ง 11 px (แบบ Sales.html)
- เมนูซ้ายไล่สีเขียว (ตัวอักษรขาว ผ่าน contrast) · แถบบนโปร่งพื้นอ่อน
- ฟอนต์ (ชุดเดียวกับระบบ Mech): **Inter** (อังกฤษ) + **Sarabun** (ไทย) เนื้อหา · **Sora** หัวข้อ · **JetBrains Mono** ตัวเลข / เลขที่เอกสาร
- prototype ฝังฟอนต์ไว้ (`dev/fonts/`) · web app โหลดจาก Google Fonts

## 3. หน้ารวมผู้บริหาร (`?page=portal`)
- GM เข้าเว็บแล้วเจอหน้านี้ก่อน · Admin / SR Manager มีในเมนู · role ใหม่ **`viewer`** (ผู้บริหาร) เห็นเฉพาะหน้านี้ (ไม่เห็นใบขอราคาราย ticket)
- แถบบนสีเขียว: ปุ่มใหญ่ **Food →** (เข้าระบบนี้) และ **Mech →** (เปิดเว็บทำราคา Mech แยก)
- ตัวเลขรวม 2 ระบบ: งานทำราคาที่เปิดอยู่ · รอผู้บริหารอนุมัติ · ราคาถึง Sales รอลูกค้า · ปิดการขายได้
- การ์ดแต่ละระบบ: ขั้นตอน (คำขอ → ทำราคา → รออนุมัติ → ถึง Sales → ปิดได้) · มูลค่ารอปิด / ปิดได้ · GP % · อัตราปิด · รายการรออนุมัติ · แนวโน้ม 6 เดือน
  - Food: มูลค่า = ราคาขาย × ปริมาณ/เดือน · กดรายการรออนุมัติเพื่อเปิดใบ
  - Mech: อ่านจากแท็บ `Quotations` ของระบบ Mech (เฉพาะคอลัมน์สรุป ไม่อ่าน Detail) · USD แปลงด้วย Exrate ของใบ · สกุลอื่นแจ้งแยก · cache 5 นาที
  - สถานะ Mech: SR Submitted = คำขอ · Accepted / Requested / In Progress = ทำราคา · Submitted / Partial Approved = รออนุมัติ · Approved = รอปล่อยราคา · Pending = ถึง Sales · Won · Closed

### ตั้งค่า
1. Script Properties ของระบบ Food: `MECH_SHEET_ID` = ID ไฟล์ Google Sheets ของ MGS Project Pricing · `MECH_WEBAPP_URL` = ลิงก์ /exec ของระบบ Mech
2. แชร์ไฟล์ Sheets ของ Mech ให้ **เจ้าของสคริปต์ Food** แบบ Viewer (สคริปต์รันในชื่อเจ้าของ)
3. ผู้บริหารที่ไม่ได้ใช้ระบบ Food: เพิ่มในแท็บ Users role `viewer`
4. (ไม่บังคับ) ในระบบ Mech ใส่ลิงก์กลับ `https://…/exec?page=portal` ของ Food เพื่อกลับมาหน้ารวม

## หลังวางโค้ด
1. วางไฟล์ `gas/` ทั้งหมด (ไฟล์ใหม่: `Portal.gs`, `PagePortal.html`)
2. Run `setupDatabase` → คอลัมน์ `deal_stage`, `deal_next_step` · Settings `deal_customer_stages`, `deal_next_steps` · role `viewer` ใน dropdown
3. Run `runAcceptanceTests` → 387/387 · Deploy **New version**
