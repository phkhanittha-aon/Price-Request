/**
 * File: Files.gs
 * Attachments in Google Drive (folder per ticket, never shared publicly).
 *
 * Upload (≤ 20 MB) uses a Drive *resumable upload session* driven from the server:
 *   1. beginUpload(meta)            → server opens a session with the owner's token, returns upload_id
 *   2. uploadChunk(id, index, b64)  → browser sends 2 MB chunks one at a time (with progress);
 *                                      server forwards each to Drive with Content-Range
 *   3. last chunk                   → Drive returns the file id → row in Attachments + audit log
 * The OAuth token never leaves the server, and no call ever holds the whole file in memory.
 *
 * Viewing: openAttachment() checks permission, then grants that ONE user reader access
 * (no e-mail is sent) and returns the Drive link. Files are never "anyone with the link".
 */

const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;        // multiple of 256 KB (Drive requirement)
const UPLOAD_CACHE_PREFIX_ = 'upl_';
const EXT_MIME_ = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv'
};

/**
 * meta: { ticket_id, item_id?, quote_id?, category: 'request'|'info_response'|'quotation'|'quote_photo'|'other',
 *         file_name, mime_type, size_bytes }
 * quote_photo = product photo of ONE supplier offer (item_id + quote_id required, images only, ≤ max_photos_per_quote).
 * quote_id may be the client UUID of an offer that is still a draft on the pricing page.
 */
function beginUpload(meta) {
  return api_('beginUpload', function () {
    const m = meta || {};
    const u = currentUser_();
    const t = ticketForUser_(u, m.ticket_id);
    if (!canUpload_(u, t)) throw appError_('FORBIDDEN', 'แนบไฟล์ไม่ได้ในสถานะนี้ หรือคุณไม่ใช่ผู้รับผิดชอบใบนี้');

    const category = oneOf_(m.category || 'request', ATTACHMENT_CATEGORIES, 'ประเภทไฟล์');
    if (COST_FILE_CATEGORIES_.indexOf(category) !== -1 && u.role !== 'sr' && u.role !== 'admin') throw appError_('FORBIDDEN', 'ไฟล์ใบเสนอราคา / รูปสินค้าของ Supplier แนบได้เฉพาะ SR');
    const name = sanitizeFileName_(m.file_name);
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = cleanText_(m.mime_type, 150) || EXT_MIME_[ext] || '';
    const allowed = setting_('allowed_mime_types', []);
    if (allowed.indexOf(mime) === -1 || !EXT_MIME_[ext]) {
      throw appError_('FILE_TYPE', 'ไฟล์ชนิดนี้ไม่อนุญาต (รับเฉพาะ PDF, รูปภาพ, Excel, CSV)');
    }
    const size = toNumber_(m.size_bytes, 'ขนาดไฟล์', { gt: 0, integer: true });
    const maxMb = Number(setting_('max_upload_mb', 20));
    if (size > maxMb * 1024 * 1024) throw appError_('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกิน ' + maxMb + ' MB');

    let itemId = '';
    if (m.item_id) {
      const it = findOne_(TAB.ITEMS, 'item_id', m.item_id);
      if (!it || String(it.ticket_id) !== t.ticket_id || toBool_(it.is_deleted)) throw appError_('VALIDATION', 'รายการสินค้าไม่ได้อยู่ในใบนี้');
      itemId = String(it.item_id);
    }
    let quoteId = '';
    if (category === 'quote_photo') {
      if (PHOTO_MIME_TYPES_.indexOf(mime) === -1) throw appError_('FILE_TYPE', 'รูปสินค้ารับเฉพาะไฟล์รูป (JPG, PNG, WEBP, HEIC)');
      quoteId = checkPhotoTarget_(t, itemId, m.quote_id);
    }

    const folderId = withLock_(function () { return ticketFolderId_(t); });
    const res = http_().fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': mime,
        'X-Upload-Content-Length': String(size)
      },
      payload: JSON.stringify({ name: name, parents: [folderId], mimeType: mime }),
      muteHttpExceptions: true
    });
    const headers = res.getAllHeaders();
    const sessionUri = headers.Location || headers.location;
    if (res.getResponseCode() !== 200 || !sessionUri) {
      throw new Error('Drive resumable init failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
    }

    const uploadId = uuid_();
    const session = {
      owner: u.email, ticket_id: t.ticket_id, item_id: itemId, quote_id: quoteId, category: category, file_name: name, mime: mime,
      size: size, uri: sessionUri, next_offset: 0, chunk: UPLOAD_CHUNK_BYTES
    };
    CacheService.getScriptCache().put(UPLOAD_CACHE_PREFIX_ + uploadId, JSON.stringify(session), 6 * 3600);
    return { upload_id: uploadId, chunk_bytes: UPLOAD_CHUNK_BYTES, total_chunks: Math.ceil(size / UPLOAD_CHUNK_BYTES) };
  });
}

/** Send chunk number `index` (0-based) as base64. Returns { done, received } or the attachment when done. */
function uploadChunk(uploadId, index, base64) {
  return api_('uploadChunk', function () {
    const u = currentUser_();
    const cache = CacheService.getScriptCache();
    const key = UPLOAD_CACHE_PREFIX_ + cleanText_(uploadId, 64);
    const s = parseJson_(cache.get(key), null);
    if (!s || s.owner !== u.email) throw appError_('UPLOAD_EXPIRED', 'การอัปโหลดหมดอายุหรือไม่ถูกต้อง กรุณาเลือกไฟล์ใหม่');
    if (s.done) return s.result;

    const start = Number(index) * s.chunk;
    if (start < s.next_offset) return { done: false, received: s.next_offset };   // retried chunk already accepted
    if (start !== s.next_offset) throw appError_('UPLOAD_ORDER', 'ลำดับการอัปโหลดผิดพลาด กรุณาลองใหม่');

    const bytes = Utilities.base64Decode(String(base64 || ''));
    const end = start + bytes.length - 1;
    const isLast = end + 1 >= s.size;
    if (!bytes.length || (!isLast && bytes.length !== s.chunk) || end + 1 > s.size) {
      throw appError_('UPLOAD_SIZE', 'ขนาดข้อมูลไม่ตรงกับไฟล์ กรุณาลองใหม่');
    }

    const res = http_().fetch(s.uri, {
      method: 'put',
      contentType: s.mime,
      headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + s.size },
      payload: bytes,
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 308) {
      s.next_offset = end + 1;
      cache.put(key, JSON.stringify(s), 6 * 3600);
      return { done: false, received: s.next_offset };
    }
    if (code !== 200 && code !== 201) {
      throw new Error('Drive chunk upload failed: ' + code + ' ' + res.getContentText().slice(0, 300));
    }
    const file = JSON.parse(res.getContentText());

    const attachment = withLock_(function () {
      // Permission re-checked: the ticket may have moved on while the file was uploading
      const t = ticketForUser_(u, s.ticket_id);
      if (!canUpload_(u, t)) {
        try { drive_().getFileById(file.id).setTrashed(true); } catch (e) { console.warn(e); }
        throw appError_('FORBIDDEN', 'สถานะใบเปลี่ยนไประหว่างอัปโหลด ไฟล์นี้จึงไม่ถูกบันทึก');
      }
      if (s.category === 'quote_photo') {
        // limit re-checked under the lock: several photos may finish uploading at the same time
        try { checkPhotoTarget_(t, s.item_id, s.quote_id); } catch (e) {
          try { drive_().getFileById(file.id).setTrashed(true); } catch (e2) { console.warn(e2); }
          throw e;
        }
      }
      const row = {
        attachment_id: uuid_(), ticket_id: t.ticket_id, item_id: s.item_id, quote_id: s.quote_id || '', category: s.category,
        file_name: s.file_name, drive_file_id: String(file.id), mime_type: s.mime, size_bytes: s.size,
        uploaded_by: u.email, uploaded_at: new Date(), is_deleted: false, deleted_by: '', deleted_at: ''
      };
      insertRow_(TAB.ATTACHMENTS, row);
      appendLog_({ ticket_id: t.ticket_id, action: 'attachment_added', actor_email: u.email, actor_role: u.role,
        metadata: { attachment_id: row.attachment_id, file_name: row.file_name, category: row.category, size_bytes: row.size_bytes, item_id: row.item_id, quote_id: row.quote_id } });
      return publicAttachment_(row);
    });
    s.done = true;
    s.result = { done: true, attachment: attachment };
    cache.put(key, JSON.stringify(s), 3600);
    return s.result;
  });
}

function deleteAttachment(attachmentId) {
  return api_('deleteAttachment', function () {
    return withLock_(function () {
      const u = currentUser_();
      const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', cleanText_(attachmentId));
      if (!a || toBool_(a.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
      const t = ticketForUser_(u, a.ticket_id);
      if (u.role !== 'admin' && (String(a.uploaded_by).toLowerCase() !== u.email || !canUpload_(u, t))) {   // Admin may remove any file
        throw appError_('FORBIDDEN', 'ลบได้เฉพาะไฟล์ที่คุณแนบเอง และยังอยู่ในขั้นตอนที่แนบไฟล์ได้');
      }
      const inUse = rows_(TAB.QUOTATIONS).some(function (q) {
        return String(q.attachment_file_id) === String(a.attachment_id) && !toBool_(q.is_deleted);
      });
      if (inUse) throw appError_('IN_USE', 'ไฟล์นี้ผูกกับใบเสนอราคาอยู่ กรุณาเอาออกจากใบเสนอราคาก่อน');
      updateRow_(TAB.ATTACHMENTS, a.attachment_id, { is_deleted: true, deleted_by: u.email, deleted_at: new Date() });
      try { drive_().getFileById(String(a.drive_file_id)).setTrashed(true); } catch (e) { console.warn('trash failed', e); }
      appendLog_({ ticket_id: t.ticket_id, action: 'attachment_removed', actor_email: u.email, actor_role: u.role,
        metadata: { attachment_id: String(a.attachment_id), file_name: String(a.file_name), category: String(a.category) } });
      return { deleted: true };
    });
  });
}

/** Permission-checked link: grants the viewer reader access on this one file (no e-mail). */
function openAttachment(attachmentId) {
  return api_('openAttachment', function () {
    const u = currentUser_();
    const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', cleanText_(attachmentId));
    if (!a || toBool_(a.is_deleted)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
    const t = ticketForUser_(u, a.ticket_id);
    if (COST_FILE_CATEGORIES_.indexOf(String(a.category)) !== -1 && !canViewQuotes_(u, t)) throw appError_('NOT_FOUND', 'ไม่พบไฟล์แนบ');
    const fileId = String(a.drive_file_id);
    const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (u.email !== owner) {
      const res = http_().fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
        '/permissions?sendNotificationEmail=false&supportsAllDrives=true', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ type: 'user', role: 'reader', emailAddress: u.email }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) {
        throw new Error('Drive permission failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
      }
    }
    return { url: 'https://drive.google.com/file/d/' + fileId + '/view', file_name: String(a.file_name) };
  });
}

function maxPhotosPerQuote_() {
  const n = Number(setting_('max_photos_per_quote', 10));
  return isFinite(n) && n >= 1 ? Math.min(Math.floor(n), 30) : 10;
}

/** Active photos of one supplier offer. */
function quotePhotos_(quoteId) {
  return findAll_(TAB.ATTACHMENTS, 'quote_id', quoteId).filter(function (a) {
    return String(a.category) === 'quote_photo' && !toBool_(a.is_deleted);
  });
}

/** quote_photo target: item of this ticket + offer of that item (saved or a draft UUID), and room for one more photo. */
function checkPhotoTarget_(t, itemId, rawQuoteId) {
  if (!itemId) throw appError_('VALIDATION', 'รูปสินค้าต้องระบุรายการสินค้า');
  const quoteId = cleanText_(rawQuoteId, 64);
  if (!isUuid_(quoteId)) throw appError_('VALIDATION', 'รูปสินค้าต้องผูกกับ Supplier (ใบเสนอราคา) ที่ถูกต้อง');
  const q = findOne_(TAB.QUOTATIONS, 'quote_id', quoteId);
  if (q && (String(q.item_id) !== String(itemId) || String(q.ticket_id) !== String(t.ticket_id) || toBool_(q.is_deleted))) {
    throw appError_('VALIDATION', 'Supplier นี้ไม่ได้อยู่ในรายการสินค้านี้');
  }
  const max = maxPhotosPerQuote_();
  if (quotePhotos_(quoteId).length >= max) throw appError_('PHOTO_LIMIT', 'แนบรูปได้สูงสุด ' + max + ' รูปต่อ Supplier 1 เจ้า');
  return quoteId;
}

/** Soft-delete the photos of a removed offer (called inside the lock). */
function removeQuotePhotos_(u, quoteId) {
  quotePhotos_(quoteId).forEach(function (a) {
    updateRow_(TAB.ATTACHMENTS, a.attachment_id, { is_deleted: true, deleted_by: u.email, deleted_at: new Date() });
    try { drive_().getFileById(String(a.drive_file_id)).setTrashed(true); } catch (e) { console.warn('trash failed', e); }
  });
}

/**
 * Inline previews for the photo gallery: { attachment_id: 'data:image/...;base64,...' }.
 * size 'thumb' (≈ 320 px, cached 6 h) or 'large' (≈ 1600 px, for the full-screen viewer).
 * Images are read by the server with the owner's token, so viewers never need Drive access
 * and Sales can never load a supplier photo (same permission as openAttachment).
 */
function getPhotoPreviews(attachmentIds, size) {
  return api_('getPhotoPreviews', function () {
    const u = currentUser_();
    const large = size === 'large';
    const ids = (Array.isArray(attachmentIds) ? attachmentIds : []).map(function (x) { return cleanText_(x, 64); })
      .filter(String).slice(0, large ? 1 : 12);
    const cache = CacheService.getScriptCache();
    const seen = {};
    const out = {};
    ids.forEach(function (id) {
      const a = findOne_(TAB.ATTACHMENTS, 'attachment_id', id);
      if (!a || toBool_(a.is_deleted) || String(a.mime_type).indexOf('image/') !== 0) return;
      const tid = String(a.ticket_id);
      if (!(tid in seen)) {
        const t = ticketById_(tid);
        seen[tid] = { see: !!t && canSeeTicket_(u, t), cost: !!t && canViewQuotes_(u, t) };
      }
      if (!seen[tid].see || (COST_FILE_CATEGORIES_.indexOf(String(a.category)) !== -1 && !seen[tid].cost)) return;
      const key = 'ph_' + (large ? 'l_' : 't_') + id;
      const hit = large || TEST_DRIVE_ ? null : cache.get(key);
      if (hit) { out[id] = hit; return; }
      const url = drivePreview_(String(a.drive_file_id), large ? 1600 : 320, String(a.mime_type), Number(a.size_bytes || 0));
      if (!url) return;
      out[id] = url;
      if (!large && !TEST_DRIVE_ && url.length < 95000) cache.put(key, url, 6 * 3600);
    });
    return { previews: out };
  });
}

/** Data URL of a Drive file preview (Drive thumbnail at the wanted width; small originals as a fallback). */
function drivePreview_(fileId, px, mime, sizeBytes) {
  const auth = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  const meta = http_().fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
    '?fields=thumbnailLink&supportsAllDrives=true', { method: 'get', headers: auth, muteHttpExceptions: true });
  const link = meta.getResponseCode() === 200 ? String(parseJson_(meta.getContentText(), {}).thumbnailLink || '') : '';
  if (link) {
    const res = http_().fetch(link.replace(/=s\d+(-[a-z0-9-]+)?$/i, '') + '=s' + px, { method: 'get', headers: auth, muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const h = res.getAllHeaders();
      const type = String(h['Content-Type'] || h['content-type'] || 'image/jpeg').split(';')[0];
      return 'data:' + type + ';base64,' + Utilities.base64Encode(res.getContent());
    }
  }
  // Drive makes the thumbnail a few seconds after upload — until then send small browser-viewable originals as is
  if (sizeBytes > 0 && sizeBytes <= 1.5 * 1024 * 1024 && ['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) !== -1) {
    return 'data:' + mime + ';base64,' + Utilities.base64Encode(drive_().getFileById(fileId).getBlob().getBytes());
  }
  return '';
}

function publicAttachment_(a) {
  return {
    attachment_id: String(a.attachment_id), item_id: String(a.item_id || ''), quote_id: String(a.quote_id || ''),
    category: String(a.category), file_name: String(a.file_name), drive_file_id: String(a.drive_file_id),
    mime_type: String(a.mime_type || ''), size_bytes: Number(a.size_bytes || 0),
    uploaded_by: String(a.uploaded_by), uploaded_at: isoOrBlank_(a.uploaded_at)
  };
}

function sanitizeFileName_(name) {
  const s = cleanText_(name, 180).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  if (!s || s === '.' || s === '..') throw appError_('VALIDATION', 'ชื่อไฟล์ไม่ถูกต้อง');
  return s;
}

/** Drive folder for one ticket (created on first upload). Must run inside withLock_. */
function ticketFolderId_(t) {
  const rootId = TEST_DRIVE_ ? 'test-root' : PropertiesService.getScriptProperties().getProperty(CFG.PROP.DRIVE_ROOT_ID);
  if (!rootId) throw appError_('NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าโฟลเดอร์ไฟล์แนบ กรุณาให้ผู้ดูแลระบบรัน setupDatabase()');
  const root = drive_().getFolderById(rootId);
  const name = String(t.ticket_no);
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next().getId() : root.createFolder(name).getId();
}
