# MGS Food Price Request — System Audit (v2026.10.11-1)

**Mode:** audit only — no production code changed. Every test runs on a FRESH demo database (in-memory mocks or the browser prototype); no real Sheet / Drive / Lark was touched.
**Harness (never deployed — lives in `outputs/audit/`, outside `gas/`):**

| Script | What it proves | Run |
|---|---|---|
| `perm_test.js` | every public server function × every role, called like `google.script.run` (server-side decision) | `node outputs/audit/perm_test.js` |
| `leak_test.js` | Sales / Sales Manager payloads of every read API, every stage → no cost key, vendor name, supplier photo | `node outputs/audit/leak_test.js` |
| `flow_test.js` | full loop SUBMITTED → closed with 3 product groups + who owns each status + absence cases | `node outputs/audit/flow_test.js` |
| `owner_test.js` | inbox badge vs notification vs buttons; two SLA engines | `node outputs/audit/owner_test.js` |
| `edge_test.js` | stale page, double click, number parsing, FX, formula text, row re-order, old data, missing config | `node outputs/audit/edge_test.js` |
| `io_test.js` | sheet reads per call, payload size, Date-in-payload, cells per request on ~1 year of data (300 requests) | `node outputs/audit/io_test.js 300` |
| `xss_e2e.js` | script payloads in every free-text field, every page × every role in the browser | `node dev/build-prototype.js /tmp/p.html --standalone && node outputs/audit/xss_e2e.js /tmp/p.html` |

> Items in the brief that do not exist in this Food app: `CATALOG`, `EXCEL_LEGACY_LINES`, `syncQueue`, `isReleaser_()` (those belong to the Mech / Sales apps). The logo is a 4.5 KB WebP data-URI in `Index.html` (not touched). `localStorage` holds a single key `mgs.side.mini` (sidebar collapsed). "SR" in this app = the Sourcing **role**, not a document.

---

## 1. Pass / fail against the 7 objectives

| # | Objective | Result | Evidence |
|---|---|---|---|
| 1 | Whole loop flows, nothing dead-ends | **Partial** | `flow_test`: one request with 3 product groups ran SUBMITTED → GM return → resubmit → split to 2 SRs + Others → need_info → PRICING (partial submit) → SM → GM → APPROVED → closed. 542 acceptance tests cover every return/reject/cancel. **Dead-ends:** sole GM / SR Manager deactivated → nobody (not even Admin) can act — `NO_PROXY` (H1); SR Manager's "split Others" job is not in their inbox (H3). |
| 2 | No duplicated work / silent overwrites | **Partial** | Double submit (same `client_key`) → 1 record; double click on approve → `VERSION_CONFLICT`. **But:** stale page silently deletes another person's supplier quote (H4); SR who already sent stays in "รอฉัน" (M1); pending_assign shows in every SR's badge while only the SR Manager is notified (H3); same event via bell + DM + group mention (M5). |
| 3 | Efficient (clicks / screens) | **Partial** | GM approve = 2 clicks (no SR to pick any more). Whole loop ≈ 87 interactions for 3 items, ~70% of it supplier data entry (inherent). Avoidable: ~5–6 checklist ticks per request (M10); Sales must cancel & re-create to fix a typo after submit (M2). |
| 4 | Work can be handed over when someone is away | **Fail** | Only SR level has a real hand-over (SR Manager splits / transfers items, SR transfers own items). GM, SR Manager and Sales have no delegate: only Admin can act for them, and if the account is set inactive even Admin is blocked (H1, H2). |
| 5 | Everyone updates + sees an own-view dashboard | **Partial** | Every role lands on a home with "รอฉัน / กำลังดำเนินการ / เกินกำหนด" scoped to them (screenshots in walk-through). **But:** list/badge "เกินกำหนด" and the request page disagree (two SLA engines, H6); SR Manager badge misses split work (H3); Admin home shows an obsolete Lark warning and no stuck-job view (M6). No dead (empty) screens and no JS errors in the browser walk (57 page × role views). |
| 6 | Durable back end, full history | **Pass (with gaps)** | Every transition → TicketLogs row (time, actor, action, from→to stage/status, comment, metadata incl. "on behalf of", item moves); field edits log diffs; hash chain + `verifyLogChain`. Lookups by stable key: still correct after reversing Sheet rows + inserting a blank row (`edge_test`). Pre-v2026.10.11 single-SR tickets still price + submit. Formula text is neutralised (`'=…`). **Gaps:** hand edits of Users / ProductGroups / Settings tabs leave no audit row; quote overwrite in H4 is a soft delete (recoverable but silent). |
| 7 | Storage / app size not bloated | **Partial** | Sheets: ~556 cells per request (3 items, full cycle) → 10 M-cell limit in ~15 years at 100 requests/month. HTML 387 KB (95 KB gzip) — fine on mobile. **Risks:** supplier photos in Drive (biggest), whole-tab reads getting slower before the cell limit (M8/M9), logs/notifications never purged, 1-year list payloads 290–405 KB (M7). |

---

## 2. Findings (most severe first)

No **Critical** finding was confirmed: no server-side permission hole, no cost field in any Sales payload (70/70 checks), no hard data loss, no XSS — script payloads typed into 25 free-text fields (request, item, remark, comments, supplier, quotation, deal note) never executed on any of 57 page × role views, 0 JS errors (`xss_e2e_result.md`).

### High

| ID | What | Where | Role | Reproduce | Why it matters | Suggested fix |
|---|---|---|---|---|---|---|
| H1 | If the only GM (or only SR Manager) is set **inactive**, nobody can move the request — Admin gets `NO_PROXY` | `Auth.gs proxyUserFor_` (`firstActive_('gm')` returns null) → `Workflow.gs doTransition_` | GM, SR Mgr, Admin | `flow_test.js` § Absence: deactivate GM → Admin `gm_approve` → `NO_PROXY` | Whole pipeline stops at GM_REVIEW / SM_REVIEW / GM_FINAL until the account is re-enabled | When no active holder exists, let Admin act as itself (logged "Admin — no active GM") or route to a named backup approver (see Q1) |
| H2 | No delegation for GM, SR Manager or Sales; only Admin can act for them | `allowedActions_`, `doTransition_` role checks; no delegate field in Users | GM, SR Mgr, Sales | Sales1 away at need_info / awaiting_sales_ack: other Sales `NOT_FOUND`, Sales Manager has no button (`flow_test`) | Leave = request waits; Admin becomes a bottleneck and acts without the business owner's judgement | Users tab: `delegate_email` + `away_until`; inbox + buttons + notifications follow the delegate; Sales Manager may act for own-department Sales |
| H3 | SR Manager's "แบ่งงาน Others" job is not in their "รอฉัน"/badge; at pending_assign **every SR** gets the badge + a "รับงาน" button although only the SR Manager is notified | `Api.gs isAssignee_` (pending_assign → any SR; doc_check/sourcing → SRs only); `Notify.gs stageAssignees_` | SR Mgr, SR | `owner_test.js`: Others-only request → SRMgr badge +0, SR1 +1; mixed request → SRMgr badge +0 | Split work is forgotten (badge says nothing) or an SR claims everything | `isAssignee_`: SR Manager when the request has unassigned items (by-group mode); hide "claim" for SRs in by-group mode |
| H4 | A stale page **silently deletes** another person's supplier quote | `Editing.gs saveSourcingDraft` (quotes missing from the payload are deleted; no version check) | SR + Admin, two tabs, several SR Managers | `edge_test.js` #1: Admin adds supplier D, SR saves old page → D gone | Lost prices; reviewer approves on incomplete comparison | Client sends the quote ids it loaded + item version; delete only ids the client knew; refuse with VERSION_CONFLICT otherwise |
| H5 | Price sanity: a **0** unit price passes all the way to Sales; FX "35,5" is read as **355** by the server | `Editing.gs validateQuoteFields_` / `toNumber_` (comma = thousands); `validateQuotesForSubmit_` | SR, Sales (wrong price) | `edge_test.js` #3/#4: price "0" stored; USD 3 @ "35,5" → net 1,065 THB | Wrong selling price can reach the customer. (The UI number input blocks commas, so the FX case is API-level defence.) | Winner price > 0 at submit; FX must be within ±X % of `fx_defaults` (or confirm); reject comma in FX |
| H6 | Two SLA engines disagree: list / home / SLA DM use calendar `sla_hours`, request page + FPR Reminder use working-time `fpr_sla` | `Api.gs slaInfo_` + `Jobs.gs checkSlaAlerts` vs `Bots.gs slaDue_` | all | `owner_test.js`: 30 calendar h in GM_REVIEW → list "breach", request page "not overdue" | Users stop trusting the dashboard; two different reminders for the same job | One engine (working time, Holidays): feed `slaInfo_` from `slaDue_`; retire or align `checkSlaAlerts` |

### Medium

| ID | What | Where | Role | Reproduce | Fix |
|---|---|---|---|---|---|
| M1 | SR who already sent their items stays in "รอฉัน"; in doc_check every SR on the request owns the same checklist + "ยืนยันเอกสารครบ" | `Api.gs isAssignee_` (`isSr_`) | SR | `flow_test` row "PRICING — SR1 ส่งแล้ว": inbox SR1, SR2 | sourcing → only SRs with unsent items; doc_check → one owner (first SR) |
| M2 | Sales cannot edit the request after submitting (pending_gm) — only Admin can; Sales must cancel & re-create | `Auth.gs canEditRequest_` | Sales | `perm_test` "Edit request header (pending_gm, own)" → FORBIDDEN | Allow owner edit while `pending_gm` (version-checked, logged) |
| M3 | Form draft lives only in memory: refresh / session expiry on mobile loses it; after refresh a new `client_key` → a lost-response retry can create a duplicate | `PageForm.html` `state.drafts` | Sales (mobile) | manual: fill form → pull-to-refresh → form empty | Persist draft + client_key per user in `localStorage` (cleared on success) |
| M4 | Supplier-shortfall reason (purchasing text, e.g. "มีผู้เสนอราคาเพียง 2 ราย") is sent to Sales | `Workflow.gs ticketDetail_` Sales branch | Sales | `leak_test`: NOTE supplier_shortfall_reason present | Delete it for non-cost roles (like `gp_percent`) |
| M5 | Same event reaches a person 2–3 times (bell + Lark DM + @mention in group card); old `larkGroupText_` SLA text adds a 4th channel | `Workflow.gs` notifications + `Bots.gs` + `Jobs.gs` | all | `owner_test` | Group card (mention) + bell; DM only for escalation |
| M6 | Admin home: obsolete "ยังไม่ได้ตั้งค่า Lark (LARK_APP_ID)" warning, no bot health, no stuck-job list | `PageHome.html`, `Api.gs getAdminHealth` | Admin | home screenshot | Show FPR bot failures (NotifLog 24 h), jobs with inactive owner, unassigned items |
| M7 | 1-year payloads: listDeals 383 KB, GP summary 405 KB, board 292 KB (Admin) — grows linearly | `Deals.gs`, `Api.gs listTicketBoard` | Sales Mgr (mobile), GM, Admin | `io_test.js 300` | Default period (6 months) + paging; send only needed columns |
| M8 | saveSourcingDraft = 62 whole-tab reads for 3 items × 5 suppliers (each write drops the cache) | `Db.gs updateRow_` (`meta.rows = null`), `Editing.gs` | SR | `io_test` | Update the cached row in place; batch writes per tab |
| M9 | getPoll reads ~15 tabs every 60 s per open page per user | `Api.gs pollData_` | all | `io_test` | Cache counters per user keyed by `DATA_VERSION`; recompute only on change |
| M10 | ~5–6 checklist ticks on every request before prices; checklist not linked to the Sales "เอกสารที่ต้องการ" chips | `Workflow.gs generateChecklist_` | SR | 4 root + 1 per group required items | Pre-tick what the form already provides; "ครบทั้งหมด" button |
| M11 | `setupDatabase` silently creates a NEW empty database if the DB property is missing | `Setup.gs setupDatabase` | Admin / owner | delete `DB_SPREADSHEET_ID` → run setup → empty app | Refuse unless a `force` flag; show current DB URL on the Admin page |
| M12 | UsageLog writes one row per page per poll (not per day) | `Api.gs logUsage_` | all | ~9 users × 30 rows/day | Aggregate per user/page/day |
| M13 | Supplier photos are the main storage cost (≤1600 px JPEG q 0.85, up to 10 per supplier × 5 suppliers per item) | `App.html shrink()`, `Files.gs` | SR | see §5 | 1280 px / q 0.75; delete non-winning supplier photos 6 months after close |
| M14 | SR Manager sees both "มอบหมายทั้งใบให้ SR คนเดียว" and the per-item panel → one click undoes the group split | `PageTicket.html` ACTION_UI `assign` | SR Mgr | doc_check request | Hide whole-request assign in by-group mode (or confirm with the item list) |

### Low

| ID | What | Where | Fix |
|---|---|---|---|
| L1 | `buildMention` is a public server function with no login check → returns any user's Lark open_id to anyone in the domain (even unregistered) | `Bots.gs` | Rename `buildMention_` |
| L2 | Tests.gs (~2,200 lines) ships inside production Code.gs | `dev/build-deploy.js` | Separate test bundle |
| L3 | 4 Google-Font families on a mobile page | `Index.html` | Keep Sarabun + Inter |
| L4 | Reviewer (SR Mgr / GM) can edit a price and approve it in the same step — logged, but no second pair of eyes on that edit | `canEditQuotes_` | Policy (Q6) |
| L5 | Admin action bar lists every role's buttons (cancel vs admin_cancel side by side) | `PageTicket.html actionBar` | Group under "ทำแทน ▾" |

---

## 3. Permission matrix (server-side, from `perm_test.js`)

R = read allowed · W = write allowed · – = refused by the server. ⚠ = differs from expected.

| Action | Expected | Sales | Sales Mgr | GM | SR | SR Mgr | Admin |
|---|---|---|---|---|---|---|---|
| Bootstrap / menu | all | R | R | R | R | R | R |
| Ticket board (scoped) | all | R | R | R | R | R | R |
| Open own pending request | Sales, Mgr, GM, Admin | R | R | R | – | – | R |
| Open another Sales' request | not Sales | – | R | R | R | R | R |
| Create request | Sales, Admin (for Sales) | W | – | – | – | – | W |
| Edit request after submit (pending_gm) | Sales, Admin | – ⚠ (M2) | – | – | – | – | W |
| GM approve | GM, Admin | – | – | W | – | – | W |
| Cancel own request before GM | Sales, Admin | W | – | – | – | – | W |
| Save prices on another SR's item | Admin | – | – | – | – | – | W |
| SR Manager approve | SR Mgr, Admin | – | – | – | – | W | W |
| GM final approve | GM, Admin | – | – | W | – | – | W |
| Accept price — own request | Sales, Admin | W | – | – | – | – | W |
| Accept price — another Sales' request | Admin | – | – | – | – | – | W |
| Delete / restore request | Admin | – | – | – | – | – | W |
| Supplier list / last-price hints | GM, SR, SR Mgr, Admin | – | – | R | R | R | R |
| Supplier save | SR, SR Mgr, Admin | – | – | – | W | W | W |
| GP summary | GM, SR Mgr, Admin | – | – | R | – | R | R |
| Deal follow-up (scoped, no cost for Sales side) | all | R | R | R | R | R | R |
| Reports (scoped) | all | R | R | R | R | R | R |
| Admin health / bot settings / audit chain | Admin | – | – | – | – | – | R/W |
| setupDatabase / seedDemoData / installTriggers | script owner only | – | – | – | – | – | – |
| Jobs from browser (SLA reminder, self-test, testBots) | Admin | – | – | – | – | – | W |
| `buildMention` | nobody (helper) | R ⚠ | R ⚠ | R ⚠ | R ⚠ | R ⚠ | R ⚠ (L1; also unregistered users) |
| Unregistered domain user → any data API | nobody | – | – | – | – | – | – |

All decisions are made on the server (`doTransition_`, `can*_`, `ticketForUser_`); the browser only hides buttons. Supplier photos and quotation files: Sales `getPhotoPreviews` → nothing, `openAttachment` → NOT_FOUND (`leak_test`).

---

## 4. Who owns the job in each status (`flow_test.js`, by-group mode)

| Status | stage | In "รอฉัน" of | Notified | Has buttons | Issue |
|---|---|---|---|---|---|
| SUBMITTED → GM_REVIEW | pending_gm | GM | GM | GM; Sales (cancel); Admin | — |
| Returned to requester | returned | Sales | Sales | Sales; Admin | Sales away → Admin only (H2) |
| Waiting for SR Manager split (Others only) | pending_assign | **every SR** | SR Manager | SRs (claim), SR Mgr (panel) | H3 — notified ≠ inbox; SR can grab all |
| ASSIGNED (2 SRs + Others unassigned) | doc_check | SR1, SR2 | SR1, SR2, SR Mgr | SR1, SR2 (both can confirm docs), SR Mgr (panel) | H3 SR Mgr not in inbox; M1 shared doc check |
| Need info from Sales | need_info | Sales | Sales | Sales; SR/SR Mgr (transfer) | — |
| PRICING (nobody sent) | sourcing | SR1, SR2 | SR1, SR2 | each SR on own items | — |
| PRICING (SR1 sent, SR2 not) | sourcing | **SR1**, SR2 | SR1, SR2 | SR2 | M1 — SR1 has nothing to do |
| SM_REVIEW | pending_sr_manager | SR Mgr | SR Mgr | SR Mgr; Admin | SR Mgr away → Admin only; inactive → stuck (H1) |
| GM_FINAL_REVIEW | pending_gm_price | GM | GM | GM; Admin | same (H1) |
| APPROVED | awaiting_sales_ack | Sales | Sales | Sales; Admin | Sales away → Admin only (H2) |
| Closed / rejected / cancelled | — | — | — | Admin (delete) | — |

---

## 5. Data growth & app size

**Measured** (`io_test.js 300` — 300 requests × 3 items, 100 taken to closed):

| Tab | cells / request | note |
|---|---|---|
| TicketLogs | ~170 | append-only, hash chain — largest |
| TicketItems | ~104 | |
| Quotations | ~104 | 3 suppliers × 34 cols per item |
| Notifications | ~70 | bell + DM status |
| Tickets | ~42 | |
| Checklist | ~36 | |
| NotifLog | ~28 | group cards |
| **Total** | **~556** | + UsageLog (M12) |

**Projection at 100 requests / month** (your volume may differ — Q3):

| Resource | per year | Limit | Hits limit |
|---|---|---|---|
| Sheet cells | ~0.7 M | 10 M per spreadsheet | ~14–15 years |
| Speed (whole-tab reads per call: getTicket 18, saveSourcingDraft 62) | TicketLogs +12 k rows/yr | practical ~30–50 k rows before calls take several seconds | **~3–4 years** (the real limit) |
| Drive — supplier photos (est. 2 suppliers × 3 photos × 3 items × ~0.4 MB ≈ 7 MB/request) | ~8 GB | owner's Drive quota (e.g. 30 GB Business Starter) | **~3 years** |
| Drive — weekly DB backups | 12 copies × DB size (a few MB) | — | negligible |
| Web page | 387 KB (95 KB gzip), logo 4.5 KB | — | fine on mobile |
| `localStorage` | 1 key, a few bytes | — | no growth (no sync queue) |

**No duplicated storage found:** no base64 in the Sheet, photo previews are generated on request (not stored), one record per entity (quotes reference the item, logs reference the ticket).

**Retention proposal (keeps everything needed for audit):**

| Data | Keep | Then |
|---|---|---|
| Tickets, TicketItems, Quotations (incl. deleted rows), Vendors, SupplierLogs, Users | forever | — |
| TicketLogs | forever | after 18 months closed → move to a yearly archive spreadsheet; keep the last hash as an anchor so `verifyLogChain` still proves nothing changed |
| Notifications | 6 months after read | delete |
| NotifLog (group cards) | 6 months | delete (failures summarised monthly) |
| SlaAlerts | 3 months after the request closed | delete |
| UsageLog | aggregate monthly | delete raw rows > 3 months |
| ErrorLog | 6 months | delete |
| Supplier photos of **non-winning** suppliers | 6 months after close | delete (winner + request photos kept) |
| Weekly DB backups | 12 weekly | + 12 monthly (optional) |

---

## 6. Fix order (what can ship together)

| Round | Findings | Why together |
|---|---|---|
| **1 — nothing stalls, no wrong price** | H1, H2 (delegate + Admin fallback), H3 + M1 (one owner per status in `isAssignee_`), H5 (price sanity), M4, L1 | all in `Auth.gs` / `Api.gs isAssignee_` / validation; small, high value |
| **2 — trust in data & dashboards** | H4 (draft concurrency), H6 (one SLA engine), M5 (notification channels), M6 (Admin home), M14 | touch Editing / SLA / Notify / home pages |
| **3 — speed & storage** | M8, M9, M7, M12, M13 + retention job (§5), M11 | Db.gs caching + a monthly clean-up trigger |
| **4 — UX polish** | M2, M3, M10, L5, L2, L3, L4 | form / checklist / admin bar |

---

## Manual walk-through (things code cannot prove)

1. **Session expiry:** open the app, sign out of Google in another tab, click "บันทึกร่าง" → expected toast "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ…" and the page keeps the data (no blank screen). Then sign in again and retry.
2. **Mobile Sales:** on a phone (Chrome/Safari) create a request with 2 items + 3 photos; check no sideways scroll, photo upload progress, and the success toast with the FPR number.
3. **Lark mentions:** after setting the 2 webhooks, run "ส่งการ์ดทดสอบ" in ⚙️ ตั้งค่า Lark Bot; the names in "ผู้ขอ" / "ผู้ดำเนินการ" must be blue.
4. **Sheet hand edits:** reorder rows of the Tickets tab with a filter-sort, then approve a request → the right row changes (proved in `edge_test`, worth a one-time check on the real Sheet copy).
