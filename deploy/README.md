# ไฟล์สำหรับวางขึ้น Apps Script (พร้อมใช้)

สร้างจากโค้ดในโฟลเดอร์ `gas/` และ `portal/` ด้วย `node dev/build-deploy.js` — แก้โค้ดที่ `gas/` / `portal/` แล้วรันคำสั่งนี้ใหม่ทุกครั้ง

## 1. ระบบ Food — `deploy/food/` (3 ไฟล์)
| ไฟล์ใน Apps Script | วางจาก |
|---|---|
| `Code.gs` | `deploy/food/Code.gs` (โค้ดฝั่ง server ทั้งหมดรวมไฟล์เดียว) |
| `Index.html` | `deploy/food/Index.html` (หน้าเว็บทั้งหมดรวมไฟล์เดียว — ตั้งชื่อไฟล์ว่า **Index** ตรงตัว) |
| `appsscript.json` | `deploy/food/appsscript.json` (Project Settings → ✅ Show "appsscript.json" manifest file in editor) |

### ติดตั้งครั้งแรก
1. https://script.google.com → **New project** → ตั้งชื่อ “MGS Food Price Request”
2. ลบโค้ดเดิมใน `Code.gs` → วางไฟล์ `Code.gs` · กด **+ › HTML** ตั้งชื่อ `Index` → วาง `Index.html` · เปิด manifest แล้ววาง `appsscript.json` · **Save**
3. เลือกฟังก์ชัน **`setupDatabase`** → **Run** → อนุญาตสิทธิ์ (ระบบสร้าง Google Sheets ฐานข้อมูล + โฟลเดอร์ไฟล์แนบใน Drive ให้อัตโนมัติ)
4. แท็บ **Users** ในไฟล์ Sheets ที่สร้าง: ใส่อีเมล + role (sales / manager / gm / sr / sr_manager / admin) + แผนก · แท็บ **Departments**: ใส่ manager_email
5. (ไม่บังคับ) Run **`runAcceptanceTests`** → ต้องได้ ✅ 394/394 (ทดสอบในไฟล์ชั่วคราว ไม่แตะข้อมูลจริง)
6. Project Settings → **Script properties** (Lark — ไม่บังคับ): `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_PRICE_GROUP_CHAT_ID`, `LARK_MGMT_GROUP_CHAT_ID` → Run `testLarkConnection` แล้ว `installTriggers`
7. **Deploy → New deployment → Web app** · Execute as: **Me** · Who has access: **Anyone within บริษัท** → ได้ลิงก์ `/exec`

### อัปเดตเวอร์ชัน (มีไฟล์อยู่แล้ว)
1. วางทับ `Code.gs` และ `Index.html` ทั้งไฟล์ → Save
2. Run **`setupDatabase`** (เพิ่มคอลัมน์ / Settings ใหม่ ไม่ลบข้อมูลเดิม)
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** (ลิงก์ /exec เดิม) — กด Save อย่างเดียว เว็บจริงจะยังไม่เปลี่ยน

## 2. หน้ารวมผู้บริหาร — `deploy/portal/` (โปรเจกต์แยก 3 ไฟล์)
| ไฟล์ใน Apps Script | วางจาก |
|---|---|
| `Code.gs` | `deploy/portal/Code.gs` |
| `Portal.html` | `deploy/portal/Portal.html` (ตั้งชื่อไฟล์ว่า **Portal**) |
| `appsscript.json` | `deploy/portal/appsscript.json` |

1. New project “MGS Price Request Portal” → วาง 3 ไฟล์ → Save
2. Script properties: `FOOD_SHEET_ID` (ID ไฟล์ Sheets ของ Food) · `FOOD_WEBAPP_URL` (/exec ของ Food) · `MECH_SHEET_ID` · `MECH_WEBAPP_URL` · (ไม่บังคับ) `PORTAL_ALLOWED_EMAILS`
3. แชร์ไฟล์ Sheets ของ Food และ Mech ให้บัญชีที่ deploy แบบ **Viewer**
4. Run **`checkPortalSetup`** → แก้ตามที่แจ้ง
5. Deploy → New deployment → Web app · Execute as: **Me** · Who has access: **Anyone within บริษัท**
