# MGS Price Request & Sourcing System

ระบบใบขอราคาและจัดหาสินค้าภายใน M Global Sourcing Ltd. (MGS)
Workflow: **Sales → Manager → GM → SR (Sourcing) → Sales** พร้อม audit trail แบบ append-only (hash chain),
การเทียบราคา vendor ที่ normalize VAT/FX แล้ว และแจ้งเตือน Lark รายคน

**Stack:** Google Sheets (database) · Google Apps Script (backend + web app) · Google Drive (ไฟล์แนบ) · Lark Bot API

## สถานะการพัฒนา

| Phase | เนื้อหา | สถานะ |
|---|---|---|
| 1 | ฐานข้อมูล Google Sheets + server rules (workflow, สิทธิ์, ราคา, audit log) + seed + acceptance tests | ✅ [docs/phase1-database.md](docs/phase1-database.md) |
| 2 | Web app (dashboard, รายการใบ, รายละเอียด, ฟอร์ม), Lark Bot DM, triggers, อัปโหลดไฟล์ ≤ 20 MB, deploy | ✅ [docs/phase2-webapp.md](docs/phase2-webapp.md) |
| 3 | หน้าใบเสนอราคา SR (Food + Others, ฟอนต์ Prompt) + Prototype | ✅ [docs/phase3-pricing.md](docs/phase3-pricing.md) |

## โครงสร้าง

```
gas/                      # วางทุกไฟล์ลงโปรเจกต์ Apps Script (หรือ clasp push)
  appsscript.json         # manifest: timezone Asia/Bangkok, web app execute-as-me, domain only
  Config.gs               # ค่าคงที่, schema ของทุกแท็บ, enum, default settings
  Util.gs                 # structured result, business error, parse ตัวเลข/วันที่, hash
  Db.gs                   # Sheets-as-database: อ่าน/เขียนตามชื่อคอลัมน์, lock, counters
  Audit.gs                # TicketLogs append-only + SHA-256 hash chain + verifyLogChain()
  Auth.gs                 # ตัวตนจาก Google session, สิทธิ์ระดับใบ (แทน RLS)
  Pricing.gs              # VAT/FX normalization + ตารางเทียบราคา
  Notify.gs               # คิวแจ้งเตือน + ผู้รับผิดชอบแต่ละ stage
  Workflow.gs             # createTicket, transitionTicket (state machine), getTicket
  Editing.gs              # แก้ใบ/รายการ, checklist, ใบเสนอราคา vendor, เลือกผู้ชนะ
  Code.gs                 # doGet + bootstrap (เมนูตาม role)
  Api.gs                  # รายการใบ, inbox, notifications, dashboard
  Files.gs                # อัปโหลดไฟล์แนบแบบ chunk + เปิดไฟล์ตามสิทธิ์
  Lark.gs                 # Lark Bot API (DM รายคน) + retry
  Jobs.gs                 # triggers: ส่งแจ้งเตือน, SLA, self-test, backup
  Setup.gs                # setupDatabase, seedMasterData, seedDemoData
  Tests.gs                # runAcceptanceTests (ใช้ชีตชั่วคราว, 151 ข้อ)
  Index.html, App.html    # โครงหน้าเว็บ + แกน JS (router, api, dialog, upload)
  Page*.html              # Dashboard, รายการ, รายละเอียด, ฟอร์ม, ใบเสนอราคา (Pricing)
dev/gas-local-runner.js   # รันโค้ด gas/ + tests บน Node ด้วย mock (ไม่ได้ deploy)
dev/preview-server.js     # เปิดหน้าเว็บจริงในเครื่องด้วยข้อมูลจำลอง (ไม่ได้ deploy)
dev/build-prototype.js    # สร้าง prototype ไฟล์เดียว (UI + โค้ด server รันในเบราว์เซอร์)
docs/                     # เอกสารแต่ละ phase
```

## Quick start

ดูขั้นตอนเต็มใน [docs/phase1-database.md §7](docs/phase1-database.md)
1. script.google.com → New project → วางไฟล์ทั้งหมดใน `gas/`
2. Run `setupDatabase` → Run `runAcceptanceTests` (ต้องได้ 151/151) → Run `seedDemoData` (UAT)
3. Deploy เป็น Web app (Execute as Me, Anyone within domain) → Run `installTriggers` — ดู [docs/phase2-webapp.md §4](docs/phase2-webapp.md)

นักพัฒนา: `node dev/gas-local-runner.js tests` · `node dev/preview-server.js` แล้วเปิด http://localhost:8787/?as=mgr.food@example.co.th
