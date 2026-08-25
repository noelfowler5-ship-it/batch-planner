/* run.js — Phase 1 checks. Run from the clipforge/ directory:  node test/run.js
   Exits non-zero on any failure, so it works as a pre-commit gate. */

const { boot } = require('./harness.cjs');
const app = boot();

app.run(`
section('util — formatting');
ok(CF.util.clock(27.4) === '0:27', 'clock() renders 27.4s as 0:27');
ok(CF.util.clock(95) === '1:35', 'clock() renders 95s as 1:35');
ok(CF.util.clock(0) === '0:00', 'clock() renders 0 as 0:00');
ok(CF.util.clock(undefined) === '0:00', 'clock() survives undefined');
ok(CF.util.clock(-5) === '0:00', 'clock() survives a negative');
ok(CF.util.bytes(1536) === '2 KB', 'bytes() rounds KB');
ok(CF.util.bytes(5 * 1024 * 1024) === '5 MB', 'bytes() renders MB');
ok(CF.util.bytes(undefined) === '—', 'bytes() survives undefined');
ok(CF.util.esc('<img onerror="x">') === '&lt;img onerror=&quot;x&quot;&gt;', 'esc() neutralises markup');
ok(CF.util.esc("O'Brien") === 'O&#39;Brien', 'esc() escapes apostrophes');

section('util — frame sampling');
var t = CF.util.sampleTimes(20, 4);
ok(t.length === 4, 'sampleTimes returns the requested count');
ok(t[0] > 0, 'first sample is never t=0 (usually a black frame)');
ok(t[t.length - 1] < 20, 'last sample is strictly inside the clip');
ok(CF.util.sampleTimes(0, 5).length === 0, 'zero duration yields no samples');
ok(CF.util.sampleTimes(10, 0).length === 0, 'zero count yields no samples');
ok(CF.util.framesForDuration(4) === 6, 'short clip clamps to the 6-frame floor');
ok(CF.util.framesForDuration(600) === CF.FRAME_COUNT, 'long clip clamps to the frame ceiling');
ok(CF.util.framesForDuration(20) === 10, '20s clip samples 10 frames');

section('util — misc');
ok(CF.util.aspectLabel(1080, 1920) === '9:16', 'aspectLabel detects portrait');
ok(CF.util.aspectLabel(1920, 1080) === '16:9', 'aspectLabel detects landscape');
ok(CF.util.aspectLabel(0, 0) === '—', 'aspectLabel survives missing dimensions');
ok(CF.util.isVideoFile({ name: 'a.MOV', type: '' }) === true, 'extension fallback catches MIME-less pickers');
ok(CF.util.isVideoFile({ name: 'notes.pdf', type: 'application/pdf' }) === false, 'rejects a non-video');
var fpA = CF.util.videoFingerprint({ name: 'a.mp4', size: 100, lastModified: 5 }, 10);
var fpB = CF.util.videoFingerprint({ name: 'a.mp4', size: 100, lastModified: 5 }, 10);
var fpC = CF.util.videoFingerprint({ name: 'b.mp4', size: 100, lastModified: 5 }, 10);
ok(fpA === fpB, 'fingerprint is stable for the same file (AI cache key)');
ok(fpA !== fpC, 'fingerprint differs for a different file');

section('project — shape and defaults');
var p = CF.project.create({ name: 'Chopper' });
ok(p.status === 'RAW', 'a new project starts at RAW');
ok(Array.isArray(p.scenes) && Array.isArray(p.captions), 'later-phase arrays exist from the start');
ok(p.aiAnalysis === null, 'aiAnalysis is null, not undefined');
ok(p.timeBudget === CF.DEFAULT_TIME_BUDGET, 'time budget defaults to 5 min');
ok(CF.project.nameFromFile({ name: 'chopper_final_v2.MP4' }) === 'Chopper final v2', 'name derived from filename');
ok(CF.project.nameFromFile({ name: '' }) === 'Untitled clip', 'blank filename falls back');

section('project — normalize an old record');
var old = CF.project.normalize({ id: 'x1', name: 'Legacy', status: 'BOGUS' });
ok(old.status === 'RAW', 'an unknown status is coerced to RAW');
ok(Array.isArray(old.textOverlays), 'missing arrays are restored');
ok(old.video.duration === 0, 'missing video block is rebuilt');
ok(CF.project.normalize(null) === null, 'normalize(null) does not throw');

section('project — workflow');
ok(CF.project.nextStatus('RAW') === 'ANALYZING', 'RAW advances to ANALYZING');
ok(CF.project.nextStatus('POSTED') === null, 'POSTED is terminal');
var groups = CF.project.groupByStatus([{ status: 'RAW' }, { status: 'READY' }, { status: 'READY' }]);
ok(groups.READY.length === 2 && groups.RAW.length === 1, 'groupByStatus buckets correctly');
ok(groups.POSTED.length === 0, 'empty buckets still exist');
ok(CF.project.groupByStatus([{ status: 'NONSENSE' }]).RAW.length === 1, 'unknown status buckets into RAW');
ok(CF.project.nextAction({ videoId: null }).tone === 'bad', 'a project with no video reports a problem');
ok(CF.project.nextAction({ videoId: 'v', frameCount: 8 }).label === 'Ready for AI analysis', 'frames present means ready for AI');
show('summaryLine', CF.project.summaryLine({ video: { duration: 27.4, width: 1080, height: 1920 }, frameCount: 12, timeBudget: 5 }));
`);

/* The async blocks below must run strictly in order: the "fresh install"
   assertions are only meaningful before anything has been written. */

function freshInstall(ctx) {
  return ctx.CF.boot().then(function () {
    app.run(`
section('storage — degraded fallback');
ok(CF.db.ready === true, 'db reports ready after boot');
ok(CF.db.degraded === true, 'harness has no IndexedDB, so the fallback path is live');
ok(CF.state.projects.length === 0, 'no projects on a fresh install');

section('render — empty states (every tab must survive zero data)');
CF.state.tab = 'create'; CF.render();
ok(html('#view-create').includes('Upload a video'), 'create shows the dropzone');
ok(html('#view-create').includes('How much time do you have?'), 'create asks the time-budget question');
ok(html('#view-create').includes('Limited storage mode'), 'degraded storage is disclosed to the user');
ok(html('#view-create').includes('still frames'), 'privacy note explains frames are sent, not the video');

CF.state.tab = 'projects'; CF.render();
ok(html('#view-projects').includes('No projects yet'), 'projects empty state renders');

CF.state.tab = 'queue'; CF.render();
ok(html('#view-queue').includes('Queue is empty'), 'queue empty state renders');

CF.state.tab = 'settings'; CF.render();
ok(html('#view-settings').includes('Face-free mode'), 'settings shows the face-free switch');
ok(html('#view-settings').includes('Phase 2'), 'unbuilt AI is labelled honestly, not faked');
`);
  });
}

function roundTripAndRender(ctx) {
  const CF = ctx.CF;
  const frames = [
    { t: 1.0, dataUrl: 'data:image/jpeg;base64,AAAA' },
    { t: 3.0, dataUrl: 'data:image/jpeg;base64,BBBB' }
  ];
  const proj = CF.project.create({
    name: "Sara's chopper <test>",
    videoId: 'vid_1',
    frameCount: frames.length,
    timeBudget: 10,
    video: { duration: 27.4, width: 1080, height: 1920, size: 8500000, type: 'video/mp4', name: 'clip.mp4' }
  });

  return CF.db.putVideo({
    id: 'vid_1', blob: null, thumb: 'data:image/jpeg;base64,THUMB',
    frames: frames, name: 'clip.mp4', size: 8500000
  })
    .then(function () { return CF.db.putProject(proj); })
    .then(function () { return CF.db.allProjects(); })
    .then(function (list) {
      ctx.__roundTrip = list;
      return CF.db.getVideoMeta('vid_1');
    })
    .then(function (meta) {
      ctx.__meta = meta;
      app.run(`
section('storage — round trip');
ok(__roundTrip.length === 1, 'exactly one project comes back');
ok(__roundTrip[0].name === "Sara's chopper <test>", 'the name survives storage verbatim');
ok(__meta && __meta.frames.length === 2, 'frames survive alongside the video record');
ok(__meta.hasBlob === false, 'getVideoMeta reports blob presence without loading it');
`);
      /* Re-boot so state.projects is rebuilt from storage, exactly as a page reload would. */
      return CF.boot();
    })
    .then(function () {
      app.run(`
section('render — populated');
ok(CF.state.projects.length === 1, 'the saved project survives a reload');
CF.state.tab = 'projects'; CF.render();
var pj = html('#view-projects');
ok(pj.includes('Sara&#39;s chopper &lt;test&gt;'), 'project name is escaped in the list, not injected raw');
ok(pj.indexOf('<test>') === -1, 'the raw angle brackets never reach the markup');
ok(pj.includes('0:27'), 'duration renders as mm:ss');
ok(pj.includes('9:16'), 'aspect ratio renders');
ok(pj.includes('Ready for AI analysis'), 'next action is shown on the card');
ok(pj.includes('data:image/jpeg;base64,THUMB'), 'the stored cover thumbnail is used in the list');

CF.state.tab = 'queue'; CF.render();
var q = html('#view-queue');
ok(q.includes('Raw'), 'queue groups the project under Raw');
ok(q.includes('&rarr; Analyzing') || q.includes('\\u2192 Analyzing'), 'queue offers the next workflow stage');
ok(q.includes('Not connected to TikTok'), 'queue states plainly that nothing auto-posts');

CF.state.tab = 'settings'; CF.render();
ok(html('#view-settings').includes('localStorage + memory'), 'settings reports the live storage backend');

section('render — no leaked placeholders anywhere');
['create','projects','queue','settings'].forEach(function (t) {
  CF.state.tab = t; CF.render();
  var markup = html('#view-' + t);
  ok(!/undefined|NaN/.test(markup), t + ' renders with no undefined/NaN');
  ok(markup.length > 80, t + ' actually rendered content');
});

section('modal — project detail');
CF.screens.openProjectModal(CF.state.projects[0], { frames: [{ t: 1, dataUrl: 'data:image/jpeg;base64,AAAA' }] }, 'blob:x');
var modal = html('#modalRoot');
ok(modal.includes('Frames for AI'), 'modal shows the extracted frames');
ok(modal.includes('Phase 4'), 'modal is honest that the editor is not built yet');
ok(!/undefined|NaN/.test(modal), 'modal renders with no undefined/NaN');
CF.ui.closeModal();
ok(html('#modalRoot') === '', 'closeModal clears the modal root');

section('settings persistence');
CF.state.settings.language = 'mix';
CF.state.settings.faceFree = false;
CF.db.saveSettings(CF.state.settings);
var reloaded = CF.db.loadSettings();
ok(reloaded.language === 'mix', 'language choice survives a reload');
ok(reloaded.faceFree === false, 'face-free toggle survives a reload');
ok(CF.db.loadSettings().timeBudget === 5, 'unset values fall back to the default');

section('deletion');
show('rendered queue stage button', /→ [A-Za-z]+/.exec(q) ? /→ [A-Za-z]+/.exec(q)[0] : '(none)');
`);
    });
}

app.runAsync(freshInstall)
  .then(function () { return app.runAsync(roundTripAndRender); })
  .then(function () { app.done(); });
