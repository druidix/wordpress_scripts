/**
 * Forminator -> Google Drive (free, automatic)
 * ------------------------------------------------------------------
 * A Google Apps Script Web App that receives Forminator's Custom Webhook
 * on each submission, fetches the uploaded image(s) from their public
 * wp-content URL, and saves them into a specific Drive folder — renamed
 * by submitter.
 *
 * Why this approach:
 *   - $0. No Zapier/Make/Bit-Integrations subscription.
 *   - Runs AS YOUR Google account, so files land in YOUR Drive and count
 *     against your normal 15 GB quota (no service-account "0 storage" trap).
 *   - Native DriveApp — pick the target folder by ID, rename freely.
 *
 * SETUP
 *   1. script.google.com -> New project -> paste this file.
 *   2. Set FOLDER_ID and SHARED_SECRET as Script Properties (never hardcode
 *      real values in this source file — see "SECRETS" below), and adjust
 *      the FILE_FIELD_KEYS / NAME_FIELD_KEY constants if needed.
 *   3. Deploy -> New deployment -> type "Web app":
 *        Execute as: Me
 *        Who has access: Anyone   (it's an unauthenticated endpoint;
 *                                  the SHARED_SECRET below is what guards it)
 *      Copy the /exec URL.
 *   4. In Forminator: your form -> Integrations -> Custom Webhook.
 *        URL:    <the /exec URL>?token=YOUR_SECRET
 *        Method: POST
 *   5. Submit the form once and check the Drive folder + the Apps Script
 *      execution log (View -> Executions).
 *
 * SECRETS
 *   Apps Script has no filesystem and no .env support, so secrets live in
 *   Script Properties instead (Project Settings -> Script Properties in the
 *   editor UI, or Project Settings -> "Add script property"). To seed them
 *   from code instead:
 *     1. Temporarily edit setScriptProperties_() below with your real
 *        FOLDER_ID and SHARED_SECRET.
 *     2. Run setScriptProperties_ once (Run menu -> select it -> Run).
 *     3. Revert your edit (put the placeholder strings back) so the real
 *        values never sit in source / get committed.
 *   Properties persist on the project regardless of what's in the file.
 *
 * NOTES
 *   - The image must be publicly fetchable. Forminator stores uploads under
 *     wp-content/uploads/forminator/ which is public by default. If you lock
 *     that folder down, use the WordPress-hook approach instead (local file
 *     path, no public URL needed).
 *   - Forminator sends multiple files in one field joined by "<br/>".
 *   - Consumer Apps Script quotas (UrlFetch 20k/day, Drive create) are far
 *     above a <100-submission event.
 */

// ------------------------------- CONFIG -------------------------------
// FOLDER_ID and SHARED_SECRET are secrets: they live in Script Properties,
// not in this file (see the SECRETS block in the header comment above).
// Everything else here is non-sensitive and fine to keep in source.
var CONFIG = {
  // The Forminator field key(s) that hold the uploaded file URL(s).
  // Forminator keys look like "upload-1", "upload-2". Inspect a test
  // payload (see logPayload_ below) and set the real key(s) here.
  FILE_FIELD_KEYS: ['upload-1'],

  // Field key used to build the filename (e.g. the Name field). Optional.
  NAME_FIELD_KEY: 'name-1',

  // Fallback prefix if the name field is empty.
  FALLBACK_PREFIX: 'submission'
};
// ----------------------------------------------------------------------

// One-time helper: fill in real values below, run this once from the Apps
// Script editor (Run -> setScriptProperties_), then revert the edit so the
// real values don't linger in source.
function setScriptProperties_() {
  PropertiesService.getScriptProperties().setProperties({
    FOLDER_ID: 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',
    SHARED_SECRET: 'change-me-to-a-long-random-string'
  });
}

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var folderId = props.getProperty('FOLDER_ID');
    var sharedSecret = props.getProperty('SHARED_SECRET');
    if (!folderId || !sharedSecret) {
      return json_({ ok: false, error: 'missing FOLDER_ID/SHARED_SECRET script properties' }, 500);
    }

    // 1) Auth: reject anything without the shared secret.
    var token = (e && e.parameter && e.parameter.token) || '';
    if (token !== sharedSecret) {
      return json_({ ok: false, error: 'unauthorized' }, 401);
    }

    // 2) Parse the payload (Forminator posts form-encoded; JSON handled too).
    var data = parsePayload_(e);
    // Uncomment while wiring up, to see the exact keys Forminator sends:
    // logPayload_(data);

    // 3) Build a base filename from the name field.
    var base = sanitize_(pick_(data, CONFIG.NAME_FIELD_KEY) || CONFIG.FALLBACK_PREFIX);
    var stamp = Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss");
    var folder = DriveApp.getFolderById(folderId);

    // 4) Collect all file URLs across the configured field(s).
    var urls = [];
    CONFIG.FILE_FIELD_KEYS.forEach(function (key) {
      var raw = pick_(data, key);
      if (!raw) return;
      // Forminator joins multiple files with <br/>; also tolerate commas/newlines.
      String(raw).split(/<br\s*\/?>|\r?\n|,/).forEach(function (u) {
        u = u.trim();
        if (/^https?:\/\//i.test(u)) urls.push(u);
      });
    });

    if (!urls.length) {
      return json_({ ok: false, error: 'no file URL in payload', keys: Object.keys(data) }, 422);
    }

    // 5) Fetch each image and drop it into the folder, renamed.
    var saved = [];
    urls.forEach(function (url, i) {
      var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
      if (resp.getResponseCode() !== 200) {
        saved.push({ url: url, error: 'HTTP ' + resp.getResponseCode() });
        return;
      }
      var blob = resp.getBlob();
      var ext = extFromUrl_(url) || extFromBlob_(blob) || 'jpg';
      var suffix = urls.length > 1 ? ('_' + (i + 1)) : '';
      var name = base + '_' + stamp + suffix + '.' + ext;
      var file = folder.createFile(blob.setName(name));
      saved.push({ name: name, id: file.getId() });
    });

    return json_({ ok: true, saved: saved }, 200);
  } catch (err) {
    return json_({ ok: false, error: String(err) }, 500);
  }
}

// Optional: quick GET check that the endpoint is live.
function doGet() {
  return json_({ ok: true, msg: 'Forminator->Drive endpoint is live. POST only.' }, 200);
}

// --------------------------- helpers ---------------------------
function parsePayload_(e) {
  if (e && e.postData && /json/i.test(e.postData.type || '')) {
    try { return JSON.parse(e.postData.contents) || {}; } catch (_) {}
  }
  // Form-encoded (Forminator default): flat key/value map.
  return (e && e.parameter) ? e.parameter : {};
}

// Case-insensitive-ish lookup; also tries a "fields[key]" shape some setups use.
function pick_(data, key) {
  if (!key) return '';
  if (data[key] != null) return data[key];
  var alt = 'fields[' + key + ']';
  if (data[alt] != null) return data[alt];
  var lk = key.toLowerCase();
  for (var k in data) if (k.toLowerCase() === lk) return data[k];
  return '';
}

function sanitize_(s) {
  return String(s).trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'x';
}

function extFromUrl_(url) {
  var m = String(url).split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : '';
}

function extFromBlob_(blob) {
  var map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif' };
  return map[blob.getContentType()] || '';
}

function json_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
  // (Apps Script Web Apps don't let you set arbitrary HTTP status codes;
  //  the `code` arg is kept for readability/logging intent.)
}

function logPayload_(data) {
  Logger.log('Forminator keys: ' + JSON.stringify(Object.keys(data)));
  Logger.log('Full payload: ' + JSON.stringify(data));
}
