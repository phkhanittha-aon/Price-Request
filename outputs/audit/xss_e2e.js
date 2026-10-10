#!/usr/bin/env node
/**
 * outputs/audit/xss_e2e.js — XSS + dead-screen walk in the browser prototype (AUDIT, never deployed).
 * The prototype runs the real gas/*.gs on in-memory mocks inside the page (dev/build-prototype.js).
 * 1) puts script payloads into every free-text field a user can type (request, item, remark, comment,
 *    supplier, deal note, reject reason) through the real server functions;
 * 2) opens every menu page + the request / pricing page as every role;
 * 3) reports any executed payload (window.__xss), JS errors and empty screens.
 *   node dev/build-prototype.js /tmp/proto.html --standalone && node outputs/audit/xss_e2e.js /tmp/proto.html
 */
'use strict';
const path = require('path');
let chromium;
try { chromium = require('playwright-core').chromium; } catch (e) { chromium = require(process.env.PW || 'playwright-core').chromium; }
const FILE = process.argv[2];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => { errors.push('DIALOG ' + d.message()); d.dismiss(); });
  await p.goto('file://' + path.resolve(FILE)); await p.waitForSelector('#nav button');
  const X = (tag) => '<img src=x onerror="window.__xss=(window.__xss||[]).concat(\'' + tag + '\')">"\'><svg onload="window.__xss=(window.__xss||[]).concat(\'' + tag + '-svg\')">';
  const ids = await p.evaluate((X) => {
    const P = window.__proto; const x = (t) => X.replace(/TAG/g, t);
    const d = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    P.setUser('sales.food1@example.co.th');
    const t = P.call('createTicket', [{ customer_group: 'ร้านอาหาร', customer_name: x('customer'), destination_country: x('dest'), documents_needed: x('docs'), description: x('remark'), due_date: d,
      items: [{ product_group_code: 'FOOD-SHRIMP', product_name: x('product'), net_weight: x('nw'), size: x('size'), packing_size: x('pack'), spec: x('spec'), description: x('itemdesc'), qty: 5, uom: 'กก.', target_price: 0 }] }]).data.ticket;
    const T = () => { P.setUser('admin@example.co.th'); return P.call('getTicket', [t.ticket_id]).data.ticket; };
    P.setUser('gm@example.co.th'); P.call('transitionTicket', [t.ticket_id, 'gm_return', x('gmreturn'), { expected_version: T().version }]);
    P.setUser('sales.food1@example.co.th'); P.call('transitionTicket', [t.ticket_id, 'resubmit', x('resubmit'), { expected_version: T().version }]);
    P.setUser('gm@example.co.th'); P.call('transitionTicket', [t.ticket_id, 'gm_approve', x('gmok'), { expected_version: T().version }]);
    P.setUser('sr1@example.co.th');
    const dd = P.call('getTicket', [t.ticket_id]).data;
    dd.checklist.forEach((c) => P.call('updateChecklist', [c.check_id, true, x('cknote')]));
    P.call('transitionTicket', [t.ticket_id, 'doc_complete', '', { expected_version: T().version }]);
    P.setUser('sr1@example.co.th');
    P.call('saveSupplier', [{ name: x('supplier'), supplier_type: 'import', default_currency: 'THB', default_vat_term: 'ex_vat', payment_term: x('payterm'), note: x('supnote') }]);
    const it = P.call('getTicket', [t.ticket_id]).data.items[0];
    const qs = [1, 2, 3].map((n) => ({ quote_id: crypto.randomUUID(), vendor_name: x('vendor' + n), unit_price: 100 + n, currency: 'THB', fx_rate: 1, vat_term: 'ex_vat',
      valid_until: d, brand: x('brand'), origin_country: x('origin'), packing: x('qpack'), shelf_life: x('shelf'), payment_term: x('qpay'), remark: x('qremark') }));
    P.call('saveSourcingDraft', [t.ticket_id, [{ item_id: it.item_id, quotes: qs, winner_quote_id: qs[1].quote_id, selection_reason: x('reason'), shortfall_reason: x('shortfall') }]]);
    P.call('transitionTicket', [t.ticket_id, 'submit_quote', '', { expected_version: T().version }]);
    P.setUser('sr.manager@example.co.th'); P.call('transitionTicket', [t.ticket_id, 'srm_approve', x('srmok'), { expected_version: T().version }]);
    P.setUser('gm@example.co.th'); P.call('transitionTicket', [t.ticket_id, 'gm_price_approve', x('gmprice'), { expected_version: T().version }]);
    P.setUser('sales.food1@example.co.th');
    P.call('transitionTicket', [t.ticket_id, 'accept', x('accept'), { expected_version: T().version }]);
    P.call('updateDeal', [it.item_id, { status: 'follow', note: x('dealnote'), stage: x('dealstage'), next_step: x('nextstep') }]);
    return { id: t.ticket_id };
  }, X('TAG'));
  const roles = { sales: 'sales.food1', manager: 'mgr.food', gm: 'gm', sr: 'sr1', sr_manager: 'sr.manager', admin: 'admin' };
  const report = [];
  for (const r of Object.keys(roles)) {
    await p.evaluate((e) => { window.__proto.setUser(e + '@example.co.th'); }, roles[r]);
    const menu = await p.evaluate(() => { const P = window.__proto; return P.call('getBootstrap', []).data.menu.map((m) => m.route); });
    const routes = menu.concat([{ page: 'ticket', id: ids.id }, { page: 'pricing', id: ids.id }, { page: 'deals', view: 'pending' }, { page: 'gp' }, { page: 'dashboard' }]);
    for (const route of routes) {
      const before = errors.length;
      await p.evaluate(([e, rt]) => { window.__xss = []; window.__proto.setUser(e); window.__protoStart = rt; document.getElementById('nav').innerHTML = ''; App.start(); }, [roles[r] + '@example.co.th', route]);
      await p.waitForTimeout(700);
      // open every <details>, the notification bell and the deal update dialog where present, then let events fire
      await p.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
      const bell = await p.$('#bell, [data-bell], .bell'); if (bell && await bell.isVisible()) { await bell.click({ timeout: 1500 }).catch(() => {}); await p.waitForTimeout(300); }
      await p.waitForTimeout(300);
      const res = await p.evaluate(() => ({ xss: window.__xss || [], text: (document.getElementById('view') || document.body).innerText.trim().slice(0, 80), h: (document.getElementById('view') || document.body).innerText.trim().length }));
      report.push([r, JSON.stringify(route), res.xss.length ? 'XSS: ' + res.xss.join(',') : 'ok', res.h < 30 ? 'EMPTY? "' + res.text + '"' : 'content ' + res.h + ' chars', errors.slice(before).join(' | ').slice(0, 120)]);
    }
  }
  console.log('| role | route | XSS | screen | JS errors |\n|---|---|---|---|---|');
  report.forEach((x) => console.log('| ' + x.join(' | ') + ' |'));
  console.log('\nexecuted payloads: ' + report.filter((x) => x[2] !== 'ok').length + ' · JS errors: ' + errors.length);
  await b.close();
})();
