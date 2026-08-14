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
  const u = new URL(req.url);
  const origin = u.origin;
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state');
  const err = u.searchParams.get('error');
  const c = readCookies(req);

  const back = (q) => new Response(null, { status: 302, headers: { Location: `${origin}/?${q}` } });

  if (err) return back('tt=error&reason=' + encodeURIComponent(err));
  if (!code) return back('tt=error&reason=no_code');
  // state must match the one we set before redirecting — blocks request forgery
  if (!state || !c.tt_state || state !== c.tt_state) return back('tt=error&reason=bad_state');

  const redirect = process.env.TIKTOK_REDIRECT_URI || `${origin}/auth/callback`;
  const r = await fetch(`${TT}/v2/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code: decodeURIComponent(code),
      grant_type: 'authorization_code',
      redirect_uri: redirect
    })
  });
  const d = await r.json();
  if (!d.access_token) return back('tt=error&reason=' + encodeURIComponent(d.error_description || d.error || 'token_failed'));

  const exp = Date.now() + (d.expires_in || 86400) * 1000;
  const h = new Headers({ Location: `${origin}/?tt=connected` });
  h.append('Set-Cookie', cookie('tt_access', d.access_token, 60 * 60 * 24 * 30));
  h.append('Set-Cookie', cookie('tt_refresh', d.refresh_token || '', 60 * 60 * 24 * 300));
  h.append('Set-Cookie', cookie('tt_exp', String(exp), 60 * 60 * 24 * 30));
  h.append('Set-Cookie', clear('tt_state'));
  return new Response(null, { status: 302, headers: h });
};

export const config = { path: '/auth/callback' };
