#!/usr/bin/env node
/**
 * File: dev/build-prototype.js
 * Developer tool — NOT deployed. Builds ONE static HTML prototype from the real code:
 *   gas/*.html (UI)  +  gas/*.gs (server rules, run in the browser)  +  dev/gas-browser-mocks.js
 * Demo data is seeded on load and lives in memory (refresh = start over).
 *
 *   node dev/build-prototype.js <output.html>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) { console.error('usage: node dev/build-prototype.js <output.html>'); process.exit(2); }
const gasDir = path.join(__dirname, '..', 'gas');
const FILE_ORDER = ['Config', 'Util', 'Db', 'Audit', 'Auth', 'Pricing', 'Notify', 'Workflow', 'Editing',
  'Api', 'Files', 'Lark', 'Jobs', 'Code', 'Setup', 'Tests'];

const read = (f) => fs.readFileSync(path.join(gasDir, f), 'utf8');
const gs = FILE_ORDER.map((f) => `// ==== ${f}.gs ====\n` + read(f + '.gs')).join('\n');
const publicFns = Array.from(gs.matchAll(/^function ([A-Za-z][A-Za-z0-9]*)\(/gm)).map((m) => m[1]).filter((n) => !n.endsWith('_'));
const version = /APP_VERSION = '([^']+)'/.exec(read('Config.gs'))[1];
const mocks = fs.readFileSync(path.join(__dirname, 'gas-browser-mocks.js'), 'utf8');

let index = read('Index.html')
  .replace(/<\?!= include_\('(\w+)'\); \?>/g, (_, n) => read(n + '.html'))
  .replace(/<\?= appVersion \?>/g, version + ' · prototype');
const head = /<head>([\s\S]*?)<\/head>/.exec(index)[1]
  .replace(/<base[^>]*>/, '').replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '');
let body = /<body>([\s\S]*?)<\/body>/.exec(index)[1];

const backend = `
<script>
/* ===== Prototype backend: the real Apps Script code running on in-memory mocks ===== */
(function () {
${mocks}
${gs}
  const PUBLIC = { ${publicFns.map((n) => `${n}: ${n}`).join(', ')} };
  setupDatabase();
  seedDemoData();
  TEST_HTTP_ = fakeHttp_();     // uploads go to a fake Drive
  TEST_DRIVE_ = fakeDrive_();
  const users = rows_(TAB.USERS).map(function (u) { return { email: String(u.email), name: String(u.full_name), role: String(u.role), lead: toBool_(u.is_sr_lead) }; });
  const byTitle = function (part) { const t = rows_(TAB.TICKETS).filter(function (r) { return String(r.title).indexOf(part) !== -1; })[0]; return t ? String(t.ticket_id) : ''; };
  let current = demoUsers_().sr2;
  window.__proto = {
    users: users,
    tickets: { pricing: byTitle('กุ้งขาว PD'), closed: byTitle('แซลมอนฟิเล่'), needInfo: byTitle('หมึกกล้วย'), pendingManager: byTitle('ซอสเทริยากิ'), pendingGm: byTitle('ถุงสุญญากาศ') },
    get user() { return current; },
    setUser: function (email) { current = email; },
    call: function (fn, args) {
      if (fn === 'openAttachment') return { ok: false, code: 'PROTOTYPE', error: 'Prototype: ไฟล์จริงจะเปิดใน Google Drive ของบริษัท' };
      if (!PUBLIC[fn]) return { ok: false, code: 'NO_FN', error: 'ไม่พบฟังก์ชัน ' + fn };
      const a = JSON.parse(JSON.stringify(args || []));
      return JSON.parse(JSON.stringify(withIdentity_(current, function () { return PUBLIC[fn].apply(null, a); }) || null));
    }
  };
})();

/* ===== google.script.* shim ===== */
(function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (k === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        const args = Array.prototype.slice.call(arguments);
        setTimeout(function () {
          let res;
          try { res = window.__proto.call(k, args); } catch (e) { if (fail) fail(e); console.error(e); return; }
          if (ok) ok(res);
        }, 120);
      };
    } });
  }
  window.google = { script: {
    get run() { return runner(null, null); },
    history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} },
    url: { getLocation: function (cb) { cb({ parameter: window.__protoStart || {} }); } }
  } };
})();
</script>`;

const ROLE_TH = { sales: 'Sales', manager: 'Manager', gm: 'GM', sr: 'SR', admin: 'Admin' };
const bar = `
<div class="proto-bar" role="region" aria-label="ตัวควบคุม Prototype">
  <span class="proto-tag">PROTOTYPE</span>
  <span class="proto-note">ข้อมูลตัวอย่าง · รีเฟรชหน้า = เริ่มใหม่</span>
  <label class="proto-who">ดูในมุมมองของ <select id="proto-user"></select></label>
  <span class="proto-links">
    <button type="button" class="btn sm" data-jump="pricing">💰 ใบเสนอราคา (SR)</button>
    <button type="button" class="btn sm" data-jump="closed">ใบที่ส่งราคาแล้ว (Food)</button>
    <button type="button" class="btn sm" data-jump="manager">ใบรอ Manager อนุมัติ</button>
  </span>
</div>
<style>
  .proto-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 8px 16px; background: #13262E; color: #E8F1F3; font-size: .85rem; }
  .proto-tag { padding: 2px 10px; border-radius: 999px; background: #fab219; color: #13262E; font-weight: 700; letter-spacing: .06em; }
  .proto-who select { width: auto; min-height: 36px; margin-left: 6px; color: var(--text); }
  .proto-links { display: flex; flex-wrap: wrap; gap: 6px; }
  .proto-links .btn { min-height: 34px; background: #fff; }
</style>
<script>
(function () {
  const ROLE_TH = ${JSON.stringify(ROLE_TH)};
  const sel = document.getElementById('proto-user');
  sel.innerHTML = window.__proto.users.map(function (u) {
    return '<option value="' + u.email + '"' + (u.email === window.__proto.user ? ' selected' : '') + '>' + u.name + ' — ' + ROLE_TH[u.role] + (u.lead ? ' Lead' : '') + '</option>';
  }).join('');
  function switchTo(email, route) {
    window.__proto.setUser(email);
    sel.value = email;
    window.__protoStart = route || {};
    document.getElementById('nav').innerHTML = '';
    document.getElementById('who').innerHTML = '';
    document.getElementById('view').innerHTML = '<div class="loading"><span class="spinner"></span>กำลังสลับผู้ใช้...</div>';
    App.start();
  }
  sel.onchange = function () { switchTo(sel.value, {}); };
  const find = function (role, lead) { return window.__proto.users.filter(function (u) { return u.role === role && (lead === undefined || u.lead === lead); }); };
  document.querySelectorAll('[data-jump]').forEach(function (b) {
    b.onclick = function () {
      const t = window.__proto.tickets;
      const j = b.getAttribute('data-jump');
      if (j === 'pricing') switchTo(find('sr', false).filter(function (u) { return u.email.indexOf('sr2') === 0; })[0].email, { page: 'pricing', id: t.pricing });
      if (j === 'closed') switchTo(window.__proto.users.filter(function (u) { return u.email.indexOf('sales.food1') === 0; })[0].email, { page: 'ticket', id: t.closed });
      if (j === 'manager') switchTo(window.__proto.users.filter(function (u) { return u.email.indexOf('mgr.food') === 0; })[0].email, { page: 'tickets', scope: 'inbox' });
    };
  });
  window.__protoStart = { page: 'pricing', id: window.__proto.tickets.pricing };
})();
</script>`;

body = body.replace(/(<header class="topbar">)/, backend + bar + '$1');
const html = '<title>MGS Price Request</title>\n' + head.trim() + '\n' + body.trim() + '\n';
fs.writeFileSync(out, html);
console.log('Prototype written: ' + out + ' (' + Math.round(html.length / 1024) + ' KB, ' + publicFns.length + ' server functions)');
