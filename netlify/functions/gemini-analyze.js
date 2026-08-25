/* POST /api/gemini/analyze

   Input:  { frames:[{t,dataUrl}], duration, timeBudget, faceFree, language, model? }
   Output: { analysis: {...}, model, promptVersion }

   The browser sends extracted still frames, never the video file — a
   synchronous Netlify function caps request bodies near 6 MB while a short
   1080p clip is 15-60 MB. */

import { guard, json, fail, readJsonBody, resolveModel, framesToParts, callGemini } from './lib/gemini.mjs';

export const PROMPT_VERSION = 1;

const SYSTEM = `You are an expert short-form video editor who plans faceless TikTok product videos for a Malaysian affiliate creator. The product varies by clip — it could be a kitchen gadget, a skincare item, a fashion accessory, a phone gadget, fitness gear, anything physical sold on TikTok Shop — so judge every clip from what the frames actually show, never from an assumed category.

You will be shown still frames sampled at even intervals from ONE video, each labelled with its timestamp in seconds, plus the clip's total duration.

Your job is to produce an editing plan: divide the clip into scenes and say what each scene is FOR.

Rules you must follow:
- Scenes must cover the clip in order, must not overlap, and must stay within 0 and the stated duration.
- Judge only what you can actually see. Never invent product features, prices, brands, claims or results that the frames do not show.
- If you cannot tell what the product is, say so plainly in the description rather than guessing a specific product.
- This is faceless content. Prefer hands, the product itself, close-ups, demonstrations, before/after, and how the product actually works — the specific setting depends on the product (a countertop and ingredients for a kitchen item, a mirror and skin close-ups for skincare, a mat and reps for fitness gear, and so on). Set faceDetected true for any scene where a human face is visible.
- Scores are an editing judgement, not a prediction of views. Never claim you can predict virality.
- Reply with JSON only. No prose, no code fences.`;

function purposeList() {
  return ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'PROOF', 'RESULT', 'CTA', 'FILLER', 'REMOVE'];
}

function buildPrompt(input) {
  const budgetGuidance = {
    3: 'The creator has 3 minutes. Recommend the fewest edits that still work. Prefer KEEP. Suggest at most 2 text overlays.',
    5: 'The creator has 5 minutes. Balanced: cut obvious dead weight, mark the strongest hook, suggest a small number of overlays.',
    10: 'The creator has 10 minutes. Optimise more thoroughly: tighten weak sections and structure the payoff clearly.',
    20: 'The creator has 20 minutes. Be thorough: fine-grained scene splits and detailed recommendations are welcome.'
  }[input.timeBudget] || 'The creator has about 5 minutes. Keep recommendations proportionate.';

  const faceRule = input.faceFree === false
    ? 'Face-free mode is OFF, but still report faceDetected accurately.'
    : 'Face-free mode is ON. Flag every scene containing a visible face, and prefer editingRecommendation "TRIM" or "REMOVE" for scenes whose only content is a face.';

  return `Clip duration: ${input.duration} seconds.
Number of frames supplied: ${input.frameCount}.
${budgetGuidance}
${faceRule}

Return exactly this JSON shape:

{
  "video": {
    "duration": ${input.duration},
    "description": "one sentence describing what happens across the whole clip",
    "product": "what the product appears to be, or 'unclear' if you cannot tell",
    "category": "short category matching what the frames show, e.g. kitchen gadget, skincare, phone accessory, fitness gear"
  },
  "score": {
    "overall": 0-100,
    "hook": 0-20,
    "productClarity": 0-20,
    "demonstration": 0-20,
    "payoff": 0-20,
    "ctaPotential": 0-20
  },
  "verdict": "MAKE" | "EDIT" | "SKIP",
  "recommendedStructure": ["HOOK","DEMO","RESULT","CTA"],
  "scenes": [
    {
      "id": "s1",
      "start": 0,
      "end": 2.4,
      "description": "what is visible in this stretch",
      "purpose": one of ${JSON.stringify(purposeList())},
      "visualStrength": 1-10,
      "faceDetected": true or false,
      "voiceoverRecommended": true or false,
      "textRecommended": true or false,
      "editingRecommendation": "KEEP" | "TRIM" | "REMOVE" | "SPEED_UP" | "ZOOM",
      "reason": "one short sentence explaining the call"
    }
  ]
}

"overall" should be roughly the sum of the five sub-scores. Omit a section from recommendedStructure if the footage genuinely does not support it — never force a fake section.`;
}

export default guard(async (req, apiKey) => {
  const body = await readJsonBody(req);

  const duration = Number(body.duration);
  if (!isFinite(duration) || duration <= 0) {
    return fail('A valid clip duration is required.', 400);
  }
  if (duration > 600) {
    return fail('That clip is longer than 10 minutes. ClipForge is built for short-form clips.', 400);
  }

  const parts = framesToParts(body.frames);
  if (parts.length < 2) {
    return fail('No usable frames were supplied for analysis.', 400);
  }

  const model = resolveModel(body.model);
  const frameCount = parts.filter((p) => p.inlineData).length;

  const promptParts = [
    { text: buildPrompt({
      duration: Math.round(duration * 100) / 100,
      frameCount,
      timeBudget: Number(body.timeBudget) || 5,
      faceFree: body.faceFree !== false
    }) },
    ...parts
  ];

  const result = await callGemini({
    apiKey,
    model,
    parts: promptParts,
    systemInstruction: SYSTEM,
    temperature: 0.35   /* analysis should be steady, not creative */
  });

  if (!result.ok) {
    return fail(result.error, result.status, {
      code: result.status === 429 ? 'quota' : undefined,
      detail: result.upstream
    });
  }

  return json({
    analysis: result.data,
    model,
    promptVersion: PROMPT_VERSION
  });
});

export const config = { path: '/api/gemini/analyze' };
