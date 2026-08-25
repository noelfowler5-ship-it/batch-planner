/* POST /api/gemini/generate

   Input:  { analysis, duration, language, timeBudget, model? }
   Output: { content: { hooks, captions, voiceovers, textOverlays }, model, promptVersion }

   Stage two. Takes the scene plan produced by /api/gemini/analyze and writes the
   words that go over it. No frames are sent here — the analysis already says
   what happens at every timestamp, which is far cheaper and more controllable
   than asking the model to "make my TikTok". */

import { guard, json, fail, readJsonBody, resolveModel, callGemini } from './lib/gemini.mjs';

export const PROMPT_VERSION = 2;

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
- Never state a price, a discount, or any number of ringgit. Say "murah", "berbaloi", "bajet", "tak mahal" instead. The creator fills in real prices themselves; an invented one is a policy risk.
- Reply with JSON only. No prose, no code fences.`;

/* How this creator actually captions their posts, taken from their own
   published videos rather than from generic TikTok advice. The model copies
   register far better from real examples than from adjectives. */
/* Mirrors CF.DEFAULT_STYLE_EXAMPLES in clipforge/js/util.js — this is what a
   request sends when Settings → Caption style examples is still empty (a
   fresh install, or the creator hit "Reset to defaults"). Keep both lists in
   sync if they change. */
const DEFAULT_STYLE_EXAMPLES = [
  'Tengah malam lapar? / Nasip baik ada benda ni, senang kerja',
  'Pembuka penutup tin makanan AUTOMATIC!!',
  'Pencenkan lesung batu korang! 😗 / Tumbuk sambal tak bising, senang je.',
  'SENANG KERJA MAK-MAK 👍👍🔥'
];
const MAX_STYLE_EXAMPLES = 12;
const MAX_STYLE_EXAMPLE_CHARS = 160;

/* Same caps as U.sanitizeStyleExamples client-side — the client already
   enforces these, but a request body is untrusted input and gets its own
   pass regardless. */
function sanitizeStyleExamples(list) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((raw) => {
    const text = String(raw == null ? '' : raw).trim().slice(0, MAX_STYLE_EXAMPLE_CHARS);
    if (!text || seen.has(text)) return;
    seen.add(text);
    if (out.length < MAX_STYLE_EXAMPLES) out.push(text);
  });
  return out;
}

function buildOverlayVoice(styleExamples) {
  const examples = styleExamples.length ? styleExamples : DEFAULT_STYLE_EXAMPLES;
  const quoted = examples.map((e) => `  "${e.replace(/"/g, "'")}"`).join('\n');
  return `On-screen text style — match this creator's real captions:
- Everyday spoken Malay, including the loose spellings people actually type ("je", "ni", "korang", "mak-mak", "yerr"). Never textbook Malay.
- One or two short lines. The first line hooks, the second pays it off.
- End a line with 1-3 emoji when it suits the tone. Real examples: "✨", "👍👍🔥", "😗".
- Real captions from this creator, as a register reference only — do not reuse the wording or the product:
${quoted}
- Write about whatever the scene plan actually shows, in that voice.`;
}

function buildPrompt(input) {
  const { analysis, duration, language, styleExamples } = input;
  const langRule = LANGUAGE_RULES[language] || LANGUAGE_RULES.bm;

  /* Overlay count follows the clip's own length, not the editing time
     budget: a 15s clip carries one caption for its whole length however
     long the creator has to work on it. Mirrors U.overlayCountFor(). */
  const overlay = duration < 20 ? { min: 1, max: 1, shape: 'sticky' }
                : duration <= 25 ? { min: 1, max: 2, shape: 'sticky' }
                : { min: 3, max: 4, shape: 'changing' };

  const sceneSummary = (analysis.scenes || []).map((s) =>
    `- ${s.start}s to ${s.end}s | ${s.purpose} | ${s.description}` +
    (s.voiceoverRecommended ? ' | voiceover suggested' : '') +
    (s.textRecommended ? ' | text suggested' : '')
  ).join('\n');

  return `${langRule}

${buildOverlayVoice(styleExamples)}

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
- Write ${overlay.min === overlay.max ? 'exactly ' + overlay.max : overlay.min + ' to ' + overlay.max} text overlay${overlay.max === 1 ? '' : 's'}, never overlapping in time — one message on screen at a time.
${overlay.shape === 'sticky'
  ? `- This clip is ${duration}s, which is short. The caption is NOT a per-scene subtitle: write one caption that starts within the first second and stays on screen until roughly ${Math.max(1, Math.round(duration - 0.5))}s. It must make sense over the whole clip, so keep it about the product overall, not about one moment.`
  : `- This clip is ${duration}s, long enough for the text to follow the demo. Each overlay covers a different stretch of the scene plan and describes what is happening in that stretch — the first hooks, the middle narrate the steps, the last lands the payoff. Together they should read as one thought, and cover most of the clip with no long silent gaps.`}
- Every overlay must sit inside 0 to ${duration} seconds.
- Set every overlay's "position" to "center" and "style" to whichever of hook/benefit/proof/cta describes its job. Position and style no longer change how the text is drawn, but they are still recorded.`;
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
      timeBudget: Number(body.timeBudget) || 5,
      styleExamples: sanitizeStyleExamples(body.styleExamples)
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
