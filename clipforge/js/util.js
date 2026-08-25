/* util.js — tiny helpers + app-wide constants. No DOM rendering, no storage.
   Everything here is pure and safe to unit-test. */

var CF = window.CF || {};
window.CF = CF;

CF.VERSION = '0.1.0';

/* Statuses a project moves through. Purely a personal workflow — nothing here
   talks to TikTok or any other platform. */
CF.STATUSES = ['RAW', 'ANALYZING', 'EDITING', 'READY', 'POSTED'];

CF.STATUS_LABEL = {
  RAW: 'Raw',
  ANALYZING: 'Analyzing',
  EDITING: 'Editing',
  READY: 'Ready',
  POSTED: 'Posted'
};

/* Time budget drives how aggressive AI recommendations get in Phase 2.
   Stored on the project so a re-analysis reproduces the same intent. */
CF.TIME_BUDGETS = [3, 5, 10, 20];
CF.DEFAULT_TIME_BUDGET = 5;

CF.LANGUAGES = [
  ['bm', 'Bahasa Melayu'],
  ['mix', 'BM + English'],
  ['en', 'English']
];
CF.DEFAULT_LANGUAGE = 'bm';

/* How many frames get sampled for AI analysis. Frames — not the video file —
   are what Phase 2 sends to Gemini: a Netlify function caps request bodies at
   roughly 6 MB, while a 20-second 1080p clip is 15-60 MB. 14 frames at 480px
   land around 400 KB, which fits comfortably and is far kinder to a free quota. */
CF.FRAME_COUNT = 14;
CF.FRAME_MAX_WIDTH = 480;
CF.FRAME_QUALITY = 0.72;

CF.ACCEPTED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v'];
CF.MAX_SENSIBLE_BYTES = 500 * 1024 * 1024; /* 500 MB — beyond this the browser struggles */

/* Starting point for the caption-style examples the generate prompt learns
   from (see Settings → Caption style examples). Real lines from this
   creator's own posts, picked when the overlay style was first built.
   Mirrored server-side in gemini-generate.js as the fallback for a request
   that sends none — keep both in sync if these change. */
CF.DEFAULT_STYLE_EXAMPLES = [
  'Tengah malam lapar? / Nasip baik ada benda ni, senang kerja',
  'Pembuka penutup tin makanan AUTOMATIC!!',
  'Pencenkan lesung batu korang! 😗 / Tumbuk sambal tak bising, senang je.',
  'SENANG KERJA MAK-MAK 👍👍🔥'
];
CF.MAX_STYLE_EXAMPLES = 12;
CF.MAX_STYLE_EXAMPLE_CHARS = 160;

var U = {};
CF.util = U;

/* Trim, drop empties/dupes, cap length and count. Used wherever a style
   example list is accepted — Settings storage and the outgoing request both
   run input through this, so neither can drift from what the other expects. */
U.sanitizeStyleExamples = function (list) {
  var seen = {};
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (raw) {
    var text = String(raw == null ? '' : raw).trim().slice(0, CF.MAX_STYLE_EXAMPLE_CHARS);
    if (!text || seen[text]) return;
    seen[text] = true;
    if (out.length < CF.MAX_STYLE_EXAMPLES) out.push(text);
  });
  return out;
};

U.uid = function (prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
};

/* Escape before any interpolation into innerHTML. A filename with an apostrophe
   or an angle bracket otherwise breaks the markup or injects an attribute. */
U.esc = function (s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};

U.clamp = function (n, lo, hi) { return Math.max(lo, Math.min(hi, n)); };

U.round = function (n, dp) {
  var f = Math.pow(10, dp || 0);
  return Math.round(n * f) / f;
};

/* 27.4 -> "0:27" ; 95 -> "1:35". Always mm:ss, never a bare float. */
U.clock = function (seconds) {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return '0:00';
  var total = Math.round(seconds);
  var m = Math.floor(total / 60);
  var s = total % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
};

U.bytes = function (n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return U.round(n / 1024, 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return U.round(n / (1024 * 1024), 1) + ' MB';
  return U.round(n / (1024 * 1024 * 1024), 2) + ' GB';
};

/* ISO date (YYYY-MM-DD) in local time — not UTC, so "today" matches the user's day. */
U.ymd = function (d) {
  var x = d || new Date();
  var m = x.getMonth() + 1;
  var day = x.getDate();
  return x.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
};

U.relativeDay = function (iso) {
  if (!iso) return '';
  var then = new Date(iso);
  if (isNaN(then.getTime())) return '';
  var days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return days + ' days ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
};

U.isVideoFile = function (file) {
  if (!file) return false;
  if (file.type && file.type.indexOf('video/') === 0) return true;
  /* Some Android pickers hand over an empty MIME type — fall back to the extension. */
  return /\.(mp4|mov|m4v|webm)$/i.test(file.name || '');
};

/* Evenly spaced sample points, offset half a step inward so we never land on
   t=0 (commonly a black frame) or exactly on the final frame (which often
   refuses to seek). */
U.sampleTimes = function (duration, count) {
  var out = [];
  if (!(duration > 0) || !(count > 0)) return out;
  for (var i = 0; i < count; i++) {
    out.push(U.round((i + 0.5) * duration / count, 2));
  }
  return out;
};

/* How many frames are worth pulling for a clip of this length. Short clips do
   not need 14 samples, long ones should not balloon the request past the
   function payload limit. */
U.framesForDuration = function (duration) {
  if (!(duration > 0)) return 6;
  var n = Math.ceil(duration / 2);
  return U.clamp(n, 6, CF.FRAME_COUNT);
};

/* How many on-screen text overlays a clip of this length should carry.

   Taken from how this creator actually posts: a short clip gets one caption
   that sits there for the whole video, and only a longer clip earns text
   that changes as the demo moves. The 20-25s band is the in-between case and
   gets two. Both the prompt and the validator use this, so the AI is asked
   for the same number the app will accept. */
U.overlayCountFor = function (duration) {
  var d = duration > 0 ? duration : 0;
  if (d < 20) return { min: 1, max: 1 };
  if (d <= 25) return { min: 1, max: 2 };
  return { min: 3, max: 4 };
};

U.aspectLabel = function (w, h) {
  if (!w || !h) return '—';
  if (Math.abs(w / h - 9 / 16) < 0.02) return '9:16';
  if (Math.abs(w / h - 16 / 9) < 0.02) return '16:9';
  if (Math.abs(w / h - 1) < 0.02) return '1:1';
  return w + '×' + h;
};

/* A stable identity for a video, so Phase 2 can cache an analysis and never
   pay for the same clip twice. Name+size+mtime+duration is collision-safe
   enough for one person's library and costs nothing to compute. */
/* djb2 — not cryptographic, just cheap and stable enough to notice when two
   inputs differ. Used anywhere a piece of content needs a short, stable id
   without hashing the whole thing every comparison (video identity, and
   detecting when generated content has changed since something was checked
   against it). */
U.hashString = function (s) {
  var h = 5381;
  var str = String(s == null ? '' : s);
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};

U.videoFingerprint = function (file, duration) {
  var parts = [
    (file && file.name) || '',
    (file && file.size) || 0,
    (file && file.lastModified) || 0,
    U.round(duration || 0, 2)
  ].join('|');
  return 'v' + U.hashString(parts) + '_' + ((file && file.size) || 0).toString(36);
};

/* Round-robin merge of several arrays into one, preserving each array's own
   order. Used to combine multiple clips' frames for the policy check: the
   server caps the frame count it will accept, and a naive concatenation
   would let an early clip's frames crowd out a later clip's entirely —
   interleaving means every clip keeps some representation after the cap. */
U.interleave = function (arrays) {
  var lists = (arrays || []).filter(function (a) { return Array.isArray(a) && a.length; });
  var out = [];
  var i = 0;
  while (lists.some(function (a) { return i < a.length; })) {
    lists.forEach(function (a) { if (i < a.length) out.push(a[i]); });
    i++;
  }
  return out;
};

U.dataUrlBytes = function (dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return 0;
  var i = dataUrl.indexOf(',');
  if (i < 0) return 0;
  return Math.floor((dataUrl.length - i - 1) * 3 / 4);
};
