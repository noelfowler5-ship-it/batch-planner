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
    openProjectId: null,
    objectUrls: []
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

  /* Strip runtime-only fields (thumbnails cached for rendering) before writing
     a project to storage, so they never bloat the stored record. */
  function persist(project) {
    var clean = {};
    Object.keys(project).forEach(function (k) {
      if (k.charAt(0) !== '_') clean[k] = project[k];
    });
    return CF.db.putProject(clean).then(function () {
      return clean;
    });
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

  /* --------------------------------------------------------------- render */

  function render() {
    if (state.tab === 'create') CF.screens.renderCreate();
    else if (state.tab === 'projects') CF.screens.renderProjects();
    else if (state.tab === 'queue') CF.screens.renderQueue();
    else CF.screens.renderSettings();
  }
  CF.render = render;

  function switchTab(tab) {
    if (ui.TABS.indexOf(tab) < 0) return;
    state.tab = tab;
    state.settings.lastTab = tab;
    saveSettings();
    ui.showTab(tab);
    render();
  }

  /* Load every project, then attach its cover thumbnail for list rendering. */
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
      onStep: function (step) {
        state.ingest.step = step;
        render();
      },
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

  function readDraftName() {
    var input = ui.$('#draftName');
    var typed = input && input.value ? input.value.trim() : '';
    return typed || (state.draft ? state.draft.name : 'Untitled clip');
  }

  function saveDraft() {
    var draft = state.draft;
    if (!draft) return;

    var videoId = U.uid('vid');
    var project = CF.project.create({
      name: readDraftName(),
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
      if (!durable) {
        ui.toast('Saved for this session only — storage is limited in this browser', 'warn');
      }
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

  /* -------------------------------------------------------- project modal */

  function openProject(id) {
    var project = findProject(id);
    if (!project) { ui.toast('Project not found', 'err'); return; }
    state.openProjectId = id;

    CF.db.getVideo(project.videoId).then(function (rec) {
      var url = null;
      if (rec && rec.blob) {
        try { url = trackUrl(URL.createObjectURL(rec.blob)); } catch (e) { url = null; }
      }
      CF.screens.openProjectModal(project, rec, url);
    }).catch(function () {
      CF.screens.openProjectModal(project, null, null);
    });
  }

  function setStatus(id, status) {
    var project = findProject(id);
    if (!project) return;
    CF.project.setStatus(project, status);
    persist(project).then(function () {
      /* Patch the modal's tag in place so the open <video> keeps playing. */
      var tag = ui.$('#modalStatusTag');
      if (tag) tag.innerHTML = ui.statusTag(project.status);
      syncChips('set-status', status);
      render();
    });
  }

  function deleteProject(id) {
    var project = findProject(id);
    if (!project) return;
    var work = project.videoId ? CF.db.deleteVideo(project.videoId) : Promise.resolve();
    work.then(function () {
      return CF.db.deleteProject(id);
    }).then(function () {
      ui.closeModal();
      return refreshProjects();
    }).then(function () {
      render();
      ui.toast('Project deleted');
    }).catch(function () {
      ui.toast('Could not delete that project', 'err');
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

    switch (action) {
      case 'modal-backdrop':
        /* Only a click on the backdrop itself closes; clicks inside bubble to here too. */
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

      case 'save-draft':
        saveDraft();
        break;

      case 'discard-draft':
        discardDraft();
        render();
        break;

      case 'open-project':
        openProject(id);
        break;

      case 'set-status':
        setStatus(state.openProjectId, value);
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

      case 'rename-project': {
        var target = findProject(id);
        if (target) CF.screens.renameForm(target);
        break;
      }

      case 'save-rename': {
        var proj = findProject(id);
        var field = ui.$('#renameInput');
        if (proj && field) {
          var name = (field.value || '').trim();
          if (!name) { ui.toast('Give it a name first', 'warn'); break; }
          proj.name = name.slice(0, 70);
          persist(proj).then(function () {
            ui.closeModal();
            render();
            ui.toast('Renamed');
          });
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

      case 'confirm-clear-all':
        ui.confirm('Delete everything?',
          'Every project and every stored video on this device will be removed. This cannot be undone.',
          'Delete all', 'clear-all', {});
        break;

      case 'clear-all':
        CF.db.clearAll().then(function () {
          ui.closeModal();
          releaseUrls();
          return refreshProjects();
        }).then(function () {
          render();
          ui.toast('All data deleted');
        });
        break;

      default:
        break;
    }
  }

  function onFileChosen(e) {
    var files = e.target && e.target.files;
    if (files && files.length) handleFile(files[0]);
    /* Reset so choosing the same file twice in a row still fires a change event. */
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
    window.addEventListener('online', ui.renderNetwork);
    window.addEventListener('offline', ui.renderNetwork);

    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ui.isModalOpen()) ui.closeModal();
    });
    var fileInput = ui.$('#fileInput');
    if (fileInput) fileInput.addEventListener('change', onFileChosen);
    wireDragAndDrop();
    window.addEventListener('pagehide', releaseUrls);

    return CF.db.init().then(function () {
      return refreshProjects();
    }).then(function () {
      var startTab = ui.TABS.indexOf(state.settings.lastTab) >= 0 ? state.settings.lastTab : 'create';
      state.tab = startTab;
      ui.showTab(startTab);
      render();
      if (CF.db.degraded) {
        ui.toast('Limited storage mode — see the notice on Create', 'warn');
      }
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
