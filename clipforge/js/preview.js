/* preview.js — a silent, in-browser playback preview of the edited video
   (cuts + overlays), so a clip can be checked before spending the real time
   it takes to render an actual export.

   Shares its drawing code with export.js (CF.exporter.drawFrame /
   drawOverlaysAt) on purpose: the preview and the real export must never be
   able to drift apart and show something different.

   This owns its own DOM and its own requestAnimationFrame loop, independent
   of the app's normal "render() replaces a tab's innerHTML" pattern — a live
   <video> mid-playback would be destroyed the instant anything else on
   screen re-rendered. Living inside a modal keeps it isolated from that,
   since nothing else calls render() on #modalRoot while a modal is open. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var ui = CF.ui;
  var P = {};
  CF.preview = P;

  var active = null; /* internal handle for the open preview, or null */

  function stopLoop() {
    if (!active) return;
    if (active.rafId) cancelAnimationFrame(active.rafId);
    Object.keys(active.videos).forEach(function (id) {
      try { active.videos[id].pause(); } catch (e) { /* ignore */ }
    });
    active.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
    active = null;
  }

  /* Safe to call any time, including when nothing is open. Wired into the
     modal's close/backdrop handling so the loop and the blob URL are always
     cleaned up, not just when Close is tapped deliberately. */
  P.close = function () {
    stopLoop();
  };

  P.isOpen = function () {
    return !!active;
  };

  P.open = function (project) {
    stopLoop();

    var timeline = CF.editor.outputTimeline(project);
    if (!timeline.segments.length) {
      ui.toast('Nothing is switched on to preview. Enable at least one scene.', 'warn');
      return;
    }

    var clipIds = [];
    timeline.segments.forEach(function (s) {
      if (clipIds.indexOf(s.clipId) < 0) clipIds.push(s.clipId);
    });
    /* clipIds are project-local clip ids (segment.clipId) — CF.db.getVideo
       needs each clip's OWN videoId, the separate IndexedDB blob record it
       points at, so look that up per clip before fetching. */
    var videoIds = clipIds.map(function (id) {
      var clip = CF.project.findClip(project, id);
      return clip && clip.videoId;
    });

    Promise.all(videoIds.map(function (vid) { return vid ? CF.db.getVideo(vid) : null; })).then(function (recs) {
      var blobs = {};
      for (var i = 0; i < clipIds.length; i++) {
        if (!recs[i] || !recs[i].blob) {
          ui.toast('The source video is not available in this browser session.', 'err');
          return;
        }
        blobs[clipIds[i]] = recs[i].blob;
      }
      buildAndOpen(project, blobs, clipIds, timeline);
    }).catch(function () {
      ui.toast('Could not open the preview.', 'err');
    });
  };

  function previewSize(project, crop) {
    /* A small on-screen canvas is plenty for "does this look right" and is
       far cheaper to draw every frame than the full 1080x1920 export size.
       Mirrors CF.exporter.targetSizeFor's choice of reference clip, scaled
       down for an on-screen preview instead of an export file. */
    var ref = project.clips && project.clips[0];
    if (crop === 'none' && ref && ref.width && ref.height) {
      var cap = 480 / Math.max(ref.width, ref.height);
      var scale = Math.min(1, cap);
      return {
        w: Math.max(2, Math.round(ref.width * scale / 2) * 2),
        h: Math.max(2, Math.round(ref.height * scale / 2) * 2)
      };
    }
    return { w: 270, h: 480 };
  }

  /* videoBlobs/videos below are keyed by clipIds — the project's own clip
     ids, matching segment.clipId — not by the IndexedDB videoId each blob
     was actually fetched with above. */
  function buildAndOpen(project, videoBlobs, clipIds, timeline) {
    var crop = (project.edits && project.edits.crop) || '9:16';
    var muted = true; /* preview is always silent, regardless of the project's mute setting */

    var urls = [];
    var videos = {};
    clipIds.forEach(function (id) {
      var url = URL.createObjectURL(videoBlobs[id]);
      urls.push(url);
      var v = document.createElement('video');
      v.src = url;
      v.muted = muted;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('muted', '');
      v.preload = 'auto';
      videos[id] = v;
    });

    var size = previewSize(project, crop);

    var h = '<div class="modal-title">Preview</div>';
    h += '<div class="preview-shell"><canvas id="previewCanvas" width="' + size.w + '" height="' + size.h + '"></canvas></div>';
    h += '<div class="bar" style="margin-top:10px"><i id="previewBar" style="width:0%"></i></div>';
    h += '<div class="row" style="gap:8px;margin-top:12px">';
    h += '<button class="btn-primary" style="flex:1" data-action="preview-toggle">▶ Play</button>';
    h += '<button class="btn-ghost" style="flex:1" data-action="close-modal">Close</button>';
    h += '</div>';
    h += '<div class="tiny faint" style="margin-top:8px">Silent preview, no sound. Otherwise exactly what will export.</div>';

    ui.openModal(h);

    var canvas = ui.$('#previewCanvas');
    var ctx = canvas.getContext('2d');

    active = {
      videos: videos, urls: urls, canvas: canvas, ctx: ctx, rafId: null,
      playing: false, segIndex: 0, timeline: timeline, project: project,
      crop: crop, targetW: size.w, targetH: size.h
    };

    Promise.all(clipIds.map(function (id) {
      return new Promise(function (res, rej) {
        videos[id].onloadedmetadata = res;
        videos[id].onerror = rej;
      });
    })).then(function () {
      if (!active) return;
      seekTo(active.timeline.segments[0].sourceStart);
      drawCurrentFrame();
    }).catch(function () {
      ui.toast('This video could not be decoded for preview.', 'err');
      P.close();
    });
  }

  function currentVideo() {
    if (!active) return null;
    var seg = active.timeline.segments[active.segIndex];
    return seg ? active.videos[seg.clipId] : null;
  }

  function seekTo(t) {
    var v = currentVideo();
    if (!v) return;
    try { v.currentTime = t; } catch (e) { /* ignore */ }
  }

  function drawCurrentFrame() {
    if (!active) return;
    var seg = active.timeline.segments[active.segIndex];
    var v = currentVideo();
    if (!seg || !v) return;
    var current = U.clamp(v.currentTime, seg.sourceStart, seg.sourceEnd);
    var outputTime = seg.outStart + (current - seg.sourceStart);

    CF.exporter.drawFrame(active.ctx, v, active.targetW, active.targetH, active.crop);
    CF.exporter.drawOverlaysAt(active.ctx, active.project, outputTime, active.targetW, active.targetH);

    var bar = ui.$('#previewBar');
    if (bar) bar.style.width = U.clamp(outputTime / active.timeline.duration * 100, 0, 100) + '%';
  }

  P.toggle = function () {
    if (!active) return;
    if (active.playing) pause(); else play();
  };

  function setToggleLabel(text) {
    var btn = document.querySelector('[data-action="preview-toggle"]');
    if (btn) btn.textContent = text;
  }

  function play() {
    if (!active) return;
    active.playing = true;
    setToggleLabel('⏸ Pause');
    var v = currentVideo();
    if (v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* the tap that started this already counts as the user gesture */ });
    }
    tick();
  }

  function pause() {
    if (!active) return;
    active.playing = false;
    var v = currentVideo();
    if (v) { try { v.pause(); } catch (e) { /* ignore */ } }
    if (active.rafId) cancelAnimationFrame(active.rafId);
    setToggleLabel('▶ Play');
  }

  function tick() {
    if (!active || !active.playing) return;
    var seg = active.timeline.segments[active.segIndex];
    var v = currentVideo();
    if (!seg || !v) { pause(); return; }

    if (v.currentTime >= seg.sourceEnd || v.ended) {
      var prevClipId = seg.clipId;
      active.segIndex++;
      var next = active.timeline.segments[active.segIndex];
      if (!next) {
        pause();
        setToggleLabel('↻ Replay');
        active.segIndex = 0;
        seekTo(active.timeline.segments[0].sourceStart);
        drawCurrentFrame();
        return;
      }
      /* Crossing into a different clip: stop the one that just finished so
         two videos are never both mid-playback at once. */
      if (next.clipId !== prevClipId) { try { v.pause(); } catch (e) { /* ignore */ } }
      seekTo(next.sourceStart);
      var nv = currentVideo();
      if (nv) nv.play().catch(function () { /* ignore */ });
    }

    drawCurrentFrame();
    active.rafId = requestAnimationFrame(tick);
  }

})(window.CF);
