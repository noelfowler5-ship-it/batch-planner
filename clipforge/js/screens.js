/* screens.js — one render function per tab, plus the project detail modal.

   Render functions build an HTML string and assign it to the tab's container.
   They read from CF.state and never fetch anything themselves. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var ui = CF.ui;
  var S = {};
  CF.screens = S;

  /* ================================================================ CREATE */

  S.renderCreate = function () {
    var st = CF.state;
    var html = '';

    html += '<h1 class="screen-title">Create</h1>';
    html += '<p class="screen-sub">Raw footage in, publish-ready TikTok out.</p>';

    if (CF.db.degraded) {
      html += ui.note(
        '<b>Limited storage mode.</b> This browser refused IndexedDB (' + U.esc(CF.db.reason) + '). ' +
        'Projects still save, but video files are kept in memory only and are lost when you close the tab. ' +
        'Opening the app over http:// or https:// fixes this.', 'warn');
      html += '<div style="height:12px"></div>';
    }

    if (st.ingest.active) {
      html += renderIngestProgress(st.ingest);
    } else if (st.draft) {
      html += renderDraft(st.draft);
    } else {
      html += renderDropzone(st.settings);
    }

    ui.setHtml('create', html);
  };

  function renderDropzone(settings) {
    var h = '';
    h += '<div class="dropzone" id="dropzone" data-action="pick-file">' +
      '<div class="big">🎬</div>' +
      '<h2>Upload a video</h2>' +
      '<div class="small muted">Tap to choose, or drag a file here</div>' +
      '<div class="tiny faint" style="margin-top:10px">MP4 · MOV · WebM</div>' +
    '</div>';

    h += '<div class="section-label">How much time do you have?</div>';
    h += ui.chipRow('set-budget',
      CF.TIME_BUDGETS.map(function (m) { return [m, m + ' MIN']; }),
      settings.timeBudget);
    h += '<div class="tiny faint" style="margin-top:8px">' +
      'Sets how aggressive the AI recommendations will be. You can change it per project.' +
    '</div>';

    h += '<div class="section-label">What happens on this device</div>';
    h += ui.note(
      'Your video is stored <b>on this device only</b>. Nothing is uploaded when you add a clip. ' +
      'AI analysis in a later phase will ask first, and will send <b>still frames</b> — not the video file.',
      'info');
    return h;
  }

  function renderIngestProgress(ingest) {
    var steps = [
      ['probe', 'Reading the video'],
      ['thumb', 'Making a cover frame'],
      ['frames', 'Extracting frames for AI'],
      ['done', 'Saving to this device']
    ];
    var order = steps.map(function (s) { return s[0]; });
    var at = order.indexOf(ingest.step);

    var pct = ingest.total
      ? Math.round(((at >= 0 ? at : 0) / steps.length + (ingest.done / ingest.total) / steps.length) * 100)
      : Math.round(((at >= 0 ? at : 0) / steps.length) * 100);
    pct = U.clamp(pct, 4, 99);

    var h = '<div class="card">';
    h += '<div class="bold" style="margin-bottom:10px">Preparing “' + U.esc(ingest.name) + '”</div>';
    h += '<div class="bar"><i style="width:' + pct + '%"></i></div>';
    h += '<ul class="steps">';
    steps.forEach(function (s, i) {
      var cls = i < at ? 'done' : (i === at ? 'active' : '');
      var suffix = (s[0] === 'frames' && i === at && ingest.total)
        ? ' (' + ingest.done + '/' + ingest.total + ')'
        : '';
      h += '<li class="' + cls + '">' + (i < at ? '✓' : (i === at ? '●' : '○')) + ' ' +
           U.esc(s[1]) + U.esc(suffix) + '</li>';
    });
    h += '</ul></div>';
    h += '<div class="tiny faint">Longer clips take longer — frames are read one at a time.</div>';
    return h;
  }

  function renderDraft(draft) {
    var m = draft.meta;
    var h = '';

    h += '<div class="card">';
    h += '<div class="video-shell"><video src="' + U.esc(draft.objectUrl) + '" controls playsinline preload="metadata"></video></div>';
    h += '<div class="row-between" style="margin-top:12px">';
    h += '<div class="small muted mono">' +
      U.esc(U.clock(m.duration)) + ' · ' + U.esc(U.aspectLabel(m.width, m.height)) +
      ' · ' + U.esc(U.bytes(draft.file.size)) +
    '</div>';
    h += '<span class="tag">' + U.esc(draft.frames.length) + ' frames</span>';
    h += '</div>';
    h += '</div>';

    h += '<label class="field"><span>Project name</span>' +
      '<input type="text" id="draftName" value="' + U.esc(draft.name) + '" maxlength="70" ' +
      'placeholder="e.g. Vegetable chopper"></label>';

    h += '<div class="section-label">Time budget for this project</div>';
    h += ui.chipRow('set-draft-budget',
      CF.TIME_BUDGETS.map(function (mm) { return [mm, mm + ' MIN']; }),
      draft.timeBudget);

    h += '<div class="section-label">Frames extracted</div>';
    h += ui.filmstrip(draft.frames);
    h += '<div class="tiny faint" style="margin-top:6px">' +
      U.esc(draft.frames.length) + ' stills · ' + U.esc(U.bytes(CF.video.framesBytes(draft.frames))) +
      ' — this is what gets sent for AI analysis, not the video file.' +
    '</div>';

    if (m.width && m.height && Math.abs(m.width / m.height - 9 / 16) > 0.02) {
      h += '<div style="height:12px"></div>';
      h += ui.note('This clip is <b>' + U.esc(U.aspectLabel(m.width, m.height)) +
        '</b>, not 9:16. Cropping for TikTok arrives with the editor in Phase 4.', 'warn');
    }

    h += '<div style="height:16px"></div>';
    h += '<button class="btn-primary btn-block" data-action="save-draft">Save to Projects</button>';
    h += '<div style="height:8px"></div>';
    h += '<button class="btn-ghost btn-block" data-action="discard-draft">Discard</button>';
    return h;
  }

  /* ============================================================== PROJECTS */

  S.renderProjects = function () {
    var st = CF.state;
    var h = '';
    h += '<h1 class="screen-title">Projects</h1>';
    h += '<p class="screen-sub">' +
      (st.projects.length ? st.projects.length + ' saved on this device' : 'Nothing saved yet') +
    '</p>';

    h += '<button class="btn-primary btn-block" data-action="go-create">＋ New project</button>';
    h += '<div style="height:16px"></div>';

    if (!st.projects.length) {
      h += ui.empty('📁', 'No projects yet', 'Upload a clip on the Create tab to get started.');
      ui.setHtml('projects', h);
      return;
    }

    h += renderBatchPanel(st);

    var sort = st.settings.projectSort || 'recent';
    var scored = st.projects.filter(function (p) { return typeof p.score === 'number'; });

    if (scored.length > 1) {
      h += ui.chipRow('sort-projects', [['recent', 'Newest'], ['score', 'Best score']], sort);
      h += '<div style="height:12px"></div>';
    }

    var list = st.projects.slice();
    if (sort === 'score') {
      list.sort(function (a, b) {
        var as = typeof a.score === 'number' ? a.score : -1;
        var bs = typeof b.score === 'number' ? b.score : -1;
        return bs - as;
      });
    }

    list.forEach(function (p) { h += projectCard(p); });
    ui.setHtml('projects', h);
  };

  /* Batch mode: score several clips in one run so the best use of a short
     editing session is obvious before any editing starts. */
  function renderBatchPanel(st) {
    if (st.batch.active) {
      var pct = st.batch.total
        ? U.clamp(Math.round(st.batch.done / st.batch.total * 100), 3, 99)
        : 5;
      return '<div class="card">' +
        '<div class="bold" style="margin-bottom:8px">Analysing ' + (st.batch.done + 1) +
          ' of ' + st.batch.total + '</div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="tiny faint" style="margin-top:8px">' + U.esc(st.batch.label || '') + '</div>' +
        '<button class="btn-sm btn-block" style="margin-top:10px" data-action="cancel-batch">Stop after this one</button>' +
      '</div>';
    }

    var pending = st.projects.filter(function (p) {
      return !p.aiAnalysis && p.videoId && p.frameCount;
    });
    if (pending.length < 2) return '';

    var blocked = CF.ai.blockedReason();
    var h = '<div class="card">';
    h += '<div class="bold">' + pending.length + ' clips not scored yet</div>';
    h += '<div class="small muted" style="margin-top:4px">' +
      'Score them all, then work on the highest one first.</div>';
    h += '<button class="btn-sm btn-block" style="margin-top:10px" data-action="run-batch"' +
      (blocked ? ' disabled' : '') + '>Analyse all ' + pending.length + '</button>';
    if (blocked) {
      h += '<div class="tiny faint" style="margin-top:8px">' + U.esc(blocked) + '</div>';
    } else {
      h += '<div class="tiny faint" style="margin-top:8px">Runs one at a time and uses your Gemini quota.</div>';
    }
    h += '</div>';
    return h;
  }

  function scoreColor(score) {
    if (score >= 90 || score >= 75) return 'good';
    if (score >= 60) return 'warn';
    return 'bad';
  }

  function projectCard(p) {
    var next = CF.project.nextAction(p);
    var h = '<div class="card card-tight" data-action="open-project" data-id="' + U.esc(p.id) + '">';
    h += '<div class="row" style="align-items:flex-start">';
    h += ui.thumbImg(p._thumb, p.name);
    h += '<div style="flex:1;min-width:0">';
    h += '<div class="row-between"><div class="bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      U.esc(p.name) + '</div>' + ui.statusTag(p.status) + '</div>';
    h += '<div class="small muted mono" style="margin-top:3px">' + U.esc(CF.project.summaryLine(p)) + '</div>';
    h += '<div class="tiny faint" style="margin-top:3px">Added ' + U.esc(U.relativeDay(p.createdAt)) + '</div>';

    if (typeof p.score === 'number') {
      var verdict = CF.aiSchema.verdictFor(p.score);
      h += '<div class="tiny" style="margin-top:6px;color:var(--' + scoreColor(p.score) + ')">' +
        '<b>' + p.score + '/100</b> · ' + U.esc(verdict.label) + '</div>';
    } else if (next) {
      h += '<div class="tiny" style="margin-top:6px;color:var(--' +
        (next.tone === 'accent' ? 'accent' : next.tone === 'bad' ? 'bad' : next.tone === 'warn' ? 'warn' : 'faint') +
        ')">' + U.esc(next.label) + '</div>';
    }
    h += '</div></div></div>';
    return h;
  }

  /* ================================================================= QUEUE */

  S.renderQueue = function () {
    var st = CF.state;
    var groups = CF.project.groupByStatus(st.projects);
    var h = '';

    h += '<h1 class="screen-title">Queue</h1>';
    h += '<p class="screen-sub">Your personal workflow. Not connected to TikTok — nothing posts itself.</p>';

    if (!st.projects.length) {
      h += ui.empty('☰', 'Queue is empty', 'Saved projects show up here grouped by stage.');
      ui.setHtml('queue', h);
      return;
    }

    CF.STATUSES.forEach(function (status) {
      var list = groups[status];
      h += '<div class="section-label">' + U.esc(CF.STATUS_LABEL[status]) +
           ' <span class="faint">(' + list.length + ')</span></div>';
      if (!list.length) {
        h += '<div class="tiny faint" style="margin:-4px 0 4px">Nothing here.</div>';
        return;
      }
      list.forEach(function (p) {
        h += '<div class="card card-tight">';
        h += '<div class="row" style="align-items:center">';
        h += ui.thumbImg(p._thumb, p.name);
        h += '<div style="flex:1;min-width:0">' +
          '<div class="bold" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + U.esc(p.name) + '</div>' +
          '<div class="tiny faint mono" style="margin-top:2px">' + U.esc(CF.project.summaryLine(p)) + '</div>' +
        '</div>';
        h += '</div>';
        h += '<div class="row" style="gap:6px;margin-top:10px">';
        h += '<button class="btn-xs" data-action="open-project" data-id="' + U.esc(p.id) + '">Open</button>';
        var nxt = CF.project.nextStatus(p.status);
        if (nxt) {
          h += '<button class="btn-xs" data-action="advance-status" data-id="' + U.esc(p.id) + '">' +
               '→ ' + U.esc(CF.STATUS_LABEL[nxt]) + '</button>';
        }
        h += '</div>';
        h += '</div>';
      });
    });

    ui.setHtml('queue', h);
  };

  /* ============================================================== SETTINGS */

  S.renderSettings = function () {
    var s = CF.state.settings;
    var h = '';

    h += '<h1 class="screen-title">Settings</h1>';
    h += '<p class="screen-sub">ClipForge AI v' + U.esc(CF.VERSION) + '</p>';

    h += '<div class="section-label">Content language</div>';
    h += ui.chipRow('set-language', CF.LANGUAGES, s.language);
    h += '<div class="tiny faint" style="margin-top:8px">Default language for generated hooks, voiceovers and captions.</div>';

    h += '<div class="section-label">Default time budget</div>';
    h += ui.chipRow('set-budget', CF.TIME_BUDGETS.map(function (m) { return [m, m + ' MIN']; }), s.timeBudget);

    h += '<div class="section-label">Content style</div>';
    h += '<div class="card">';
    h += '<div class="switch-row">' +
      '<div><div class="bold">Face-free mode</div>' +
      '<div class="tiny faint" style="margin-top:2px">Prioritise hands, product and close-ups. Flags any frame with a face.</div></div>' +
      '<button class="switch' + (s.faceFree ? ' on' : '') + '" data-action="toggle-facefree" ' +
      'aria-pressed="' + (s.faceFree ? 'true' : 'false') + '" aria-label="Face-free mode"></button>' +
    '</div>';
    h += '</div>';

    h += '<div class="section-label">Storage</div>';
    h += '<div class="card" id="storageCard">';
    h += '<div class="row-between"><span class="small muted">Projects</span>' +
         '<span class="small mono bold">' + CF.state.projects.length + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Backend</span>' +
         '<span class="small mono bold">' + (CF.db.degraded ? 'localStorage + memory' : 'IndexedDB') + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Used</span>' +
         '<span class="small mono bold" id="storageUsed">…</span></div>';
    h += '</div>';

    h += '<div class="section-label">AI model</div>';
    h += renderModelPicker(CF.state);

    h += '<div class="section-label">Danger zone</div>';
    h += '<button class="btn-danger btn-block" data-action="confirm-clear-all">Delete all projects and videos</button>';
    h += '<div class="tiny faint" style="margin-top:8px">This device only. There is no cloud copy to restore from.</div>';

    ui.setHtml('settings', h);

    /* Storage figure arrives asynchronously — fill it in once it lands. */
    CF.db.estimate().then(function (est) {
      var el = ui.$('#storageUsed');
      if (!el) return;
      el.textContent = est && est.usage ? U.bytes(est.usage) : 'unknown';
    });
    CF.db.countAi().then(function (n) {
      var el = ui.$('#aiCacheCount');
      if (el) el.textContent = String(n);
    });
  };

  /* The model list is fetched live from Google rather than hardcoded, so a
     renamed or retired model never bricks the app. */
  function renderModelPicker(st) {
    var current = st.settings.aiModel || '';
    var h = '<div class="card">';

    h += '<div class="row-between"><span class="small muted">In use</span>' +
      '<span class="small mono bold">' + U.esc(current || 'server default') + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Saved AI results</span>' +
      '<span class="small mono bold" id="aiCacheCount">…</span></div>';
    h += '<div class="tiny faint" style="margin-top:8px">' +
      'Cached results are reused instead of calling Gemini again — that is what keeps this inside a free quota.</div>';

    var blocked = CF.ai.blockedReason();
    if (blocked) {
      h += '<div style="height:10px"></div>';
      h += ui.note(U.esc(blocked), 'warn');
      h += '</div>';
      return h;
    }

    if (st.models === 'loading') {
      h += '<div class="tiny faint" style="margin-top:12px">Loading the model list…</div>';
    } else if (Array.isArray(st.models)) {
      h += '<div class="section-label" style="margin:16px 0 6px">Available to your API key ' +
        '(' + st.models.length + ')</div>';
      h += '<button class="btn-xs btn-block model-row' + (current === '' ? ' on' : '') +
        '" data-action="set-model" data-value="__default__">' +
        '<span>Server default</span>' + (current === '' ? '<span>✓</span>' : '') + '</button>';
      st.models.forEach(function (m) {
        var on = m.id === current;
        h += '<button class="btn-xs btn-block model-row' + (on ? ' on' : '') + '" data-action="set-model" data-value="' +
          U.esc(m.id) + '"><span>' + U.esc(m.label) + '</span>' + (on ? '<span>✓</span>' : '') + '</button>';
      });
      h += '<button class="btn-sm btn-block" style="margin-top:10px" data-action="load-models">Refresh list</button>';
    } else {
      h += '<button class="btn-sm btn-block" style="margin-top:12px" data-action="load-models">' +
        'Show models my key can use</button>';
    }

    h += '</div>';
    return h;
  }

  S.renameForm = function (project) {
    ui.openModal(
      '<div class="modal-title">Rename project</div>' +
      '<label class="field"><span>Name</span>' +
      '<input type="text" id="renameInput" maxlength="70" value="' + U.esc(project.name) + '"></label>' +
      '<div class="row" style="gap:8px">' +
        '<button class="btn-ghost" style="flex:1" data-action="close-modal">Cancel</button>' +
        '<button class="btn-primary" style="flex:1" data-action="save-rename" data-id="' + U.esc(project.id) + '">Save</button>' +
      '</div>'
    );
  };

})(window.CF);
