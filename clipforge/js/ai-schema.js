/* ai-schema.js — validate and repair everything the model returns.

   Core application logic never runs on free-form AI text. Every response is
   coerced into a known shape here first: out-of-range numbers get clamped,
   unknown enum values get replaced, overlapping or out-of-bounds timings get
   fixed, and anything unusable is dropped rather than corrupting a project.

   Pure functions only — no DOM, no network, no storage. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var A = {};
  CF.aiSchema = A;

  A.PURPOSES = ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'PROOF', 'RESULT', 'CTA', 'FILLER', 'REMOVE'];
  A.EDITS = ['KEEP', 'TRIM', 'REMOVE', 'SPEED_UP', 'ZOOM'];
  A.VERDICTS = ['MAKE', 'EDIT', 'SKIP'];
  A.POSITIONS = ['top', 'center', 'bottom'];
  A.OVERLAY_STYLES = ['hook', 'benefit', 'proof', 'cta'];
  A.ANIMATIONS = ['none', 'fade', 'pop'];
  A.HOOK_STYLES = ['curiosity', 'painpoint', 'pov', 'unexpected', 'value'];
  A.CAPTION_STYLES = ['curiosity', 'problem', 'casual'];
  A.VOICEOVER_VARIANTS = ['short', 'medium', 'full'];

  A.MAX_OVERLAY_CHARS = 72;

  /* Purposes that carry the story. FILLER/REMOVE are what a tight edit drops. */
  A.KEEP_PURPOSES = ['HOOK', 'PROBLEM', 'DEMO', 'BENEFIT', 'PROOF', 'RESULT', 'CTA'];

  /* ------------------------------------------------------------- primitives */

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function clampNum(v, lo, hi, fallback) {
    var n = num(v, fallback);
    return U.clamp(n, lo, hi);
  }

  function str(v, max) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, ' ').trim();
    return max && s.length > max ? s.slice(0, max).trim() : s;
  }

  function oneOf(v, list, fallback) {
    var s = String(v === null || v === undefined ? '' : v).trim().toUpperCase();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]).toUpperCase() === s) return list[i];
    }
    return fallback;
  }

  function bool(v) {
    if (v === true || v === 'true' || v === 1) return true;
    return false;
  }

  /* ---------------------------------------------------------------- scenes */

  /* Force a scene list into a clean, ordered, non-overlapping timeline inside
     [0, duration]. Returns { scenes, repairs }. */
  A.repairScenes = function (rawScenes, duration) {
    var repairs = [];
    var list = Array.isArray(rawScenes) ? rawScenes : [];
    if (!list.length) return { scenes: [], repairs: ['no scenes returned'] };

    var cleaned = [];
    list.forEach(function (s, i) {
      if (!s || typeof s !== 'object') { repairs.push('dropped a non-object scene'); return; }
      var start = clampNum(s.start, 0, duration, 0);
      var end = clampNum(s.end, 0, duration, 0);
      if (end <= start) { repairs.push('dropped scene ' + (i + 1) + ' with no length'); return; }
      cleaned.push({
        id: str(s.id, 24) || 's' + (i + 1),
        start: U.round(start, 2),
        end: U.round(end, 2),
        description: str(s.description, 240) || 'No description given.',
        purpose: oneOf(s.purpose, A.PURPOSES, 'FILLER'),
        visualStrength: Math.round(clampNum(s.visualStrength, 1, 10, 5)),
        faceDetected: bool(s.faceDetected),
        voiceoverRecommended: bool(s.voiceoverRecommended),
        textRecommended: bool(s.textRecommended),
        editingRecommendation: oneOf(s.editingRecommendation, A.EDITS, 'KEEP'),
        reason: str(s.reason, 240)
      });
    });

    if (!cleaned.length) return { scenes: [], repairs: repairs.concat(['every scene was unusable']) };

    cleaned.sort(function (a, b) { return a.start - b.start; });

    /* Trim overlaps by pulling each scene's end back to the next one's start. */
    var out = [];
    for (var j = 0; j < cleaned.length; j++) {
      var cur = cleaned[j];
      var next = cleaned[j + 1];
      if (next && cur.end > next.start) {
        repairs.push('trimmed an overlap at ' + U.clock(next.start));
        cur.end = next.start;
      }
      if (cur.end - cur.start < 0.15) { repairs.push('dropped a sliver scene'); continue; }
      cur.id = 's' + (out.length + 1);
      out.push(cur);
    }

    if (out.length) {
      /* Close a leading or trailing gap so the timeline covers the whole clip. */
      if (out[0].start > 0.05) { out[0].start = 0; repairs.push('extended the first scene to 0:00'); }
      var last = out[out.length - 1];
      if (duration - last.end > 0.05) { last.end = U.round(duration, 2); repairs.push('extended the last scene to the end'); }
    }

    return { scenes: out, repairs: repairs };
  };

  /* -------------------------------------------------------------- analysis */

  A.validateAnalysis = function (raw, duration) {
    var repairs = [];
    var d = num(duration, 0);
    if (d <= 0) return { ok: false, errors: ['The clip duration is unknown, so the analysis cannot be checked.'] };
    if (!raw || typeof raw !== 'object') {
      return { ok: false, errors: ['The AI response was not an object.'] };
    }

    var sceneResult = A.repairScenes(raw.scenes, d);
    repairs = repairs.concat(sceneResult.repairs);
    if (!sceneResult.scenes.length) {
      return { ok: false, errors: ['The AI returned no usable scenes for this clip.'], repairs: repairs };
    }

    var rawVideo = raw.video && typeof raw.video === 'object' ? raw.video : {};
    var rawScore = raw.score && typeof raw.score === 'object' ? raw.score : {};

    var parts = {
      hook: Math.round(clampNum(rawScore.hook, 0, 20, 10)),
      productClarity: Math.round(clampNum(rawScore.productClarity, 0, 20, 10)),
      demonstration: Math.round(clampNum(rawScore.demonstration, 0, 20, 10)),
      payoff: Math.round(clampNum(rawScore.payoff, 0, 20, 10)),
      ctaPotential: Math.round(clampNum(rawScore.ctaPotential, 0, 20, 10))
    };
    var sum = parts.hook + parts.productClarity + parts.demonstration + parts.payoff + parts.ctaPotential;

    var overall = Math.round(clampNum(rawScore.overall, 0, 100, sum));
    /* If the stated overall disagrees badly with its own parts, trust the parts. */
    if (Math.abs(overall - sum) > 12) {
      repairs.push('overall score did not match its breakdown — recalculated');
      overall = sum;
    }

    var structure = Array.isArray(raw.recommendedStructure)
      ? raw.recommendedStructure
          .map(function (s) { return oneOf(s, A.PURPOSES, null); })
          .filter(Boolean)
      : [];
    if (!structure.length) {
      /* Fall back to the order the scenes actually imply. */
      var seen = {};
      sceneResult.scenes.forEach(function (s) {
        if (A.KEEP_PURPOSES.indexOf(s.purpose) >= 0 && !seen[s.purpose]) {
          seen[s.purpose] = true;
          structure.push(s.purpose);
        }
      });
      if (structure.length) repairs.push('rebuilt the recommended structure from the scenes');
    }

    var value = {
      video: {
        duration: U.round(d, 2),
        description: str(rawVideo.description, 300) || 'No description given.',
        product: str(rawVideo.product, 120) || 'unclear',
        category: str(rawVideo.category, 80) || 'unknown'
      },
      score: {
        overall: overall,
        hook: parts.hook,
        productClarity: parts.productClarity,
        demonstration: parts.demonstration,
        payoff: parts.payoff,
        ctaPotential: parts.ctaPotential
      },
      verdict: oneOf(raw.verdict, A.VERDICTS, overall >= 75 ? 'MAKE' : overall >= 60 ? 'EDIT' : 'SKIP'),
      recommendedStructure: structure,
      scenes: sceneResult.scenes
    };

    return { ok: true, value: value, repairs: repairs, errors: [] };
  };

  /* ------------------------------------------------------- generated copy */

  function repairTimedList(rawList, duration, opts) {
    var o = opts || {};
    var repairs = [];
    var list = Array.isArray(rawList) ? rawList : [];
    var cleaned = [];

    list.forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var text = str(item.text, o.maxChars || 300);
      if (!text) return;
      var start = clampNum(item.start, 0, duration, 0);
      var end = clampNum(item.end, 0, duration, 0);
      if (end <= start) {
        /* Give it a sensible default length rather than discarding good copy. */
        end = U.clamp(start + (o.defaultLength || 2.5), 0, duration);
        if (end <= start) return;
        repairs.push('fixed a zero-length timing');
      }
      cleaned.push({ raw: item, text: text, start: U.round(start, 2), end: U.round(end, 2) });
    });

    cleaned.sort(function (a, b) { return a.start - b.start; });

    var out = [];
    cleaned.forEach(function (c) {
      var prev = out[out.length - 1];
      if (prev && c.start < prev.end) {
        if (o.dropOverlaps) {
          repairs.push('dropped an overlapping item at ' + U.clock(c.start));
          return;
        }
        c.start = prev.end;
        if (c.end <= c.start) { repairs.push('dropped an item with no room left'); return; }
        repairs.push('shifted an overlapping item at ' + U.clock(prev.end));
      }
      out.push(c);
    });

    return { items: out, repairs: repairs };
  }

  A.validateGeneration = function (raw, duration, language) {
    var repairs = [];
    var d = num(duration, 0);
    if (d <= 0) return { ok: false, errors: ['The clip duration is unknown, so generated content cannot be checked.'] };
    if (!raw || typeof raw !== 'object') return { ok: false, errors: ['The AI response was not an object.'] };

    /* hooks */
    var hooks = (Array.isArray(raw.hooks) ? raw.hooks : [])
      .map(function (h, i) {
        if (!h || typeof h !== 'object') return null;
        var text = str(h.text, 160);
        if (!text) return null;
        return {
          id: 'h' + (i + 1),
          style: String(h.style || '').toLowerCase().replace(/[^a-z]/g, '') || A.HOOK_STYLES[i] || 'curiosity',
          text: text
        };
      })
      .filter(Boolean);
    if (hooks.length > 5) { hooks = hooks.slice(0, 5); repairs.push('kept the first 5 hooks'); }
    if (hooks.length < 5) repairs.push('only ' + hooks.length + ' usable hooks were returned');

    /* captions */
    var captions = (Array.isArray(raw.captions) ? raw.captions : [])
      .map(function (c, i) {
        if (!c || typeof c !== 'object') return null;
        var text = str(c.text, 2200);
        if (!text) return null;
        return {
          id: 'c' + (i + 1),
          style: String(c.style || '').toLowerCase().replace(/[^a-z]/g, '') || A.CAPTION_STYLES[i] || 'casual',
          text: text
        };
      })
      .filter(Boolean);
    if (captions.length > 3) { captions = captions.slice(0, 3); repairs.push('kept the first 3 captions'); }

    /* voiceovers */
    var voiceovers = {};
    var rawVo = raw.voiceovers && typeof raw.voiceovers === 'object' ? raw.voiceovers : {};
    A.VOICEOVER_VARIANTS.forEach(function (variant) {
      var v = rawVo[variant];
      var segs = v && Array.isArray(v.segments) ? v.segments : (Array.isArray(v) ? v : []);
      var res = repairTimedList(segs, d, { maxChars: 400, defaultLength: 3 });
      repairs = repairs.concat(res.repairs.map(function (r) { return variant + ' voiceover: ' + r; }));
      var segments = res.items.map(function (item) {
        var words = item.text.split(/\s+/).filter(Boolean).length;
        return {
          start: item.start,
          end: item.end,
          text: item.text,
          /* Trust the clip's own timings over the model's estimate, but keep a
             spoken-length figure so an over-long script is visible. */
          estimatedSeconds: U.round(Math.max(0.5, words / 2.6), 1)
        };
      });
      var spoken = segments.reduce(function (sum, s) { return sum + s.estimatedSeconds; }, 0);
      voiceovers[variant] = {
        segments: segments,
        totalSeconds: U.round(spoken, 1),
        fitsClip: spoken <= d + 1.5
      };
      if (segments.length && !voiceovers[variant].fitsClip) {
        repairs.push(variant + ' voiceover reads longer than the clip');
      }
    });

    /* text overlays — one message on screen at a time, so overlaps are dropped */
    var overlayRes = repairTimedList(raw.textOverlays, d, {
      maxChars: A.MAX_OVERLAY_CHARS,
      defaultLength: 2.5,
      dropOverlaps: true
    });
    repairs = repairs.concat(overlayRes.repairs.map(function (r) { return 'overlay: ' + r; }));
    var textOverlays = overlayRes.items.map(function (item, i) {
      var src = item.raw;
      return {
        id: 'o' + (i + 1),
        text: item.text,
        start: item.start,
        end: item.end,
        position: oneOf(src.position, A.POSITIONS, 'center'),
        style: oneOf(src.style, A.OVERLAY_STYLES, 'benefit'),
        animation: oneOf(src.animation, A.ANIMATIONS, 'fade')
      };
    });

    if (!hooks.length && !captions.length && !textOverlays.length) {
      return { ok: false, errors: ['The AI returned no usable content for this clip.'], repairs: repairs };
    }

    return {
      ok: true,
      value: {
        language: language || 'bm',
        hooks: hooks,
        captions: captions,
        voiceovers: voiceovers,
        textOverlays: textOverlays
      },
      repairs: repairs,
      errors: []
    };
  };

  /* ---------------------------------------------------------------- verdict */

  /* Spec §20: advisory only. These bands never claim to predict views. */
  A.verdictFor = function (overall) {
    var n = clampNum(overall, 0, 100, 0);
    if (n >= 90) return { key: 'excellent', label: 'EXCELLENT — prioritise this', tone: 'good' };
    if (n >= 75) return { key: 'worth', label: 'WORTH EDITING', tone: 'good' };
    if (n >= 60) return { key: 'needswork', label: 'NEEDS WORK', tone: 'warn' };
    return { key: 'skip', label: "DON'T WASTE TIME", tone: 'bad' };
  };

  A.SCORE_PARTS = [
    ['hook', 'Hook'],
    ['productClarity', 'Product clarity'],
    ['demonstration', 'Demonstration'],
    ['payoff', 'Payoff'],
    ['ctaPotential', 'CTA potential']
  ];

  /* -------------------------------------------------------- policy check */

  A.RISK_LEVELS = ['low', 'medium', 'high'];
  A.FLAG_CATEGORIES = [
    'FAKED_PROMOTION', 'FAKED_DANGER', 'UNDISCLOSED_AD',
    'FAKE_TESTIMONIAL', 'UNVERIFIABLE_CLAIM', 'MISLEADING_RESULT'
  ];
  A.FLAG_SOURCES = ['hook', 'caption', 'voiceover', 'overlay', 'visual'];

  A.FLAG_CATEGORY_LABEL = {
    FAKED_PROMOTION: 'Faked promotion / urgency',
    FAKED_DANGER: 'Faked or staged danger',
    UNDISCLOSED_AD: 'No paid-partnership disclosure',
    FAKE_TESTIMONIAL: 'Fake testimonial',
    UNVERIFIABLE_CLAIM: 'Unverifiable claim',
    MISLEADING_RESULT: 'Misleading result'
  };

  A.validatePolicyCheck = function (raw) {
    var repairs = [];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, errors: ['The AI response was not an object.'] };
    }

    var flags = (Array.isArray(raw.flags) ? raw.flags : [])
      .map(function (f, i) {
        if (!f || typeof f !== 'object') { repairs.push('dropped a non-object flag'); return null; }
        var excerpt = str(f.excerpt, 300);
        var reason = str(f.reason, 300);
        if (!excerpt && !reason) { repairs.push('dropped an empty flag'); return null; }
        return {
          id: 'flag' + (i + 1),
          category: oneOf(f.category, A.FLAG_CATEGORIES, 'UNVERIFIABLE_CLAIM'),
          severity: oneOf(f.severity, A.RISK_LEVELS, 'medium'),
          source: oneOf(f.source, A.FLAG_SOURCES, 'visual'),
          excerpt: excerpt || '(unspecified)',
          reason: reason || 'No explanation given.',
          suggestion: str(f.suggestion, 300)
        };
      })
      .filter(Boolean);

    var stated = oneOf(raw.overallRisk, A.RISK_LEVELS, null);
    var bySeverity = { high: 0, medium: 0, low: 0 };
    flags.forEach(function (f) { bySeverity[f.severity]++; });
    var implied = bySeverity.high ? 'high' : bySeverity.medium ? 'medium' : flags.length ? 'low' : 'low';

    /* Trust what the flags actually show over a mismatched top-line claim —
       the whole point of this check is not to be quietly over- or
       under-confident about what it found. */
    var overallRisk = stated;
    if (!overallRisk || (overallRisk === 'low' && implied !== 'low')) {
      if (overallRisk !== implied) repairs.push('overallRisk did not match its own flags — recalculated');
      overallRisk = implied;
    }

    var summary = str(raw.summary, 300) ||
      (flags.length ? flags.length + ' potential issue' + (flags.length === 1 ? '' : 's') + ' found.' : 'No obvious issues found.');

    return {
      ok: true,
      value: { overallRisk: overallRisk, summary: summary, flags: flags },
      repairs: repairs,
      errors: []
    };
  };

  A.riskBand = function (risk) {
    if (risk === 'high') return { label: 'HIGH RISK — review carefully', tone: 'bad' };
    if (risk === 'medium') return { label: 'WORTH A SECOND LOOK', tone: 'warn' };
    return { label: 'LOOKS FINE', tone: 'good' };
  };

})(window.CF);
