/* editor.js — the edit model.

   The source video is never touched. Every edit is an instruction recorded
   against it, which is what makes undo trivial and export reproducible.

   Two timelines matter and mixing them up is the classic bug here:
     • SOURCE time — where something sits in the original file. The AI speaks
       in source time, because that is what it was shown.
     • OUTPUT time — where it lands in the finished video, after disabled
       segments are dropped and the rest are reordered.

   Overlays are stored in OUTPUT time, so they stay glued to the right moment
   when a segment before them is cut. sourceToOutput() does the conversion. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var E = {};
  CF.editor = E;

  var MAX_HISTORY = 40;
  var MIN_SEGMENT = 0.25;

  /* history is runtime-only: undo does not need to survive a page reload, and
     keeping it out of storage keeps project records small. */
  var history = {};   /* projectId -> { past: [], future: [] } */

  function laneFor(projectId) {
    if (!history[projectId]) history[projectId] = { past: [], future: [] };
    return history[projectId];
  }

  function snapshot(project) {
    return JSON.stringify({
      edits: project.edits,
      textOverlays: project.textOverlays
    });
  }

  function restore(project, snap) {
    var parsed = JSON.parse(snap);
    project.edits = parsed.edits;
    project.textOverlays = parsed.textOverlays;
  }

  /* Call before any mutation you want to be undoable. */
  E.mark = function (project) {
    var lane = laneFor(project.id);
    lane.past.push(snapshot(project));
    if (lane.past.length > MAX_HISTORY) lane.past.shift();
    lane.future.length = 0;
  };

  E.canUndo = function (project) { return laneFor(project.id).past.length > 0; };
  E.canRedo = function (project) { return laneFor(project.id).future.length > 0; };

  E.undo = function (project) {
    var lane = laneFor(project.id);
    if (!lane.past.length) return false;
    lane.future.push(snapshot(project));
    restore(project, lane.past.pop());
    return true;
  };

  E.redo = function (project) {
    var lane = laneFor(project.id);
    if (!lane.future.length) return false;
    lane.past.push(snapshot(project));
    restore(project, lane.future.pop());
    return true;
  };

  E.clearHistory = function (projectId) { delete history[projectId]; };

  /* ------------------------------------------------------------- segments */

  /* clipId identifies which of the project's clips this segment cuts —
     sourceStart/sourceEnd are always LOCAL to that one clip, never a
     position in the combined multi-clip timeline. See project.js's header
     comment for how the two timelines relate. */
  E.newSegment = function (clipId, start, end, extra) {
    return Object.assign({
      id: U.uid('seg'),
      clipId: clipId,
      sourceStart: U.round(start, 2),
      sourceEnd: U.round(end, 2),
      enabled: true,
      purpose: null,
      label: ''
    }, extra || {});
  };

  /* Build the initial cut across every clip, in clip order. A clip with an
     analysis gets one segment per scene, REMOVE-flagged ones switched off;
     a clip with none yet gets a single full-length segment. Concatenating
     per-clip segment lists is all multi-clip needs here — E.outputTimeline
     below turns "an ordered list of cuts, some from different clips" into
     one continuous finished video without caring which clip any of them
     came from. */
  E.buildSegments = function (project) {
    var segments = [];
    (project.clips || []).forEach(function (clip) {
      var scenes = (clip.analysis && clip.analysis.scenes) || [];
      if (!scenes.length) {
        if (clip.duration > 0) {
          segments.push(E.newSegment(clip.id, 0, clip.duration, { label: clip.name || 'Full clip' }));
        }
        return;
      }
      scenes.forEach(function (s) {
        segments.push(E.newSegment(clip.id, s.start, s.end, {
          purpose: s.purpose,
          label: s.purpose,
          enabled: s.editingRecommendation !== 'REMOVE' && s.purpose !== 'REMOVE'
        }));
      });
    });
    return segments;
  };

  E.ensureSegments = function (project) {
    if (!project.edits) project.edits = CF.project.emptyEdits();
    if (!project.edits.segments || !project.edits.segments.length) {
      project.edits.segments = E.buildSegments(project);
    }
    return project.edits.segments;
  };

  E.find = function (project, segmentId) {
    var segs = (project.edits && project.edits.segments) || [];
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].id === segmentId) return { segment: segs[i], index: i };
    }
    return null;
  };

  E.toggleSegment = function (project, segmentId) {
    var hit = E.find(project, segmentId);
    if (!hit) return false;
    /* Refuse to switch off the last enabled segment — an empty export is not
       a useful state to land in silently. */
    if (hit.segment.enabled && E.enabledSegments(project).length <= 1) return false;
    E.mark(project);
    hit.segment.enabled = !hit.segment.enabled;
    return true;
  };

  E.moveSegment = function (project, segmentId, direction) {
    var segs = project.edits.segments;
    var hit = E.find(project, segmentId);
    if (!hit) return false;
    var target = hit.index + (direction < 0 ? -1 : 1);
    if (target < 0 || target >= segs.length) return false;
    E.mark(project);
    var moved = segs.splice(hit.index, 1)[0];
    segs.splice(target, 0, moved);
    return true;
  };

  E.deleteSegment = function (project, segmentId) {
    var segs = project.edits.segments;
    var hit = E.find(project, segmentId);
    if (!hit) return false;
    if (segs.length <= 1) return false;
    E.mark(project);
    segs.splice(hit.index, 1);
    return true;
  };

  /* Split at a SOURCE timestamp inside the segment. */
  E.splitSegment = function (project, segmentId, atSourceTime) {
    var hit = E.find(project, segmentId);
    if (!hit) return false;
    var seg = hit.segment;
    var at = U.round(atSourceTime, 2);
    if (at - seg.sourceStart < MIN_SEGMENT || seg.sourceEnd - at < MIN_SEGMENT) return false;

    E.mark(project);
    var tail = E.newSegment(seg.clipId, at, seg.sourceEnd, {
      purpose: seg.purpose,
      label: seg.label,
      enabled: seg.enabled
    });
    seg.sourceEnd = at;
    project.edits.segments.splice(hit.index + 1, 0, tail);
    return true;
  };

  /* Trim one edge. `edge` is 'start' or 'end'; delta is in seconds. */
  E.trimSegment = function (project, segmentId, edge, delta) {
    var hit = E.find(project, segmentId);
    if (!hit) return false;
    var seg = hit.segment;
    var clip = CF.project.findClip(project, seg.clipId);
    var duration = (clip && clip.duration) || 0;

    var nextStart = seg.sourceStart;
    var nextEnd = seg.sourceEnd;

    if (edge === 'start') nextStart = U.round(U.clamp(seg.sourceStart + delta, 0, duration), 2);
    else nextEnd = U.round(U.clamp(seg.sourceEnd + delta, 0, duration), 2);

    if (nextEnd - nextStart < MIN_SEGMENT) return false;

    E.mark(project);
    seg.sourceStart = nextStart;
    seg.sourceEnd = nextEnd;
    return true;
  };

  E.setCrop = function (project, crop) {
    if (crop !== '9:16' && crop !== 'none') return false;
    if (project.edits.crop === crop) return false;
    E.mark(project);
    project.edits.crop = crop;
    return true;
  };

  E.toggleMute = function (project) {
    E.mark(project);
    project.edits.muted = !project.edits.muted;
    return true;
  };

  E.resetToAi = function (project) {
    E.mark(project);
    project.edits.segments = E.buildSegments(project);
    return true;
  };

  /* -------------------------------------------------------------- timeline */

  E.enabledSegments = function (project) {
    return ((project.edits && project.edits.segments) || []).filter(function (s) {
      return s.enabled && s.sourceEnd > s.sourceStart;
    });
  };

  /* Segments with their position in the finished video worked out. Ordering
     is purely "walk the enabled segments in array order" — a segment from
     clip 2 sitting after one from clip 1 lands right after it in the output
     with no gap, exactly like a cut within a single clip would. This is the
     whole trick that makes multi-clip work without a special case here. */
  E.outputTimeline = function (project) {
    var out = [];
    var cursor = 0;
    E.enabledSegments(project).forEach(function (s) {
      var length = s.sourceEnd - s.sourceStart;
      out.push({
        id: s.id,
        clipId: s.clipId,
        sourceStart: s.sourceStart,
        sourceEnd: s.sourceEnd,
        outStart: U.round(cursor, 3),
        outEnd: U.round(cursor + length, 3),
        length: U.round(length, 3),
        purpose: s.purpose,
        label: s.label
      });
      cursor += length;
    });
    return { segments: out, duration: U.round(cursor, 2) };
  };

  E.outputDuration = function (project) {
    return E.outputTimeline(project).duration;
  };

  /* Where a (clip, source timestamp) ends up in the finished video, or null
     if that moment was cut. clipId matters: two different clips can share
     the same local timestamp range (both may have a scene at "0s-3s"), so
     time alone is not enough to find the right segment once there is more
     than one clip. Used when applying AI suggestions, which arrive in
     source time but must be stored in output time. */
  E.sourceToOutput = function (project, clipId, sourceTime) {
    var tl = E.outputTimeline(project);
    for (var i = 0; i < tl.segments.length; i++) {
      var s = tl.segments[i];
      if (s.clipId === clipId && sourceTime >= s.sourceStart && sourceTime <= s.sourceEnd) {
        return U.round(s.outStart + (sourceTime - s.sourceStart), 2);
      }
    }
    return null;
  };

  /* Nearest surviving output time within the SAME clip — used so an overlay
     whose exact moment was cut still lands somewhere sensible instead of
     being silently dropped. Never crosses into another clip's segments:
     "nearest" only means something within the footage the AI was actually
     describing. */
  E.sourceToOutputNearest = function (project, clipId, sourceTime) {
    var exact = E.sourceToOutput(project, clipId, sourceTime);
    if (exact !== null) return exact;
    var tl = E.outputTimeline(project);
    var own = tl.segments.filter(function (s) { return s.clipId === clipId; });
    if (!own.length) return null;
    var best = null;
    var bestGap = Infinity;
    own.forEach(function (s) {
      var gap = sourceTime < s.sourceStart ? s.sourceStart - sourceTime : sourceTime - s.sourceEnd;
      if (gap < bestGap) {
        bestGap = gap;
        best = sourceTime < s.sourceStart ? s.outStart : s.outEnd;
      }
    });
    return best === null ? null : U.round(best, 2);
  };

  /* AI-facing convenience: the AI describes moments in the combined/global
     timeline spanning every clip (see project.js), never in one clip's own
     time. This converts a global time straight to an output time in one
     step, so callers never need to juggle both conversions themselves. */
  E.globalToOutputNearest = function (project, globalTime) {
    var loc = CF.project.globalToLocal(project, globalTime);
    if (!loc) return null;
    return E.sourceToOutputNearest(project, loc.clipId, loc.localTime);
  };

  /* -------------------------------------------------------------- overlays */

  E.newOverlay = function (fields) {
    var f = fields || {};
    return {
      id: U.uid('ov'),
      text: String(f.text || '').slice(0, CF.aiSchema.MAX_OVERLAY_CHARS),
      start: U.round(f.start || 0, 2),
      end: U.round(f.end || 2.5, 2),
      position: CF.aiSchema.POSITIONS.indexOf(f.position) >= 0 ? f.position : 'center',
      style: CF.aiSchema.OVERLAY_STYLES.indexOf(f.style) >= 0 ? f.style : 'benefit',
      animation: CF.aiSchema.ANIMATIONS.indexOf(f.animation) >= 0 ? f.animation : 'fade',
      source: f.source || 'manual'
    };
  };

  E.addOverlay = function (project, fields) {
    var outDuration = E.outputDuration(project);
    var overlay = E.newOverlay(fields);
    overlay.start = U.clamp(overlay.start, 0, Math.max(0, outDuration - 0.4));
    overlay.end = U.clamp(overlay.end, overlay.start + 0.4, outDuration || overlay.start + 0.4);
    if (!overlay.text) return null;
    E.mark(project);
    project.textOverlays.push(overlay);
    E.sortOverlays(project);
    return overlay;
  };

  E.removeOverlay = function (project, overlayId) {
    var before = project.textOverlays.length;
    E.mark(project);
    project.textOverlays = project.textOverlays.filter(function (o) { return o.id !== overlayId; });
    return project.textOverlays.length !== before;
  };

  /* Wipe every overlay in one step. Exists so the same clip can be tried with
     a different batch of AI-suggested text without deleting the old ones one
     at a time first — clear, then reapply from the Plan tab. */
  E.clearOverlays = function (project) {
    if (!project.textOverlays.length) return false;
    E.mark(project);
    project.textOverlays = [];
    return true;
  };

  /* A hook is a single choice, not a growing list — tapping "Put on video" on
     a second hook should replace the first attempt at the start of the clip,
     not stack a second overlay on top of it at the same 0-2.5s spot. Inlines
     addOverlay's clamping rather than calling it, so the remove+add reads as
     one undo step instead of two. */
  E.setHookOverlay = function (project, fields) {
    var outDuration = E.outputDuration(project);
    var overlay = E.newOverlay(fields);
    overlay.style = 'hook';
    overlay.start = U.clamp(overlay.start, 0, Math.max(0, outDuration - 0.4));
    overlay.end = U.clamp(overlay.end, overlay.start + 0.4, outDuration || overlay.start + 0.4);
    if (!overlay.text) return null;

    E.mark(project);
    project.textOverlays = project.textOverlays.filter(function (o) { return o.style !== 'hook'; });
    project.textOverlays.push(overlay);
    E.sortOverlays(project);
    return overlay;
  };

  E.updateOverlay = function (project, overlayId, changes) {
    var found = null;
    project.textOverlays.forEach(function (o) { if (o.id === overlayId) found = o; });
    if (!found) return false;
    E.mark(project);
    if (typeof changes.text === 'string') found.text = changes.text.slice(0, CF.aiSchema.MAX_OVERLAY_CHARS);
    if (CF.aiSchema.POSITIONS.indexOf(changes.position) >= 0) found.position = changes.position;
    if (CF.aiSchema.OVERLAY_STYLES.indexOf(changes.style) >= 0) found.style = changes.style;
    if (typeof changes.start === 'number' || typeof changes.end === 'number') {
      var outDuration = E.outputDuration(project);
      var start = typeof changes.start === 'number' ? changes.start : found.start;
      var end = typeof changes.end === 'number' ? changes.end : found.end;
      start = U.clamp(U.round(start, 2), 0, Math.max(0, outDuration - 0.4));
      end = U.clamp(U.round(end, 2), start + 0.4, outDuration || start + 0.4);
      found.start = start;
      found.end = end;
    }
    E.sortOverlays(project);
    return true;
  };

  E.sortOverlays = function (project) {
    project.textOverlays.sort(function (a, b) { return a.start - b.start; });
  };

  E.overlaysAt = function (project, outputTime) {
    return (project.textOverlays || []).filter(function (o) {
      return outputTime >= o.start && outputTime < o.end;
    });
  };

  /* Overlays are meant to be one-at-a-time. Report clashes rather than
     silently rewriting what the user typed. */
  E.overlapWarnings = function (project) {
    var list = (project.textOverlays || []).slice().sort(function (a, b) { return a.start - b.start; });
    var warnings = [];
    for (var i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end) {
        warnings.push('“' + list[i - 1].text + '” and “' + list[i].text + '” are on screen at the same time.');
      }
    }
    return warnings;
  };

  /* ------------------------------------------------------- applying the AI */

  /* Convert one AI overlay (combined/global time) into a stored overlay
     (output time). */
  E.applyAiOverlay = function (project, aiOverlay) {
    var start = E.globalToOutputNearest(project, aiOverlay.start);
    if (start === null) return null;
    var length = Math.max(0.6, aiOverlay.end - aiOverlay.start);
    return E.addOverlay(project, {
      text: aiOverlay.text,
      start: start,
      end: start + length,
      position: aiOverlay.position,
      style: aiOverlay.style,
      animation: aiOverlay.animation,
      source: 'ai'
    });
  };

  E.hasOverlayText = function (project, text) {
    return (project.textOverlays || []).some(function (o) {
      return o.text.trim().toLowerCase() === String(text || '').trim().toLowerCase();
    });
  };

  /* "Apply all" — only safe, reversible things: switch off REMOVE scenes and
     add the AI's overlays. It never deletes a segment or touches the source. */
  E.applyAllSafe = function (project) {
    var applied = { segmentsDisabled: 0, overlaysAdded: 0 };
    E.mark(project);

    E.ensureSegments(project);
    /* Keyed by clip + start + end, not just start/end: two different clips
       can each have a scene at "0s-3s", and matching on time alone would
       risk disabling a segment because of the WRONG clip's REMOVE flag. */
    var byClipAndSpan = {};
    (project.clips || []).forEach(function (clip) {
      ((clip.analysis && clip.analysis.scenes) || []).forEach(function (s) {
        byClipAndSpan[clip.id + ':' + s.start + ':' + s.end] = s;
      });
    });

    project.edits.segments.forEach(function (seg) {
      var scene = byClipAndSpan[seg.clipId + ':' + seg.sourceStart + ':' + seg.sourceEnd];
      if (scene && (scene.editingRecommendation === 'REMOVE' || scene.purpose === 'REMOVE') && seg.enabled) {
        if (E.enabledSegments(project).length > 1) {
          seg.enabled = false;
          applied.segmentsDisabled++;
        }
      }
    });

    var aiOverlays = (project.aiContent && project.aiContent.textOverlays) || [];
    aiOverlays.forEach(function (o) {
      if (E.hasOverlayText(project, o.text)) return;
      var start = E.globalToOutputNearest(project, o.start);
      if (start === null) return;
      var length = Math.max(0.6, o.end - o.start);
      var overlay = E.newOverlay({
        text: o.text, start: start, end: start + length,
        position: o.position, style: o.style, animation: o.animation, source: 'ai'
      });
      var outDuration = E.outputDuration(project);
      overlay.start = U.clamp(overlay.start, 0, Math.max(0, outDuration - 0.4));
      overlay.end = U.clamp(overlay.end, overlay.start + 0.4, outDuration || overlay.start + 0.4);
      project.textOverlays.push(overlay);
      applied.overlaysAdded++;
    });
    E.sortOverlays(project);

    return applied;
  };

})(window.CF);
