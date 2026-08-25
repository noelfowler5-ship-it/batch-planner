/* video-engine.js — everything that touches the actual pixels, locally.

   Nothing in this file uploads anything. It reads a File the user picked,
   measures it, and pulls still frames out of it with a <video> + <canvas>.

   Those frames are the pipeline's real output: Phase 2 sends *them* to Gemini
   rather than the video file, because a Netlify function caps request bodies
   near 6 MB while a short 1080p clip is comfortably 15-60 MB. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var engine = {};
  CF.video = engine;

  var META_TIMEOUT = 12000;
  var SEEK_TIMEOUT = 6000;

  function makeElement(url) {
    var v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.crossOrigin = 'anonymous';
    v.src = url;
    return v;
  }

  function loadMetadata(v) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Timed out reading this video. It may use a codec your browser cannot open.'));
      }, META_TIMEOUT);

      var done = function () {
        if (settled) return;
        /* Some browsers report duration as Infinity for a just-created blob URL
           until a seek forces them to finish parsing the container. */
        if (!isFinite(v.duration) || v.duration <= 0) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          duration: U.round(v.duration, 2),
          width: v.videoWidth || 0,
          height: v.videoHeight || 0
        });
      };

      v.onloadedmetadata = function () {
        if (!isFinite(v.duration) || v.duration <= 0) {
          /* Nudge it: seeking far forward makes the browser resolve the real duration. */
          try { v.currentTime = 1e6; } catch (e) { /* ignore */ }
        }
        done();
      };
      v.ondurationchange = done;
      v.onerror = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('This file could not be decoded as video.'));
      };
    });
  }

  function seekTo(v, t) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.onseeked = null;
        resolve();
      };
      /* A failed seek should skip the frame, never hang the whole extraction. */
      var timer = setTimeout(finish, SEEK_TIMEOUT);
      v.onseeked = finish;
      try {
        v.currentTime = Math.max(0, t);
      } catch (e) {
        finish();
      }
    });
  }

  function fitCanvas(canvas, width, height, maxWidth) {
    var w = width || 720;
    var h = height || 1280;
    var scale = Math.min(1, maxWidth / w);
    canvas.width = Math.max(2, Math.round(w * scale));
    canvas.height = Math.max(2, Math.round(h * scale));
    return canvas;
  }

  /* Read duration + dimensions without decoding any frames. Cheap. */
  engine.probe = function (file) {
    var url = URL.createObjectURL(file);
    var v = makeElement(url);
    return loadMetadata(v).then(function (meta) {
      URL.revokeObjectURL(url);
      v.src = '';
      return meta;
    }).catch(function (err) {
      URL.revokeObjectURL(url);
      v.src = '';
      throw err;
    });
  };

  /* One representative still, used as the project's cover image. Taken a third
     of the way in rather than at t=0, which is usually a black or blurred frame. */
  engine.thumbnail = function (file, meta) {
    var url = URL.createObjectURL(file);
    var v = makeElement(url);
    var cleanup = function () { URL.revokeObjectURL(url); v.src = ''; };

    return loadMetadata(v).then(function (m) {
      var use = meta || m;
      var canvas = fitCanvas(document.createElement('canvas'), use.width, use.height, 240);
      var at = Math.min(use.duration / 3, Math.max(0.4, use.duration * 0.1));
      return seekTo(v, at).then(function () {
        try {
          canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
          var out = canvas.toDataURL('image/jpeg', 0.7);
          cleanup();
          return out;
        } catch (e) {
          cleanup();
          return null;
        }
      });
    }).catch(function () {
      cleanup();
      return null;
    });
  };

  /* Pull evenly spaced stills. Returns [{ t, dataUrl }] ordered by time.
     onProgress(done, total) fires after each frame so the UI can move a bar. */
  engine.extractFrames = function (file, options) {
    var opts = options || {};
    var url = URL.createObjectURL(file);
    var v = makeElement(url);
    var cleanup = function () { URL.revokeObjectURL(url); v.src = ''; };

    return loadMetadata(v).then(function (meta) {
      var count = opts.count || U.framesForDuration(meta.duration);
      var times = U.sampleTimes(meta.duration, count);
      var canvas = fitCanvas(document.createElement('canvas'), meta.width, meta.height,
                             opts.maxWidth || CF.FRAME_MAX_WIDTH);
      var ctx = canvas.getContext('2d');
      var quality = opts.quality || CF.FRAME_QUALITY;
      var frames = [];

      /* Sequential, not parallel: one <video> element can only be at one
         currentTime, and parallel decode of a large file thrashes memory. */
      var chain = Promise.resolve();
      times.forEach(function (t, i) {
        chain = chain.then(function () {
          return seekTo(v, t).then(function () {
            try {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              frames.push({ t: U.round(t, 2), dataUrl: canvas.toDataURL('image/jpeg', quality) });
            } catch (e) {
              /* A frame that refuses to draw is skipped, not fatal. */
            }
            if (opts.onProgress) opts.onProgress(i + 1, times.length);
          });
        });
      });

      return chain.then(function () {
        cleanup();
        if (!frames.length) throw new Error('No frames could be read from this video.');
        return { frames: frames, meta: meta, width: canvas.width, height: canvas.height };
      });
    }).catch(function (err) {
      cleanup();
      throw err;
    });
  };

  /* Everything Phase 1 needs to know about a newly picked file, in one pass:
     metadata, a cover thumbnail, and the frame set for later AI analysis. */
  engine.ingest = function (file, options) {
    var opts = options || {};
    var report = opts.onStep || function () {};
    var out = {};

    report('probe');
    return engine.probe(file).then(function (meta) {
      out.meta = meta;
      report('thumb');
      return engine.thumbnail(file, meta);
    }).then(function (thumb) {
      out.thumb = thumb;
      report('frames');
      return engine.extractFrames(file, {
        onProgress: opts.onFrameProgress,
        count: opts.frameCount
      });
    }).then(function (res) {
      out.frames = res.frames;
      out.frameSize = { width: res.width, height: res.height };
      report('done');
      return out;
    });
  };

  /* Rough byte size of a frame set — surfaced in the UI so it is obvious how
     much would travel to Gemini once Phase 2 is wired up. */
  engine.framesBytes = function (frames) {
    return (frames || []).reduce(function (sum, f) {
      return sum + U.dataUrlBytes(f && f.dataUrl);
    }, 0);
  };

})(window.CF);
