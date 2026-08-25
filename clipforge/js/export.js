/* export.js — render the edit to a finished video file, in the browser.

   Approach: draw every enabled segment onto a 1080x1920 canvas in output
   order, burning in the text overlays, and record that canvas with
   MediaRecorder while the source audio is piped through a WebAudio graph.

   Why not ffmpeg.wasm as the primary path: it is a ~30 MB download, its fast
   core needs COOP/COEP headers that would block other resources, and burning
   styled text through it means shipping fonts into the wasm filesystem.
   MediaRecorder is native, needs no download, and handles trim, reorder, crop
   and overlays in one pass with identical drawing code to the live preview.

   The trade-off, stated plainly in the UI: rendering runs in real time (a 30
   second video takes about 30 seconds), and most browsers record WebM rather
   than MP4. ffmpeg.wasm is loaded on demand purely to convert WebM to MP4 for
   the browsers that need it. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var X = {};
  CF.exporter = X;

  X.TARGET_WIDTH = 1080;
  X.TARGET_HEIGHT = 1920;
  X.FPS = 30;

  /* Overlay colours per style. Kept here so the preview and the exported file
     cannot drift apart. */
  var STYLE_COLORS = {
    hook: { fill: '#ffffff', box: 'rgba(255,92,57,0.92)' },
    benefit: { fill: '#1a0d08', box: 'rgba(255,214,102,0.95)' },
    proof: { fill: '#ffffff', box: 'rgba(24,24,28,0.85)' },
    cta: { fill: '#0d1a12', box: 'rgba(90,230,160,0.95)' }
  };

  /* ------------------------------------------------------------ capability */

  X.pickMimeType = function () {
    if (typeof MediaRecorder === 'undefined') return null;
    var candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
      } catch (e) { /* keep looking */ }
    }
    return null;
  };

  X.support = function () {
    var reasons = [];
    if (typeof MediaRecorder === 'undefined') reasons.push('This browser has no MediaRecorder, so it cannot render video.');
    var canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (canvas && typeof canvas.captureStream !== 'function') reasons.push('This browser cannot capture a canvas stream.');
    var mime = X.pickMimeType();
    if (!mime && !reasons.length) reasons.push('This browser offers no video format MediaRecorder can write.');
    return {
      ok: reasons.length === 0,
      reasons: reasons,
      mimeType: mime,
      isMp4: !!(mime && mime.indexOf('mp4') === 0)
    };
  };

  X.extensionFor = function (mimeType) {
    return mimeType && mimeType.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
  };

  X.fileName = function (project, extension) {
    var base = String(project && project.name || 'clipforge')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'clipforge';
    return base + '.' + (extension || 'mp4');
  };

  /* --------------------------------------------------------------- drawing */

  /* Cover-fit the source frame into the target box, cropping the overflow —
     the same transform TikTok applies, done once here so it is predictable. */
  function drawFrame(ctx, video, targetW, targetH, crop) {
    var vw = video.videoWidth || targetW;
    var vh = video.videoHeight || targetH;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, targetW, targetH);

    var scale;
    if (crop === 'none') {
      scale = Math.min(targetW / vw, targetH / vh);   /* letterbox, nothing lost */
    } else {
      scale = Math.max(targetW / vw, targetH / vh);   /* fill 9:16, crop edges */
    }
    var dw = vw * scale;
    var dh = vh * scale;
    ctx.drawImage(video, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);
  }

  function wrapLines(ctx, text, maxWidth) {
    var words = String(text || '').split(/\s+/).filter(Boolean);
    var lines = [];
    var line = '';
    words.forEach(function (word) {
      var attempt = line ? line + ' ' + word : word;
      if (ctx.measureText(attempt).width <= maxWidth || !line) {
        line = attempt;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 3);
  }

  /* progress is 0..1 through the overlay's own lifetime, used for fade/pop. */
  X.drawOverlay = function (ctx, overlay, width, height, progress) {
    var colors = STYLE_COLORS[overlay.style] || STYLE_COLORS.benefit;

    var alpha = 1;
    var scale = 1;
    var IN = 0.18;
    if (overlay.animation === 'fade') {
      if (progress < IN) alpha = progress / IN;
      else if (progress > 1 - IN) alpha = Math.max(0, (1 - progress) / IN);
    } else if (overlay.animation === 'pop') {
      if (progress < IN) {
        var p = progress / IN;
        alpha = p;
        scale = 0.86 + 0.14 * p;
      } else if (progress > 1 - IN) {
        alpha = Math.max(0, (1 - progress) / IN);
      }
    }
    if (alpha <= 0) return;

    var fontSize = Math.round(width * 0.062);
    var pad = Math.round(width * 0.032);
    var maxTextWidth = width * 0.82 - pad * 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
    ctx.font = '700 ' + fontSize + 'px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var lines = wrapLines(ctx, overlay.text, maxTextWidth);
    var lineHeight = Math.round(fontSize * 1.24);
    var blockHeight = lines.length * lineHeight + pad * 2;

    var widest = 0;
    lines.forEach(function (l) {
      widest = Math.max(widest, ctx.measureText(l).width);
    });
    var boxWidth = Math.min(width * 0.9, widest + pad * 2);

    var centerY;
    if (overlay.position === 'top') centerY = height * 0.17;
    else if (overlay.position === 'bottom') centerY = height * 0.8;
    else centerY = height * 0.5;

    ctx.translate(width / 2, centerY);
    ctx.scale(scale, scale);

    var radius = Math.round(fontSize * 0.35);
    var bx = -boxWidth / 2;
    var by = -blockHeight / 2;
    ctx.fillStyle = colors.box;
    roundRect(ctx, bx, by, boxWidth, blockHeight, radius);
    ctx.fill();

    ctx.fillStyle = colors.fill;
    var firstLineY = by + pad + lineHeight / 2;
    lines.forEach(function (l, i) {
      ctx.fillText(l, 0, firstLineY + i * lineHeight);
    });

    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  X.drawOverlaysAt = function (ctx, project, outputTime, width, height) {
    CF.editor.overlaysAt(project, outputTime).forEach(function (o) {
      var span = Math.max(0.001, o.end - o.start);
      X.drawOverlay(ctx, o, width, height, (outputTime - o.start) / span);
    });
  };

  /* ---------------------------------------------------------------- render */

  function seek(video, time) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        resolve();
      };
      var timer = setTimeout(finish, 5000);
      video.addEventListener('seeked', finish);
      try { video.currentTime = time; } catch (e) { finish(); }
    });
  }

  /* opts: { onProgress(fraction, label), signal:{cancelled:bool} } */
  X.render = function (project, videoBlob, opts) {
    var options = opts || {};
    var report = options.onProgress || function () {};
    var signal = options.signal || { cancelled: false };

    var support = X.support();
    if (!support.ok) {
      return Promise.reject(new Error(support.reasons.join(' ')));
    }
    if (!videoBlob) {
      return Promise.reject(new Error('The source video for this project is not available in this browser session.'));
    }

    var timeline = CF.editor.outputTimeline(project);
    if (!timeline.segments.length || timeline.duration <= 0) {
      return Promise.reject(new Error('Nothing is switched on to export. Enable at least one segment.'));
    }

    var crop = (project.edits && project.edits.crop) || '9:16';
    var targetW = X.TARGET_WIDTH;
    var targetH = X.TARGET_HEIGHT;
    if (crop === 'none' && project.video && project.video.width && project.video.height) {
      /* Keep the source shape, but cap the long edge so the file stays sane. */
      var srcW = project.video.width;
      var srcH = project.video.height;
      var cap = 1920 / Math.max(srcW, srcH);
      var s = Math.min(1, cap);
      targetW = Math.round(srcW * s / 2) * 2;   /* even dimensions encode reliably */
      targetH = Math.round(srcH * s / 2) * 2;
    }

    var url = URL.createObjectURL(videoBlob);
    var video = document.createElement('video');
    video.src = url;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.muted = !!(project.edits && project.edits.muted);

    var canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    var ctx = canvas.getContext('2d');

    var audioCtx = null;
    var recorder = null;
    var chunks = [];
    var rafId = null;
    var cleanedUp = false;

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { video.pause(); } catch (e) {}
      video.src = '';
      try { URL.revokeObjectURL(url); } catch (e) {}
      if (audioCtx && audioCtx.state !== 'closed') {
        try { audioCtx.close(); } catch (e) {}
      }
    }

    return new Promise(function (resolve, reject) {
      var failed = function (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      video.onerror = function () { failed(new Error('The source video could not be decoded for export.')); };

      video.onloadedmetadata = function () {
        var stream;
        try {
          stream = canvas.captureStream(X.FPS);
        } catch (e) {
          return failed(new Error('This browser refused to capture the canvas for recording.'));
        }

        /* Pipe the source audio into the recording, unless muted. Failure here
           is not fatal — a silent export still beats no export. */
        if (!video.muted) {
          try {
            var Ctor = window.AudioContext || window.webkitAudioContext;
            if (Ctor) {
              audioCtx = new Ctor();
              var source = audioCtx.createMediaElementSource(video);
              var dest = audioCtx.createMediaStreamDestination();
              source.connect(dest);
              dest.stream.getAudioTracks().forEach(function (track) { stream.addTrack(track); });
            }
          } catch (e) {
            audioCtx = null;
          }
        }

        try {
          recorder = new MediaRecorder(stream, {
            mimeType: support.mimeType,
            videoBitsPerSecond: 6000000
          });
        } catch (e) {
          return failed(new Error('This browser could not start a recorder for ' + support.mimeType + '.'));
        }

        recorder.ondataavailable = function (e) {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        recorder.onerror = function () { failed(new Error('Recording failed part-way through.')); };
        recorder.onstop = function () {
          cleanup();
          if (!chunks.length) return reject(new Error('The recorder produced no data.'));
          var blob = new Blob(chunks, { type: support.mimeType.split(';')[0] });
          resolve({
            blob: blob,
            mimeType: support.mimeType,
            extension: X.extensionFor(support.mimeType),
            isMp4: support.isMp4,
            duration: timeline.duration,
            width: targetW,
            height: targetH
          });
        };

        recorder.start(250);
        runSegments(0, 0);
      };

      /* Walk the segments in output order, drawing every animation frame. */
      function runSegments(index, elapsedBefore) {
        if (signal.cancelled) {
          try { recorder.stop(); } catch (e) {}
          cleanup();
          return reject(new Error('Export cancelled.'));
        }
        if (index >= timeline.segments.length) {
          setTimeout(function () {
            try { recorder.stop(); } catch (e) { failed(new Error('Could not finish the recording.')); }
          }, 220);   /* let the last frames flush */
          return;
        }

        var seg = timeline.segments[index];
        report(elapsedBefore / timeline.duration, 'Rendering ' + (index + 1) + '/' + timeline.segments.length);

        seek(video, seg.sourceStart).then(function () {
          var playPromise = video.play();
          if (playPromise && playPromise.catch) {
            playPromise.catch(function () {
              failed(new Error('The browser blocked playback needed for export. Tap the page, then try again.'));
            });
          }

          var tick = function () {
            if (signal.cancelled) {
              try { recorder.stop(); } catch (e) {}
              cleanup();
              return reject(new Error('Export cancelled.'));
            }

            var atEnd = video.currentTime >= seg.sourceEnd || video.ended;
            var current = Math.min(video.currentTime, seg.sourceEnd);
            var outputTime = seg.outStart + Math.max(0, current - seg.sourceStart);

            drawFrame(ctx, video, targetW, targetH, crop);
            X.drawOverlaysAt(ctx, project, outputTime, targetW, targetH);

            report(Math.min(0.999, outputTime / timeline.duration),
                   'Rendering ' + (index + 1) + '/' + timeline.segments.length);

            if (atEnd) {
              video.pause();
              return runSegments(index + 1, seg.outEnd);
            }
            rafId = requestAnimationFrame(tick);
          };
          rafId = requestAnimationFrame(tick);
        }).catch(failed);
      }
    });
  };

  /* ------------------------------------------------- optional MP4 convert */

  /* Loaded from a CDN only when the user asks for MP4 and MediaRecorder gave
     us WebM. Nothing is downloaded otherwise. */
  var FFMPEG_SOURCES = [
    {
      base: 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
      util: 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js',
      core: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
    },
    {
      base: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
      util: 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
      core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd'
    }
  ];

  var ffmpegInstance = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-cf-src="' + src + '"]');
      if (existing) return resolve();
      var el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.setAttribute('data-cf-src', src);
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('Could not download the converter from ' + src)); };
      document.head.appendChild(el);
    });
  }

  X.mp4Available = function () {
    return CF.ai.online();
  };

  X.loadFfmpeg = function (onProgress) {
    if (ffmpegInstance) return Promise.resolve(ffmpegInstance);
    if (!CF.ai.online()) {
      return Promise.reject(new Error('Converting to MP4 needs a connection the first time — the converter is about 30 MB.'));
    }

    var attempt = function (i) {
      if (i >= FFMPEG_SOURCES.length) {
        return Promise.reject(new Error('The MP4 converter could not be downloaded. Your WebM file is already saved and plays fine.'));
      }
      var src = FFMPEG_SOURCES[i];
      return loadScript(src.base)
        .then(function () { return loadScript(src.util); })
        .then(function () {
          var FFmpegNS = window.FFmpegWASM || window.FFmpeg;
          var UtilNS = window.FFmpegUtil || window.FFmpegUtil;
          if (!FFmpegNS || !FFmpegNS.FFmpeg || !UtilNS || !UtilNS.toBlobURL) {
            throw new Error('The converter loaded but did not expose the expected interface.');
          }
          var instance = new FFmpegNS.FFmpeg();
          if (onProgress) {
            instance.on('progress', function (e) {
              if (e && typeof e.progress === 'number') onProgress(U.clamp(e.progress, 0, 1), 'Converting to MP4');
            });
          }
          return Promise.all([
            UtilNS.toBlobURL(src.core + '/ffmpeg-core.js', 'text/javascript'),
            UtilNS.toBlobURL(src.core + '/ffmpeg-core.wasm', 'application/wasm')
          ]).then(function (urls) {
            return instance.load({ coreURL: urls[0], wasmURL: urls[1] });
          }).then(function () {
            ffmpegInstance = { instance: instance, util: UtilNS };
            return ffmpegInstance;
          });
        })
        .catch(function () { return attempt(i + 1); });
    };

    return attempt(0);
  };

  /* Convert a recorded WebM into H.264 MP4. Returns a new blob. */
  X.toMp4 = function (blob, onProgress) {
    var report = onProgress || function () {};
    report(0.02, 'Loading the converter');

    return X.loadFfmpeg(report).then(function (ff) {
      var instance = ff.instance;
      var util = ff.util;
      report(0.15, 'Converting to MP4');

      return util.fetchFile(blob).then(function (data) {
        return instance.writeFile('input.webm', data);
      }).then(function () {
        return instance.exec([
          '-i', 'input.webm',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-r', String(X.FPS),
          '-movflags', '+faststart',
          '-c:a', 'aac',
          '-b:a', '128k',
          'output.mp4'
        ]);
      }).then(function () {
        return instance.readFile('output.mp4');
      }).then(function (out) {
        /* Free the wasm filesystem so a second export does not accumulate. */
        try { instance.deleteFile('input.webm'); } catch (e) {}
        try { instance.deleteFile('output.mp4'); } catch (e) {}
        report(1, 'Done');
        return new Blob([out.buffer || out], { type: 'video/mp4' });
      });
    });
  };

  /* ------------------------------------------------------------ save file */

  X.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { a.remove(); } catch (e) {}
      URL.revokeObjectURL(url);
    }, 1500);
  };

})(window.CF);
