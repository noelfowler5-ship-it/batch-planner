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
    objectUrls: [],

    /* studio */
    studioProject: null,
    studioTab: 'overview',
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
        if (!p.videoId) return Promise.resolve(p);
        return CF.db.getVideoMeta(p.videoId).then(function (meta) {
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

  function handleFile(file) {
    if (!file) return;
    if (!U.isVideoFile(file)) {
      ui.toast('That is not a video file', 'err');
      return;
    }
    if (file.size > CF.MAX_SENSIBLE_BYTES) {
      ui.toast('That file is ' + U.bytes(file.size) + ' — too large for the browser to handle reliably', 'err');
      return;
    }

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
      ui.toast(result.frames.length + ' frames ready', 'ok');
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

  function saveDraft() {
    var draft = state.draft;
    if (!draft) return;

    var typed = inputValue('#draftName').trim();
    var videoId = U.uid('vid');
    var project = CF.project.create({
      name: typed || draft.name,
      videoId: videoId,
      fingerprint: draft.fingerprint,
      frameCount: draft.frames.length,
      timeBudget: draft.timeBudget,
      language: state.settings.language,
      video: {
        duration: draft.meta.duration,
        width: draft.meta.width,
        height: draft.meta.height,
        size: draft.file.size,
        type: draft.file.type,
        name: draft.file.name
      }
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
    state.studioTab = 'overview';
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
  function framesFor(project) {
    return CF.db.getVideoMeta(project.videoId).then(function (meta) {
      return (meta && meta.frames) || [];
    });
  }

  function runAnalysis(project, force) {
    if (state.aiBusy.active) return;
    state.aiBusy = { active: true, kind: 'analyze', label: 'Analysing this clip', fraction: 0.15 };
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

    framesFor(project).then(function (frames) {
      return CF.ai.analyzeVideo({
        frames: frames,
        duration: project.video.duration,
        fingerprint: project.fingerprint,
        timeBudget: project.timeBudget,
        faceFree: state.settings.faceFree,
        model: state.settings.aiModel,
        force: force
      });
    }).then(function (result) {
      stop();
      project.aiAnalysis = result.analysis;
      project.scenes = result.analysis.scenes;
      project.score = result.analysis.score.overall;
      project.aiModel = result.model || project.aiModel;
      if (project.status === 'RAW') CF.project.setStatus(project, 'ANALYZING');
      /* A fresh analysis invalidates a cut built from the old one. */
      project.edits.segments = CF.editor.buildSegments(project);
      CF.editor.clearHistory(project.id);
      return commit().then(function () {
        if (result.cached) ui.toast('Loaded the saved analysis — no quota used', 'ok');
        else ui.toast('Analysis complete', 'ok');
        if (result.repairs && result.repairs.length) {
          ui.toast('Tidied ' + result.repairs.length + ' issue' + (result.repairs.length > 1 ? 's' : '') + ' in the AI response');
        }
      });
    }).catch(function (err) {
      stop();
      render();
      reportAiError(err);
    });
  }

  function runGeneration(project, force) {
    if (state.aiBusy.active) return;
    if (!project.aiAnalysis) { ui.toast('Analyse the clip first', 'warn'); return; }

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

    CF.ai.generateContent({
      analysis: project.aiAnalysis,
      duration: project.video.duration,
      fingerprint: project.fingerprint,
      language: project.language,
      timeBudget: project.timeBudget,
      model: state.settings.aiModel,
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
      });
    }).catch(function (err) {
      stop();
      render();
      reportAiError(err);
    });
  }

  function reportAiError(err) {
    var message = (err && err.message) || 'The AI request failed.';
    ui.toast(message, 'err');
    if (err && err.code === 'quota') {
      ui.toast('You can keep editing locally and try again later', 'warn');
    }
  }

  /* ---------------------------------------------------------- batch mode */

  /* Score several clips in one go so the highest-value one is obvious.
     Sequential on purpose: parallel requests burn a free quota far faster and
     give no useful speed-up on one connection. */
  function runBatch() {
    if (state.batch.active) return;
    var pending = state.projects.filter(function (p) {
      return !p.aiAnalysis && p.videoId && p.frameCount;
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

      return framesFor(project).then(function (frames) {
        return CF.ai.analyzeVideo({
          frames: frames,
          duration: project.video.duration,
          fingerprint: project.fingerprint,
          timeBudget: project.timeBudget,
          faceFree: state.settings.faceFree,
          model: state.settings.aiModel
        });
      }).then(function (result) {
        project.aiAnalysis = result.analysis;
        project.scenes = result.analysis.scenes;
        project.score = result.analysis.score.overall;
        project.aiModel = result.model || project.aiModel;
        if (project.status === 'RAW') CF.project.setStatus(project, 'ANALYZING');
        project.edits.segments = CF.editor.buildSegments(project);
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

    CF.db.getVideo(project.videoId).then(function (rec) {
      if (!rec || !rec.blob) {
        throw new Error('The source video is not available in this browser session. Re-add the clip to export it.');
      }
      return CF.exporter.render(project, rec.blob, {
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
        if (e.target === el) ui.closeModal();
        break;
      case 'close-modal':
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
            var added = CF.editor.addOverlay(project, {
              text: hook.text, start: 0, end: 2.5, position: 'center', style: 'hook', animation: 'pop', source: 'ai'
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
        if (project && project.aiAnalysis) {
          var scene = project.aiAnalysis.scenes[Number(el.dataset.idx)];
          if (scene) {
            CF.editor.ensureSegments(project);
            var match = project.edits.segments.filter(function (s) {
              return s.sourceStart === scene.start && s.sourceEnd === scene.end;
            })[0];
            if (match && match.enabled) {
              if (CF.editor.toggleSegment(project, match.id)) {
                commit();
                ui.toast('Scene switched off');
              } else {
                ui.toast('That is the only scene left switched on', 'warn');
              }
            } else {
              ui.toast('Already switched off');
            }
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
          else ui.toast('At least one segment has to stay on', 'warn');
        }
        break;
      case 'seg-move':
        if (project && CF.editor.moveSegment(project, el.dataset.sid, Number(el.dataset.dir))) commit();
        break;
      case 'seg-delete':
        if (project) {
          if (CF.editor.deleteSegment(project, el.dataset.sid)) commit();
          else ui.toast('The last segment cannot be deleted', 'warn');
        }
        break;
      case 'seg-split':
        if (project) CF.studio.splitForm(project, el.dataset.sid);
        break;
      case 'seg-split-confirm':
        if (project) {
          var at = Number(inputValue('#splitAt'));
          if (CF.editor.splitSegment(project, el.dataset.sid, at)) {
            ui.closeModal();
            commit();
            ui.toast('Split');
          } else {
            ui.toast('Pick a point at least 0.25s from each edge', 'warn');
          }
        }
        break;
      case 'seg-trim':
        if (project) {
          if (CF.editor.trimSegment(project, el.dataset.sid, el.dataset.edge, Number(el.dataset.delta))) commit();
          else ui.toast('That would make the segment too short', 'warn');
        }
        break;
      case 'reset-segments':
        if (project) { CF.editor.resetToAi(project); commit(); ui.toast('Reset to the AI cut'); }
        break;
      case 'set-crop':
        if (project && CF.editor.setCrop(project, value)) commit();
        break;
      case 'toggle-mute':
        if (project) { CF.editor.toggleMute(project); commit(); }
        break;

      /* ------------------------------------------------------ overlays */
      case 'overlay-new':
        if (project) CF.studio.overlayForm(project, null);
        break;
      case 'overlay-edit':
        if (project) CF.studio.overlayForm(project, el.dataset.oid);
        break;
      case 'overlay-save':
        if (project) saveOverlayForm(project, el.dataset.oid);
        break;
      case 'overlay-delete':
        if (project && CF.editor.removeOverlay(project, el.dataset.oid)) {
          commit();
          ui.toast('Text removed');
        }
        break;
      case 'overlay-nudge':
        if (project) {
          var delta = Number(el.dataset.delta);
          var found = project.textOverlays.filter(function (o) { return o.id === el.dataset.oid; })[0];
          if (found) {
            CF.editor.updateOverlay(project, found.id, {
              start: found.start + delta,
              end: found.end + delta
            });
            commit();
          }
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

  function saveOverlayForm(project, overlayId) {
    var text = inputValue('#ovText').trim();
    if (!text) { ui.toast('Type some text first', 'warn'); return; }

    var start = Number(inputValue('#ovStart'));
    var end = Number(inputValue('#ovEnd'));
    var position = inputValue('#ovPos');
    var style = inputValue('#ovStyle');

    if (!isFinite(start) || !isFinite(end) || end <= start) {
      ui.toast('The end time has to be after the start time', 'warn');
      return;
    }

    var ok;
    if (overlayId) {
      ok = CF.editor.updateOverlay(project, overlayId, {
        text: text, start: start, end: end, position: position, style: style
      });
    } else {
      ok = !!CF.editor.addOverlay(project, {
        text: text, start: start, end: end, position: position, style: style, animation: 'fade'
      });
    }

    if (!ok) { ui.toast('Could not save that overlay', 'err'); return; }
    ui.closeModal();
    commit();
    ui.toast('Text saved', 'ok');
  }

  function deleteProject(id) {
    var target = findProject(id);
    if (!target) return;
    var work = target.videoId ? CF.db.deleteVideo(target.videoId) : Promise.resolve();
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
    if (files && files.length) handleFile(files[0]);
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
      if (e.key === 'Escape' && ui.isModalOpen()) ui.closeModal();
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
