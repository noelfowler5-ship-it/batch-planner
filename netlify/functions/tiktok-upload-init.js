const TT = 'https://open.tiktokapis.com';

function readCookies(req) {
  const raw = req.headers.get('cookie') || '';
  const out = {};
  raw.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function clear(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
function json(body, status, extraHeaders) {
  const h = new Headers({ 'Content-Type': 'application/json' });
  (extraHeaders || []).forEach(v => h.append('Set-Cookie', v));
  return new Response(JSON.stringify(body), { status: status || 200, headers: h });
}
async function refreshToken(refresh) {
  const r = await fetch(`${TT}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refresh
    })
  });
  return r.json();
}
/* Returns { token, setCookies } or { error }. Refreshes transparently when expired. */
async function getToken(req) {
  const c = readCookies(req);
  if (!c.tt_access) return { error: 'not_connected' };
  const expMs = Number(c.tt_exp || 0);
  if (expMs && Date.now() < expMs - 60000) return { token: c.tt_access, setCookies: [] };
  if (!c.tt_refresh) return { error: 'not_connected' };
  const d = await refreshToken(c.tt_refresh);
  if (!d.access_token) return { error: d.error_description || d.error || 'refresh_failed' };
  const exp = Date.now() + (d.expires_in || 86400) * 1000;
  return {
    token: d.access_token,
    setCookies: [
      cookie('tt_access', d.access_token, 60 * 60 * 24 * 30),
      cookie('tt_refresh', d.refresh_token || c.tt_refresh, 60 * 60 * 24 * 300),
      cookie('tt_exp', String(exp), 60 * 60 * 24 * 30)
    ]
  };
}

/* Returns a TikTok upload_url. The browser PUTs the video bytes straight to TikTok,
   so the video never passes through this function — which keeps us far under the
   serverless request size limit. */
export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const t = await getToken(req);
  if (t.error) return json({ error: t.error }, 401);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'bad_json' }, 400); }
  const size = Number(body.video_size);
  if (!size || size < 1) return json({ error: 'video_size required' }, 400);

  // One chunk keeps this simple; TikTok accepts a single chunk for whole-file uploads.
  const r = await fetch(`${TT}/v2/post/publish/inbox/video/init/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t.token}`,
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1
      }
    })
  });
  const d = await r.json();
  if (!d.data || !d.data.upload_url) {
    const e = d.error || {};
    return json({ error: e.message || e.code || 'init_failed', code: e.code }, 400, t.setCookies);
  }
  return json({ publish_id: d.data.publish_id, upload_url: d.data.upload_url }, 200, t.setCookies);
};

export const config = { path: '/api/tiktok/upload-init' };

