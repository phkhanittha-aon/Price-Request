/**
 * File: Lark.gs
 * Lark Bot API delivery of queued notifications (DM to each person).
 *
 * Setup (once):
 *   1. Lark Developer Console → Create custom app → enable "Bot".
 *   2. Permissions: im:message:send_as_bot, contact:user.id:readonly (get user ID by e-mail). Publish the app version.
 *   3. Apps Script → Project Settings → Script properties:
 *        LARK_APP_ID, LARK_APP_SECRET
 *        LARK_HOST           (optional, default https://open.larksuite.com — Feishu: https://open.feishu.cn)
 *        LARK_GROUP_CHAT_ID  (optional, oc_xxx — group that receives SLA breach summaries; add the bot to it)
 *   4. Run testLarkConnection() then installTriggers().
 *
 * Rules: a Lark failure never blocks or rolls back a business action. Rows stay in the
 * Notifications tab and are retried up to LARK_MAX_ATTEMPTS_ times with back-off.
 */

const LARK_MAX_ATTEMPTS_ = 5;
const LARK_BATCH_ = 40;

function larkConfig_() {
  if (TEST_LARK_) return TEST_LARK_;
  const p = PropertiesService.getScriptProperties();
  return {
    app_id: p.getProperty(CFG.PROP.LARK_APP_ID) || '',
    app_secret: p.getProperty(CFG.PROP.LARK_APP_SECRET) || '',
    host: p.getProperty(CFG.PROP.LARK_HOST) || 'https://open.larksuite.com',
    group_chat_id: p.getProperty(CFG.PROP.LARK_GROUP_CHAT_ID) || ''
  };
}

function larkConfigured_() {
  const c = larkConfig_();
  return !!(c.app_id && c.app_secret);
}

function larkHost_() {
  return larkConfig_().host || 'https://open.larksuite.com';
}

function larkToken_() {
  const cache = CacheService.getScriptCache();
  const hit = TEST_LARK_ ? null : cache.get('lark_tat');
  if (hit) return hit;
  const c = larkConfig_();
  const res = http_().fetch(larkHost_() + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    payload: JSON.stringify({ app_id: c.app_id, app_secret: c.app_secret })
  });
  const body = parseJson_(res.getContentText(), {});
  if (body.code !== 0 || !body.tenant_access_token) throw new Error('Lark auth failed: ' + (body.msg || res.getResponseCode()));
  if (!TEST_LARK_) cache.put('lark_tat', body.tenant_access_token, 100 * 60);   // token lives ~2 h
  return body.tenant_access_token;
}

function larkCall_(path, payload) {
  const res = http_().fetch(larkHost_() + path, {
    method: 'post', contentType: 'application/json; charset=utf-8', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + larkToken_() },
    payload: JSON.stringify(payload)
  });
  const body = parseJson_(res.getContentText(), {});
  // Lark returns HTTP 200 with an error code inside — always check body.code
  if (res.getResponseCode() >= 500 || body.code === 99991400) {
    const e = new Error('Lark temporary error: ' + (body.msg || res.getResponseCode()));
    e.retryable = true;
    throw e;
  }
  if (body.code !== 0) throw new Error('Lark error ' + body.code + ': ' + (body.msg || ''));
  return body.data || {};
}

/** Resolve open_ids for e-mails (cached for 6 h; persisted to Users.lark_open_id when found). */
function larkOpenIds_(emails) {
  const cache = CacheService.getScriptCache();
  const out = {};
  const unknown = [];
  emails.forEach(function (e) {
    const u = userByEmail_(e);
    const cached = TEST_LARK_ ? null : cache.get('lark_oid_' + e);
    if (u && u.lark_open_id) out[e] = u.lark_open_id;
    else if (cached) out[e] = cached;
    else unknown.push(e);
  });
  for (let i = 0; i < unknown.length; i += 50) {
    const data = larkCall_('/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id', { emails: unknown.slice(i, i + 50) });
    (data.user_list || []).forEach(function (x) {
      if (x.user_id && x.email) {
        const e = String(x.email).toLowerCase();
        out[e] = x.user_id;
        if (!TEST_LARK_) cache.put('lark_oid_' + e, x.user_id, 6 * 3600);
      }
    });
  }
  return out;
}

function larkCard_(n) {
  const link = String(n.link || '');
  const card = {
    config: { wide_screen_mode: true },
    header: { template: String(n.type).indexOf('sla_breach') === 0 ? 'red' : 'blue', title: { tag: 'plain_text', content: String(n.title).slice(0, 150) } },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: String(n.body || '').slice(0, 1500) } }]
  };
  if (/^https:\/\//.test(link)) {
    card.elements.push({ tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: 'เปิดใบขอราคา' }, url: link }] });
  }
  return card;
}

/** Trigger handler (every minute): deliver pending notifications. */
function dispatchNotifications() {
  requireJobContext_();
  if (!larkConfigured_()) return { skipped: 'not_configured' };
  const now = new Date();
  // 1) claim a batch under the lock
  const batch = withLock_(function () {
    const due = rows_(TAB.NOTIFICATIONS).filter(function (r) {
      const status = String(r.lark_status);
      const attempts = Number(r.lark_attempts || 0);
      const last = r.lark_sent_at ? new Date(r.lark_sent_at) : null;
      if (status === 'sending' && last && now - last > 10 * 60000) return true;          // stuck claim
      if (status !== 'pending' || attempts >= LARK_MAX_ATTEMPTS_) return false;
      if (now - new Date(r.created_at) > 48 * 3600000) return false;                     // too old to matter
      const backoffMin = [0, 1, 5, 15, 60][attempts] || 60;
      return !last || now - last >= backoffMin * 60000;
    }).slice(0, LARK_BATCH_);
    due.forEach(function (r) {
      updateRow_(TAB.NOTIFICATIONS, r.notif_id, { lark_status: 'sending', lark_attempts: Number(r.lark_attempts || 0) + 1, lark_sent_at: now });
    });
    return due.map(function (r) {
      return { notif_id: String(r.notif_id), email: String(r.user_email).toLowerCase(), type: String(r.type), title: String(r.title),
        body: String(r.body || ''), link: String(r.link || ''), attempts: Number(r.lark_attempts || 0) + 1 };
    });
  });
  if (!batch.length) return { sent: 0 };

  // 2) send outside the lock (network calls are slow)
  const results = {};
  let ids = {};
  try {
    ids = larkOpenIds_(batch.map(function (b) { return b.email; }).filter(function (e, i, a) { return a.indexOf(e) === i; }));
  } catch (e) {
    batch.forEach(function (b) { results[b.notif_id] = { status: 'pending', error: String(e.message).slice(0, 300) }; });
  }
  batch.forEach(function (b) {
    if (results[b.notif_id]) return;
    if (!ids[b.email]) { results[b.notif_id] = { status: 'no_lark_user', error: 'ไม่พบผู้ใช้ Lark จากอีเมลนี้' }; return; }
    try {
      larkCall_('/open-apis/im/v1/messages?receive_id_type=open_id', {
        receive_id: ids[b.email], msg_type: 'interactive', content: JSON.stringify(larkCard_(b)), uuid: b.notif_id.slice(0, 50)
      });
      results[b.notif_id] = { status: 'sent', error: '' };
    } catch (e) {
      const final = b.attempts >= LARK_MAX_ATTEMPTS_;
      results[b.notif_id] = { status: final ? 'failed' : 'pending', error: String(e.message).slice(0, 300) };
    }
  });

  // 3) record results under the lock
  let sent = 0;
  let failed = 0;
  withLock_(function () {
    Object.keys(results).forEach(function (id) {
      const r = results[id];
      if (r.status === 'sent') sent++;
      if (r.status === 'failed') failed++;
      updateRow_(TAB.NOTIFICATIONS, id, { lark_status: r.status, lark_error: r.error, lark_sent_at: new Date() });
    });
  });
  if (failed) logError_('dispatchNotifications', new Error(failed + ' Lark message(s) failed permanently'));
  return { sent: sent, failed: failed, claimed: batch.length };
}

/** Post a plain text message to the optional Lark group (SLA summaries, self-test alerts). */
function larkGroupText_(text) {
  const chatId = larkConfig_().group_chat_id;
  if (!chatId || !larkConfigured_()) return false;
  try {
    larkCall_('/open-apis/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: String(text).slice(0, 3000) })
    });
    return true;
  } catch (e) {
    console.error('larkGroupText_ failed', e);
    return false;
  }
}

/** Run from the editor after setting the Script Properties. Sends a DM to yourself. */
function testLarkConnection() {
  requireOwner_();
  const me = String(Session.getActiveUser().getEmail()).toLowerCase();
  larkToken_();
  const ids = larkOpenIds_([me]);
  if (!ids[me]) throw new Error('Token OK แต่ไม่พบผู้ใช้ Lark ของ ' + me + ' — ตรวจสิทธิ์ contact:user.id:readonly และอีเมลใน Lark');
  larkCall_('/open-apis/im/v1/messages?receive_id_type=open_id', {
    receive_id: ids[me], msg_type: 'interactive',
    content: JSON.stringify(larkCard_({ type: 'test', title: 'MGS Price Request — ทดสอบการเชื่อมต่อ', body: 'ถ้าเห็นข้อความนี้ แปลว่า Lark Bot ใช้งานได้ ✅', link: '' }))
  });
  const groupOk = larkGroupText_('MGS Price Request — ทดสอบการส่งเข้ากลุ่ม ✅');
  console.log('Lark OK. DM sent to ' + me + (groupOk ? ' + group message sent' : ' (no group configured)'));
  return 'OK';
}
