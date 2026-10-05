#!/usr/bin/env node
/**
 * File: dev/preview-server.js
 * Developer tool — NOT deployed. Serves the real gas/*.html UI on http://localhost:8787 with
 * google.script.run / history / url shimmed to call the real gas/*.gs code (in-memory mocks,
 * seeded with demo data). Pick the user with ?as=<email> (default: sales.food1@example.co.th).
 *
 *   node dev/preview-server.js
 *   open http://localhost:8787/?as=mgr.food@example.co.th
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { createSandbox } = require('./gas-local-runner');

const PORT = Number(process.env.PORT || 8787);
const gasDir = path.join(__dirname, '..', 'gas');
const sandbox = createSandbox();
sandbox.__api.setupDatabase();
sandbox.__api.seedDemoData();
const U = sandbox.__api.demoUsers_();

function readHtml(name) { return fs.readFileSync(path.join(gasDir, name + '.html'), 'utf8'); }

/** Minimal HtmlService template evaluation for the scriptlets this project uses. */
function renderIndex() {
  const version = /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(gasDir, 'Config.gs'), 'utf8'))[1];
  return readHtml('Index')
    .replace(/<\?!= include_\('(\w+)'\); \?>/g, (_, n) => readHtml(n))
    .replace(/<\?= appVersion \?>/g, version)
    .replace('<body>', '<body>\n<script>' + SHIM + '</script>');
}

const SHIM = `
(function () {
  const params = new URLSearchParams(location.search);
  const as = params.get('as') || sessionStorage.getItem('as') || '${U.salesFood1}';
  sessionStorage.setItem('as', as);
  function call(fn, args, ok, fail) {
    fetch('/api/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-As': as }, body: JSON.stringify(args) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { setTimeout(function () { ok && ok(d); }, 80); })
      .catch(function (e) { fail && fail(e); });
  }
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_, k) {
      if (k === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (k === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () { call(k, Array.prototype.slice.call(arguments), ok, fail); };
    } });
  }
  let handler = null;
  function toQuery(p) { const q = new URLSearchParams(); q.set('as', as); Object.keys(p || {}).forEach(function (k) { q.set(k, p[k]); }); return '?' + q.toString(); }
  function current() { const o = {}; new URLSearchParams(location.search).forEach(function (v, k) { if (k !== 'as') o[k] = v; }); return o; }
  window.google = { script: {
    get run() { return runner(null, null); },
    history: {
      push: function (st, p) { history.pushState(st, '', toQuery(p)); },
      replace: function (st, p) { history.replaceState(st, '', toQuery(p)); },
      setChangeHandler: function (f) { handler = f; }
    },
    url: { getLocation: function (cb) { cb({ parameter: current() }); } }
  } };
  window.addEventListener('popstate', function (e) { if (handler) handler({ state: e.state, location: { parameter: current() } }); });
})();
`;

http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIndex());
    return;
  }
  const m = /^\/api\/(\w+)$/.exec(req.url);
  if (req.method === 'POST' && m) {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      try {
        out = sandbox.__call(m[1], JSON.parse(body || '[]'), String(req.headers['x-as'] || U.salesFood1));
      } catch (e) {
        out = { ok: false, code: 'SYSTEM_ERROR', error: e.message };
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(out === undefined ? null : out));
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
}).listen(PORT, () => {
  console.log('Preview: http://localhost:' + PORT + '/?as=' + U.salesFood1);
  console.log('Users: ' + Object.keys(U).map((k) => U[k]).join(', '));
});
