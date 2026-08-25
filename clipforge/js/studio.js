/* studio.js — the per-project workspace.

   Three tabs over one project: Plan, Edit, Export.

   Plan used to be three separate tabs (Overview / Director / Content) for
   what is really one continuous idea — analyse, see the scene-by-scene plan,
   generate the words, apply them — so it is one scrolling page instead: each
   step appears right below the previous one as soon as it is ready, with no
   tab-switching in between. Edit (manual timeline control) and Export
   (rendering) stay separate because they are genuinely different modes, not
   steps in the same flow.

   Every AI suggestion here is paired with an action that actually applies it —
   a recommendation you have to retype by hand is a chatbot, not an editor. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var ui = CF.ui;
  var St = {};
  CF.studio = St;

  St.TABS = [
    ['plan', 'Plan'],
    ['edit', 'Edit'],
    ['export', 'Export']
  ];

  var PURPOSE_ICON = {
    HOOK: '🔥', PROBLEM: '😖', DEMO: '🎬', BENEFIT: '✨', PROOF: '🔍',
    RESULT: '🏁', CTA: '👉', FILLER: '➖', REMOVE: '🗑'
  };

  var HOOK_STYLE_LABEL = {
    curiosity: 'Curiosity', painpoint: 'Pain point', pov: 'POV',
    unexpected: 'Unexpected', value: 'Value'
  };

  var CAPTION_STYLE_LABEL = {
    curiosity: 'Curiosity', problem: 'Problem / benefit', casual: 'Casual / value'
  };

  /* ------------------------------------------------------------------ shell */

  St.render = function () {
    var project = CF.state.studioProject;
    if (!project) {
      ui.setHtml('studio', ui.empty('📁', 'No project open', 'Pick one from Projects.'));
      return;
    }

    var tab = CF.state.studioTab || 'plan';
    var h = '';

    h += '<div class="row-between" style="margin-bottom:10px">';
    h += '<button class="btn-xs" data-action="close-studio">‹ Projects</button>';
    h += ui.statusTag(project.status);
    h += '</div>';

    h += '<h1 class="screen-title" style="font-size:19px">' + U.esc(project.name) + '</h1>';
    h += '<p class="screen-sub mono">' + U.esc(CF.project.summaryLine(project)) + '</p>';

    h += '<div class="subtabs">';
    St.TABS.forEach(function (t) {
      var on = t[0] === tab ? ' on' : '';
      h += '<button class="subtab' + on + '" data-action="studio-tab" data-value="' + t[0] + '">' +
           U.esc(t[1]) + '</button>';
    });
    h += '</div>';

    if (tab === 'plan') h += renderPlan(project) + renderManage(project);
    else if (tab === 'edit') h += renderEdit(project);
    else h += renderExport(project);

    ui.setHtml('studio', h);
  };

  function renderManage(project) {
    var h = '';
    h += '<div class="section-label">Stage</div>';
    h += ui.chipRow('set-status', CF.STATUSES.map(function (s) { return [s, CF.STATUS_LABEL[s]]; }), project.status);

    h += '<div class="section-label">Manage</div>';
    h += '<div class="row" style="gap:8px">';
    h += '<button class="btn-sm" style="flex:1" data-action="rename-project" data-id="' + U.esc(project.id) + '">Rename</button>';
    h += '<button class="btn-sm btn-danger" style="flex:1" data-action="confirm-delete-project" data-id="' +
      U.esc(project.id) + '">Delete</button>';
    h += '</div>';
    return h;
  }

  function busyBar(label, fraction) {
    var pct = U.clamp(Math.round((fraction || 0) * 100), 3, 100);
    return '<div class="card">' +
      '<div class="bold" style="margin-bottom:10px">' + U.esc(label) + '</div>' +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="tiny faint mono" style="margin-top:8px">' + pct + '%</div>' +
    '</div>';
  }

  function aiBlockedNote() {
    var reason = CF.ai.blockedReason();
    if (!reason) return '';
    return ui.note(U.esc(reason), 'warn') + '<div style="height:12px"></div>';
  }

  /* ------------------------------------------------------------------ plan */

  /* One continuous scroll: score → scene plan → generated content. Each
     section only appears once the step before it is ready, so the page reads
     as a guided sequence rather than a wall of everything at once. */
  function renderPlan(project) {
    var st = CF.state;
    var h = '';

    if (st.aiBusy.active && st.aiBusy.kind === 'analyze') {
      return busyBar(st.aiBusy.label, st.aiBusy.fraction) + analysisStepsNote();
    }

    if (!project.aiAnalysis) {
      h += aiBlockedNote();
      h += '<div class="card">';
      h += '<div class="bold" style="margin-bottom:6px">Not analysed yet</div>';
      h += '<div class="small muted">ClipForge will send <b>' + (project.frameCount || 0) +
        ' still frames</b> from this clip to Gemini — not the video file — and get back a scene-by-scene plan.</div>';
      h += '</div>';
      h += ui.note('AI analysis sends this clip\'s frames to Gemini for analysis. Editing and project storage stay on your device.', 'info');
      h += '<div style="height:14px"></div>';
      h += '<button class="btn-primary btn-block" data-action="analyze-now"' +
           (CF.ai.blockedReason() ? ' disabled' : '') + '>Analyse this clip</button>';
      return h;
    }

    h += renderScore(project);
    h += renderScenePlan(project);
    h += renderContentSection(project);

    h += '<div style="height:6px"></div>';
    h += '<button class="btn-primary btn-block" data-action="studio-tab" data-value="edit">Continue to Edit</button>';
    return h;
  }

  function analysisStepsNote() {
    return '<ul class="steps">' +
      '<li class="done">✓ Reading the frames</li>' +
      '<li class="active">● Detecting scenes and the hook</li>' +
      '<li>○ Scoring the clip</li>' +
      '<li>○ Building the edit plan</li>' +
    '</ul>';
  }

  /* --------------------------------------------------------------- score */

  function renderScore(project) {
    var a = project.aiAnalysis;
    var verdict = CF.aiSchema.verdictFor(a.score.overall);
    var h = '';

    h += '<div class="card" style="text-align:center">';
    h += '<div class="tiny faint" style="letter-spacing:.1em">CONTENT SCORE</div>';
    h += '<div class="score-big" style="color:var(--' + verdict.tone + ')">' + a.score.overall + '<span class="score-out">/100</span></div>';
    h += '<div class="bold" style="color:var(--' + verdict.tone + ');margin-top:2px">' + U.esc(verdict.label) + '</div>';
    h += '<div class="tiny faint" style="margin-top:8px">An editing judgement, not a prediction of views.</div>';
    h += '</div>';

    h += '<div class="card">';
    CF.aiSchema.SCORE_PARTS.forEach(function (part) {
      var value = a.score[part[0]];
      h += '<div class="meter-row">' +
        '<span class="small muted">' + U.esc(part[1]) + '</span>' +
        '<span class="meter"><i style="width:' + (value / 20 * 100) + '%"></i></span>' +
        '<span class="small mono bold">' + value + '/20</span>' +
      '</div>';
    });
    h += '</div>';

    h += '<div class="section-label">What Gemini saw</div>';
    h += '<div class="card">';
    h += '<div class="small"><b>Product:</b> ' + U.esc(a.video.product) + '</div>';
    h += '<div class="small muted" style="margin-top:6px">' + U.esc(a.video.description) + '</div>';
    h += '</div>';

    if (a.recommendedStructure && a.recommendedStructure.length) {
      h += '<div class="section-label">Recommended structure</div>';
      h += '<div class="card"><div class="structure">' +
        a.recommendedStructure.map(function (s) {
          return '<span class="struct-step">' + U.esc(PURPOSE_ICON[s] || '') + ' ' + U.esc(s) + '</span>';
        }).join('<span class="struct-arrow">→</span>') +
      '</div></div>';
    }

    var faces = a.scenes.filter(function (s) { return s.faceDetected; });
    if (faces.length) {
      h += ui.note('⚠️ <b>Face detected</b> in ' + faces.length + ' scene' + (faces.length > 1 ? 's' : '') +
        '. This is faceless content — consider trimming ' + (faces.length > 1 ? 'those sections' : 'that section') +
        ' on the Edit tab.', 'warn');
      h += '<div style="height:12px"></div>';
    }

    h += '<button class="btn-ghost btn-block" data-action="reanalyze"' +
         (CF.ai.blockedReason() ? ' disabled' : '') + '>Re-analyse (uses quota)</button>';
    h += '<div class="tiny faint" style="margin-top:8px">Results are cached, so reopening this project costs nothing.</div>';
    return h;
  }

  /* ----------------------------------------------------------- scene plan */

  function renderScenePlan(project) {
    var h = '';
    var scenes = project.aiAnalysis.scenes;

    h += '<div class="section-label">Scene plan</div>';
    h += '<div class="row" style="gap:8px;margin-bottom:12px">';
    h += '<button class="btn-sm btn-primary" style="flex:1" data-action="apply-all">Apply all safe suggestions</button>';
    h += '</div>';
    h += '<div class="tiny faint" style="margin-bottom:14px">' +
      'Switches off scenes marked REMOVE and adds the AI\'s text overlays. Reversible — the source video is never changed.' +
    '</div>';

    scenes.forEach(function (scene, i) {
      var content = project.aiContent;
      var vo = content ? voiceoverLineFor(content, scene) : null;
      var overlay = content ? overlayFor(content, scene) : null;

      h += '<div class="card">';
      h += '<div class="row-between">';
      h += '<div class="bold">' + U.esc(PURPOSE_ICON[scene.purpose] || '') + ' ' + U.esc(scene.purpose) + '</div>';
      h += '<span class="small mono faint">' + U.esc(U.clock(scene.start)) + '–' + U.esc(U.clock(scene.end)) + '</span>';
      h += '</div>';

      h += '<div class="small muted" style="margin-top:6px">' + U.esc(scene.description) + '</div>';

      h += '<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">';
      h += '<span class="tag">Strength ' + scene.visualStrength + '/10</span>';
      h += '<span class="tag">' + U.esc(scene.editingRecommendation) + '</span>';
      /* These two flags come straight from the analysis and used to be
         invisible in the UI — shown only indirectly, and only once a
         matching generated overlay/voiceover line happened to exist with
         overlapping timing. If generation gave that moment slightly
         different timing, the AI's own recommendation vanished with no
         trace. Show it plainly regardless of whether a match was found. */
      if (scene.textRecommended) h += '<span class="tag">📝 Text recommended</span>';
      if (scene.voiceoverRecommended) h += '<span class="tag">🎙 VO recommended</span>';
      if (scene.faceDetected) h += '<span class="tag" style="color:var(--warn);border-color:rgba(232,177,58,.4)">⚠ Face</span>';
      h += '</div>';

      if (scene.reason) {
        h += '<div class="tiny faint" style="margin-top:8px">' + U.esc(scene.reason) + '</div>';
      }

      if (vo) {
        h += '<div class="suggest"><div class="suggest-label">🎙 Voiceover</div>' +
          '<div class="small">' + U.esc(vo.text) + '</div>' +
          '<button class="btn-xs" style="margin-top:8px" data-action="copy-text" data-copy="' + U.esc(vo.text) + '">Copy</button>' +
        '</div>';
      } else if (scene.voiceoverRecommended && content) {
        h += '<div style="margin-top:10px">' + ui.note(
          'The AI recommended a voiceover line here, but the generated script doesn\'t line up with this exact moment. Check the full script below, or regenerate content.',
          'warn') + '</div>';
      }

      if (overlay) {
        var already = CF.editor.hasOverlayText(project, overlay.text);
        h += '<div class="suggest"><div class="suggest-label">📝 On-screen text</div>' +
          '<div class="small">' + U.esc(overlay.text) + '</div>' +
          '<button class="btn-xs" style="margin-top:8px" data-action="apply-overlay" data-oid="' + U.esc(overlay.id) + '"' +
            (already ? ' disabled' : '') + '>' + (already ? '✓ Added' : 'Add to video') + '</button>' +
        '</div>';
      } else if (scene.textRecommended && content) {
        h += '<div style="margin-top:10px">' + ui.note(
          'The AI recommended on-screen text here, but none of the generated overlays line up with this exact moment. Check the suggested text below, or add your own on the Edit tab.',
          'warn') + '</div>';
      }

      if (scene.editingRecommendation === 'REMOVE') {
        h += '<div class="suggest suggest-cut"><div class="suggest-label">✂ Recommendation</div>' +
          '<div class="small">Cut this section.</div>' +
          '<button class="btn-xs" style="margin-top:8px" data-action="cut-scene" data-idx="' + i + '">Switch it off</button>' +
        '</div>';
      }

      h += '</div>';
    });

    if (!project.aiContent) {
      h += ui.note('Voiceover lines and on-screen text appear right below once you generate content.', 'info');
    }

    return h;
  }

  function voiceoverLineFor(content, scene) {
    var variant = content.voiceovers && content.voiceovers[CF.state.studioVoiceover || 'medium'];
    if (!variant || !variant.segments) return null;
    var hit = null;
    variant.segments.forEach(function (s) {
      var overlapStart = Math.max(s.start, scene.start);
      var overlapEnd = Math.min(s.end, scene.end);
      if (overlapEnd - overlapStart > 0.3 && !hit) hit = s;
    });
    return hit;
  }

  function overlayFor(content, scene) {
    var hit = null;
    (content.textOverlays || []).forEach(function (o) {
      var overlapStart = Math.max(o.start, scene.start);
      var overlapEnd = Math.min(o.end, scene.end);
      if (overlapEnd - overlapStart > 0.2 && !hit) hit = o;
    });
    return hit;
  }

  /* -------------------------------------------------------------- content */

  function renderContentSection(project) {
    var st = CF.state;
    var h = '';

    if (st.aiBusy.active && st.aiBusy.kind === 'generate') {
      return '<div class="section-label">Hooks, captions &amp; voiceover</div>' + busyBar(st.aiBusy.label, st.aiBusy.fraction);
    }

    if (!project.aiContent) {
      h += '<div class="section-label">Hooks, captions &amp; voiceover</div>';
      h += aiBlockedNote();
      h += '<div class="card">';
      h += '<div class="bold" style="margin-bottom:6px">Write the words</div>';
      h += '<div class="small muted">5 hooks, 3 captions, three voiceover lengths and timed on-screen text — all built from the scene plan above, in your chosen language.</div>';
      h += '</div>';
      h += '<div class="section-label">Language</div>';
      h += ui.chipRow('set-project-language', CF.LANGUAGES, project.language);
      h += '<div style="height:14px"></div>';
      h += '<button class="btn-primary btn-block" data-action="generate-content"' +
           (CF.ai.blockedReason() ? ' disabled' : '') + '>Generate content</button>';
      return h;
    }

    var c = project.aiContent;

    /* hooks */
    h += '<div class="section-label">Hooks — pick one</div>';
    (c.hooks || []).forEach(function (hook) {
      var chosen = project.chosenHookId === hook.id;
      h += '<div class="card card-tight' + (chosen ? ' picked' : '') + '">';
      h += '<div class="row-between"><span class="tag">' +
        U.esc(HOOK_STYLE_LABEL[hook.style] || hook.style) + '</span>' +
        (chosen ? '<span class="tag" style="color:var(--good);border-color:rgba(53,192,122,.4)">✓ Chosen</span>' : '') +
      '</div>';
      h += '<div style="margin-top:8px">' + U.esc(hook.text) + '</div>';
      h += '<div class="row" style="gap:6px;margin-top:10px">';
      h += '<button class="btn-xs" data-action="pick-hook" data-hid="' + U.esc(hook.id) + '">' +
        (chosen ? 'Chosen' : 'Use this') + '</button>';
      h += '<button class="btn-xs" data-action="copy-text" data-copy="' + U.esc(hook.text) + '">Copy</button>';
      h += '<button class="btn-xs" data-action="hook-to-overlay" data-hid="' + U.esc(hook.id) + '">Put on video</button>';
      h += '</div>';
      h += '</div>';
    });
    if (!(c.hooks || []).length) h += ui.note('No usable hooks came back. Try regenerating.', 'warn');

    /* voiceovers */
    h += '<div class="section-label">Voiceover script</div>';
    var current = CF.state.studioVoiceover || 'medium';
    h += ui.chipRow('set-vo-variant', [
      ['short', 'Short'], ['medium', 'Medium'], ['full', 'Full']
    ], current);

    var variant = c.voiceovers && c.voiceovers[current];
    if (variant && variant.segments && variant.segments.length) {
      h += '<div class="card" style="margin-top:10px">';
      h += '<div class="row-between" style="margin-bottom:8px">';
      h += '<span class="tiny faint mono">reads in about ' + U.esc(String(variant.totalSeconds)) + 's</span>';
      h += '<span class="tag" style="' + (variant.fitsClip ? '' : 'color:var(--warn);border-color:rgba(232,177,58,.4)') + '">' +
        (variant.fitsClip ? 'Fits the clip' : 'Longer than the clip') + '</span>';
      h += '</div>';
      variant.segments.forEach(function (seg) {
        h += '<div class="vo-line"><span class="mono tiny faint">' + U.esc(U.clock(seg.start)) + '</span>' +
             '<span>' + U.esc(seg.text) + '</span></div>';
      });
      var full = variant.segments.map(function (s) { return s.text; }).join(' ');
      h += '<button class="btn-sm btn-block" style="margin-top:10px" data-action="copy-text" data-copy="' + U.esc(full) + '">Copy whole script</button>';
      h += '</div>';
    } else {
      h += '<div class="card"><div class="small muted">No script for this length.</div></div>';
    }

    /* captions */
    h += '<div class="section-label">Captions</div>';
    (c.captions || []).forEach(function (cap) {
      h += '<div class="card card-tight">';
      h += '<span class="tag">' + U.esc(CAPTION_STYLE_LABEL[cap.style] || cap.style) + '</span>';
      h += '<div style="margin-top:8px;white-space:pre-wrap">' + U.esc(cap.text) + '</div>';
      h += '<button class="btn-xs" style="margin-top:10px" data-action="copy-text" data-copy="' + U.esc(cap.text) + '">Copy</button>';
      h += '</div>';
    });

    /* overlays */
    h += '<div class="section-label">Suggested on-screen text</div>';
    var overlays = c.textOverlays || [];
    if (!overlays.length) {
      h += '<div class="card"><div class="small muted">None suggested for this clip.</div></div>';
    } else {
      overlays.forEach(function (o) {
        var already = CF.editor.hasOverlayText(project, o.text);
        h += '<div class="card card-tight">';
        h += '<div class="row-between"><span class="small mono faint">' +
          U.esc(U.clock(o.start)) + '–' + U.esc(U.clock(o.end)) + '</span>' +
          '<span class="tag">' + U.esc(o.style) + '</span></div>';
        h += '<div style="margin-top:6px">' + U.esc(o.text) + '</div>';
        h += '<button class="btn-xs" style="margin-top:10px" data-action="apply-overlay" data-oid="' + U.esc(o.id) + '"' +
          (already ? ' disabled' : '') + '>' + (already ? '✓ Added' : 'Add to video') + '</button>';
        h += '</div>';
      });
    }

    h += '<div style="height:16px"></div>';
    h += '<button class="btn-ghost btn-block" data-action="regenerate-content"' +
         (CF.ai.blockedReason() ? ' disabled' : '') + '>Regenerate (uses quota)</button>';
    return h;
  }

  /* ------------------------------------------------------------------- edit */

  function renderEdit(project) {
    CF.editor.ensureSegments(project);
    var timeline = CF.editor.outputTimeline(project);
    var segs = project.edits.segments;
    var h = '';

    h += '<div class="row-between" style="margin-bottom:10px">';
    h += '<div class="small muted mono">Output ' + U.esc(U.clock(timeline.duration)) +
         ' of ' + U.esc(U.clock(project.video.duration)) + '</div>';
    h += '<div class="row" style="gap:6px">';
    h += '<button class="btn-xs" data-action="undo"' + (CF.editor.canUndo(project) ? '' : ' disabled') + '>↶ Undo</button>';
    h += '<button class="btn-xs" data-action="redo"' + (CF.editor.canRedo(project) ? '' : ' disabled') + '>↷ Redo</button>';
    h += '</div></div>';

    /* visual timeline */
    h += '<div class="timeline">';
    if (timeline.segments.length) {
      timeline.segments.forEach(function (s) {
        var pct = (s.length / timeline.duration) * 100;
        h += '<div class="tl-seg" style="width:' + pct + '%" title="' + U.esc(s.label || '') + '">' +
          '<span>' + U.esc(s.label || '·') + '</span></div>';
      });
    } else {
      h += '<div class="tl-empty">Nothing enabled</div>';
    }
    h += '</div>';

    if (project.textOverlays.length) {
      h += '<div class="timeline tl-overlays">';
      project.textOverlays.forEach(function (o) {
        var left = (o.start / Math.max(timeline.duration, 0.01)) * 100;
        var width = ((o.end - o.start) / Math.max(timeline.duration, 0.01)) * 100;
        h += '<div class="tl-ov" style="left:' + U.clamp(left, 0, 100) + '%;width:' + U.clamp(width, 1, 100) + '%"></div>';
      });
      h += '</div>';
      h += '<div class="tiny faint" style="margin-top:4px">Orange marks show where text appears.</div>';
    }

    CF.editor.overlapWarnings(project).forEach(function (w) {
      h += ui.note('⚠️ ' + U.esc(w), 'warn');
    });

    /* format controls */
    h += '<div class="section-label">Format</div>';
    h += ui.chipRow('set-crop', [['9:16', '9:16 crop'], ['none', 'Keep original']], project.edits.crop);
    h += '<div class="switch-row"><div><div class="bold">Mute original audio</div>' +
      '<div class="tiny faint">Use if you will record a voiceover over it later.</div></div>' +
      '<button class="switch' + (project.edits.muted ? ' on' : '') + '" data-action="toggle-mute"></button></div>';

    /* segments */
    h += '<div class="section-label">Segments (' + segs.length + ')</div>';
    segs.forEach(function (seg, i) {
      var length = seg.sourceEnd - seg.sourceStart;
      h += '<div class="card card-tight' + (seg.enabled ? '' : ' disabled-seg') + '">';
      h += '<div class="row-between">';
      h += '<div class="bold">' + (seg.purpose ? U.esc(PURPOSE_ICON[seg.purpose] || '') + ' ' + U.esc(seg.purpose) : 'Segment ' + (i + 1)) + '</div>';
      h += '<span class="small mono faint">' + U.esc(U.clock(seg.sourceStart)) + '–' + U.esc(U.clock(seg.sourceEnd)) +
           ' · ' + U.esc(U.round(length, 1) + 's') + '</span>';
      h += '</div>';

      h += '<div class="seg-controls">';
      h += '<button class="btn-xs" data-action="seg-toggle" data-sid="' + U.esc(seg.id) + '">' +
        (seg.enabled ? '👁 On' : '🚫 Off') + '</button>';
      h += '<button class="btn-xs" data-action="seg-move" data-sid="' + U.esc(seg.id) + '" data-dir="-1"' +
        (i === 0 ? ' disabled' : '') + '>↑</button>';
      h += '<button class="btn-xs" data-action="seg-move" data-sid="' + U.esc(seg.id) + '" data-dir="1"' +
        (i === segs.length - 1 ? ' disabled' : '') + '>↓</button>';
      h += '<button class="btn-xs" data-action="seg-split" data-sid="' + U.esc(seg.id) + '">Split</button>';
      h += '<button class="btn-xs btn-danger" data-action="seg-delete" data-sid="' + U.esc(seg.id) + '"' +
        (segs.length <= 1 ? ' disabled' : '') + '>Delete</button>';
      h += '</div>';

      h += '<div class="seg-controls" style="margin-top:6px">';
      h += '<span class="tiny faint" style="align-self:center">Trim start</span>';
      h += '<button class="btn-xs" data-action="seg-trim" data-sid="' + U.esc(seg.id) + '" data-edge="start" data-delta="-0.5">−0.5s</button>';
      h += '<button class="btn-xs" data-action="seg-trim" data-sid="' + U.esc(seg.id) + '" data-edge="start" data-delta="0.5">+0.5s</button>';
      h += '<span class="tiny faint" style="align-self:center">end</span>';
      h += '<button class="btn-xs" data-action="seg-trim" data-sid="' + U.esc(seg.id) + '" data-edge="end" data-delta="-0.5">−0.5s</button>';
      h += '<button class="btn-xs" data-action="seg-trim" data-sid="' + U.esc(seg.id) + '" data-edge="end" data-delta="0.5">+0.5s</button>';
      h += '</div>';
      h += '</div>';
    });

    if (project.aiAnalysis) {
      h += '<button class="btn-ghost btn-block" style="margin-top:6px" data-action="reset-segments">Reset to the AI\'s cut</button>';
    }

    /* overlays */
    h += '<div class="section-label">Text overlays (' + project.textOverlays.length + ')</div>';
    if (!project.textOverlays.length) {
      h += '<div class="card"><div class="small muted">None yet. Add one below, or apply the AI\'s suggestions from the Plan tab.</div></div>';
    }
    project.textOverlays.forEach(function (o) {
      h += '<div class="card card-tight">';
      h += '<div class="row-between"><span class="small mono faint">' +
        U.esc(U.clock(o.start)) + '–' + U.esc(U.clock(o.end)) + '</span>' +
        '<span class="tag">' + U.esc(o.position) + ' · ' + U.esc(o.style) + '</span></div>';
      h += '<div style="margin-top:6px">' + U.esc(o.text) + '</div>';
      h += '<div class="seg-controls" style="margin-top:8px">';
      h += '<button class="btn-xs" data-action="overlay-edit" data-oid="' + U.esc(o.id) + '">Edit</button>';
      h += '<button class="btn-xs" data-action="overlay-nudge" data-oid="' + U.esc(o.id) + '" data-delta="-0.5">◀ 0.5s</button>';
      h += '<button class="btn-xs" data-action="overlay-nudge" data-oid="' + U.esc(o.id) + '" data-delta="0.5">0.5s ▶</button>';
      h += '<button class="btn-xs btn-danger" data-action="overlay-delete" data-oid="' + U.esc(o.id) + '">Delete</button>';
      h += '</div>';
      h += '</div>';
    });
    h += '<button class="btn-sm btn-block" data-action="overlay-new">＋ Add text overlay</button>';

    h += '<div style="height:16px"></div>';
    h += '<button class="btn-primary btn-block" data-action="studio-tab" data-value="export">Go to export</button>';
    return h;
  }

  /* ----------------------------------------------------------------- export */

  function renderExport(project) {
    var st = CF.state;
    var timeline = CF.editor.outputTimeline(project);
    var support = CF.exporter.support();
    var h = '';

    if (st.exportBusy.active) {
      h += busyBar(st.exportBusy.label, st.exportBusy.fraction);
      h += '<button class="btn-ghost btn-block" data-action="export-cancel">Cancel</button>';
      h += '<div class="tiny faint" style="margin-top:10px">Rendering runs in real time — about ' +
        U.esc(U.clock(timeline.duration)) + ' for this clip. Keep this tab open and the screen awake.</div>';
      return h;
    }

    h += '<div class="card">';
    h += '<div class="row-between"><span class="small muted">Length</span><span class="small mono bold">' +
      U.esc(U.clock(timeline.duration)) + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Size</span><span class="small mono bold">' +
      (project.edits.crop === '9:16' ? '1080 × 1920 (9:16)' : 'original shape') + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Segments</span><span class="small mono bold">' +
      timeline.segments.length + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Text overlays</span><span class="small mono bold">' +
      project.textOverlays.length + '</span></div>';
    h += '<div class="row-between" style="margin-top:8px"><span class="small muted">Audio</span><span class="small mono bold">' +
      (project.edits.muted ? 'muted' : 'from source') + '</span></div>';
    h += '</div>';

    if (!support.ok) {
      h += ui.note('<b>This browser cannot export.</b> ' + U.esc(support.reasons.join(' ')) +
        ' Try Chrome or Safari on a normal (non-private) window.', 'warn');
      return h;
    }

    if (!timeline.segments.length) {
      h += ui.note('Nothing is switched on. Enable at least one segment on the Edit tab.', 'warn');
      return h;
    }

    if (st.exportResult) {
      var r = st.exportResult;
      h += '<div class="section-label">Ready</div>';
      h += '<div class="card">';
      h += '<div class="bold">' + U.esc(r.filename) + '</div>';
      h += '<div class="small muted mono" style="margin-top:4px">' + U.esc(U.bytes(r.blob.size)) +
        ' · ' + U.esc(r.extension.toUpperCase()) + '</div>';
      h += '<button class="btn-primary btn-block" style="margin-top:12px" data-action="export-download">Save the video</button>';
      if (r.extension !== 'mp4') {
        h += '<div style="height:8px"></div>';
        h += '<button class="btn-sm btn-block" data-action="export-to-mp4">Convert to MP4 first</button>';
        h += '<div class="tiny faint" style="margin-top:8px">WebM uploads to TikTok from most phones, but MP4 is the safest bet. ' +
          'Converting downloads a ~30 MB tool the first time.</div>';
      }
      h += '</div>';
      h += '<button class="btn-ghost btn-block" data-action="export-start">Render again</button>';
      return h;
    }

    h += '<div class="section-label">Export</div>';
    h += ui.note('Rendering happens on your device — nothing is uploaded. It runs in <b>real time</b>, so a ' +
      U.esc(U.clock(timeline.duration)) + ' video takes about that long. Keep the screen awake.', 'info');
    h += '<div style="height:12px"></div>';
    h += '<button class="btn-primary btn-block" data-action="export-start">Render ' +
      U.esc(support.isMp4 ? 'MP4' : 'video') + '</button>';
    h += '<div class="tiny faint" style="margin-top:8px">This browser records ' +
      U.esc(support.isMp4 ? 'MP4 directly' : 'WebM, which can be converted to MP4 afterwards') + '.</div>';
    return h;
  }

  /* -------------------------------------------------------------- overlay form */

  St.overlayForm = function (project, overlayId) {
    var existing = null;
    (project.textOverlays || []).forEach(function (o) { if (o.id === overlayId) existing = o; });
    var outDuration = CF.editor.outputDuration(project);

    var h = '<div class="modal-title">' + (existing ? 'Edit text' : 'Add text overlay') + '</div>';
    h += '<label class="field"><span>Text (max ' + CF.aiSchema.MAX_OVERLAY_CHARS + ' characters)</span>' +
      '<input type="text" id="ovText" maxlength="' + CF.aiSchema.MAX_OVERLAY_CHARS + '" value="' +
      U.esc(existing ? existing.text : '') + '" placeholder="Jimat masa memasak"></label>';

    h += '<div class="row" style="gap:8px">';
    h += '<label class="field" style="flex:1"><span>Start (s)</span>' +
      '<input type="number" id="ovStart" step="0.1" min="0" max="' + outDuration + '" value="' +
      U.esc(existing ? existing.start : 0) + '"></label>';
    h += '<label class="field" style="flex:1"><span>End (s)</span>' +
      '<input type="number" id="ovEnd" step="0.1" min="0" max="' + outDuration + '" value="' +
      U.esc(existing ? existing.end : Math.min(2.5, outDuration)) + '"></label>';
    h += '</div>';

    h += '<label class="field"><span>Position</span><select id="ovPos">' +
      CF.aiSchema.POSITIONS.map(function (p) {
        return '<option value="' + p + '"' + (existing && existing.position === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('') + '</select></label>';

    h += '<label class="field"><span>Style</span><select id="ovStyle">' +
      CF.aiSchema.OVERLAY_STYLES.map(function (p) {
        return '<option value="' + p + '"' + (existing && existing.style === p ? ' selected' : '') + '>' + p + '</option>';
      }).join('') + '</select></label>';

    h += '<div class="row" style="gap:8px">';
    h += '<button class="btn-ghost" style="flex:1" data-action="close-modal">Cancel</button>';
    h += '<button class="btn-primary" style="flex:1" data-action="overlay-save" data-oid="' +
      U.esc(existing ? existing.id : '') + '">Save</button>';
    h += '</div>';

    ui.openModal(h);
  };

  St.splitForm = function (project, segmentId) {
    var hit = CF.editor.find(project, segmentId);
    if (!hit) return;
    var seg = hit.segment;
    var mid = U.round((seg.sourceStart + seg.sourceEnd) / 2, 1);

    ui.openModal(
      '<div class="modal-title">Split this segment</div>' +
      '<div class="small muted" style="margin-bottom:12px">This segment runs ' +
        U.esc(U.clock(seg.sourceStart)) + ' to ' + U.esc(U.clock(seg.sourceEnd)) +
        '. Pick where to cut it in two.</div>' +
      '<label class="field"><span>Split at (seconds into the original clip)</span>' +
        '<input type="number" id="splitAt" step="0.1" min="' + seg.sourceStart + '" max="' + seg.sourceEnd +
        '" value="' + mid + '"></label>' +
      '<div class="row" style="gap:8px">' +
        '<button class="btn-ghost" style="flex:1" data-action="close-modal">Cancel</button>' +
        '<button class="btn-primary" style="flex:1" data-action="seg-split-confirm" data-sid="' + U.esc(segmentId) + '">Split</button>' +
      '</div>'
    );
  };

})(window.CF);
