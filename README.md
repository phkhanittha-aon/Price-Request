# MGS Enterprise Price Request & Sourcing System

ระบบใบขอราคาและจัดหาสินค้าภายใน M Global Sourcing Ltd. (MGS)
Workflow: **Sales → Manager → GM → SR (Sourcing) → Sales** พร้อม audit trail แบบแก้ไขย้อนหลังไม่ได้, การเทียบราคา vendor แบบ normalize VAT/FX และ Dashboard ภาระงาน/SLA

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind + shadcn/ui · react-hook-form + zod · Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions) · Recharts · Lark Webhook

## สถานะการพัฒนา

| Phase | เนื้อหา | สถานะ |
|---|---|---|
| 1 | Database: schema, RLS, workflow functions, storage, seed, acceptance tests | ✅ เสร็จ — [docs/phase1-database.md](docs/phase1-database.md) |
| 2 | โครงสร้างโปรเจกต์ Next.js, middleware, env, setup | ⏳ |
| 3 | หน้า SR Pricing Form `/sr/tickets/[id]/pricing` | ⏳ |

## โครงสร้างไฟล์ (Phase 1)

```
supabase/
  migrations/20261005000000_init_price_request.sql   # schema ทั้งหมด — รันครั้งเดียวใน SQL Editor
  seed.sql                                           # users ทุก role, แผนก, product groups, vendors, ใบตัวอย่าง
  tests/acceptance_test.sql                          # ทดสอบ acceptance criteria (rollback อัตโนมัติ)
docs/
  phase1-database.md                                 # assumptions, state machine, permission matrix, วิธีทดสอบ
```

## Quick start (Database)

1. สร้าง Supabase project → (แนะนำ) เปิด extension **pg_cron**
2. SQL Editor: รัน `supabase/migrations/20261005000000_init_price_request.sql`
3. SQL Editor: รัน `supabase/seed.sql`
4. SQL Editor: รัน `supabase/tests/acceptance_test.sql` → ต้องเห็น `ALL TESTS PASSED`

Seed users ทุกคนใช้รหัสผ่าน `Mgs@12345` (เฉพาะ dev/UAT — ลบก่อนขึ้น production)
