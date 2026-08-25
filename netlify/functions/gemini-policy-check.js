/* POST /api/gemini/policy-check

   Input:  { frames:[{t,dataUrl}], duration, hooks, captions, voiceovers,
             textOverlays, language, model? }
   Output: { policyCheck: {...}, model, promptVersion }

   A heuristic content-risk check, not a compliance verdict. Reviews both the
   generated words (hooks/captions/voiceover/overlays) and the actual video
   frames for the patterns that most often get an affiliate creator flagged:
   faked promotions/urgency, faked danger, undisclosed paid partnership,
   fake reviews, and unverifiable claims. This can never be a substitute for
   reading TikTok's own current Community Guidelines and Branded Content
   Policy — the UI says so, and this prompt says so too, so the model doesn't
   overstate its own certainty either. */

import { guard, json, fail, readJsonBody, resolveModel, framesToParts, callGemini } from './lib/gemini.mjs';

export const PROMPT_VERSION = 2;

const SYSTEM = `You are a content-safety reviewer helping a Malaysian TikTok affiliate creator self-check a video BEFORE posting it, so they can fix or soften anything risky ahead of time.

You are not TikTok, you do not have TikTok's current policy text, and your review is a heuristic risk check based on common patterns — never a compliance verdict or a guarantee the video is safe to post. Say so plainly in your summary.

Look at both the still frames (what is actually shown) and the generated hooks/captions/voiceover/on-screen text (what is actually said), and flag anything that resembles these common problem patterns for affiliate/promotional content:

- FAKED_PROMOTION — a discount, price, stock level, giveaway or urgency claim that appears invented or cannot be verified from what is shown (e.g. "only 3 left", "price doubles tonight") with nothing in the footage to support it.
- FAKED_DANGER — a staged, exaggerated, or implied dangerous/injurious act (fake burns, fake cuts, fake accidents, exaggerated risk) used for shock value rather than an honest demonstration.
- UNDISCLOSED_AD — affiliate/paid-promotion content with no visible or spoken disclosure at all (no "#ad", "paid partnership", "affiliate link", or spoken equivalent anywhere in the captions/voiceover/overlays).
- FAKE_TESTIMONIAL — a scripted line presented as a spontaneous customer review, reaction, or quote, when nothing in the footage shows an actual customer.
- UNVERIFIABLE_CLAIM — a health, safety, medical, or performance claim ("cures", "doctors recommend", "guaranteed") that the footage does not and cannot support.
- MISLEADING_RESULT — a before/after or demonstration that looks edited, staged, or exaggerated beyond what the clip plausibly shows.

Rules:
- Only flag something you can point to concretely — a specific hook/caption/overlay line, or a specific frame/timestamp. Never flag a vague feeling.
- Most affiliate content has NO issues. An empty flags list with overallRisk "low" is the normal, expected result — do not invent flags to seem thorough.
- Reply with JSON only. No prose, no code fences.`;

function buildPrompt(input) {
  const { duration, language, hooks, captions, voiceovers, textOverlays } = input;

  const lines = [];
  (hooks || []).forEach((h) => lines.push(`HOOK (${h.style}): "${h.text}"`));
  (captions || []).forEach((c) => lines.push(`CAPTION (${c.style}): "${c.text}"`));
  Object.keys(voiceovers || {}).forEach((variant) => {
    const segs = (voiceovers[variant] && voiceovers[variant].segments) || [];
    segs.forEach((s) => lines.push(`VOICEOVER (${variant}, ${s.start}s-${s.end}s): "${s.text}"`));
  });
  (textOverlays || []).forEach((o) => lines.push(`ON-SCREEN TEXT (${o.start}s-${o.end}s): "${o.text}"`));

  return `Clip duration: ${duration} seconds. Written in language code: ${language}.

Generated content to review:
${lines.length ? lines.join('\n') : '(none generated yet)'}

The still frames above show what actually happens in the video, in order.

Return exactly this JSON shape:

{
  "overallRisk": "low" | "medium" | "high",
  "summary": "one plain sentence — most clips should get something like 'No obvious issues found.'",
  "flags": [
    {
      "category": "FAKED_PROMOTION" | "FAKED_DANGER" | "UNDISCLOSED_AD" | "FAKE_TESTIMONIAL" | "UNVERIFIABLE_CLAIM" | "MISLEADING_RESULT",
      "severity": "low" | "medium" | "high",
      "source": "hook" | "caption" | "voiceover" | "overlay" | "visual",
      "excerpt": "the exact line flagged, or a short description of the frame/moment",
      "reason": "one plain sentence explaining the concern",
      "suggestion": "a concrete, specific way to fix or soften it"
    }
  ]
}`;
}

export default guard(async (req, apiKey) => {
  const body = await readJsonBody(req);

  const duration = Number(body.duration);
  if (!isFinite(duration) || duration <= 0) {
    return fail('A valid clip duration is required.', 400);
  }

  const parts = framesToParts(body.frames);
  if (parts.length < 2) {
    return fail('No usable frames were supplied for the policy check.', 400);
  }

  const hasContent = (body.hooks && body.hooks.length) || (body.captions && body.captions.length) ||
    (body.textOverlays && body.textOverlays.length);
  if (!hasContent) {
    return fail('There is no generated content to check yet.', 400);
  }

  const language = ['bm', 'mix', 'en'].indexOf(body.language) >= 0 ? body.language : 'bm';
  const model = resolveModel(body.model);

  const promptParts = [
    { text: buildPrompt({
      duration: Math.round(duration * 100) / 100,
      language,
      hooks: body.hooks,
      captions: body.captions,
      voiceovers: body.voiceovers,
      textOverlays: body.textOverlays
    }) },
    ...parts
  ];

  const result = await callGemini({
    apiKey,
    model,
    parts: promptParts,
    systemInstruction: SYSTEM,
    temperature: 0.2   /* a risk check should be steady and literal, not creative */
  });

  if (!result.ok) {
    return fail(result.error, result.status, {
      code: result.status === 429 ? 'quota' : undefined,
      detail: result.upstream
    });
  }

  return json({
    policyCheck: result.data,
    model,
    promptVersion: PROMPT_VERSION
  });
});

export const config = { path: '/api/gemini/policy-check' };
