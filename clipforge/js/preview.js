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
    try { active.video.pause(); } catch (e) { /* ignore */ }
    try { URL.revokeObjectURL(active.url); } catch (e) { /* ignore */ }
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

    CF.db.getVideo(project.videoId).then(function (rec) {
      if (!rec || !rec.blob) {
        ui.toast('The source video is not available in this browser session.', 'err');
        return;
      }
      buildAndOpen(project, rec.blob, timeline);
    }).catch(function () {
      ui.toast('Could not open the preview.', 'err');
    });
  };

  function previewSize(project, crop) {
    /* A small on-screen canvas is plenty for "does this look right" and is
       far cheaper to draw every frame than the full 1080x1920 export size. */
    if (crop === 'none' && project.video.width && project.video.height) {
      var cap = 480 / Math.max(project.video.width, project.video.height);
      var scale = Math.min(1, cap);
      return {
        w: Math.max(2, Math.round(project.video.width * scale / 2) * 2),
        h: Math.max(2, Math.round(project.video.height * scale / 2) * 2)
      };
    }
    return { w: 270, h: 480 };
  }

  function buildAndOpen(project, blob, timeline) {
    var crop = (project.edits && project.edits.crop) || '9:16';
    var url = URL.createObjectURL(blob);
    var video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';

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
      video: video, canvas: canvas, ctx: ctx, url: url, rafId: null,
      playing: false, segIndex: 0, timeline: timeline, project: project,
      crop: crop, targetW: size.w, targetH: size.h
    };

    video.onloadedmetadata = function () {
      if (!active) return;
      seekTo(active.timeline.segments[0].sourceStart);
      drawCurrentFrame();
    };
    video.onerror = function () {
      ui.toast('This video could not be decoded for preview.', 'err');
      P.close();
    };
  }

  function seekTo(t) {
    if (!active) return;
    try { active.video.currentTime = t; } catch (e) { /* ignore */ }
  }

  function drawCurrentFrame() {
    if (!active) return;
    var seg = active.timeline.segments[active.segIndex];
    if (!seg) return;
    var current = U.clamp(active.video.currentTime, seg.sourceStart, seg.sourceEnd);
    var outputTime = seg.outStart + (current - seg.sourceStart);

    CF.exporter.drawFrame(active.ctx, active.video, active.targetW, active.targetH, active.crop);
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
    var p = active.video.play();
    if (p && p.catch) p.catch(function () { /* the tap that started this already counts as the user gesture */ });
    tick();
  }

  function pause() {
    if (!active) return;
    active.playing = false;
    try { active.video.pause(); } catch (e) { /* ignore */ }
    if (active.rafId) cancelAnimationFrame(active.rafId);
    setToggleLabel('▶ Play');
  }

  function tick() {
    if (!active || !active.playing) return;
    var seg = active.timeline.segments[active.segIndex];
    if (!seg) { pause(); return; }

    if (active.video.currentTime >= seg.sourceEnd || active.video.ended) {
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
      seekTo(next.sourceStart);
      active.video.play().catch(function () { /* ignore */ });
    }

    drawCurrentFrame();
    active.rafId = requestAnimationFrame(tick);
  }

})(window.CF);
