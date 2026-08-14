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

export default async (req) => {
  const origin = new URL(req.url).origin;
  const redirect = process.env.TIKTOK_REDIRECT_URI || `${origin}/auth/callback`;
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', process.env.TIKTOK_CLIENT_KEY || '');
  url.searchParams.set('scope', 'user.info.basic,video.upload,video.list');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', state);

  const h = new Headers({ Location: url.toString() });
  h.append('Set-Cookie', cookie('tt_state', state, 600));
  return new Response(null, { status: 302, headers: h });
};

export const config = { path: '/api/tiktok/login' };
