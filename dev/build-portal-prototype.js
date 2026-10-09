#!/usr/bin/env node
/**
 * File: dev/build-portal-prototype.js
 * Developer tool — NOT deployed. Builds a static prototype of the separate หน้ารวม web app (portal/):
 * the real portal/Code.gs summarises the Food demo database + sample Mech rows, the result is embedded
 * and served to the real portal/Portal.html through a google.script.run shim.
 *   node dev/build-portal-prototype.js prototype/mgs-portal.html
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { mockSpreadsheet, foodTables, loadPortal } = require('./portal-test.js');

const out = process.argv[2] || 'prototype/mgs-portal.html';
const mo = (k) => { const d = new Date(); d.setDate(10); d.setMonth(d.getMonth() - k); return d.toISOString().slice(0, 10); };
const q = (no, type, title, cust, status, total, gp, k, cur) => {
  const p = Math.round(total * gp) / 100;
  return { Id: no, DocType: type, DocNo: no, Title: title, Customer: cust, Sales: 'Sales Mech', Currency: cur || 'THB', Exrate: cur === 'USD' ? 35 : 0,
    OfferDate: mo(k), Status: status, Total: total, Cost: total - p, Profit: p, GP: gp, UpdatedAt: mo(k), Deleted: '' };
};
const mech = [
  q('SR-2610-001', 'SR', 'โซลาร์รูฟท็อป 500 kWp', 'โรงงานสยามแพค', 'Submitted', 0, 0, 0),
  q('SR-2610-002', 'SR', 'EV Charger 10 จุด', 'คอนโด ริเวอร์ไลน์', 'Accepted', 0, 0, 0),
  q('QT-2610-014', 'QT', 'Inverter SG110CX × 8', 'บจก. กรีนพาวเวอร์', 'In Progress', 1850000, 14, 0),
  q('QT-2610-012', 'QT', 'Mounting + Cable 1 MW', 'โรงแรมภูเก็ตบีช', 'Submitted', 2460000, 12.5, 0),
  q('QT-2610-011', 'QT', 'Sungrow SG250HX × 4', 'นิคมฯ อมตะ', 'Partial Approved', 98000, 16, 0, 'USD'),
  q('QT-2610-009', 'QT', 'Hybrid Inverter 50 kW', 'ฟาร์มไก่ สุพรรณ', 'Approved', 640000, 18, 0),
  q('QT-2609-031', 'QT', 'Solar Carport 200 kWp', 'ห้างเซ็นทรัล พลาซ่า', 'Pending', 5300000, 15, 1),
  q('QT-2609-027', 'QT', 'EV Charger DC 120 kW', 'ปั๊ม PT สาขา 12', 'Pending', 1280000, 17, 1),
  q('QT-2609-020', 'QT', 'Inverter SG125CX × 6', 'โรงงานน้ำแข็งชลบุรี', 'Won', 1720000, 16.5, 1),
  q('QT-2608-018', 'QT', 'Rooftop 300 kWp', 'โรงพยาบาลเอกชน', 'Won', 3900000, 14.5, 2),
  q('QT-2608-011', 'QT', 'Cable DC 4 mm² 20 km', 'ผู้รับเหมา Solar', 'Closed', 760000, 9, 2),
  q('QT-2607-030', 'QT', 'Mounting Ground 2 MW', 'Solar Farm โคราช', 'Won', 8600000, 13, 3),
  q('QT-2607-012', 'QT', 'EV Charger AC × 30', 'หมู่บ้านจัดสรร', 'Closed', 990000, 11, 3),
  q('QT-2606-022', 'QT', 'Inverter SG33CX × 12', 'โรงงานพลาสติก', 'Won', 1450000, 15, 4),
  q('QT-2605-008', 'QT', 'Rooftop 150 kWp', 'โรงเรียนนานาชาติ', 'Pending', 2100000, 16, 5)
];
mech.headers = Object.keys(mech[0]);
const sheets = { FOOD: mockSpreadsheet('Food DB', foodTables()), MECH: mockSpreadsheet('Mech', { Quotations: mech }) };
const res = loadPortal({ email: 'gm@example.co.th', sheets,
  props: { FOOD_SHEET_ID: 'FOOD', MECH_SHEET_ID: 'MECH', FOOD_WEBAPP_URL: '#food', MECH_WEBAPP_URL: '#mech' } }).getPortalData(true);
if (!res.ok) throw new Error('portal data: ' + res.error);

const fontDir = path.join(__dirname, 'fonts');
const fontCss = fs.readFileSync(path.join(fontDir, 'manifest.txt'), 'utf8').trim().split('\n').map((line) => {
  const [file, family, weight, range] = line.split('|');
  const b64 = fs.readFileSync(path.join(__dirname, '..', file)).toString('base64');
  return "@font-face{font-family:'" + family + "';font-style:normal;font-weight:" + weight + ";font-display:swap;src:url(data:font/woff2;base64," + b64 + ") format('woff2');unicode-range:" + range + ';}';
}).join('\n');
const version = /PORTAL_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'portal', 'Code.gs'), 'utf8'))[1];
const shim = `<script>
/* Prototype: google.script.run shim — data computed by the real portal/Code.gs from demo data */
window.__PORTAL_DATA__ = ${JSON.stringify(res)};
window.google = { script: { run: (function () {
  function runner(ok, fail) { return { withSuccessHandler: function (f) { return runner(f, fail); }, withFailureHandler: function (f) { return runner(ok, f); },
    getPortalData: function () { setTimeout(function () { const d = JSON.parse(JSON.stringify(window.__PORTAL_DATA__)); d.data.generated_at = new Date().toISOString(); ok(d); }, 250); } }; }
  return runner(function () {}, function () {});
})() } };
document.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  alert(a.getAttribute('href') === '#food' ? 'Prototype: ปุ่มนี้จะเปิดเว็บ MGS Food Price Request (FOOD_WEBAPP_URL)' : 'Prototype: ปุ่มนี้จะเปิดเว็บ MGS Project Pricing — Mech (MECH_WEBAPP_URL)');
});
</script>`;
let html = fs.readFileSync(path.join(__dirname, '..', 'portal', 'Portal.html'), 'utf8')
  .replace(/<\?= version \?>/g, version + ' · prototype')
  .replace(/<link rel="(preconnect|stylesheet)"[^>]*>\s*/g, '')
  .replace('<style>', '<style>' + fontCss + '\n')
  .replace('<base target="_top">', '')
  .replace('<body>', '<body>\n' + shim);
fs.writeFileSync(out, html);
console.log('Portal prototype written: ' + out + ' (' + Math.round(html.length / 1024) + ' KB)');
