/* app.js — state, boot sequence, and the single delegated event handler.

   Every interactive element in this app carries data-action="…". There are no
   per-element listeners in rendered markup, so re-rendering by assigning
   innerHTML can never leak or orphan a handler. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var ui = CF.ui;

  CF.state = {
    tab: 'create',
    settings: null,
    projects: [],
    draft: null,
    ingest: { active: false, step: '', done: 0, total: 0, name: '' },
    /* Set to a project id while the file picker is open on behalf of
       "+ Add another clip" on the Edit tab, so onFileChosen (shared with the
       Create screen's picker) knows to add to that project instead of
       starting a brand new one. */
    pendingClipTarget: null,
    objectUrls: [],

    /* studio */
    studioProject: null,
    studioTab: 'plan',
    studioVoiceover: 'medium',

    /* long-running work */
    aiBusy: { active: false, kind: null, label: '', fraction: 0 },
    exportBusy: { active: false, label: '', fraction: 0 },
    exportSignal: null,
    exportResult: null,
    batch: { active: false, done: 0, total: 0, label: '' },

    models: null
  };

  var state = CF.state;

  /* ------------------------------------------------------------ utilities */

  function trackUrl(url) {
    state.objectUrls.push(url);
    return url;
  }

  function releaseUrls() {
    state.objectUrls.forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (e) { /* already gone */ }
    });
    state.objectUrls = [];
  }

  /* Strip runtime-only fields (cached thumbnails) before writing a project to
     storage, so they never bloat the stored record. */
  function persist(project) {
    var clean = {};
    Object.keys(project).forEach(function (k) {
      if (k.charAt(0) !== '_') clean[k] = project[k];
    });
    return CF.db.putProject(clean).then(function () { return clean; });
  }

  /* Save the open project and re-render whatever is on screen. */
  function commit() {
    var project = state.studioProject;
    if (!project) return Promise.resolve();
    return persist(project).then(function () {
      syncProjectInList(project);
      render();
    });
  }

  function syncProjectInList(project) {
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === project.id) {
        var thumb = state.projects[i]._thumb;
        state.projects[i] = project;
        state.projects[i]._thumb = thumb;
        return;
      }
    }
  }

  function saveSettings() {
    if (!CF.db.saveSettings(state.settings)) {
      ui.toast('Could not save settings — browser storage is full', 'warn');
    }
  }

  /* Update a chip row in place. Re-rendering the whole screen would restart a
     playing <video>, which is jarring while reviewing a draft. */
  function syncChips(action, value) {
    var nodes = document.querySelectorAll('[data-action="' + action + '"]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('on', String(nodes[i].dataset.value) === String(value));
    }
  }

  function findProject(id) {
    for (var i = 0; i < state.projects.length; i++) {
      if (state.projects[i].id === id) return state.projects[i];
    }
    return null;
  }

  function inputValue(sel) {
    var el = ui.$(sel);
    return el && typeof el.value === 'string' ? el.value : '';
  }

  /* --------------------------------------------------------------- render */

  function render() {
    if (state.tab === 'create') CF.screens.renderCreate();
    else if (state.tab === 'projects') CF.screens.renderProjects();
    else if (state.tab === 'queue') CF.screens.renderQueue();
    else if (state.tab === 'studio') CF.studio.render();
    else CF.screens.renderSettings();
  }
  CF.render = render;

  function switchTab(tab) {
    if (ui.VIEWS.indexOf(tab) < 0) return;
    /* Preview owns a live <video> and a requestAnimationFrame loop. Navigating
       away via a bottom-nav tap bypasses the modal's own close handling, so
       stop it here too rather than letting it keep decoding in the background. */
    CF.preview.close();
    state.tab = tab;
    if (ui.TABS.indexOf(tab) >= 0) {
      state.settings.lastTab = tab;
      saveSettings();
    }
    ui.showTab(tab);
    render();
  }

  function refreshProjects() {
    return CF.db.allProjects().then(function (list) {
      var normalized = list.map(CF.project.normalize).filter(Boolean);
      return Promise.all(normalized.map(function (p) {
        var firstVideoId = p.clips && p.clips[0] && p.clips[0].videoId;
        if (!firstVideoId) return Promise.resolve(p);
        return CF.db.getVideoMeta(firstVideoId).then(function (meta) {
          p._thumb = meta && meta.thumb ? meta.thumb : null;
          return p;
        }).catch(function () { return p; });
      }));
    }).then(function (withThumbs) {
      state.projects = withThumbs;
      return withThumbs;
    });
  }

  /* --------------------------------------------------------------- ingest */

  /* Shared by both the Create-screen picker and "+ Add another clip" on
     Edit — returns an error string, or null if the file is fine. */
  function videoFileProblem(file) {
    if (!file) return null;
    if (!U.isVideoFile(file)) return 'That is not a video file';
    if (file.size > CF.MAX_SENSIBLE_BYTES) {
      return 'That file is ' + U.bytes(file.size) + ' — too large for the browser to handle reliably';
    }
    return null;
  }

  function handleFile(file) {
    if (!file) return;
    var problem = videoFileProblem(file);
    if (problem) { ui.toast(problem, 'err'); return; }

    discardDraft();
    state.ingest = { active: true, step: 'probe', done: 0, total: 0, name: file.name || 'video' };
    render();

    CF.video.ingest(file, {
      onStep: function (step) { state.ingest.step = step; render(); },
      onFrameProgress: function (done, total) {
        state.ingest.done = done;
        state.ingest.total = total;
        render();
      }
    }).then(function (result) {
      state.ingest.active = false;
      state.draft = {
        file: file,
        objectUrl: trackUrl(URL.createObjectURL(file)),
        meta: result.meta,
        thumb: result.thumb,
        frames: result.frames,
        name: CF.project.nameFromFile(file),
        timeBudget: state.settings.timeBudget,
        fingerprint: U.videoFingerprint(file, result.meta.duration)
      };
      render();
      if (result.allBlack) {
        /* Say this here rather than letting the AI discover it: the frames
           are all the AI ever sees, so an all-black set means every verdict
           downstream would describe a black screen instead of the video. */
        ui.toast('Every frame came out black, even though the video itself may be fine. '
               + 'This is a browser decoding problem, not your clip. Try Chrome, or re-save the '
               + 'video from your photo app first.', 'err');
      } else {
        ui.toast(result.frames.length + ' frames ready', 'ok');
      }
    }).catch(function (err) {
      state.ingest.active = false;
      state.draft = null;
      render();
      ui.toast(err && err.message ? err.message : 'Could not read that video', 'err');
    });
  }

  function discardDraft() {
    if (state.draft) {
      try { URL.revokeObjectURL(state.draft.objectUrl); } catch (e) { /* ignore */ }
      state.objectUrls = state.objectUrls.filter(function (u) { return u !== state.draft.objectUrl; });
    }
    state.draft = null;
  }

  /* "+ Add another clip" on the Edit tab — ingests a file exactly like the
     Create screen does, but appends it to an existing project's clips
     instead of starting a new draft. Reuses the same #fileInput and the
     same state.ingest progress indicator (rendered on the Edit tab too when
     this is what's in flight), so there is only one ingest pipeline to
     trust, not two. */
  function handleAddClipFile(file, projectId) {
    if (!file) return;
    var project = findProject(projectId);
    if (!project) return;
    if (!CF.project.canAddClip(project)) {
      ui.toast('This project already has ' + CF.MAX_CLIPS + ' clips', 'warn');
      return;
    }
    var problem = videoFileProblem(file);
    if (problem) { ui.toast(problem, 'err'); return; }

    state.ingest = { active: true, step: 'probe', done: 0, total: 0, name: file.name || 'video' };
    render();

    CF.video.ingest(file, {
      onStep: function (step) { state.ingest.step = step; render(); },
      onFrameProgress: function (done, total) {
        state.ingest.done = done;
        state.ingest.total = total;
        render();
      }
    }).then(function (result) {
      state.ingest.active = false;
      var videoId = U.uid('vid');
      CF.editor.mark(project);
      CF.project.addClip(project, {
        videoId: videoId,
        fingerprint: U.videoFingerprint(file, result.meta.duration),
        name: CF.project.nameFromFile(file),
        duration: result.meta.duration,
        width: result.meta.width,
        height: result.meta.height,
        size: file.size,
        type: file.type,
        frameCount: result.frames.length
      });
      var newSeg = CF.editor.newSegment(project.clips[project.clips.length - 1].id, 0, result.meta.duration,
        { label: CF.project.nameFromFile(file) });
      project.edits.segments.push(newSeg);

      return CF.db.putVideo({
        id: videoId,
        blob: file,
        thumb: result.thumb,
        frames: result.frames,
        name: file.name,
        type: file.type,
        size: file.size
      }).then(function (durable) {
        if (!durable) ui.toast('Saved for this session only — storage is limited in this browser', 'warn');
        return commit();
      }).then(function () {
        render();
        if (result.allBlack) {
          ui.toast('Every frame from that clip came out black — this is a browser decoding problem, not the clip. '
                 + 'Try Chrome, or re-save the video from your photo app first.', 'err');
        } else {
          ui.toast('Clip added — analyse it from the Plan tab to bring it into the scene plan', 'ok');
        }
      });
    }).catch(function (err) {
      state.ingest.active = false;
      render();
      ui.toast(err && err.message ? err.message : 'Could not read that video', 'err');
    });
  }

  function saveDraft() {
    var draft = state.draft;
    if (!draft) return;

    var typed = inputValue('#draftName').trim();
    var videoId = U.uid('vid');
    var project = CF.project.create({
      name: typed || draft.name,
      timeBudget: draft.timeBudget,
      language: state.settings.language,
      clips: [{
        videoId: videoId,
        fingerprint: draft.fingerprint,
        name: draft.name,
        duration: draft.meta.duration,
        width: draft.meta.width,
        height: draft.meta.height,
        size: draft.file.size,
        type: draft.file.type,
        frameCount: draft.frames.length
      }]
    });

    CF.db.putVideo({
      id: videoId,
      blob: draft.file,
      thumb: draft.thumb,
      frames: draft.frames,
      name: draft.file.name,
      type: draft.file.type,
      size: draft.file.size
    }).then(function (durable) {
      if (!durable) ui.toast('Saved for this session only — storage is limited in this browser', 'warn');
      return persist(project);
    }).then(function () {
      discardDraft();
      return refreshProjects();
    }).then(function () {
      switchTab('projects');
      ui.toast('Project saved', 'ok');
    }).catch(function (err) {
      ui.toast(err && err.message ? err.message : 'Could not save this project', 'err');
    });
  }

  /* --------------------------------------------------------------- studio */

  function openProject(id) {
    var project = findProject(id);
    if (!project) { ui.toast('Project not found', 'err'); return; }
    state.studioProject = project;
    state.studioTab = 'plan';
    state.exportResult = null;
    switchTab('studio');
  }

  function closeStudio() {
    state.studioProject = null;
    state.exportResult = null;
    switchTab('projects');
  }

  /* Frames live in the video record, not the project, so they are fetched
     only when an analysis actually needs them. */
  function framesForClip(clip) {
    return CF.db.getVideoMeta(clip.videoId).then(function (meta) {
      return (meta && meta.frames) || [];
    });
  }

  /* Shared core for "analyse every clip in this project that needs it" —
     used by both the single-project Plan-tab flow and the multi-project
     batch mode, so the two never drift on what "analysed" means. Analyses
     clips one at a time (each is its own AI call, each its own cache entry
     keyed on that clip's own fingerprint) and only rebuilds the segment cut
     once every clip is done, so a project with two of three clips analysed
     never gets a half-built timeline. Rejects on the first error — a quota
     wall means every remaining clip would fail too, so callers should stop
     rather than retry the rest. */
  function analyzeProjectClips(project, force, onClipStart) {
    var clips = (project.clips || []).filter(function (c) { return force || !c.analysis; });
    var totalRepairs = 0;
    var anyFresh = false;

    var chain = clips.reduce(function (p, clip, i) {
      return p.then(function () {
        if (onClipStart) onClipStart(i, clips.length, clip);
        return framesForClip(clip).then(function (frames) {
          return CF.ai.analyzeVideo({
            frames: frames,
            duration: clip.duration,
            fingerprint: clip.fingerprint,
            timeBudget: project.timeBudget,
            faceFree: state.settings.faceFree,
            model: state.settings.aiModel,
            force: force
          });
        }).then(function (result) {
          clip.analysis = result.analysis;
          clip.score = result.analysis.score.overall;
          project.aiModel = result.model || project.aiModel;
          if (!result.cached) anyFresh = true;
          if (result.repairs) totalRepairs += result.repairs.length;
        });
      });
    }, Promise.resolve());

    return chain.then(function () {
      if (project.status === 'RAW') CF.project.setStatus(project, 'ANALYZING');
      /* A fresh analysis invalidates a cut built from the old one. */
      project.edits.segments = CF.editor.buildSegments(project);
      CF.editor.clearHistory(project.id);
      return { analyzedCount: clips.length, anyFresh: anyFresh, totalRepairs: totalRepairs };
    });
  }

  function runAnalysis(project, force) {
    if (state.aiBusy.active) return;
    var clips = project.clips || [];
    var multi = clips.length > 1;
    state.aiBusy = { active: true, kind: 'analyze', label: multi ? 'Analysing clip 1 of ' + clips.length : 'Analysing this clip', fraction: 0.15 };
    render();

    var tick = setInterval(function () {
      /* An honest slow crawl: there is no real progress signal from a single
         request, so it never claims to be nearly done. */
      state.aiBusy.fraction = Math.min(0.9, state.aiBusy.fraction + 0.03);
      render();
    }, 900);

    var stop = function () {
      clearInterval(tick);
      state.aiBusy = { active: false, kind: null, label: '', fraction: 0 };
    };

    analyzeProjectClips(project, force, function (i, total, clip) {
      if (total > 1) {
        state.aiBusy.label = 'Analysing clip ' + (i + 1) + ' of ' + total + (clip.name ? ' (' + clip.name + ')' : '');
        render();
      }
    }).then(function (result) {
      stop();
      return commit().then(function () {
        if (!result.analyzedCount) ui.toast('Nothing new to analyse', 'ok');
        else if (!result.anyFresh) ui.toast('Loaded the saved analysis — no quota used', 'ok');
        else ui.toast('Analysis complete', 'ok');
        if (result.totalRepairs) {
          ui.toast('Tidied ' + result.totalRepairs + ' issue' + (result.totalRepairs > 1 ? 's' : '') + ' in the AI response');
        }
      });
    }).catch(function (err) {
      stop();
      render();
      reportAiError(err, state.settings.aiModel);
    });
  }

  function runGeneration(project, force) {
    if (state.aiBusy.active) return;
    if (!CF.project.allAnalyzed(project)) { ui.toast('Analyse the clip first', 'warn'); return; }

    state.aiBusy = { active: true, kind: 'generate', label: 'Writing hooks, script and captions', fraction: 0.15 };
    render();

    var tick = setInterval(function () {
      state.aiBusy.fraction = Math.min(0.9, state.aiBusy.fraction + 0.04);
      render();
    }, 900);
    var stop = function () {
      clearInterval(tick);
      state.aiBusy = { active: false, kind: null, label: '', fraction: 0 };
    };

    /* One combined analysis spanning every clip, scene times converted to
       the combined/global timeline — see project.js. The AI writes one
       script for the finished, assembled video, never one per clip. */
    CF.ai.generateContent({
      analysis: CF.project.combinedAnalysis(project),
      duration: CF.project.combinedDuration(project),
      fingerprint: CF.project.combinedFingerprint(project),
      language: project.language,
      timeBudget: project.timeBudget,
      model: state.settings.aiModel,
      styleExamples: state.settings.styleExamples,
      force: force
    }).then(function (result) {
      stop();
      project.aiContent = result.content;
      project.captions = result.content.captions || [];
      project.voiceovers = result.content.voiceovers || [];
      if (project.status === 'RAW' || project.status === 'ANALYZING') {
        CF.project.setStatus(project, 'EDITING');
      }
      return commit().then(function () {
        ui.toast(result.cached ? 'Loaded saved content — no quota used' : 'Content ready', 'ok');
        /* Runs automatically, right after content exists to check. Cheap on
           a reopened project (same content = same cache key = no quota), and
           only ever costs real quota when the words actually changed. */
        runPolicyCheck(project);
      });
    }).catch(function (err) {
      stop();
      render();
      reportAiError(err, state.settings.aiModel);
    });
  }

  /* A heuristic self-check for common affiliate-content risks (faked
     promotion/urgency, faked danger, missing paid-partnership disclosure,
     fake testimonials, unverifiable claims) — reviews both the generated
     words and the actual frames. Advisory only: never a guarantee of TikTok
     compliance, which the UI says plainly wherever the result is shown. */
  function runPolicyCheck(project, force) {
    if (state.aiBusy.active) return;
    if (!project.aiContent) return;

    state.aiBusy = { active: true, kind: 'policy', label: 'Checking for policy risks', fraction: 0.15 };
    render();

    var tick = setInterval(function () {
      state.aiBusy.fraction = Math.min(0.9, state.aiBusy.fraction + 0.04);
      render();
    }, 900);
    var stop = function () {
      clearInterval(tick);
      state.aiBusy = { active: false, kind: null, label: '', fraction: 0 };
    };

    /* One check on the finished, assembled video — matches how it will
       actually be posted — rather than one per clip. Frames from every clip
       are interleaved so the server's cap on how many it accepts does not
       leave a later clip with zero representation. */
    Promise.all((project.clips || []).map(framesForClip)).then(function (perClip) {
      return CF.ai.checkPolicy({
        frames: U.interleave(perClip),
        duration: CF.project.combinedDuration(project),
        fingerprint: CF.project.combinedFingerprint(project),
        content: project.aiContent,
        language: project.language,
        model: state.settings.aiModel,
        force: force
      });
    }).then(function (result) {
      stop();
      project.policyCheck = result.policyCheck;
      return commit().then(function () {
        if (result.cached) return;
        var n = result.policyCheck.flags.length;
        if (!n) ui.toast('Policy check: looks fine', 'ok');
        else ui.toast('Policy check: ' + n + ' thing' + (n === 1 ? '' : 's') + ' to review',
                       result.policyCheck.overallRisk === 'high' ? 'err' : 'warn');
      });
    }).catch(function (err) {
      stop();
      render();
      /* A best-effort automatic check failing shouldn't interrupt the
         content-ready flow with a hard error dialog — a quiet toast plus the
         manual "Check again" button (once content exists) is enough. */
      ui.toast('Policy check failed: ' + ((err && err.message) || 'unknown error'), 'warn');
    });
  }

  /* Toasts vanish in a few seconds — too fast to read a technical error, let
     alone copy it. A failed AI call opens a small dialog instead, with the
     server's raw detail (if any) and a Copy button, so the exact wording can
     be reported back rather than a paraphrase of it. */
  function reportAiError(err, modelTried) {
    var message = (err && err.message) || 'The AI request failed.';
    var detail = err && err.detail;
    var tried = modelTried || 'server default';

    var h = '<div class="modal-title">AI request failed</div>';
    h += '<div class="small" style="margin-bottom:12px">' + U.esc(message) + '</div>';
    h += '<div class="card card-tight">';
    h += '<div class="tiny faint">Model tried</div>';
    h += '<div class="small mono" style="margin-top:2px">' + U.esc(tried) + '</div>';
    if (detail) {
      h += '<div class="tiny faint" style="margin-top:10px">Server detail</div>';
      h += '<div class="small mono" style="margin-top:2px;word-break:break-word">' + U.esc(detail) + '</div>';
    }
    h += '</div>';
    if (err && err.code === 'quota') {
      h += ui.note('You can keep editing locally and try again later.', 'warn');
    }
    var copyPayload = 'ClipForge AI error\nMessage: ' + message + '\nModel: ' + tried + (detail ? '\nDetail: ' + detail : '');
    h += '<div class="row" style="gap:8px;margin-top:6px">';
    h += '<button class="btn-ghost" style="flex:1" data-action="close-modal">Close</button>';
    h += '<button class="btn-sm" style="flex:1" data-action="copy-text" data-copy="' + U.esc(copyPayload) + '">Copy details</button>';
    h += '</div>';
    ui.openModal(h);
  }

  /* ---------------------------------------------------------- batch mode */

  /* Score several clips in one go so the highest-value one is obvious.
     Sequential on purpose: parallel requests burn a free quota far faster and
     give no useful speed-up on one connection. */
  function runBatch() {
    if (state.batch.active) return;
    var pending = state.projects.filter(function (p) {
      return !CF.project.allAnalyzed(p) && (p.clips || []).length && (p.clips || []).every(function (c) { return c.frameCount; });
    });
    if (!pending.length) { ui.toast('Nothing left to analyse', 'warn'); return; }

    var blocked = CF.ai.blockedReason();
    if (blocked) { ui.toast(blocked, 'err'); return; }

    state.batch = { active: true, done: 0, total: pending.length, label: '' };
    render();

    var failures = 0;

    var step = function (i) {
      if (i >= pending.length || !state.batch.active) {
        state.batch = { active: false, done: 0, total: 0, label: '' };
        return refreshProjects().then(function () {
          render();
          ui.toast(failures
            ? 'Batch finished — ' + failures + ' could not be analysed'
            : 'Batch finished', failures ? 'warn' : 'ok');
        });
      }

      var project = pending[i];
      state.batch.done = i;
      state.batch.label = project.name;
      render();

      /* Same shared core the Plan-tab flow uses (analyzeProjectClips), so
         batch mode and a manual "Analyse" can never disagree about what
         counts as done. force is always false here — batch mode exists to
         fill in what's missing cheaply, never to spend quota re-doing
         clips that already have a result. */
      return analyzeProjectClips(project, false).then(function () {
        return persist(project);
      }).catch(function (err) {
        failures++;
        /* A quota wall means every remaining call will fail too — stop early
           rather than hammering it. */
        if (err && (err.code === 'quota' || err.status === 429)) {
          ui.toast(err.message, 'err');
          state.batch.active = false;
        }
        return null;
      }).then(function () {
        return step(i + 1);
      });
    };

    step(0);
  }

  /* --------------------------------------------------------------- export */

  function startExport() {
    var project = state.studioProject;
    if (!project || state.exportBusy.active) return;

    state.exportResult = null;
    state.exportSignal = { cancelled: false };
    state.exportBusy = { active: true, label: 'Preparing', fraction: 0 };
    render();

    var clipIds = [];
    CF.editor.outputTimeline(project).segments.forEach(function (s) {
      if (clipIds.indexOf(s.clipId) < 0) clipIds.push(s.clipId);
    });

    Promise.all(clipIds.map(function (id) {
      var clip = CF.project.findClip(project, id);
      return clip && clip.videoId ? CF.db.getVideo(clip.videoId) : null;
    })).then(function (recs) {
      var blobs = {};
      for (var i = 0; i < clipIds.length; i++) {
        if (!recs[i] || !recs[i].blob) {
          throw new Error('One of this project\'s clips is not available in this browser session. Re-add it to export.');
        }
        blobs[clipIds[i]] = recs[i].blob;
      }
      return CF.exporter.render(project, blobs, {
        signal: state.exportSignal,
        onProgress: function (fraction, label) {
          state.exportBusy.fraction = fraction;
          state.exportBusy.label = label || 'Rendering';
          render();
        }
      });
    }).then(function (result) {
      state.exportBusy = { active: false, label: '', fraction: 0 };
      state.exportResult = {
        blob: result.blob,
        extension: result.extension,
        filename: CF.exporter.fileName(project, result.extension)
      };
      if (project.status !== 'POSTED') CF.project.setStatus(project, 'READY');
      return commit();
    }).then(function () {
      ui.toast('Render finished', 'ok');
    }).catch(function (err) {
      state.exportBusy = { active: false, label: '', fraction: 0 };
      render();
      ui.toast((err && err.message) || 'Export failed', 'err');
    });
  }

  function convertToMp4() {
    var result = state.exportResult;
    if (!result || state.exportBusy.active) return;

    state.exportBusy = { active: true, label: 'Loading the converter', fraction: 0.02 };
    render();

    CF.exporter.toMp4(result.blob, function (fraction, label) {
      state.exportBusy.fraction = fraction;
      state.exportBusy.label = label || 'Converting to MP4';
      render();
    }).then(function (mp4) {
      state.exportBusy = { active: false, label: '', fraction: 0 };
      state.exportResult = {
        blob: mp4,
        extension: 'mp4',
        filename: CF.exporter.fileName(state.studioProject, 'mp4')
      };
      render();
      ui.toast('Converted to MP4', 'ok');
    }).catch(function (err) {
      state.exportBusy = { active: false, label: '', fraction: 0 };
      render();
      ui.toast((err && err.message) || 'Conversion failed — your existing file is still fine', 'err');
    });
  }

  /* ------------------------------------------------------- event handling */

  function onClick(e) {
    var tabBtn = e.target.closest ? e.target.closest('[data-tab]') : null;
    if (tabBtn) { switchTab(tabBtn.dataset.tab); return; }

    var el = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;

    var action = el.dataset.action;
    var id = el.dataset.id;
    var value = el.dataset.value;
    var project = state.studioProject;

    switch (action) {
      /* ------------------------------------------------------- chrome */
      case 'modal-backdrop':
        /* A live preview owns a <video>/<canvas> and a requestAnimationFrame
           loop — always stop it here, not just on the dedicated Close
           button, so tapping outside the modal can't leave it running. */
        if (e.target === el) { CF.preview.close(); ui.closeModal(); }
        break;
      case 'close-modal':
        CF.preview.close();
        ui.closeModal();
        break;
      case 'pick-file': {
        var input = ui.$('#fileInput');
        if (input) input.click();
        break;
      }
      case 'go-create':
        switchTab('create');
        break;

      /* ------------------------------------------------------ settings */
      case 'set-budget':
        state.settings.timeBudget = Number(value) || CF.DEFAULT_TIME_BUDGET;
        saveSettings();
        syncChips('set-budget', state.settings.timeBudget);
        break;
      case 'set-draft-budget':
        if (state.draft) {
          state.draft.timeBudget = Number(value) || CF.DEFAULT_TIME_BUDGET;
          syncChips('set-draft-budget', state.draft.timeBudget);
        }
        break;
      case 'set-language':
        state.settings.language = value;
        saveSettings();
        syncChips('set-language', value);
        break;
      case 'toggle-facefree':
        state.settings.faceFree = !state.settings.faceFree;
        saveSettings();
        render();
        break;
      case 'load-models':
        loadModels();
        break;
      case 'add-style-example':
        if ((state.settings.styleExamples || []).length < CF.MAX_STYLE_EXAMPLES) CF.screens.styleExampleForm();
        break;
      case 'save-style-example': {
        var exText = inputValue('#styleExampleInput').trim();
        if (!exText) { ui.toast('Type a caption first', 'warn'); break; }
        state.settings.styleExamples = U.sanitizeStyleExamples(
          (state.settings.styleExamples || []).concat([exText]));
        saveSettings();
        ui.closeModal();
        render();
        break;
      }
      case 'remove-style-example': {
        var exIdx = parseInt(value, 10);
        var examples = (state.settings.styleExamples || []).slice();
        if (exIdx >= 0 && exIdx < examples.length) {
          examples.splice(exIdx, 1);
          state.settings.styleExamples = examples;
          saveSettings();
          render();
        }
        break;
      }
      case 'reset-style-examples':
        state.settings.styleExamples = CF.DEFAULT_STYLE_EXAMPLES.slice();
        saveSettings();
        render();
        ui.toast('Reset to the default examples');
        break;
      case 'set-model':
        state.settings.aiModel = value === '__default__' ? '' : value;
        saveSettings();
        render();
        ui.toast('Model set to ' + (state.settings.aiModel || 'the server default'));
        break;

      /* --------------------------------------------------------- draft */
      case 'save-draft':
        saveDraft();
        break;
      case 'discard-draft':
        discardDraft();
        render();
        break;

      /* ------------------------------------------------------ projects */
      case 'open-project':
        openProject(id);
        break;
      case 'close-studio':
        closeStudio();
        break;
      case 'advance-status': {
        var p = findProject(id);
        if (p) {
          var next = CF.project.nextStatus(p.status);
          if (next) {
            CF.project.setStatus(p, next);
            persist(p).then(function () { render(); });
          }
        }
        break;
      }
      case 'set-status':
        if (project) {
          CF.project.setStatus(project, value);
          commit();
        }
        break;
      case 'rename-project': {
        var target = findProject(id) || project;
        if (target) CF.screens.renameForm(target);
        break;
      }
      case 'save-rename': {
        var proj = findProject(id) || project;
        var name = inputValue('#renameInput').trim();
        if (proj && name) {
          proj.name = name.slice(0, 70);
          persist(proj).then(function () {
            syncProjectInList(proj);
            ui.closeModal();
            render();
            ui.toast('Renamed');
          });
        } else if (!name) {
          ui.toast('Give it a name first', 'warn');
        }
        break;
      }
      case 'confirm-delete-project':
        ui.confirm('Delete this project?',
          'The project and its stored video are removed from this device. This cannot be undone.',
          'Delete', 'delete-project', { id: id });
        break;
      case 'delete-project':
        deleteProject(id);
        break;
      case 'run-batch':
        runBatch();
        break;
      case 'cancel-batch':
        state.batch.active = false;
        ui.toast('Stopping after the current clip');
        break;
      case 'sort-projects':
        state.settings.projectSort = value;
        saveSettings();
        render();
        break;

      /* -------------------------------------------------------- studio */
      case 'studio-tab':
        state.studioTab = value;
        render();
        break;
      case 'analyze-now':
        if (project) runAnalysis(project, false);
        break;
      case 'reanalyze':
        if (project) {
          ui.confirm('Analyse again?',
            'This sends the frames to Gemini again and uses part of your free quota. The saved result will be replaced.',
            'Analyse again', 'reanalyze-confirm', {});
        }
        break;
      case 'reanalyze-confirm':
        ui.closeModal();
        if (project) runAnalysis(project, true);
        break;
      case 'generate-content':
        if (project) runGeneration(project, false);
        break;
      case 'regenerate-content':
        if (project) runGeneration(project, true);
        break;
      case 'check-policy':
        if (project) runPolicyCheck(project, false);
        break;
      case 'recheck-policy':
        if (project) runPolicyCheck(project, true);
        break;
      case 'set-project-language':
        if (project) {
          project.language = value;
          syncChips('set-project-language', value);
          commit();
        }
        break;
      case 'set-vo-variant':
        state.studioVoiceover = value;
        render();
        break;
      case 'pick-hook':
        if (project) {
          project.chosenHookId = el.dataset.hid;
          commit();
          ui.toast('Hook chosen');
        }
        break;
      case 'hook-to-overlay':
        if (project && project.aiContent) {
          var hook = (project.aiContent.hooks || []).filter(function (x) { return x.id === el.dataset.hid; })[0];
          if (hook) {
            /* setHookOverlay swaps out any previously-applied hook rather than
               stacking a second one at the same 0-2.5s spot, so trying a few
               different hooks on the same clip just works. */
            var added = CF.editor.setHookOverlay(project, {
              text: hook.text, start: 0, end: 2.5, position: 'center', animation: 'pop', source: 'ai'
            });
            if (added) {
              project.chosenHookId = hook.id;
              commit();
              ui.toast('Hook added to the start of the video', 'ok');
            } else {
              ui.toast('Could not add that overlay', 'warn');
            }
          }
        }
        break;
      case 'copy-text':
        ui.copy(el.dataset.copy || '');
        break;
      case 'apply-overlay':
        if (project && project.aiContent) {
          var src = (project.aiContent.textOverlays || []).filter(function (x) { return x.id === el.dataset.oid; })[0];
          if (src) {
            var made = CF.editor.applyAiOverlay(project, src);
            if (made) { commit(); ui.toast('Text added', 'ok'); }
            else ui.toast('That moment was cut from the video', 'warn');
          }
        }
        break;
      case 'cut-scene':
        if (project && el.dataset.sid) {
          var cutHit = CF.editor.find(project, el.dataset.sid);
          if (cutHit && cutHit.segment.enabled) {
            if (CF.editor.toggleSegment(project, el.dataset.sid)) {
              commit();
              ui.toast('Scene switched off');
            } else {
              ui.toast('That is the only scene left switched on', 'warn');
            }
          } else {
            ui.toast('Already switched off');
          }
        }
        break;
      case 'apply-all':
        if (project) {
          var applied = CF.editor.applyAllSafe(project);
          commit();
          ui.toast('Applied: ' + applied.overlaysAdded + ' text overlay' +
                   (applied.overlaysAdded === 1 ? '' : 's') + ', ' +
                   applied.segmentsDisabled + ' scene' +
                   (applied.segmentsDisabled === 1 ? '' : 's') + ' switched off', 'ok');
        }
        break;

      /* ---------------------------------------------------------- edit */
      case 'undo':
        if (project && CF.editor.undo(project)) commit();
        break;
      case 'redo':
        if (project && CF.editor.redo(project)) commit();
        break;
      case 'seg-toggle':
        if (project) {
          if (CF.editor.toggleSegment(project, el.dataset.sid)) commit();
          else ui.toast('At least one scene has to stay on', 'warn');
        }
        break;
      case 'reset-segments':
        if (project) { CF.editor.resetToAi(project); commit(); ui.toast('Reset to the AI cut'); }
        break;
      case 'add-clip':
        if (project) {
          if (!CF.project.canAddClip(project)) {
            ui.toast('This project already has ' + CF.MAX_CLIPS + ' clips', 'warn');
            break;
          }
          state.pendingClipTarget = project.id;
          var addInput = ui.$('#fileInput');
          if (addInput) addInput.click();
        }
        break;
      case 'set-crop':
        if (project && CF.editor.setCrop(project, value)) commit();
        break;
      case 'toggle-mute':
        if (project) { CF.editor.toggleMute(project); commit(); }
        break;
      case 'preview-open':
        if (project) CF.preview.open(project);
        break;
      case 'preview-toggle':
        CF.preview.toggle();
        break;

      /* ------------------------------------------------------ overlays */
      case 'overlay-delete':
        if (project && CF.editor.removeOverlay(project, el.dataset.oid)) {
          commit();
          ui.toast('Text removed');
        }
        break;
      case 'confirm-clear-overlays':
        if (project && project.textOverlays.length) {
          ui.confirm('Clear all text overlays?',
            'Every overlay on this project is removed. You can reapply a fresh set from the Plan tab right after, and Undo brings them all back if you change your mind.',
            'Clear all', 'clear-overlays', {});
        }
        break;
      case 'clear-overlays':
        if (project && CF.editor.clearOverlays(project)) {
          ui.closeModal();
          commit();
          ui.toast('Text overlays cleared');
        }
        break;

      /* -------------------------------------------------------- export */
      case 'export-start':
        startExport();
        break;
      case 'export-cancel':
        if (state.exportSignal) state.exportSignal.cancelled = true;
        break;
      case 'export-to-mp4':
        convertToMp4();
        break;
      case 'export-download':
        if (state.exportResult) {
          CF.exporter.download(state.exportResult.blob, state.exportResult.filename);
          ui.toast('Saved to your downloads', 'ok');
        }
        break;

      /* --------------------------------------------------------- danger */
      case 'confirm-clear-all':
        ui.confirm('Delete everything?',
          'Every project, video and saved AI result on this device will be removed. This cannot be undone.',
          'Delete all', 'clear-all', {});
        break;
      case 'clear-all':
        CF.db.clearAll().then(function () {
          ui.closeModal();
          releaseUrls();
          state.studioProject = null;
          return refreshProjects();
        }).then(function () {
          switchTab('projects');
          ui.toast('All data deleted');
        });
        break;

      default:
        break;
    }
  }

  function deleteProject(id) {
    var target = findProject(id);
    if (!target) return;
    var work = Promise.all((target.clips || []).map(function (c) {
      return c.videoId ? CF.db.deleteVideo(c.videoId) : null;
    }));
    work.then(function () {
      return CF.db.deleteProject(id);
    }).then(function () {
      CF.editor.clearHistory(id);
      ui.closeModal();
      if (state.studioProject && state.studioProject.id === id) state.studioProject = null;
      return refreshProjects();
    }).then(function () {
      switchTab('projects');
      ui.toast('Project deleted');
    }).catch(function () {
      ui.toast('Could not delete that project', 'err');
    });
  }

  function loadModels() {
    if (state.models === 'loading') return;
    state.models = 'loading';
    render();
    CF.ai.listModels().then(function (data) {
      state.models = data.models || [];
      render();
      ui.toast(state.models.length + ' models available', 'ok');
    }).catch(function (err) {
      state.models = null;
      render();
      ui.toast((err && err.message) || 'Could not load the model list', 'err');
    });
  }

  function onFileChosen(e) {
    var files = e.target && e.target.files;
    var target = state.pendingClipTarget;
    state.pendingClipTarget = null;
    if (files && files.length) {
      if (target) handleAddClipFile(files[0], target);
      else handleFile(files[0]);
    }
    if (e.target) e.target.value = '';
  }

  function wireDragAndDrop() {
    var stop = function (e) { e.preventDefault(); e.stopPropagation(); };

    document.addEventListener('dragover', function (e) {
      stop(e);
      var zone = ui.$('#dropzone');
      if (zone) zone.classList.add('hot');
    });
    document.addEventListener('dragleave', function (e) {
      stop(e);
      if (e.relatedTarget) return;
      var zone = ui.$('#dropzone');
      if (zone) zone.classList.remove('hot');
    });
    document.addEventListener('drop', function (e) {
      stop(e);
      var zone = ui.$('#dropzone');
      if (zone) zone.classList.remove('hot');
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        if (state.tab !== 'create') switchTab('create');
        handleFile(dt.files[0]);
      }
    });
  }

  /* ----------------------------------------------------------------- boot */

  function boot() {
    state.settings = CF.db.loadSettings();

    ui.renderNetwork();
    window.addEventListener('online', function () { ui.renderNetwork(); render(); });
    window.addEventListener('offline', function () { ui.renderNetwork(); render(); });

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ui.isModalOpen()) { CF.preview.close(); ui.closeModal(); }
    });
    var fileInput = ui.$('#fileInput');
    if (fileInput) fileInput.addEventListener('change', onFileChosen);
    wireDragAndDrop();
    window.addEventListener('pagehide', releaseUrls);

    /* Losing an in-progress render to an accidental back-swipe is miserable. */
    window.addEventListener('beforeunload', function (e) {
      if (state.exportBusy.active) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    });

    return CF.db.init().then(function () {
      return refreshProjects();
    }).then(function () {
      var startTab = ui.TABS.indexOf(state.settings.lastTab) >= 0 ? state.settings.lastTab : 'create';
      state.tab = startTab;
      ui.showTab(startTab);
      render();
      if (CF.db.degraded) ui.toast('Limited storage mode — see the notice on Create', 'warn');
    }).catch(function (err) {
      state.tab = 'create';
      ui.showTab('create');
      render();
      ui.toast('Startup problem: ' + ((err && err.message) || 'unknown'), 'err');
    });
  }

  CF.boot = boot;

  /* Skip auto-boot under the test harness, which drives boot() itself. */
  if (typeof document !== 'undefined' && !window.__CF_TEST__) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  }

})(window.CF);
