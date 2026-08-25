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

  /* Safari (notably iOS) can fire `seeked` before the frame it seeked to has
     actually been decoded and presented — drawImage right after that event
     reads a stale or blank canvas.

     requestVideoFrameCallback is the only API that says "a new frame is now
     available to draw", which is exactly the question being asked here.
     readyState is NOT a substitute: it stays at HAVE_ENOUGH_DATA straight
     through a seek, so polling it answers nothing. Where rVFC is missing,
     two animation frames is the honest best-effort fallback. */
  function waitForNextFrame(v) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      var timer = setTimeout(finish, 400);

      if (typeof v.requestVideoFrameCallback === 'function') {
        try {
          v.requestVideoFrameCallback(function () { finish(); });
          return;
        } catch (e) { /* fall through to the rAF path */ }
      }
      requestAnimationFrame(function () { requestAnimationFrame(finish); });
    });
  }

  /* Brightest pixel in a coarse sample of the canvas.

     Used to catch the failure this whole file exists to avoid: frames that
     decode "successfully" but come out solid black. Max luma, not mean —
     genuinely dark footage still contains highlights, so mean would flag a
     night shot as broken while max only fires when there is nothing there
     at all. Returns null when the canvas cannot be read, which means
     "unknown", never "black". */
  /* Pure half, exposed so it can be tested against known pixels without a
     real canvas. Takes RGBA bytes, returns null for "nothing to measure". */
  engine.peakLumaFrom = function (data) {
    if (!data || !data.length) return null;
    var peak = 0;
    /* Step over whole pixels, ~2000 samples max: enough to spot any real
       image, cheap enough to run on every frame on a phone. */
    var stride = Math.max(4, Math.floor(data.length / 4 / 2000) * 4);
    for (var i = 0; i < data.length; i += stride) {
      var luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (luma > peak) peak = luma;
    }
    return peak;
  };

  function peakLuma(ctx, w, h) {
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    try {
      return engine.peakLumaFrom(ctx.getImageData(0, 0, w, h).data);
    } catch (e) {
      return null;   // tainted canvas, or no pixels available
    }
  }

  /* Below this, a frame has no visible content at all (0-255 scale). */
  var BLACK_PEAK = 12;
  engine.BLACK_PEAK = BLACK_PEAK;

  function seekTo(v, t) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.onseeked = null;
        waitForNextFrame(v).then(resolve);
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

  /* iOS Safari has been seen to never actually start decoding a freshly
     loaded <video> — every subsequent seek reports "seeked" but the canvas
     stays black — until playback has run at least once. A muted play()
     immediately followed by pause() forces the decoder to initialize
     without ever visibly playing anything, and is a no-op cost on browsers
     that did not need it. */
  function primeDecoder(v) {
    return new Promise(function (resolve) {
      if (v.readyState >= 2) return resolve();
      var settled = false;
      var timer = setTimeout(finish, 2000);
      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { v.pause(); } catch (e) { /* ignore */ }
        resolve();
      }
      v.addEventListener('canplay', finish, { once: true });
      v.addEventListener('loadeddata', finish, { once: true });
      try {
        var p = v.play();
        if (p && typeof p.catch === 'function') p.catch(function () { /* autoplay refused, still fine */ });
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
      return primeDecoder(v).then(function () { return seekTo(v, at); }).then(function () {
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
      var chain = primeDecoder(v);
      var blackCount = 0;
      var measured = 0;
      times.forEach(function (t, i) {
        chain = chain.then(function () {
          return seekTo(v, t).then(function () {
            try {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              var peak = peakLuma(ctx, canvas.width, canvas.height);
              if (peak !== null) {
                measured++;
                if (peak < BLACK_PEAK) blackCount++;
              }
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
        return {
          frames: frames,
          meta: meta,
          width: canvas.width,
          height: canvas.height,
          /* Reported, not thrown: the caller decides what to do about it.
             `allBlack` stays false when nothing could be measured, so an
             unreadable canvas never masquerades as a black video. */
          blackFrames: blackCount,
          measuredFrames: measured,
          allBlack: measured > 0 && blackCount === measured
        };
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
      out.blackFrames = res.blackFrames;
      out.measuredFrames = res.measuredFrames;
      out.allBlack = res.allBlack;
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
