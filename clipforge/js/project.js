/* project.js — the project record and the operations on it.

   A project is metadata only. The source video is never modified and never
   re-encoded here: edits are recorded as instructions against the original, so
   every change stays reversible (spec §25 / §40).

   A project holds an ordered list of CLIPS (`project.clips`), each one an
   uploaded video with its own AI scene analysis — one clip for a normal
   single-video project, two or three when several clips (unboxing, demo,
   result) are being assembled into one finished post. Content generation,
   editing and export all treat this list as one continuous "combined"
   video: P.combinedDuration/combinedFingerprint/combinedAnalysis build the
   single virtual timeline the rest of the app reasons about, and
   P.globalToLocal/localToGlobal convert between a position in that virtual
   timeline and a (clipId, time-within-that-clip) pair. Everything downstream
   — editor.js segments, export.js/preview.js rendering — is written against
   this one list; there is no separate single-clip code path to keep in
   sync. Up to CF.MAX_CLIPS clips per project, enforced in P.addClip. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var P = {};
  CF.project = P;

  P.newClip = function (fields) {
    var f = fields || {};
    return {
      id: f.id || U.uid('clip'),
      videoId: f.videoId || null,
      fingerprint: f.fingerprint || null,
      name: f.name || '',

      duration: f.duration || 0,
      width: f.width || 0,
      height: f.height || 0,
      size: f.size || 0,
      type: f.type || '',

      frameCount: f.frameCount || 0,

      /* Populated once this clip is analysed. `score` mirrors
         analysis.score.overall — kept alongside it, not derived on every
         read, since sorting/listing projects needs it cheaply and often. */
      analysis: f.analysis || null,
      score: typeof f.score === 'number' ? f.score : null
    };
  };

  /* Defensive per-field coercion for one stored clip record, mirroring
     P.normalize below. Used both when loading a project and when migrating
     a pre-multi-clip one (see P.normalize). */
  P.normalizeClip = function (c) {
    if (!c || typeof c !== 'object') return null;
    var base = P.newClip({});
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = Object.prototype.hasOwnProperty.call(c, k) ? c[k] : base[k];
    });
    out.id = c.id || base.id;
    out.duration = Number(out.duration) || 0;
    out.width = Number(out.width) || 0;
    out.height = Number(out.height) || 0;
    out.frameCount = Number(out.frameCount) || 0;
    out.score = typeof out.score === 'number' && isFinite(out.score) ? out.score : null;
    return out;
  };

  P.create = function (fields) {
    var f = fields || {};
    var now = new Date().toISOString();
    return {
      id: U.uid('proj'),
      name: f.name || 'Untitled clip',
      createdAt: now,
      updatedAt: now,

      clips: Array.isArray(f.clips) ? f.clips.map(P.newClip) : [],

      timeBudget: f.timeBudget || CF.DEFAULT_TIME_BUDGET,
      language: f.language || CF.DEFAULT_LANGUAGE,

      /* Populated by later phases. Present from the start so the shape of a
         stored project never changes underneath older records. Project-level
         because content generation always writes one combined script across
         every clip, never one per clip. */
      aiContent: null,
      aiModel: null,
      policyCheck: null,

      /* Edits are instructions against the untouched source video, never a
         re-encode of it (spec §25/§40) — so everything stays reversible. */
      edits: P.emptyEdits(),

      textOverlays: [],
      voiceovers: [],
      captions: [],
      chosenHookId: null,
      chosenVoiceover: null,

      status: 'RAW'
    };
  };

  P.emptyEdits = function () {
    return { segments: [], crop: '9:16', muted: false };
  };

  /* Fill in anything a project saved by an earlier version is missing, so an
     old record never renders as `undefined` after an update.

     A project saved before multi-clip existed has no `clips` array at all —
     just the single-video fields (videoId/fingerprint/video/frameCount/
     aiAnalysis/score) directly on the project. Migrate those into a single
     clip rather than discard them, so an old project still opens with its
     analysis intact. */
  P.normalize = function (p) {
    if (!p || typeof p !== 'object') return null;
    var base = P.create({});
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = Object.prototype.hasOwnProperty.call(p, k) ? p[k] : base[k];
    });
    out.id = p.id || base.id;

    if (Array.isArray(p.clips) && p.clips.length) {
      out.clips = p.clips.map(P.normalizeClip).filter(Boolean);
    } else if (p.videoId) {
      out.clips = [P.normalizeClip({
        videoId: p.videoId,
        fingerprint: p.fingerprint,
        name: (p.video && p.video.name) || '',
        duration: p.video && p.video.duration,
        width: p.video && p.video.width,
        height: p.video && p.video.height,
        size: p.video && p.video.size,
        type: p.video && p.video.type,
        frameCount: p.frameCount,
        analysis: p.aiAnalysis || null,
        score: typeof p.score === 'number' ? p.score : null
      })];
    } else {
      out.clips = [];
    }

    if (CF.STATUSES.indexOf(out.status) < 0) out.status = 'RAW';
    ['textOverlays', 'voiceovers', 'captions'].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = [];
    });

    /* `edits` was an array in the first release and is an object now. Migrate
       rather than discard, so a project saved before the editor existed still
       opens cleanly. */
    if (!out.edits || typeof out.edits !== 'object' || Array.isArray(out.edits)) {
      out.edits = P.emptyEdits();
    }
    if (!Array.isArray(out.edits.segments)) out.edits.segments = [];
    if (out.edits.crop !== '9:16' && out.edits.crop !== 'none') out.edits.crop = '9:16';
    out.edits.muted = out.edits.muted === true;

    /* A segment written before multi-clip has no clipId — it always meant
       "the project's one video", which after migration is clips[0]. */
    if (out.clips.length) {
      out.edits.segments.forEach(function (seg) {
        if (!seg.clipId) seg.clipId = out.clips[0].id;
      });
    }

    return out;
  };

  /* ------------------------------------------------------------- clips */

  CF.MAX_CLIPS = 3;

  P.findClip = function (project, clipId) {
    var clips = (project && project.clips) || [];
    for (var i = 0; i < clips.length; i++) {
      if (clips[i].id === clipId) return clips[i];
    }
    return null;
  };

  P.canAddClip = function (project) {
    return !!project && (project.clips || []).length < CF.MAX_CLIPS;
  };

  P.addClip = function (project, fields) {
    if (!P.canAddClip(project)) return null;
    var clip = P.newClip(fields);
    project.clips.push(clip);
    return clip;
  };

  /* Total duration across every clip, in upload order — the length of the
     one finished video this project will become. */
  P.combinedDuration = function (project) {
    return U.round((project.clips || []).reduce(function (sum, c) { return sum + (c.duration || 0); }, 0), 2);
  };

  /* One fingerprint for "this exact set of clips", so the generate/policy
     caches bust when any clip in the set changes — not just the first one. */
  P.combinedFingerprint = function (project) {
    var parts = (project.clips || []).map(function (c) { return c.fingerprint || 'nofp'; }).join('|');
    return 'combo' + U.hashString(parts);
  };

  P.isMultiClip = function (project) {
    return (project && project.clips || []).length > 1;
  };

  P.allAnalyzed = function (project) {
    var clips = (project && project.clips) || [];
    return clips.length > 0 && clips.every(function (c) { return !!c.analysis; });
  };

  /* Average of the analysed clips' scores, rounded — the one number shown
     for a multi-clip project wherever a single-clip project would show its
     own score (Projects list, sorting, Queue). Null until at least one clip
     has been analysed, same honesty as the single-clip score used to have. */
  P.combinedScore = function (project) {
    var scores = ((project && project.clips) || [])
      .map(function (c) { return c.score; })
      .filter(function (s) { return typeof s === 'number'; });
    if (!scores.length) return null;
    return Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
  };

  /* Cumulative duration before each clip, in order — offset[i] is where
     clip i starts in the combined virtual timeline. */
  P.clipOffsets = function (project) {
    var offsets = {};
    var cursor = 0;
    (project.clips || []).forEach(function (c) {
      offsets[c.id] = cursor;
      cursor += c.duration || 0;
    });
    return offsets;
  };

  /* A moment in one clip's own timeline -> where that moment sits in the
     combined virtual timeline spanning every clip. Used to describe scenes
     to the AI as one continuous video regardless of how many clips they
     actually span. */
  P.localToGlobal = function (project, clipId, localTime) {
    var offsets = P.clipOffsets(project);
    var offset = Object.prototype.hasOwnProperty.call(offsets, clipId) ? offsets[clipId] : 0;
    return U.round(offset + (localTime || 0), 2);
  };

  /* The inverse: a position in the combined virtual timeline -> which clip
     it falls in and the local time within that clip. Used when the AI's
     response (written in combined/global time) needs to be matched back
     against one clip's own segments. Clamps into the nearest clip rather
     than returning null, since a global time is always meant to land
     somewhere in a non-empty clip list. */
  P.globalToLocal = function (project, globalTime) {
    var clips = project.clips || [];
    if (!clips.length) return null;
    var offsets = P.clipOffsets(project);
    var t = Math.max(0, globalTime || 0);
    for (var i = 0; i < clips.length; i++) {
      var start = offsets[clips[i].id];
      var end = start + (clips[i].duration || 0);
      if (t >= start && t <= end) return { clipId: clips[i].id, localTime: U.round(t - start, 2) };
    }
    var last = clips[clips.length - 1];
    return { clipId: last.id, localTime: last.duration || 0 };
  };

  /* One virtual "scene analysis" spanning every clip, scene times converted
     to combined/global time — what content generation and the policy check
     are shown instead of a single clip's analysis. Each scene's description
     is prefixed with which clip it came from when there is more than one,
     so the AI understands it is looking at a multi-shot sequence rather
     than one continuous take. */
  P.combinedAnalysis = function (project) {
    var clips = project.clips || [];
    var multi = clips.length > 1;
    var scenes = [];
    var products = [];
    var descriptions = [];

    clips.forEach(function (c, i) {
      var a = c.analysis;
      if (!a) return;
      if (a.video && a.video.product && products.indexOf(a.video.product) < 0) products.push(a.video.product);
      if (a.video && a.video.description) {
        descriptions.push(multi ? 'Clip ' + (i + 1) + ' (' + (c.name || 'clip') + '): ' + a.video.description
                                 : a.video.description);
      }
      (a.scenes || []).forEach(function (s) {
        scenes.push({
          start: P.localToGlobal(project, c.id, s.start),
          end: P.localToGlobal(project, c.id, s.end),
          purpose: s.purpose,
          description: multi ? 'Clip ' + (i + 1) + ': ' + s.description : s.description,
          voiceoverRecommended: s.voiceoverRecommended,
          textRecommended: s.textRecommended
        });
      });
    });

    return {
      scenes: scenes,
      video: { product: products.join(' / '), description: descriptions.join(' ') }
    };
  };

  /* A sensible default name from the filename: "chopper_final_v2.MP4" -> "Chopper final v2" */
  P.nameFromFile = function (file) {
    var raw = (file && file.name) || '';
    var base = raw.replace(/\.[a-z0-9]+$/i, '');
    base = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return 'Untitled clip';
    base = base.charAt(0).toUpperCase() + base.slice(1);
    return base.length > 60 ? base.slice(0, 60).trim() : base;
  };

  P.setStatus = function (project, status) {
    if (CF.STATUSES.indexOf(status) < 0) return project;
    project.status = status;
    return project;
  };

  P.nextStatus = function (status) {
    var i = CF.STATUSES.indexOf(status);
    if (i < 0 || i >= CF.STATUSES.length - 1) return null;
    return CF.STATUSES[i + 1];
  };

  /* Group projects by workflow status for the Queue screen, in pipeline order. */
  P.groupByStatus = function (projects) {
    var groups = {};
    CF.STATUSES.forEach(function (s) { groups[s] = []; });
    (projects || []).forEach(function (p) {
      var s = (p && CF.STATUSES.indexOf(p.status) >= 0) ? p.status : 'RAW';
      groups[s].push(p);
    });
    return groups;
  };

  /* Phase 1 has no AI, so "readiness" is purely about what exists locally.
     Returns the honest next action rather than pretending a score exists. */
  P.nextAction = function (project) {
    if (!project) return null;
    var clips = project.clips || [];
    if (!clips.length || !clips[0].videoId) return { label: 'Video file missing', tone: 'bad' };
    if (project.status === 'POSTED') return { label: 'Done — posted', tone: 'muted' };
    if (!clips.every(function (c) { return c.frameCount; })) return { label: 'Frames not extracted', tone: 'warn' };
    if (!P.allAnalyzed(project)) return { label: 'Ready for AI analysis', tone: 'accent' };
    return { label: 'Ready to edit', tone: 'accent' };
  };

  P.summaryLine = function (project) {
    if (!project) return '';
    var clips = project.clips || [];
    var bits = [];
    var duration = P.combinedDuration(project);
    if (duration) bits.push(U.clock(duration));
    if (clips.length > 1) bits.push(clips.length + ' clips');
    if (clips[0] && clips[0].width) {
      bits.push(U.aspectLabel(clips[0].width, clips[0].height));
    }
    var frames = clips.reduce(function (sum, c) { return sum + (c.frameCount || 0); }, 0);
    if (frames) bits.push(frames + ' frames');
    bits.push(project.timeBudget + ' min');
    return bits.join(' · ');
  };

})(window.CF);
