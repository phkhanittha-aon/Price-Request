# Phase 8 — Food Price Request (FPR) + Lark Custom Bots

## 1. Workflow

```
SUBMITTED ──► GM_REVIEW ──(GM อนุมัติ + เลือก Sourcing)──► ASSIGNED ──► PRICING ──► SM_REVIEW ──► GM_FINAL_REVIEW ──► APPROVED
                 │  ├─ ตีกลับให้ผู้ขอแก้ (เหตุผล) → returned → ผู้ขอส่งใหม่ → GM_REVIEW          │                │
                 │  └─ ไม่อนุมัติ (เหตุผล) → REJECTED                         ส่งกลับ / ปฏิเสธ ◄──┘   ส่งกลับ / ปฏิเสธ ◄┘
   ผู้ขอยกเลิกได้ก่อน GM อนุมัติ · Admin ยกเลิกได้ทุกขั้น (ต้องระบุเหตุผล) → CANCELLED
```

| FPR | stage ในระบบ | ใครทำ | ปุ่ม |
|---|---|---|---|
| SUBMITTED / GM_REVIEW | `pending_gm` | GM | อนุมัติฝั่งขาย (ต้องเลือก Sourcing) · ตีกลับให้ผู้ขอแก้ไข · ไม่อนุมัติ |
| ASSIGNED | `doc_check` | Sourcing ที่ GM เลือก | ตรวจเอกสาร → ยืนยันเอกสารครบ |
| PRICING | `sourcing` | Sourcing | supplier ≥ 3 ราย (ไม่ถึงต้องใส่เหตุผล) · ต้นทุนนำเข้า · GP% → ส่งราคา |
| SM_REVIEW | `pending_sr_manager` | Sourcing Manager | อนุมัติ · ส่งกลับ · ปฏิเสธ (แก้ราคาเองได้) |
| GM_FINAL_REVIEW | `pending_gm_price` | GM | อนุมัติ · ส่งกลับ · ปฏิเสธ (แก้ราคาเองได้) |
| APPROVED | `awaiting_sales_ack` | ผู้ขอ (Sales) | เห็นราคาขายเท่านั้น |

ทุกการเปลี่ยนสถานะผ่าน `transitionTicket` เท่านั้น: ตรวจ role + สถานะปัจจุบัน + `expected_version` (กันกดซ้ำ / สองคนกดพร้อมกัน) และบันทึก TicketLogs แบบ hash chain (append-only)

**สวิตช์ใน Settings** (ค่าเริ่มต้น = FPR): `sales_manager_step=false` · `gm_assigns_sr=true` · `min_suppliers=3` · `min_gp_percent=10`
· `fpr_sla` · `work_hours` (08:30–17:30 จ.–ศ.) · `reminder_repeat_work_hours=8` · `fpr_bot_events_off` (เช่น `["follow_up"]`)

## 2. ต้นทุนนำเข้า (บาทต่อหน่วย เช่น ต่อ กก.)
```
ราคาสินค้า (THB) = ราคา × อัตราแลกเปลี่ยน (USD เริ่มต้น 35 แก้ได้ + วันที่อัตรา)
อากร              = อากร% × CIF          CIF = ราคาสินค้า THB + ค่าขนส่ง + ค่าประกัน
ต้นทุนถึงคลัง      = ราคาสินค้า THB + ค่าขนส่ง + ค่าประกัน + อากร + ค่าธรรมเนียม + ค่าห้องเย็น + ค่าขนส่งในประเทศ + อื่นๆ
ราคาขาย           = ต้นทุนถึงคลัง ÷ (1 − GP%)          GP% = (ขาย − ทุน) ÷ ขาย
```
GP ต่ำกว่า 10% → แถบแดงในหน้าทำราคาและหน้าอนุมัติ · ไม่กรอกรายละเอียด = ใช้ช่อง “ค่าเคลียร์ของรวม” ตัวเดียวแบบเดิม

## 3. Lark — 2 Custom Bot ในกลุ่มเดียว
| บอท | Script Properties | ส่งเมื่อ |
|---|---|---|
| **FPR Bot** | `FPR_BOT_URL`, `FPR_BOT_SECRET` | ทุกขั้นตอน workflow |
| **FPR Reminder** | `FPR_REMINDER_URL`, `FPR_REMINDER_SECRET` | เกิน SLA เท่านั้น (trigger รายชั่วโมง) |

- การ์ด interactive สีตามเหตุการณ์ · ปุ่มเปิดเว็บ `?page=ticket&id=FPR-yymm-nnnn` · mention `<at email=…>` (ถ้าแท็บ Users มี `lark_open_id` จะใช้ open_id แทน)
- ลายเซ็น: `timestamp` + `sign = base64(HmacSHA256(key = timestamp + "\n" + secret, ""))`
- ส่งหลังบันทึกข้อมูลสำเร็จเท่านั้น · ลอง 3 ครั้ง (1 วิ, 2 วิ) · ผลทุกครั้งเก็บในแท็บ **NotifLog** · ส่งไม่ได้ ≠ การอนุมัติล้มเหลว
- การ์ดในกลุ่ม **ไม่มีต้นทุน / GP / supplier** — ขั้นมีราคาแล้วแสดงแค่ “💰 มีราคาแล้ว — ดูราคาบนเว็บ”; เหตุผลฝั่งราคาซื้อ (SM / GM ส่งกลับ-ปฏิเสธ) ไม่แสดงในกลุ่ม
- SLA: GM_REVIEW 4 ชม. · PRICING 2 วันทำงาน · SM_REVIEW 4 ชม. · GM_FINAL 4 ชม. (นับเฉพาะเวลาทำงาน ข้ามเสาร์-อาทิตย์และวันในแท็บ **Holidays**) · เตือนซ้ำไม่เกิน 1 ครั้ง / 8 ชม.ทำงาน / ใบ

## 4. คู่มือติดตั้ง (สั้น)
1. **สร้างบอทใน Lark** (ทำ 2 ครั้ง: “FPR Bot” และ “FPR Reminder”)
   กลุ่ม Lark → ⚙️ Settings → **Bots → Add Bot → Custom Bot** → ตั้งชื่อ → **Security settings: ✅ Set signature verification** → คัดลอก **Webhook URL** และ **Secret** → Save
2. **Apps Script** → วาง `deploy/food/Code.gs`, `Index.html`, `appsscript.json` → Save
3. **ใส่ Webhook URL + Secret** (เลือกวิธีใดวิธีหนึ่ง — ทั้งสองวิธีเก็บใน Script Properties ไม่อยู่ในโค้ดหรือ Sheet)
   - **วิธีง่าย (หน้าเว็บ):** Deploy เว็บก่อน (ข้อ 8) → เข้าเว็บด้วยบัญชี Admin → เมนู **⚙️ ตั้งค่า Lark Bot** → วาง URL + Secret ของแต่ละบอท → **บันทึก** → **ส่งการ์ดทดสอบ** (ถ้าไม่ผ่าน หน้าจอจะบอกสาเหตุ เช่น Secret ไม่ตรง)
   - **วิธีใน Apps Script:** ⚙️ Project Settings → เลื่อนลงล่างสุด **Script properties** → **Add script property** 4 รายการ: `FPR_BOT_URL`, `FPR_BOT_SECRET`, `FPR_REMINDER_URL`, `FPR_REMINDER_SECRET` → **Save script properties**
4. Run **`setup`** → อนุญาตสิทธิ์ → ดู log ว่าทั้ง 4 ค่า ✓ (สร้าง/อัปเกรดฐานข้อมูล + โฟลเดอร์ Drive “FPR Attachments”)
5. แท็บ **Users**: อีเมล @mglobalsourcing.net + role (`sales`=Requester, `gm`, `sr`=Sourcing, `sr_manager`=Sourcing Manager, `admin`) · แท็บ **Holidays**: วันหยุดบริษัท (date, name)
6. Run **`testBots`** → ในกลุ่มต้องเห็นการ์ดทดสอบทุกแบบ + การ์ดเตือน 1 ใบ และชื่อคุณเป็นสีฟ้า (mention ทำงาน)
7. Run **`installTriggers`** (รวม `sendSlaReminders` ทุกชั่วโมง) — หรือ `installReminderTrigger` ถ้าต้องการเฉพาะตัวเตือน
8. **Deploy → New deployment → Web app** · Execute as **Me** · Who has access **Anyone within mglobalsourcing.net** → ตั้ง Script property `WEBAPP_URL` = ลิงก์ /exec (ปุ่มในการ์ดใช้ลิงก์นี้)
9. (แนะนำ) Run **`runAcceptanceTests`** → ✅ ผ่านทั้งหมด (ใช้ชีตชั่วคราว ไม่แตะข้อมูลจริง)

## 4.1 Admin ทำแทนได้ทุกขั้นตอน
- ปุ่มของทุกคนที่รับผิดชอบขั้นนั้นจะแสดงให้ Admin (Sales, Sales Manager, GM, SR, SR Manager) — ระบบทำรายการ **ในนามผู้รับผิดชอบ** กฎทุกข้อยังบังคับ (เช่น GM ต้องเลือก Sourcing, Supplier ≥ 3 ราย, ปฏิเสธต้องมีเหตุผล) และ Timeline บันทึกว่า “Admin (แทน …)”
- **สร้างใบขอราคาแทน Sales:** เมนู ➕ สร้างใบขอราคา → เลือก “Sales ผู้ขอราคา” (ใบเป็นของ Sales คนนั้น)
- แก้ใบขอราคาได้จนก่อน GM อนุมัติ · ติ๊กเอกสาร / กรอกราคา supplier / แนบรูป / ไม่เสนอ-ส่งตามหลัง ได้แทน SR · แก้ราคาในขั้น SM / GM ได้ · ลบไฟล์แนบได้ทุกไฟล์ · อัปเดตผลการขายแทน Sales
- **ลบใบขอราคา:** ปุ่ม 🗑 ลบใบขอราคา (ต้องใส่เหตุผล) → ใบหายจากทุกคน รายงาน และหน้ารวมผู้บริหาร แต่ข้อมูลยังเก็บไว้ครบ (audit) · กู้คืนได้ที่หน้าใบเสนอราคา → แท็บ **🗑 ถูกลบ** → เปิดใบ → ♻️ กู้คืน (กลับไปขั้นเดิม)

## 5. Test checklist (UAT)
| # | กรณี | วิธีทดสอบ | ผลที่ต้องได้ |
|---|---|---|---|
| 1 | Happy path | Sales สร้างใบ 2 รายการ → GM อนุมัติ + เลือก SR → SR ตรวจเอกสาร → ใส่ 3 supplier + ต้นทุนนำเข้า + GP 15% → ส่ง → SM อนุมัติ → GM อนุมัติ | เลข FPR-yymm-nnnn · การ์ด 📥 → 🔧 → 🔎 → 🧾 → ✅ ตามลำดับ, mention ถูกคน · Sales เห็นเฉพาะราคาขาย |
| 2 | GM ตีกลับ | GM กด “ตีกลับให้ผู้ขอแก้ไข” (ต้องใส่เหตุผล) → Sales แก้แล้วส่งใหม่ | การ์ด ↩ @ผู้ขอ พร้อมเหตุผล · กลับมา GM_REVIEW + การ์ดใหม่ |
| 3 | SM ส่งกลับ | SM “ส่งกลับให้ SR แก้ราคา” | กลับ PRICING · การ์ด @SR ไม่มีเหตุผลราคาในกลุ่ม · SR เห็นเหตุผลบนเว็บ |
| 4 | GM final ส่งกลับ | GM “ส่งกลับให้ SR แก้ราคา” | กลับ PRICING · การ์ด @SR |
| 5 | Reject ทุกขั้น | GM_REVIEW / SM / GM final กดปฏิเสธโดยไม่ใส่เหตุผล แล้วใส่ | ไม่ใส่ = กดไม่ได้ · ใส่ = REJECTED + การ์ด ⛔ |
| 6 | ยกเลิก | Sales ยกเลิกก่อน GM อนุมัติ / หลังอนุมัติ · Admin ยกเลิกระหว่าง PRICING | ก่อน = ได้ · หลัง = ปุ่มไม่มี/ถูกปฏิเสธ · Admin ได้ (ต้องมีเหตุผล) |
| 7 | Supplier ไม่ถึง 3 | ใส่ 2 ราย แล้วกดส่ง | ระบบแจ้งให้ใส่เหตุผล · ใส่แล้วส่งได้ · SM/GM เห็นเหตุผล |
| 8 | GP ต่ำ | ใส่ GP 8% | แถบแดง “ต่ำกว่าขั้นต่ำ 10%” ในหน้าทำราคาและหน้าอนุมัติ |
| 9 | กดซ้ำ (double click) | เปิดใบเดียวกัน 2 แท็บ กดอนุมัติทั้งสอง | แท็บที่สองได้ “ใบขอราคานี้ถูกอัปเดตโดยผู้ใช้อื่นแล้ว” · การ์ดออกใบเดียว |
| 10 | ผู้ไม่มีสิทธิ์ | Sales คนอื่น / SR ที่ไม่ได้รับงาน / บัญชีนอก Users เปิดลิงก์ในการ์ด | ไม่พบใบ / ไม่ได้ลงทะเบียน · ปุ่มอนุมัติไม่แสดง |
| 11 | Webhook ล่ม | เปลี่ยน `FPR_BOT_URL` เป็นลิงก์ผิด แล้วอนุมัติ 1 ใบ | การอนุมัติสำเร็จ · NotifLog = failed, attempts 3 · คืนค่า URL แล้วใช้งานต่อได้ |
| 12 | Mention ไม่ขึ้น | ชื่อในการ์ดเป็นข้อความธรรมดาไม่ใช่สีฟ้า | ตรวจอีเมลใน Users ตรงกับอีเมลบัญชี Lark · ถ้ายังไม่ขึ้น ใส่ `lark_open_id` (ou_…) ในแท็บ Users → การ์ดถัดไปจะ mention ด้วย open_id |
| 13 | SLA Reminder | ตั้ง `fpr_sla` GM_REVIEW = `{"hours":0.1}` ชั่วคราว แล้ว Run `sendSlaReminders` 2 ครั้ง | ครั้งแรก การ์ด ⏰ สีเหลืองจาก FPR Reminder @GM · ครั้งที่สองไม่ส่งซ้ำ (8 ชม.ทำงาน) · คืนค่า SLA |
| 14 | วันหยุด | ใส่วันพรุ่งนี้ในแท็บ Holidays | เวลาครบกำหนด (SLA) ในหน้าใบเลื่อนข้ามวันนั้น |
| 15 | Admin ทำแทน | Admin สร้างใบแทน Sales → อนุมัติแทน GM (เลือก SR) → กรอกราคาแทน SR → อนุมัติแทน SM / GM | ทำได้ทุกขั้น · Timeline ขึ้น “(แทน …)” · การ์ด Lark ออกตามปกติ |
| 16 | ลบ / กู้คืน | Admin ลบใบ (ไม่ใส่เหตุผล แล้วใส่) → Sales / GM เปิดลิงก์ → Admin กู้คืน | ไม่ใส่เหตุผล = ลบไม่ได้ · ลบแล้วคนอื่นไม่เห็น · กู้คืนกลับขั้นเดิม |
| 17 | หน้าตั้งค่าบอท | Admin เมนู ⚙️ ตั้งค่า Lark Bot → ใส่ URL ผิด / ถูก → ส่งการ์ดทดสอบ · GM เปิด `?page=admin` | URL ผิดถูกปฏิเสธ · Secret แสดงเป็น ✓ เท่านั้น · GM เข้าไม่ได้ |
