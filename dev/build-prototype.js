#!/usr/bin/env node
/**
 * File: dev/build-prototype.js
 * Developer tool — NOT deployed. Builds ONE static HTML prototype from the real code:
 *   gas/*.html (UI)  +  gas/*.gs (server rules, run in the browser)  +  dev/gas-browser-mocks.js
 * Demo data is seeded on load and lives in memory (refresh = start over).
 *
 *   node dev/build-prototype.js <output.html>               # body-only (for an artifact host)
 *   node dev/build-prototype.js <output.html> --standalone  # full HTML file, open directly in a browser
 */
'use strict';

const fs = require('fs');
const path = require('path');

const out = process.argv[2];
if (!out) { console.error('usage: node dev/build-prototype.js <output.html>'); process.exit(2); }
const gasDir = path.join(__dirname, '..', 'gas');
const FILE_ORDER = ['Config', 'Util', 'Db', 'Audit', 'Auth', 'Pricing', 'Notify', 'Workflow', 'Editing', 'Suppliers',
  'Api', 'Files', 'Lark', 'Jobs', 'Code', 'Setup', 'Tests'];

const read = (f) => fs.readFileSync(path.join(gasDir, f), 'utf8');
// Tests.gs: only the fake Drive / HTTP helpers are needed (uploads in the prototype); the test cases are left out.
const testsSrc = read('Tests.gs');
const fakes = testsSrc.slice(testsSrc.indexOf('function fakeHttp_()'), testsSrc.indexOf('function runPhase2Cases_('));
const gs = FILE_ORDER.filter((f) => f !== 'Tests').map((f) => `// ==== ${f}.gs ====\n` + read(f + '.gs')).join('\n') +
  '\n// ==== Tests.gs (fakes only) ====\n' + fakes;
const publicFns = Array.from(gs.matchAll(/^function ([A-Za-z][A-Za-z0-9]*)\(/gm)).map((m) => m[1]).filter((n) => !n.endsWith('_'));
const version = /APP_VERSION = '([^']+)'/.exec(read('Config.gs'))[1];
const mocks = fs.readFileSync(path.join(__dirname, 'gas-browser-mocks.js'), 'utf8');

let index = read('Index.html')
  .replace(/<\?!= include_\('(\w+)'\); \?>/g, (_, n) => read(n + '.html'))
  .replace(/<\?= appVersion \?>/g, version + ' · prototype');
// Prompt is embedded (base64) so the prototype looks the same offline / behind a proxy. The web app uses Google Fonts.
const fontDir = path.join(__dirname, 'fonts');
const fontCss = fs.readFileSync(path.join(fontDir, 'manifest.txt'), 'utf8').trim().split('\n').map(function (line) {
  const [file, weight, range] = line.split('|');
  const b64 = fs.readFileSync(path.join(__dirname, '..', file)).toString('base64');
  return "@font-face{font-family:'Prompt';font-style:normal;font-weight:" + weight + ";font-display:swap;src:url(data:font/woff2;base64," + b64 + ") format('woff2');unicode-range:" + range + ';}';
}).join('\n');
const head = '<style>' + fontCss + '</style>\n' + /<head>([\s\S]*?)<\/head>/.exec(index)[1]
  .replace(/<base[^>]*>/, '').replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '')
  .replace(/<link rel="(preconnect|stylesheet)"[^>]*>\s*/g, '');
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
  const users = rows_(TAB.USERS).map(function (u) { return { email: String(u.email), name: String(u.full_name), role: String(u.role) }; });
  const byTitle = function (part) { const t = rows_(TAB.TICKETS).filter(function (r) { return String(r.title).indexOf(part) !== -1; })[0]; return t ? String(t.ticket_id) : ''; };
  const U = demoUsers_();
  let current = U.salesFood1;
  window.__proto = {
    users: users,
    tickets: { pricing: byTitle('ริเวอร์ไซด์'), srm: byTitle('ทะเลทอง'), closed: byTitle('ซูชิ ดีไลท์') },
    who: { sales: U.salesFood1, gm: U.gm, sr: U.sr2, srm: U.srManager },
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

const ROLE_TH = { sales: 'Sales', manager: 'Sales Manager', gm: 'GM', sr: 'SR', sr_manager: 'SR Manager', admin: 'Admin' };
const bar = `
<div class="proto-bar" role="region" aria-label="ตัวควบคุม Prototype">
  <span class="proto-tag">PROTOTYPE</span>
  <span class="proto-note">ข้อมูลตัวอย่าง · รีเฟรชหน้า = เริ่มใหม่</span>
  <label class="proto-who">ดูในมุมมองของ <select id="proto-user"></select></label>
  <span class="proto-links">
    <button type="button" class="btn sm" data-jump="form">📝 ฟอร์มขอราคา (Sales)</button>
    <button type="button" class="btn sm" data-jump="dash">📊 Dashboard (GM)</button>
    <button type="button" class="btn sm" data-jump="pricing">💰 ใบเสนอราคา (SR)</button>
    <button type="button" class="btn sm" data-jump="srm">✅ SR Manager ตรวจราคา</button>
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
    return '<option value="' + u.email + '"' + (u.email === window.__proto.user ? ' selected' : '') + '>' + u.name + ' — ' + ROLE_TH[u.role] + '</option>';
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
  document.querySelectorAll('[data-jump]').forEach(function (b) {
    b.onclick = function () {
      const t = window.__proto.tickets;
      const w = window.__proto.who;
      const j = b.getAttribute('data-jump');
      if (j === 'form') switchTo(w.sales, { page: 'new' });
      if (j === 'dash') switchTo(w.gm, { page: 'dashboard' });
      if (j === 'pricing') switchTo(w.sr, { page: 'pricing', id: t.pricing });
      if (j === 'srm') switchTo(w.srm, { page: 'ticket', id: t.srm });
    };
  });
  window.__protoStart = { page: 'new' };
})();
</script>`;

body = body.replace(/(<header class="topbar">)/, backend + bar + '$1');
let html = '<title>MGS Food Price Request</title>\n' + head.trim() + '\n' + body.trim() + '\n';
if (process.argv[3] === '--standalone') {
  html = '<!DOCTYPE html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    html.replace(/(<\/style>\s*)(?=<script>|<div class="proto-bar")/, '$1</head>\n<body>\n') + '</body>\n</html>\n';
}
fs.writeFileSync(out, html);
console.log('Prototype written: ' + out + ' (' + Math.round(html.length / 1024) + ' KB, ' + publicFns.length + ' server functions)');
