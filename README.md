# MGS Price Request & Sourcing System

ระบบใบขอราคาและจัดหาสินค้าภายใน M Global Sourcing Ltd. (MGS)
Workflow: **Sales → Manager → GM → SR (Sourcing) → Sales** พร้อม audit trail แบบ append-only (hash chain),
การเทียบราคา vendor ที่ normalize VAT/FX แล้ว และแจ้งเตือน Lark รายคน

**Stack:** Google Sheets (database) · Google Apps Script (backend + web app) · Google Drive (ไฟล์แนบ) · Lark Bot API

## สถานะการพัฒนา

| Phase | เนื้อหา | สถานะ |
|---|---|---|
| 1 | ฐานข้อมูล Google Sheets + server rules (workflow, สิทธิ์, ราคา, audit log) + seed + acceptance tests | ✅ [docs/phase1-database.md](docs/phase1-database.md) |
| 2 | Web app shell, routing ตาม role, Lark dispatcher, triggers, อัปโหลดไฟล์, deploy | ⏳ |
| 3 | หน้า SR Pricing Form | ⏳ |

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
  Setup.gs                # setupDatabase, seedMasterData, seedDemoData
  Tests.gs                # runAcceptanceTests (ใช้ชีตชั่วคราว)
dev/gas-local-runner.js   # รันโค้ด gas/ + tests บน Node ด้วย mock (ไม่ได้ deploy)
docs/                     # เอกสารแต่ละ phase
```

## Quick start

ดูขั้นตอนเต็มใน [docs/phase1-database.md §7](docs/phase1-database.md)
1. script.google.com → New project → วางไฟล์ทั้งหมดใน `gas/`
2. Run `setupDatabase` → Run `runAcceptanceTests` (ต้องได้ 79/79) → Run `seedDemoData` (UAT)

นักพัฒนา: `node dev/gas-local-runner.js tests`
