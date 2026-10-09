# Phase 7 — ธีมเขียว · ติดตามการขายแบบ Sales app · หน้ารวมผู้บริหาร Food + Mech

เวอร์ชัน Food `2026.10.09-2` · หน้ารวม `2026.10.09-2` · ขั้นตอนขอราคาและรายละเอียดราคาฝั่ง Food **ไม่เปลี่ยน** (ฟอร์ม, สายอนุมัติ, ต้นทุน + ค่าเคลียร์ + GP, สิทธิ์การเห็นราคา)

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

## 3. หน้ารวมผู้บริหาร — เว็บแยก (ไม่อยู่ในระบบ Food)
หน้ารวมเป็น **web app แยกต่างหาก** (โฟลเดอร์ `portal/` = โปรเจกต์ Apps Script ของตัวเอง มีลิงก์ /exec ของตัวเอง)
เป็นหน้าทางเข้าก่อนเลือกระบบ: ดูภาพรวมการทำราคาทั้ง Food และ Mech แล้วกดปุ่มเพื่อเข้าเว็บทำราคาของแต่ละฝั่ง
ระบบ Food ไม่มีหน้ารวมอยู่ข้างใน และหน้ารวมไม่แก้ข้อมูลของทั้ง 2 ระบบ (สิทธิ์อ่านอย่างเดียว `spreadsheets.readonly`)

- ปุ่มใหญ่ **Food →** (เปิด MGS Food Price Request) และ **Mech →** (เปิด MGS Project Pricing)
- ตัวเลขรวม: งานทำราคาที่เปิดอยู่ · รอผู้บริหารอนุมัติ · ราคาถึง Sales รอลูกค้า · ปิดการขายได้
- การ์ดแต่ละระบบ: ขั้นตอน (คำขอ → ทำราคา → รออนุมัติ → ถึง Sales → ปิดได้) · มูลค่ารอปิด / ปิดได้ · GP % · อัตราปิด · รายการรออนุมัติ · แนวโน้ม 6 เดือน
  - Food: อ่านแท็บ Tickets / TicketItems / Quotations / Settings (มูลค่า = ราคาขาย × ปริมาณ/เดือน)
  - Mech: อ่านแท็บ Quotations เฉพาะคอลัมน์สรุป (ไม่อ่าน Detail) · USD × Exrate ของใบ · สกุลอื่นแจ้งแยก
  - สถานะ Mech: SR Submitted = คำขอ · Accepted / Requested / In Progress = ทำราคา · Submitted / Partial Approved = รออนุมัติ · Approved = รอปล่อยราคา · Pending = ถึง Sales · Won · Closed
- อัปเดตทุก 5 นาที (ปุ่มรีเฟรชดึงใหม่ทันที)
- ผู้มีสิทธิ์: Food role gm / admin / sr_manager **หรือ** อีเมลใน `PORTAL_ALLOWED_EMAILS` (เช่น BD Mgr / Procurement Mgr ฝั่ง Mech) · Sales / Sales Manager / SR เปิดไม่ได้

### ติดตั้ง (ครั้งเดียว)
1. สร้างโปรเจกต์ Apps Script ใหม่ชื่อ “MGS Price Request Portal” → วาง `portal/Code.gs`, `portal/Portal.html`, `portal/appsscript.json`
2. Project Settings → Script properties:
   | Key | ค่า |
   |---|---|
   | `FOOD_SHEET_ID` | ID ไฟล์ฐานข้อมูล Food (= `DB_SPREADSHEET_ID` ของระบบ Food) |
   | `FOOD_WEBAPP_URL` | ลิงก์ /exec ของ MGS Food Price Request |
   | `MECH_SHEET_ID` | ID ไฟล์ Google Sheets ของ MGS Project Pricing |
   | `MECH_WEBAPP_URL` | ลิงก์ /exec ของ MGS Project Pricing |
   | `PORTAL_ALLOWED_EMAILS` | (ไม่บังคับ) อีเมลผู้บริหารเพิ่มเติม คั่นด้วย , |
3. แชร์ไฟล์ Sheets ทั้ง 2 ไฟล์ให้บัญชีที่ deploy หน้ารวมแบบ **Viewer**
4. Run `checkPortalSetup()` → แก้ตามที่แจ้ง
5. Deploy → New deployment → Web app · Execute as: **Me** · Who has access: **Anyone within บริษัท**
6. ใช้ลิงก์ /exec ของหน้ารวมเป็นหน้าเว็บทางเข้าของผู้บริหาร (bookmark / ใส่ใน Lark)

ทดสอบ: `node dev/portal-test.js` (21 เทสต์) · prototype: `node dev/build-portal-prototype.js prototype/mgs-portal.html`

## หลังวางโค้ด
1. ระบบ Food: วางไฟล์ `gas/` ทั้งหมด → Run `setupDatabase` (คอลัมน์ `deal_stage`, `deal_next_step` · Settings `deal_customer_stages`, `deal_next_steps`) → Run `runAcceptanceTests` (372/372) → Deploy **New version**
2. หน้ารวม: ติดตั้งโปรเจกต์แยกตามข้อ 3
