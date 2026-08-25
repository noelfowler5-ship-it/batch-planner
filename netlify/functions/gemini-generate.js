/* POST /api/gemini/generate

   Input:  { analysis, duration, language, timeBudget, model? }
   Output: { content: { hooks, captions, voiceovers, textOverlays }, model, promptVersion }

   Stage two. Takes the scene plan produced by /api/gemini/analyze and writes the
   words that go over it. No frames are sent here — the analysis already says
   what happens at every timestamp, which is far cheaper and more controllable
   than asking the model to "make my TikTok". */

import { guard, json, fail, readJsonBody, resolveModel, callGemini } from './lib/gemini.mjs';

export const PROMPT_VERSION = 1;

/* GOOD/BAD lines below are tone references, not templates — they show the
   register (casual, direct) to write in, not the product to write about.
   Two different niches per language so the model doesn't anchor on one. */
const LANGUAGE_RULES = {
  bm: `Write in casual Malaysian Bahasa Melayu — the way a real person talks on TikTok, not corporate Malay.
GOOD: "Kalau selalu masak, benda ni memang memudahkan." / "Kulit berminyak memang leceh, tapi benda ni tolong banyak."
BAD:  "Produk ini amat sesuai bagi individu yang kerap menyediakan makanan."`,
  mix: `Write in casual Malaysian BM mixed naturally with English, the way Malaysians actually speak online.
GOOD: "Kalau kau selalu potong bawang, this thing save you so much time." / "Kalau kau kaki gym, this actually helps a lot."
Keep it natural — do not translate every phrase twice.`,
  en: `Write in casual conversational English aimed at a Malaysian audience. Friendly and direct, never corporate.
GOOD: "If you cook most nights, this saves you a real amount of time." / "If your skin gets oily by noon, this actually helps."`
};

const SYSTEM = `You write short-form video copy for a faceless Malaysian TikTok affiliate creator. The product niche varies by project — kitchen gadgets, skincare, fashion, phone accessories, fitness gear, whatever the scene analysis below actually describes — so match the language and details to that specific product, never to a fixed category.

Hard rules:
- Only describe what the supplied scene analysis actually shows. Never invent product features, results, brands, testimonials or prices. If no price is given, never mention one.
- No deceptive clickbait. A hook may be curious or dramatic, but it must be true to the clip.
- No fake urgency, no invented scarcity, no made-up review quotes.
- Voiceover scripts must fit the real time available. A 15-second clip does not get a 30-second script.
- Keep on-screen text short enough to read at speed — 72 characters maximum, ideally far less.
- Reply with JSON only. No prose, no code fences.`;

function buildPrompt(input) {
  const { analysis, duration, language, timeBudget } = input;
  const langRule = LANGUAGE_RULES[language] || LANGUAGE_RULES.bm;

  const overlayBudget = timeBudget <= 3 ? 2 : timeBudget <= 5 ? 3 : timeBudget <= 10 ? 5 : 7;

  const sceneSummary = (analysis.scenes || []).map((s) =>
    `- ${s.start}s to ${s.end}s | ${s.purpose} | ${s.description}` +
    (s.voiceoverRecommended ? ' | voiceover suggested' : '') +
    (s.textRecommended ? ' | text suggested' : '')
  ).join('\n');

  return `${langRule}

Clip duration: ${duration} seconds.
Product as identified: ${(analysis.video && analysis.video.product) || 'unclear'}.
Overall description: ${(analysis.video && analysis.video.description) || 'n/a'}.

Scene plan:
${sceneSummary || '(no scenes were identified)'}

Produce exactly this JSON:

{
  "hooks": [
    { "style": "curiosity",  "text": "..." },
    { "style": "painpoint",  "text": "..." },
    { "style": "pov",        "text": "..." },
    { "style": "unexpected", "text": "..." },
    { "style": "value",      "text": "..." }
  ],
  "captions": [
    { "style": "curiosity", "text": "..." },
    { "style": "problem",   "text": "..." },
    { "style": "casual",    "text": "..." }
  ],
  "voiceovers": {
    "short":  { "segments": [ { "start": 0, "end": 3.2, "text": "...", "estimatedSeconds": 3.0 } ] },
    "medium": { "segments": [ ... ] },
    "full":   { "segments": [ ... ] }
  },
  "textOverlays": [
    {
      "text": "short punchy line",
      "start": 0,
      "end": 2.4,
      "position": "top" | "center" | "bottom",
      "style": "hook" | "benefit" | "proof" | "cta",
      "animation": "none" | "fade" | "pop"
    }
  ]
}

Requirements:
- Exactly 5 hooks and exactly 3 captions.
- Hooks are alternatives. The creator picks ONE — do not write them to be used together.
- Voiceover variants must total roughly: short 10-15s, medium 15-25s, full 25-40s. Never exceed the ${duration}s clip. If the clip is shorter than a variant's range, shorten that variant to fit and keep it natural.
- Voiceover segment timings must line up with the scene plan above and must not overlap.
- Estimate roughly 2.6 spoken words per second when setting estimatedSeconds.
- At most ${overlayBudget} text overlays, and never two overlapping in time — one message on screen at a time.
- Every overlay must sit inside 0 to ${duration} seconds.`;
}

export default guard(async (req, apiKey) => {
  const body = await readJsonBody(req);

  const analysis = body.analysis;
  if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.scenes)) {
    return fail('A scene analysis is required before content can be generated.', 400);
  }

  const duration = Number(body.duration);
  if (!isFinite(duration) || duration <= 0) {
    return fail('A valid clip duration is required.', 400);
  }

  const language = ['bm', 'mix', 'en'].indexOf(body.language) >= 0 ? body.language : 'bm';
  const model = resolveModel(body.model);

  const result = await callGemini({
    apiKey,
    model,
    parts: [{ text: buildPrompt({
      analysis,
      duration: Math.round(duration * 100) / 100,
      language,
      timeBudget: Number(body.timeBudget) || 5
    }) }],
    systemInstruction: SYSTEM,
    temperature: 0.85   /* copy benefits from some variety, unlike analysis */
  });

  if (!result.ok) {
    return fail(result.error, result.status, {
      code: result.status === 429 ? 'quota' : undefined,
      detail: result.upstream
    });
  }

  return json({
    content: result.data,
    model,
    language,
    promptVersion: PROMPT_VERSION
  });
});

export const config = { path: '/api/gemini/generate' };
