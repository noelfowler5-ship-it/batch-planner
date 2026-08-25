/* project.js — the project record and the operations on it.

   A project is metadata only. The source video is never modified and never
   re-encoded here: edits are recorded as instructions against the original, so
   every change stays reversible (spec §25 / §40). */

(function (CF) {
  'use strict';

  var U = CF.util;
  var P = {};
  CF.project = P;

  P.create = function (fields) {
    var f = fields || {};
    var now = new Date().toISOString();
    return {
      id: U.uid('proj'),
      name: f.name || 'Untitled clip',
      createdAt: now,
      updatedAt: now,

      videoId: f.videoId || null,
      fingerprint: f.fingerprint || null,

      video: {
        duration: (f.video && f.video.duration) || 0,
        width: (f.video && f.video.width) || 0,
        height: (f.video && f.video.height) || 0,
        size: (f.video && f.video.size) || 0,
        type: (f.video && f.video.type) || '',
        name: (f.video && f.video.name) || ''
      },

      frameCount: f.frameCount || 0,
      timeBudget: f.timeBudget || CF.DEFAULT_TIME_BUDGET,
      language: f.language || CF.DEFAULT_LANGUAGE,

      /* Populated by later phases. Present from the start so the shape of a
         stored project never changes underneath older records. */
      aiAnalysis: null,
      score: null,
      scenes: [],
      edits: [],
      textOverlays: [],
      voiceovers: [],
      captions: [],

      status: 'RAW'
    };
  };

  /* Fill in anything a project saved by an earlier version is missing, so an
     old record never renders as `undefined` after an update. */
  P.normalize = function (p) {
    if (!p || typeof p !== 'object') return null;
    var base = P.create({});
    var out = {};
    Object.keys(base).forEach(function (k) {
      out[k] = Object.prototype.hasOwnProperty.call(p, k) ? p[k] : base[k];
    });
    out.id = p.id || base.id;
    out.video = {
      duration: (p.video && p.video.duration) || 0,
      width: (p.video && p.video.width) || 0,
      height: (p.video && p.video.height) || 0,
      size: (p.video && p.video.size) || 0,
      type: (p.video && p.video.type) || '',
      name: (p.video && p.video.name) || ''
    };
    if (CF.STATUSES.indexOf(out.status) < 0) out.status = 'RAW';
    ['scenes', 'edits', 'textOverlays', 'voiceovers', 'captions'].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = [];
    });
    return out;
  };

  /* A sensible default name from the filename: "chopper_final_v2.MP4" -> "Chopper final v2" */
  P.nameFromFile = function (file) {
    var raw = (file && file.name) || '';
    var base = raw.replace(/\.[a-z0-9]+$/i, '');
    base = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return 'Untitled clip';
    base = base.charAt(0).toUpperCase() + base.slice(1);
    return base.length > 60 ? base.slice(0, 60).trim() : base;
  };

  P.setStatus = function (project, status) {
    if (CF.STATUSES.indexOf(status) < 0) return project;
    project.status = status;
    return project;
  };

  P.nextStatus = function (status) {
    var i = CF.STATUSES.indexOf(status);
    if (i < 0 || i >= CF.STATUSES.length - 1) return null;
    return CF.STATUSES[i + 1];
  };

  /* Group projects by workflow status for the Queue screen, in pipeline order. */
  P.groupByStatus = function (projects) {
    var groups = {};
    CF.STATUSES.forEach(function (s) { groups[s] = []; });
    (projects || []).forEach(function (p) {
      var s = (p && CF.STATUSES.indexOf(p.status) >= 0) ? p.status : 'RAW';
      groups[s].push(p);
    });
    return groups;
  };

  /* Phase 1 has no AI, so "readiness" is purely about what exists locally.
     Returns the honest next action rather than pretending a score exists. */
  P.nextAction = function (project) {
    if (!project) return null;
    if (!project.videoId) return { label: 'Video file missing', tone: 'bad' };
    if (project.status === 'POSTED') return { label: 'Done — posted', tone: 'muted' };
    if (!project.frameCount) return { label: 'Frames not extracted', tone: 'warn' };
    if (!project.aiAnalysis) return { label: 'Ready for AI analysis', tone: 'accent' };
    return { label: 'Ready to edit', tone: 'accent' };
  };

  P.summaryLine = function (project) {
    if (!project) return '';
    var bits = [];
    if (project.video && project.video.duration) bits.push(U.clock(project.video.duration));
    if (project.video && project.video.width) {
      bits.push(U.aspectLabel(project.video.width, project.video.height));
    }
    if (project.frameCount) bits.push(project.frameCount + ' frames');
    bits.push(project.timeBudget + ' min');
    return bits.join(' · ');
  };

})(window.CF);
