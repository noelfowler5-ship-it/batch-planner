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

  var POLICY_DISCLAIMER = 'Advisory only — a heuristic self-check based on common patterns, not a guarantee of TikTok compliance. Always review TikTok\'s current Community Guidelines and Branded Content Policy yourself before posting.';

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

    if (!CF.project.allAnalyzed(project)) {
      var clips = project.clips || [];
      var pending = clips.filter(function (c) { return !c.analysis; });
      var multi = clips.length > 1;
      var frames = clips.reduce(function (sum, c) { return sum + (c.frameCount || 0); }, 0);

      h += aiBlockedNote();
      h += '<div class="card">';
      h += '<div class="bold" style="margin-bottom:6px">Not analysed yet</div>';
      if (multi) {
        h += '<div class="small muted">ClipForge will send <b>' + frames + ' still frames</b> across your ' +
          clips.length + ' clips to Gemini — not the video files — and get back one combined scene-by-scene plan.</div>';
        if (pending.length && pending.length < clips.length) {
          h += '<div class="tiny faint" style="margin-top:8px">' + (clips.length - pending.length) + ' of ' +
            clips.length + ' clips already analysed. Analysing again only sends the remaining ' + pending.length + '.</div>';
        }
      } else {
        h += '<div class="small muted">ClipForge will send <b>' + frames +
          ' still frames</b> from this clip to Gemini — not the video file — and get back a scene-by-scene plan.</div>';
      }
      h += '</div>';
      h += ui.note('AI analysis sends frames to Gemini for analysis. Editing and project storage stay on your device.', 'info');
      h += '<div style="height:14px"></div>';
      h += '<button class="btn-primary btn-block" data-action="analyze-now"' +
           (CF.ai.blockedReason() ? ' disabled' : '') + '>' +
           (multi ? 'Analyse ' + (pending.length === clips.length ? 'all clips' : 'remaining clips') : 'Analyse this clip') +
           '</button>';
      return h;
    }

    h += renderScore(project);
    h += renderScenePlan(project);
    h += renderContentSection(project);
    h += renderPolicyCheck(project);

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

  /* For each score part, the average across every analysed clip — the same
     honest-average approach as P.combinedScore, applied part by part so the
     breakdown meters mean something for a multi-clip project too. */
  function averagedScoreParts(clips) {
    var out = {};
    CF.aiSchema.SCORE_PARTS.forEach(function (part) {
      var vals = clips.map(function (c) { return c.analysis && c.analysis.score && c.analysis.score[part[0]]; })
        .filter(function (v) { return typeof v === 'number'; });
      out[part[0]] = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : 0;
    });
    return out;
  }

  function renderScore(project) {
    var clips = project.clips || [];
    var multi = clips.length > 1;
    var overall = CF.project.combinedScore(project);
    var verdict = CF.aiSchema.verdictFor(overall || 0);
    var h = '';

    h += '<div class="card" style="text-align:center">';
    h += '<div class="tiny faint" style="letter-spacing:.1em">' + (multi ? 'COMBINED CONTENT SCORE' : 'CONTENT SCORE') + '</div>';
    h += '<div class="score-big" style="color:var(--' + verdict.tone + ')">' + overall + '<span class="score-out">/100</span></div>';
    h += '<div class="bold" style="color:var(--' + verdict.tone + ');margin-top:2px">' + U.esc(verdict.label) + '</div>';
    h += '<div class="tiny faint" style="margin-top:8px">' +
      (multi ? 'Averaged across your ' + clips.length + ' clips. ' : 'An editing judgement') +
      (multi ? 'An editing judgement, not a prediction of views.' : ', not a prediction of views.') + '</div>';
    h += '</div>';

    h += '<div class="card">';
    var parts = averagedScoreParts(clips);
    CF.aiSchema.SCORE_PARTS.forEach(function (part) {
      var value = parts[part[0]];
      h += '<div class="meter-row">' +
        '<span class="small muted">' + U.esc(part[1]) + '</span>' +
        '<span class="meter"><i style="width:' + (value / 20 * 100) + '%"></i></span>' +
        '<span class="small mono bold">' + value + '/20</span>' +
      '</div>';
    });
    h += '</div>';

    h += '<div class="section-label">What Gemini saw</div>';
    var totalFaces = 0;
    clips.forEach(function (clip, i) {
      var a = clip.analysis;
      if (!a) return;
      h += '<div class="card">';
      if (multi) h += '<div class="tiny faint" style="margin-bottom:4px">CLIP ' + (i + 1) + ' — ' + U.esc(clip.name || '') + '</div>';
      h += '<div class="small"><b>Product:</b> ' + U.esc(a.video.product) + '</div>';
      h += '<div class="small muted" style="margin-top:6px">' + U.esc(a.video.description) + '</div>';
      h += '</div>';

      if (a.recommendedStructure && a.recommendedStructure.length) {
        h += '<div class="card" style="margin-top:8px"><div class="structure">' +
          a.recommendedStructure.map(function (s) {
            return '<span class="struct-step">' + U.esc(PURPOSE_ICON[s] || '') + ' ' + U.esc(s) + '</span>';
          }).join('<span class="struct-arrow">→</span>') +
        '</div></div>';
      }
      totalFaces += (a.scenes || []).filter(function (s) { return s.faceDetected; }).length;
    });

    if (totalFaces) {
      h += ui.note('⚠️ <b>Face detected</b> in ' + totalFaces + ' scene' + (totalFaces > 1 ? 's' : '') +
        '. This is faceless content — consider trimming ' + (totalFaces > 1 ? 'those sections' : 'that section') +
        ' on the Edit tab.', 'warn');
      h += '<div style="height:12px"></div>';
    }

    h += '<button class="btn-ghost btn-block" data-action="reanalyze"' +
         (CF.ai.blockedReason() ? ' disabled' : '') + '>Re-analyse' + (multi ? ' all clips' : '') + ' (uses quota)</button>';
    h += '<div class="tiny faint" style="margin-top:8px">Results are cached, so reopening this project costs nothing.</div>';
    return h;
  }

  /* ----------------------------------------------------------- scene plan */

  /* Content (hooks/captions/voiceover/overlays) is generated once across
     every clip and stored in the combined/global timeline (see project.js),
     so matching it against one clip's scene needs that scene's global
     start/end, not its own local time — two clips can share the same local
     numbers. */
  function renderScenePlan(project) {
    var h = '';
    var clips = project.clips || [];
    var multi = clips.length > 1;
    var content = project.aiContent;

    h += '<div class="section-label">Scene plan</div>';
    h += '<div class="row" style="gap:8px;margin-bottom:12px">';
    h += '<button class="btn-sm btn-primary" style="flex:1" data-action="apply-all">Apply all safe suggestions</button>';
    h += '</div>';
    h += '<div class="tiny faint" style="margin-bottom:14px">' +
      'Switches off scenes marked REMOVE and adds the AI\'s text overlays. Reversible — the source video is never changed.' +
    '</div>';

    CF.editor.ensureSegments(project);

    clips.forEach(function (clip, ci) {
      var scenes = (clip.analysis && clip.analysis.scenes) || [];
      if (!scenes.length) return;
      if (multi) h += '<div class="tiny faint" style="margin:14px 0 6px">CLIP ' + (ci + 1) + ' — ' + U.esc(clip.name || '') + '</div>';

      scenes.forEach(function (scene) {
        var globalStart = CF.project.localToGlobal(project, clip.id, scene.start);
        var globalEnd = CF.project.localToGlobal(project, clip.id, scene.end);
        var vo = content ? voiceoverLineFor(content, globalStart, globalEnd) : null;
        var overlay = content ? overlayFor(content, globalStart, globalEnd) : null;
        var seg = (project.edits.segments || []).filter(function (s) {
          return s.clipId === clip.id && s.sourceStart === scene.start && s.sourceEnd === scene.end;
        })[0];

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

        if (scene.editingRecommendation === 'REMOVE' && seg) {
          h += '<div class="suggest suggest-cut"><div class="suggest-label">✂ Recommendation</div>' +
            '<div class="small">Cut this section.</div>' +
            '<button class="btn-xs" style="margin-top:8px" data-action="cut-scene" data-sid="' + U.esc(seg.id) + '">Switch it off</button>' +
          '</div>';
        }

        h += '</div>';
      });
    });

    if (!project.aiContent) {
      h += ui.note('Voiceover lines and on-screen text appear right below once you generate content.', 'info');
    }

    return h;
  }

  function voiceoverLineFor(content, globalStart, globalEnd) {
    var variant = content.voiceovers && content.voiceovers[CF.state.studioVoiceover || 'medium'];
    if (!variant || !variant.segments) return null;
    var hit = null;
    variant.segments.forEach(function (s) {
      var overlapStart = Math.max(s.start, globalStart);
      var overlapEnd = Math.min(s.end, globalEnd);
      if (overlapEnd - overlapStart > 0.3 && !hit) hit = s;
    });
    return hit;
  }

  function overlayFor(content, globalStart, globalEnd) {
    var hit = null;
    (content.textOverlays || []).forEach(function (o) {
      var overlapStart = Math.max(o.start, globalStart);
      var overlapEnd = Math.min(o.end, globalEnd);
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

  /* --------------------------------------------------------- policy check */

  /* A self-check for the patterns that most often get an affiliate creator
     flagged — faked promotion/urgency, faked danger, missing paid-partnership
     disclosure, fake testimonials, unverifiable claims. Advisory only: this
     is a heuristic pattern check, never a guarantee of TikTok compliance,
     which is stated plainly wherever a result is shown here. */
  function renderPolicyCheck(project) {
    var st = CF.state;

    if (st.aiBusy.active && st.aiBusy.kind === 'policy') {
      return '<div class="section-label">Policy check</div>' + busyBar(st.aiBusy.label, st.aiBusy.fraction);
    }

    if (!project.aiContent) return ''; /* nothing generated yet to check */

    var h = '<div class="section-label">Policy check</div>';

    if (!project.policyCheck) {
      h += '<div class="card">';
      h += '<div class="small muted">Not checked yet. This runs automatically right after content is generated — if you\'re seeing this, the automatic check may have failed.</div>';
      h += '</div>';
      h += '<button class="btn-sm btn-block" data-action="check-policy"' +
           (CF.ai.blockedReason() ? ' disabled' : '') + '>Check for policy risks</button>';
      h += '<div class="tiny faint" style="margin-top:8px">' + U.esc(POLICY_DISCLAIMER) + '</div>';
      return h;
    }

    var pc = project.policyCheck;
    var band = CF.aiSchema.riskBand(pc.overallRisk);

    h += '<div class="card">';
    h += '<div class="bold" style="color:var(--' + band.tone + ')">' + U.esc(band.label) + '</div>';
    h += '<div class="small muted" style="margin-top:6px">' + U.esc(pc.summary) + '</div>';
    h += '</div>';

    pc.flags.forEach(function (flag) {
      h += '<div class="card card-tight">';
      h += '<div class="row-between">';
      h += '<span class="tag" style="' + (flag.severity === 'high' ? 'color:var(--bad);border-color:rgba(229,84,75,.4)' :
        flag.severity === 'medium' ? 'color:var(--warn);border-color:rgba(232,177,58,.4)' : '') + '">' +
        U.esc(flag.severity) + '</span>';
      h += '<span class="tiny faint">' + U.esc(flag.source) + '</span>';
      h += '</div>';
      h += '<div class="bold" style="margin-top:6px">' + U.esc(CF.aiSchema.FLAG_CATEGORY_LABEL[flag.category] || flag.category) + '</div>';
      h += '<div class="small" style="margin-top:4px;font-style:italic">“' + U.esc(flag.excerpt) + '”</div>';
      h += '<div class="small muted" style="margin-top:6px">' + U.esc(flag.reason) + '</div>';
      if (flag.suggestion) {
        h += '<div class="suggest" style="margin-top:8px"><div class="suggest-label">Suggested fix</div>' +
          '<div class="small">' + U.esc(flag.suggestion) + '</div></div>';
      }
      h += '</div>';
    });

    h += ui.note(U.esc(POLICY_DISCLAIMER), 'warn');
    h += '<div style="height:8px"></div>';
    h += '<button class="btn-ghost btn-block" data-action="recheck-policy"' +
         (CF.ai.blockedReason() ? ' disabled' : '') + '>Check again (uses quota)</button>';
    return h;
  }

  /* ------------------------------------------------------------------- edit */

  function renderEdit(project) {
    if (CF.state.ingest.active) {
      return CF.screens.renderIngestProgress(CF.state.ingest);
    }

    CF.editor.ensureSegments(project);
    var timeline = CF.editor.outputTimeline(project);
    var segs = project.edits.segments;
    var h = '';

    h += '<div class="row-between" style="margin-bottom:10px">';
    h += '<div class="small muted mono">Output ' + U.esc(U.clock(timeline.duration)) +
         ' of ' + U.esc(U.clock(CF.project.combinedDuration(project))) + '</div>';
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

    h += '<button class="btn-primary btn-block" style="margin-top:4px" data-action="preview-open"' +
      (timeline.segments.length ? '' : ' disabled') + '>▶ Preview with overlays</button>';
    h += '<div class="tiny faint" style="margin-top:6px;margin-bottom:16px">' +
      'Watch your cuts and text together before spending the time to actually export — silent, no file saved.</div>';

    /* format controls */
    h += '<div class="section-label">Format</div>';
    h += ui.chipRow('set-crop', [['9:16', '9:16 crop'], ['none', 'Keep original']], project.edits.crop);
    h += '<div class="switch-row"><div><div class="bold">Mute original audio</div>' +
      '<div class="tiny faint">Use if you will record a voiceover over it later.</div></div>' +
      '<button class="switch' + (project.edits.muted ? ' on' : '') + '" data-action="toggle-mute"></button></div>';

    /* segments — a scene is either in the video or out of it, tap to toggle.
       No trim, split, reorder or delete: they always run in the order the AI
       found them, which is what makes this a one-tap choice rather than a
       timing edit. */
    var multiClip = CF.project.isMultiClip(project);
    h += '<div class="section-label">Scenes (' + segs.length + ')</div>';
    h += '<div class="tiny faint" style="margin:-4px 0 10px">Tap a scene to include or exclude it.</div>';
    segs.forEach(function (seg) {
      var length = seg.sourceEnd - seg.sourceStart;
      var clip = CF.project.findClip(project, seg.clipId);
      h += '<div class="card card-tight seg-pick' + (seg.enabled ? '' : ' disabled-seg') +
           '" data-action="seg-toggle" data-sid="' + U.esc(seg.id) + '">';
      h += '<div class="row-between">';
      h += '<div class="bold">' + (seg.purpose ? U.esc(PURPOSE_ICON[seg.purpose] || '') + ' ' + U.esc(seg.purpose) : 'Clip') + '</div>';
      h += '<span class="tag" style="' + (seg.enabled ? 'color:var(--good);border-color:rgba(53,192,122,.4)' : '') +
        '">' + (seg.enabled ? '✓ Included' : 'Excluded') + '</span>';
      h += '</div>';
      h += '<div class="small muted mono" style="margin-top:4px">' +
        (multiClip && clip ? U.esc(clip.name || 'clip') + ' · ' : '') +
        U.esc(U.clock(seg.sourceStart)) + '–' +
        U.esc(U.clock(seg.sourceEnd)) + ' · ' + U.esc(U.round(length, 1) + 's') + '</div>';
      h += '</div>';
    });

    if ((project.clips || []).some(function (c) { return c.analysis; })) {
      h += '<button class="btn-ghost btn-block" style="margin-top:6px" data-action="reset-segments">Reset to the AI\'s cut</button>';
    }

    h += '<div class="section-label">Clips (' + (project.clips || []).length + ' of ' + CF.MAX_CLIPS + ')</div>';
    h += '<div class="tiny faint" style="margin:-4px 0 10px">Add another clip to combine it into this same video — an unboxing, a demo, a result shot.</div>';
    h += '<button class="btn-sm btn-block" data-action="add-clip"' +
      (CF.project.canAddClip(project) ? '' : ' disabled') + '>+ Add another clip</button>';
    if (!CF.project.canAddClip(project)) {
      h += '<div class="tiny faint" style="margin-top:8px">Up to ' + CF.MAX_CLIPS + ' clips per project.</div>';
    }

    /* overlays — add or remove only, timing always matches what the AI
       suggested on the Plan tab. "Clear all" makes it cheap to try a
       different batch of text on the same clip without deleting one by one. */
    h += '<div class="section-label">Text overlays (' + project.textOverlays.length + ')</div>';
    if (!project.textOverlays.length) {
      h += '<div class="card"><div class="small muted">None yet. Apply the AI\'s suggestions from the Plan tab.</div></div>';
    }
    project.textOverlays.forEach(function (o) {
      h += '<div class="card card-tight">';
      h += '<div class="row-between"><span class="small mono faint">' +
        U.esc(U.clock(o.start)) + '–' + U.esc(U.clock(o.end)) + '</span>' +
        '<span class="tag">' + U.esc(o.position) + ' · ' + U.esc(o.style) + '</span></div>';
      h += '<div style="margin-top:6px">' + U.esc(o.text) + '</div>';
      h += '<button class="btn-xs btn-danger" style="margin-top:8px" data-action="overlay-delete" data-oid="' + U.esc(o.id) + '">Delete</button>';
      h += '</div>';
    });
    if (project.textOverlays.length) {
      h += '<button class="btn-sm btn-block" data-action="confirm-clear-overlays">Clear all overlays</button>';
    }

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

    if (!timeline.segments.length) {
      h += ui.note('Nothing is switched on. Enable at least one segment on the Edit tab.', 'warn');
      return h;
    }

    /* Preview only needs canvas + a <video>, not MediaRecorder — offer it even
       on a browser that cannot actually export, since it's still useful to
       check the edit on a device you can't render on. */
    h += '<button class="btn-sm btn-block" data-action="preview-open">▶ Preview before rendering</button>';
    h += '<div style="height:16px"></div>';

    if (!support.ok) {
      h += ui.note('<b>This browser cannot export.</b> ' + U.esc(support.reasons.join(' ')) +
        ' Try Chrome or Safari on a normal (non-private) window.', 'warn');
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

})(window.CF);
