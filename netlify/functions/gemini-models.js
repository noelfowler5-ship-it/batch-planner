/* GET /api/gemini/models

   Returns the models this API key can actually use, so Settings can offer a
   real list instead of a hardcoded name that may be renamed or retired.

   Output: { models: [{ id, label, inputTokenLimit }], default } */

import { guard, json, getApiKey, DEFAULT_MODEL } from './lib/gemini.mjs';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export default guard(async () => {
  const apiKey = getApiKey();

  let res;
  try {
    res = await fetch(`${API_ROOT}/models?pageSize=100`, {
      headers: { 'x-goog-api-key': apiKey }
    });
  } catch (e) {
    return json({ error: 'Could not reach Gemini to list models.' }, 502);
  }

  let body;
  try {
    body = await res.json();
  } catch (e) {
    return json({ error: 'Gemini returned an unreadable model list.' }, 502);
  }

  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || `Gemini rejected the request (${res.status}).`;
    return json({ error: String(msg).replace(/AIza[0-9A-Za-z_\-]+/g, '[redacted]').slice(0, 300) }, res.status);
  }

  /* Keep only models that can actually answer a generateContent call, and
     strip the "models/" prefix the API returns. */
  const models = (body.models || [])
    .filter((m) => Array.isArray(m.supportedGenerationMethods)
      ? m.supportedGenerationMethods.indexOf('generateContent') >= 0
      : true)
    .map((m) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      label: m.displayName || String(m.name || '').replace(/^models\//, ''),
      inputTokenLimit: m.inputTokenLimit || 0
    }))
    .filter((m) => m.id && !/embedding|aqa|imagen|veo/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  return json({ models, default: DEFAULT_MODEL });
});

export const config = { path: '/api/gemini/models' };
