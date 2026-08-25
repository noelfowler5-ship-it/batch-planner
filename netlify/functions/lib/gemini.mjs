/* Shared helpers for the ClipForge Gemini proxy functions.

   This file lives in a subdirectory that does not contain a matching entry
   file, so Netlify does not publish it as a function of its own — it is only
   imported by the real ones.

   The API key is read from the environment here and never leaves the server.
   Nothing in this file logs request bodies or key material. */

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

/* Changing the default here changes it for every function at once. It can also
   be overridden per-deploy with the GEMINI_MODEL environment variable, and
   per-request by the client (Settings reads the live model list from Google,
   so a renamed or retired model never bricks the app). */
export const DEFAULT_MODEL = 'gemini-2.5-flash';

/* Request bodies are capped well under Netlify's synchronous function limit.
   The client sends still frames rather than video precisely to stay here. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

export function fail(message, status = 400, extra) {
  return json(Object.assign({ error: message }, extra || {}), status);
}

export function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !String(key).trim()) return null;
  return String(key).trim();
}

export function resolveModel(requested) {
  const clean = (requested || '').trim();
  /* Only allow the shape of a real model id — never interpolate arbitrary
     user input into the upstream URL path. */
  if (clean && /^[a-zA-Z0-9._-]{1,64}$/.test(clean)) return clean;
  const fromEnv = (process.env.GEMINI_MODEL || '').trim();
  if (fromEnv && /^[a-zA-Z0-9._-]{1,64}$/.test(fromEnv)) return fromEnv;
  return DEFAULT_MODEL;
}

export async function readJsonBody(req) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    const err = new Error('Request too large. Try a shorter clip or fewer frames.');
    err.status = 413;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error('Malformed request body.');
    err.status = 400;
    throw err;
  }
}

/* Turn the client's "data:image/jpeg;base64,…" strings into Gemini inlineData
   parts. Anything that is not a plausible JPEG/PNG data URL is dropped rather
   than forwarded. */
export function framesToParts(frames, limit = 20) {
  const parts = [];
  const list = Array.isArray(frames) ? frames.slice(0, limit) : [];
  for (const f of list) {
    if (!f || typeof f.dataUrl !== 'string') continue;
    const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(f.dataUrl);
    if (!m) continue;
    const seconds = Number(f.t);
    parts.push({ text: `Frame at ${isFinite(seconds) ? seconds.toFixed(2) : '?'}s:` });
    parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  return parts;
}

/* Gemini wraps JSON in prose often enough that a bare JSON.parse is unreliable.
   Strip code fences, then fall back to the outermost brace pair. */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(s);
  } catch (e) { /* fall through to brace scan */ }

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch (e) { /* give up below */ }
  }
  return null;
}

/* One call to generateContent. Returns { ok, data } or { ok:false, status, error }. */
export async function callGemini({ apiKey, model, parts, systemInstruction, temperature }) {
  const url = `${API_ROOT}/models/${encodeURIComponent(model)}:generateContent`;

  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: typeof temperature === 'number' ? temperature : 0.6,
      responseMimeType: 'application/json',
      maxOutputTokens: 8192
    }
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    return { ok: false, status: 502, error: 'Could not reach Gemini. Check your connection and try again.' };
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, status: 502, error: 'Gemini returned a response that could not be read.' };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: describeUpstreamError(res.status, body), upstream: safeUpstream(body) };
  }

  const candidate = body && body.candidates && body.candidates[0];
  if (!candidate) {
    const blocked = body && body.promptFeedback && body.promptFeedback.blockReason;
    return {
      ok: false,
      status: 422,
      error: blocked
        ? `Gemini declined to analyse this clip (${blocked}).`
        : 'Gemini returned no result for this clip.'
    };
  }

  if (candidate.finishReason === 'MAX_TOKENS') {
    return { ok: false, status: 422, error: 'The analysis was cut off. Try a shorter clip.' };
  }

  const text = (candidate.content && candidate.content.parts || [])
    .map((p) => p.text || '')
    .join('');

  const parsed = extractJson(text);
  if (!parsed) {
    return { ok: false, status: 422, error: 'Gemini did not return usable JSON.', raw: text.slice(0, 400) };
  }

  return { ok: true, data: parsed, model };
}

function describeUpstreamError(status, body) {
  const msg = (body && body.error && body.error.message) || '';
  if (status === 400 && /API key not valid/i.test(msg)) {
    return 'The Gemini API key is not valid. Check GEMINI_API_KEY in the Netlify environment variables.';
  }
  if (status === 401 || status === 403) {
    return 'Gemini refused the API key. It may be restricted, disabled, or missing permissions.';
  }
  if (status === 404) {
    return 'That Gemini model is not available to this key. Pick a different model in Settings.';
  }
  if (status === 429) {
    return 'Gemini free-tier limit reached. You can keep editing locally and try AI again later.';
  }
  if (status >= 500) {
    return 'Gemini had a server problem. Try again in a moment.';
  }
  return msg || `Gemini rejected the request (${status}).`;
}

function safeUpstream(body) {
  const msg = (body && body.error && body.error.message) || '';
  /* Truncate, and never echo anything that could contain key material. */
  return String(msg).replace(/AIza[0-9A-Za-z_\-]+/g, '[redacted]').slice(0, 300);
}

export function guard(handler) {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
    if (req.method !== 'POST' && req.method !== 'GET') {
      return fail('Method not allowed.', 405);
    }
    const apiKey = getApiKey();
    if (!apiKey) {
      return fail(
        'No Gemini API key is configured on the server. Add GEMINI_API_KEY in Netlify → Site configuration → Environment variables, then redeploy.',
        503,
        { code: 'no_api_key' }
      );
    }
    try {
      return await handler(req, apiKey);
    } catch (e) {
      const status = e && e.status ? e.status : 500;
      return fail((e && e.message) || 'Unexpected server error.', status);
    }
  };
}
