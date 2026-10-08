# Phase 2 — Web App, Lark, Triggers, ไฟล์แนบ และการ Deploy

> MGS Price Request — เวอร์ชัน `2026.10.06-1` · Stack: Google Apps Script web app + Google Sheets + Drive + Lark Bot API

## 1. โครงสร้างโปรเจกต์

| ไฟล์ | หน้าที่ | Phase |
|---|---|---|
| `appsscript.json` | manifest: timezone `Asia/Bangkok`, V8, web app **Execute as: Me / Access: Domain**, OAuth scopes | 1 |
| `Config.gs` | ค่าคงที่, schema ของ 15 แท็บ, enum, settings เริ่มต้น | 1 |
| `Util.gs` | structured result `{ok,data}`, business error, parse ตัวเลข/วันที่, hash, **test seams** (HTTP/Drive/Lark) | 1–2 |
| `Db.gs` | Sheets-as-database, `withLock_`, counters | 1 |
| `Audit.gs` | TicketLogs append-only + hash chain, `verifyLogChain()` | 1 |
| `Auth.gs` | ตัวตนจาก Workspace session, สิทธิ์ระดับใบ, guard ของฟังก์ชัน admin/job | 1–2 |
| `Pricing.gs`, `Workflow.gs`, `Editing.gs`, `Notify.gs` | ราคา, state machine, การแก้ไข, คิวแจ้งเตือน | 1 |
| **`Code.gs`** | `doGet()` entry point, `include_()` (whitelist), `getBootstrap()` (ผู้ใช้ + เมนูตาม role + ข้อมูลอ้างอิง) | 2 |
| **`Api.gs`** | `listTickets` (ตัวกรอง/ค้นหา/aging/SLA/แบ่งหน้า), `getPoll`, `getNotifications`, `markNotificationsRead`, `getDashboard` | 2 |
| **`Files.gs`** | อัปโหลด ≤ 20 MB ทีละ 2 MB ผ่าน Drive resumable upload, `openAttachment` (ให้สิทธิ์อ่านรายคน), `deleteAttachment` | 2 |
| **`Lark.gs`** | Bot API: token cache, หา open_id จากอีเมล, ส่ง card DM, retry + backoff, ข้อความเข้ากลุ่ม, `testLarkConnection()` | 2 |
| **`Jobs.gs`** | `installTriggers()`, `checkSlaAlerts` (รายชั่วโมง), `runSelfTest` (รายวัน), `weeklyBackup` (รายสัปดาห์) | 2 |
| `Setup.gs`, `Tests.gs` | ติดตั้ง/seed, acceptance tests (Phase 1 + 2 = 132 ข้อ) | 1–2 |
| **`Index.html`** | โครงหน้า + design tokens + CSS (mobile-first, ปุ่ม ≥ 44px) | 2 |
| **`App.html`** | แกนฝั่ง browser: `api()` (promise + timeout + failure handler), router, dialog, toast, tooltip, polling, chunked upload | 2 |
| **`PageDashboard.html`** | ภาพรวม: KPI, สถานะ/ขั้นตอน, aging, SLA, Sales, ภาระงาน SR, cycle time, vendor, กลุ่มสินค้า | 2 |
| **`PageTickets.html`** | รายการใบ: งานรอฉัน / ของฉัน / คิว SR / ทั้งหมด + ตัวกรอง | 2 |
| **`PageTicket.html`** | รายละเอียดใบ: ปุ่ม action ตาม role, ตารางเทียบราคา, checklist, ไฟล์แนบ, timeline | 2 |
| **`PageForm.html`** | สร้าง / แก้ไขใบขอราคา (หลายรายการ, validate ทันที, กันกดซ้ำ) | 2 |
| `PagePricing.html` | หน้าตรวจเอกสาร + กรอกราคาของ SR — **placeholder** จะแทนที่ใน Phase 3 | 3 |
| `dev/gas-local-runner.js` | รัน `.gs` + tests บน Node ด้วย mock (ไม่ deploy) | dev |
| `dev/preview-server.js` | เปิด UI จริงในเครื่อง โดยจำลอง `google.script.run` (ไม่ deploy) | dev |

### เทียบกับแนวคิดเดิม (Next.js)

| เดิม | Apps Script |
|---|---|
| Route groups ตาม role + `middleware.ts` | `getBootstrap()` ส่ง**เมนูตาม role** และทุก API ตรวจสิทธิ์ฝั่ง server ทุกครั้ง (การซ่อนเมนูเป็นแค่ UX) |
| Auth redirect | Web app `Access: Anyone within domain` → Google บังคับ login บัญชีบริษัทก่อนเข้า; ผู้ที่ไม่อยู่ในแท็บ Users เห็นหน้า "ยังไม่มีสิทธิ์ใช้งาน" |
| URL `/tickets/[id]` | `?page=ticket&id=…` ผ่าน `google.script.history` (ปุ่ม Back ใช้ได้, ลิงก์ใน Lark เปิดตรงหน้าใบ) |
| `.env` | **Script Properties** (ตารางข้อ 3) |
| Supabase Realtime | polling ทุก 60 วินาทีเมื่อหน้าจอเปิดอยู่ (badge งานรอฉัน + การแจ้งเตือน) |
| Edge Function → Lark | `dispatchNotifications` ทุก 1 นาที (คิวในแท็บ Notifications) |
| Storage signed URL | Drive: ให้สิทธิ์ **อ่านเฉพาะคนที่กดเปิด** และเฉพาะคนที่มีสิทธิ์เห็นใบ (ไม่ส่งอีเมล) |

## 2. หน้าจอตาม role

| เมนู | Sales | Manager | GM | SR | Admin |
|---|---|---|---|---|---|
| ภาพรวม (Dashboard) | ✅ เฉพาะใบตัวเอง | ✅ แผนกตัวเอง | ✅ ทั้งหมด | ✅ ใบหลัง GM อนุมัติ | ✅ |
| งานรอฉัน (+ตัวเลขแจ้งเตือน) | ✅ | ✅ | ✅ | ✅ | ✅ |
| ใบขอราคาของฉัน / งานของฉัน | ✅ | – | – | ✅ | – |
| + สร้างใบขอราคา | ✅ | – | – | – | – |
| คิวรอรับงาน | – | – | – | ✅ | – |
| ใบขอราคาทั้งหมด | – | ✅ | ✅ | ✅ | ✅ |

## 3. Script Properties (แทน `.env`)

Apps Script → ⚙️ Project Settings → **Script properties**

| Key | ตั้งโดย | ค่า |
|---|---|---|
| `DB_SPREADSHEET_ID` | `setupDatabase()` อัตโนมัติ | ID ชีตฐานข้อมูล |
| `DRIVE_ROOT_FOLDER_ID` | `setupDatabase()` อัตโนมัติ | โฟลเดอร์ไฟล์แนบ (มีโฟลเดอร์ย่อยต่อใบ + `Backups`) |
| `LARK_APP_ID` | Admin | `cli_xxx` จาก Lark Developer Console |
| `LARK_APP_SECRET` | Admin | App Secret (**ความลับ** — อย่าวางในแชท/เอกสาร) |
| `LARK_HOST` | Admin (ไม่บังคับ) | `https://open.larksuite.com` (ค่าเริ่มต้น) หรือ `https://open.feishu.cn` |
| `LARK_GROUP_CHAT_ID` | Admin (ไม่บังคับ) | `oc_xxx` กลุ่มรับสรุป SLA เกิน / self-test ล้มเหลว (ต้องเชิญ bot เข้ากลุ่ม) |
| `LARK_PRICE_GROUP_CHAT_ID` | Admin (ไม่บังคับ) | `oc_xxx` กลุ่ม Sales — แจ้งสถานะอัตโนมัติ (ไม่มีราคา) · ว่าง = ใช้ `LARK_GROUP_CHAT_ID` · ดู phase 6 |
| `LARK_MGMT_GROUP_CHAT_ID` | Admin (ไม่บังคับ) | `oc_xxx` กลุ่มผู้บริหาร (SR / SR Manager / GM) — ราคารอตรวจ / รอ GM อนุมัติฝั่งซื้อ · ว่าง = ไม่ส่ง |
| `WEBAPP_URL` | Admin (ไม่บังคับ) | URL `/exec` ถ้าต้องการบังคับลิงก์ใน Lark (ปกติระบบหาเองจาก deployment) |

## 4. ติดตั้งตั้งแต่ศูนย์จนใช้งานได้

> ใช้ **บัญชีกลางของบริษัท** (เช่น `system@…`) ทุกขั้นตอน — บัญชีนี้เป็นเจ้าของชีต ไฟล์ สคริปต์ และ trigger

1. **สร้างโปรเจกต์**: script.google.com → New project → ตั้งชื่อ `MGS Price Request`
2. ⚙️ Project Settings → ติ๊ก *Show "appsscript.json"* → วาง `gas/appsscript.json`
3. **วางไฟล์ทั้งหมด** จากโฟลเดอร์ `gas/` (ชื่อไฟล์ต้องตรง ไม่ต้องใส่นามสกุล): Script 16 ไฟล์ (`Config` `Util` `Db` `Audit` `Auth` `Pricing` `Notify` `Workflow` `Editing` `Api` `Files` `Lark` `Jobs` `Code` `Setup` `Tests`) และ HTML 7 ไฟล์ (`Index` `App` `PageDashboard` `PageTickets` `PageTicket` `PageForm` `PagePricing`)
4. Run `setupDatabase` → อนุญาตสิทธิ์ (Sheets, Drive, ส่ง HTTP, triggers)
5. Run `runAcceptanceTests` → ต้องได้ **`✅ ALL TESTS PASSED — 132/132 passed`** (ใช้ชีตชั่วคราว ไม่เรียก Lark/Drive จริง)
6. **ข้อมูลตั้งต้น**: Production → Run `seedMasterData` แล้วกรอกแท็บ **Users** (email, ชื่อ, role, department_code, is_active=TRUE) และ `manager_email` ในแท็บ **Departments** · UAT → แก้ `DEMO_DOMAIN` ใน `Setup.gs` แล้ว Run `seedDemoData`
7. **Lark** (ดูข้อ 5) → ใส่ Script Properties → Run `testLarkConnection` ต้องได้ DM ทดสอบ
8. **Deploy**: Deploy → New deployment → ⚙️ Web app → Execute as **Me** → Who has access **Anyone within <โดเมนบริษัท>** → Deploy → คัดลอก URL `/exec`
9. Run `installTriggers` (สร้าง trigger 4 ตัว) → Run `runSelfTest` ทุกข้อควร PASS
10. ส่ง URL `/exec` ให้ผู้ใช้ (ปักหมุดใน Lark ได้) — **ห้ามแชร์ชีตฐานข้อมูล**

### Deploy เวอร์ชันใหม่ทุกครั้งที่แก้โค้ด
Deploy → **Manage deployments** → ✏️ → Version: **New version** → Deploy
(การกด Save อย่างเดียว **ไม่อัปเดต** URL `/exec` — อาการ "ใน editor ใช้ได้ แต่ของจริงไม่เปลี่ยน" เกิดจากข้อนี้เกือบทุกครั้ง)
แก้ `APP_VERSION` ใน `Config.gs` ทุกครั้ง แล้วตรวจที่ท้ายหน้าเว็บว่าเลขเวอร์ชันตรง · **Rollback** = Manage deployments → เลือก version ก่อนหน้า

## 5. ตั้งค่า Lark Bot (DM รายคน)

1. Lark Developer Console → **Create custom app** → เปิด capability **Bot**
2. Permissions & Scopes: `im:message:send_as_bot` (ส่งข้อความ) และ `contact:user.id:readonly` (หา user จากอีเมล)
3. Availability: ให้แอปมองเห็นพนักงานทุกคนที่ใช้ระบบ → **Create version → Publish** (ให้ admin Lark อนุมัติ)
4. คัดลอก App ID / App Secret ใส่ Script Properties → Run `testLarkConnection`
5. ระบบหา Lark user จากอีเมลบริษัทอัตโนมัติ — ถ้าอีเมล Lark ไม่ตรงกับอีเมล Google ให้กรอก `lark_open_id` ในแท็บ Users

| สถานะในแท็บ Notifications (`lark_status`) | ความหมาย |
|---|---|
| `pending` | รอส่ง / รอส่งซ้ำ (backoff 1 → 5 → 15 → 60 นาที) |
| `sending` | กำลังส่ง (ถ้าค้างเกิน 10 นาที จะกลับมาส่งใหม่) |
| `sent` | ส่งแล้ว |
| `no_lark_user` | ไม่พบผู้ใช้ Lark จากอีเมลนี้ → กรอก `lark_open_id` |
| `failed` | ส่งไม่สำเร็จครบ 5 ครั้ง → self-test รายวันแจ้งเตือนเข้ากลุ่ม |

การแจ้งเตือนในแอป (ไอคอน 🔔) ทำงานเสมอแม้ยังไม่ได้ตั้งค่า Lark

## 6. Scheduled jobs (`installTriggers`)

| Job | เวลา | ทำอะไร |
|---|---|---|
| `dispatchNotifications` | ทุก 1 นาที | ส่ง Lark DM ทีละไม่เกิน 40 ข้อความ |
| `checkSlaAlerts` | ทุกชั่วโมง | ใกล้ครบ SLA (80%) → แจ้งผู้รับผิดชอบ · เกิน SLA → แจ้งผู้รับผิดชอบ + หัวหน้า + สรุปเข้ากลุ่ม (ไม่แจ้งซ้ำในการเข้า stage ครั้งเดียวกัน) |
| `runSelfTest` | ทุกวัน 07:00 | schema, ค่าตั้งค่า, แผนกที่ไม่มี Manager, ใบที่ไม่มี log การสร้าง, status/stage ตรงกัน, hash chain, Lark ล้มเหลว → แจ้งกลุ่มถ้าพบปัญหา |
| `weeklyBackup` | วันจันทร์ 06:00 | สำเนาชีตฐานข้อมูลไว้ที่ `Backups` เก็บ 12 สัปดาห์ล่าสุด |

ฟังก์ชันเหล่านี้เป็น public จึงใส่ guard: เรียกได้จาก trigger หรือโดยเจ้าของ/Admin เท่านั้น (ผู้ใช้ทั่วไปเรียกผ่าน browser จะได้ `FORBIDDEN`)

## 7. ผลการทดสอบ

| ชุดทดสอบ | ผล |
|---|---|
| Server acceptance tests (`runAcceptanceTests` / `node dev/gas-local-runner.js tests`) | **132/132 passed** (Phase 1: 79 + Phase 2: 53) |
| End-to-end ใน Chromium ผ่าน `dev/preview-server.js` | ผ่าน: Sales สร้างใบ (ฟอร์มว่างถูกบล็อก 5 ช่อง) → Manager เห็นใน "งานรอฉัน", ไม่อนุมัติโดยไม่ใส่เหตุผลถูกบล็อก, อนุมัติ → GM อนุมัติผ่าน deep link → SR รับงานจากคิว → Sales อีกคนเปิดใบไม่ได้ → มือถือ 390px: รายการ, ตารางเทียบราคา, การแจ้งเตือน → ผู้ใช้ที่ไม่ได้ลงทะเบียนเห็นหน้าแจ้งสิทธิ์ · ไม่มี JavaScript error |

Phase 2 server tests ครอบคลุม: เมนูตาม role, รายการใบเห็นเฉพาะที่มีสิทธิ์ (แม้ส่ง `scope=all`), inbox, ค้นหา/กรอง/แบ่งหน้า, dashboard ตามขอบเขตผู้ใช้, อ่านการแจ้งเตือน, อัปโหลด (ชนิดไฟล์, ขนาด, chunk ซ้ำ, ขโมย session, Content-Range), สิทธิ์เปิด/ลบไฟล์, Lark (ส่งสำเร็จ, ไม่มีผู้ใช้ Lark, retry, failed หลัง 5 ครั้ง, ไม่ส่งเมื่อยังไม่ตั้งค่า), SLA (เตือนครั้งเดียว, escalate ถึง GM), self-test

## 8. UAT checklist (สำหรับผู้ใช้จริง)

```
ตรวจรับระบบ: MGS Price Request (เวอร์ชัน 2026.10.06-1)
ผู้ทดสอบ: ____________  Role: ____________  วันที่: ____________
```

| # | สิ่งที่ต้องลอง | ผลที่ควรได้ | ผ่าน/ไม่ผ่าน | หมายเหตุ |
|---|---|---|---|---|
| 1 | เปิดลิงก์ระบบจากมือถือด้วยบัญชีบริษัท | เห็นชื่อตัวเองมุมขวาบน และเมนูตามตำแหน่งงาน ภายใน 5 วินาที | | |
| 2 | (Sales) สร้างใบขอราคา 2 รายการ + แนบไฟล์ PDF 1 ไฟล์ | ได้เลขที่ใบ PR-ปปปป-xxxx และเห็นไฟล์แนบในหน้ารายละเอียด | | |
| 3 | (Sales) กดส่งโดยไม่กรอกชื่อสินค้า | ช่องที่ขาดเป็นสีแดง มีข้อความบอก และยังไม่ส่ง | | |
| 4 | (Manager) เปิด Lark | ได้ข้อความแจ้งใบใหม่ กดปุ่มแล้วเปิดหน้าใบนั้นทันที | | |
| 5 | (Manager) กด "ไม่อนุมัติ" โดยไม่ใส่เหตุผล | ระบบไม่ยอม ให้กรอกเหตุผลก่อน | | |
| 6 | (Manager) กด "ส่งกลับให้แก้ไข" พร้อมเหตุผล → (Sales) แก้แล้วกดส่งอีกครั้ง | ใบกลับไปรอ Manager และ Timeline แสดงทุกขั้น | | |
| 7 | (GM) อนุมัติ | สถานะเป็น "On Process / รอ SR รับงาน" และ SR ทุกคนได้แจ้งเตือน | | |
| 8 | (SR 2 คน) กด "รับงานนี้" พร้อมกัน | มีคนเดียวที่รับได้ อีกคนเห็นข้อความ "งานนี้ถูกรับไปแล้ว" | | |
| 9 | (Sales 3–5 คน) กดสร้างใบพร้อมกัน | เลขที่ใบไม่ซ้ำ ไม่ข้าม (ดูในหน้ารายการ) | | |
| 10 | (Sales คนอื่น) เปิดลิงก์ใบที่ไม่ใช่ของตัวเอง | เห็น "ไม่พบใบขอราคา หรือคุณไม่มีสิทธิ์เข้าถึง" | | |
| 11 | กดไฟล์แนบเพื่อเปิด | เปิดไฟล์ใน Google Drive ได้ (เฉพาะคนที่มีสิทธิ์เห็นใบ) | | |
| 12 | ดูหน้า "ภาพรวม" เปลี่ยนช่วงวันที่ 30 วัน / 1 ปี | ตัวเลขเปลี่ยนตาม และแตะกราฟแล้วเห็นรายละเอียด | | |
| 13 | ปิดแอปทิ้งไว้ แล้วเปิดใหม่หลังมีงานเข้า | ตัวเลขแดงที่ "งานรอฉัน" และ 🔔 อัปเดตภายใน 1 นาที | | |
| 14 | ดูท้ายหน้าเว็บ | เลขเวอร์ชันตรงกับที่ Admin แจ้ง | | |

**ปัญหาที่พบ / สิ่งที่อยากให้แก้:** ______________________

## 9. Watch-outs

- **SR ยังตรวจเอกสาร/กรอกราคาผ่านหน้าเว็บไม่ได้** จนกว่าจะส่ง Phase 3 (ปุ่มพาไปหน้า placeholder)
- **Polling ไม่ใช่ realtime** — badge อัปเดตช้าสุด ~1 นาที, Lark ช้าสุด ~1–2 นาที (trigger ทุก 1 นาที)
- **สิทธิ์อ่านไฟล์ Drive ที่ให้ไปแล้วไม่ถูกถอนอัตโนมัติ** เมื่อผู้ใช้เปลี่ยนแผนก/ลาออก — ปิด `is_active` ในแท็บ Users จะตัดการเข้าแอปทันที แต่ลิงก์ไฟล์ที่เคยเปิดยังใช้ได้กับบัญชีนั้น จนกว่าบัญชี Google จะถูกปิด (ขั้นตอน off-boarding ปกติของบริษัท)
- **โควตา Apps Script**: trigger ทุกนาที + UrlFetch อยู่ในโควตา Workspace สบาย ๆ ที่ 80 คน แต่ถ้าเจอ "Service invoked too many times" ให้ดู ErrorLog
- **ความเร็ว**: แต่ละการเรียก server ~1–3 วินาที (อ่านชีตทั้งแท็บ) — เมื่อ Tickets เกิน ~3,000 ใบ ควรทำ archive รายปี (จะเพิ่มเมื่อถึงเวลา)
- **Preview ในเครื่องใช้ mock** — ต้องทดสอบบน `/exec` จริงด้วย UAT checklist ข้างบนก่อนใช้งานจริง
