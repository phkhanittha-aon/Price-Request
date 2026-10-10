#!/usr/bin/env node
/**
 * File: dev/build-deploy.js
 * Developer tool — NOT deployed. Builds paste-ready Apps Script files in deploy/:
 *   deploy/food/Code.gs        every gas/*.gs in load order (one file)
 *   deploy/food/Index.html     gas/Index.html with every page partial inlined (one file)
 *   deploy/food/appsscript.json
 *   deploy/portal/…            the separate หน้ารวม web app (copied as is)
 *   node dev/build-deploy.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const gas = path.join(root, 'gas');
const out = path.join(root, 'deploy');
const ORDER = ['Config', 'Util', 'Db', 'Audit', 'Auth', 'Pricing', 'Notify', 'Workflow', 'Editing', 'Suppliers', 'Deals',
  'Api', 'Files', 'Lark', 'Bots', 'Jobs', 'Code', 'Setup', 'Tests'];
const files = fs.readdirSync(gas).filter((f) => f.endsWith('.gs')).map((f) => f.slice(0, -3));
const extra = files.filter((f) => ORDER.indexOf(f) === -1);
if (extra.length) throw new Error('add to ORDER: ' + extra.join(', '));
const version = /APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(gas, 'Config.gs'), 'utf8'))[1];

const head = `/**
 * MGS Food Price Request — Code.gs (ALL server code in one file) · version ${version}
 * Built from the repository gas/*.gs by dev/build-deploy.js — do not edit here, edit gas/ and rebuild.
 *
 * Apps Script project needs exactly 3 files:  Code.gs (this) · Index.html · appsscript.json
 * First install: Run setupDatabase → Run runAcceptanceTests → Deploy (see the end of docs/ or the README).
 */
`;
const code = head + ORDER.filter((f) => files.indexOf(f) !== -1)
  .map((f) => `\n// ============================================================================\n// ${f}.gs\n// ============================================================================\n` +
    fs.readFileSync(path.join(gas, f + '.gs'), 'utf8')).join('\n');
const index = fs.readFileSync(path.join(gas, 'Index.html'), 'utf8')
  .replace(/<\?!= include_\('(\w+)'\); \?>/g, (_, n) => '<!-- ===== ' + n + '.html ===== -->\n' + fs.readFileSync(path.join(gas, n + '.html'), 'utf8'));
if (/include_\(/.test(index)) throw new Error('Index.html still has include_');

fs.mkdirSync(path.join(out, 'food'), { recursive: true });
fs.mkdirSync(path.join(out, 'portal'), { recursive: true });
fs.writeFileSync(path.join(out, 'food', 'Code.gs'), code);
fs.writeFileSync(path.join(out, 'food', 'Index.html'), index);
fs.copyFileSync(path.join(gas, 'appsscript.json'), path.join(out, 'food', 'appsscript.json'));
['Code.gs', 'Portal.html', 'appsscript.json'].forEach((f) => fs.copyFileSync(path.join(root, 'portal', f), path.join(out, 'portal', f)));
new (require('vm').Script)(code, { filename: 'Code.gs' });                     // syntax check
new (require('vm').Script)(fs.readFileSync(path.join(root, 'portal', 'Code.gs'), 'utf8'), { filename: 'portal/Code.gs' });
const kb = (p) => Math.round(fs.statSync(p).size / 1024) + ' KB';
console.log('deploy/food:   Code.gs ' + kb(path.join(out, 'food', 'Code.gs')) + ' · Index.html ' + kb(path.join(out, 'food', 'Index.html')) + ' · appsscript.json  (v' + version + ')');
console.log('deploy/portal: Code.gs · Portal.html · appsscript.json');
