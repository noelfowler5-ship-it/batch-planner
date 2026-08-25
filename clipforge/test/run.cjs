/* run.cjs — ClipForge test suite. Run from the clipforge/ directory:
     node test/run.cjs
   Exits non-zero on any failure, so it works as a pre-commit gate. */

const { boot } = require('./harness.cjs');
const app = boot();

/* ============================ pure logic ================================ */

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
ok(CF.util.framesForDuration(4) === 6, 'short clip clamps to the 6-frame floor');
ok(CF.util.framesForDuration(600) === CF.FRAME_COUNT, 'long clip clamps to the frame ceiling');

section('util — identity');
var fpA = CF.util.videoFingerprint({ name: 'a.mp4', size: 100, lastModified: 5 }, 10);
var fpB = CF.util.videoFingerprint({ name: 'a.mp4', size: 100, lastModified: 5 }, 10);
var fpC = CF.util.videoFingerprint({ name: 'b.mp4', size: 100, lastModified: 5 }, 10);
ok(fpA === fpB, 'fingerprint is stable for the same file (the AI cache key)');
ok(fpA !== fpC, 'fingerprint differs for a different file');
ok(CF.util.isVideoFile({ name: 'a.MOV', type: '' }) === true, 'extension fallback catches MIME-less pickers');
ok(CF.util.isVideoFile({ name: 'notes.pdf', type: 'application/pdf' }) === false, 'rejects a non-video');

section('project — shape, defaults, migration');
var p = CF.project.create({ name: 'Chopper' });
ok(p.status === 'RAW', 'a new project starts at RAW');
ok(p.aiAnalysis === null && p.aiContent === null, 'AI fields are null, not undefined');
ok(p.edits && Array.isArray(p.edits.segments), 'edits is an object with a segments array');
ok(CF.project.nameFromFile({ name: 'chopper_final_v2.MP4' }) === 'Chopper final v2', 'name derived from filename');
var old = CF.project.normalize({ id: 'x1', name: 'Legacy', status: 'BOGUS', edits: [] });
ok(old.status === 'RAW', 'an unknown status is coerced to RAW');
ok(old.edits && !Array.isArray(old.edits) && Array.isArray(old.edits.segments),
   'a pre-editor project whose edits was an array is migrated to the object shape');
ok(old.edits.crop === '9:16', 'the migrated project gets the default crop');
ok(CF.project.normalize(null) === null, 'normalize(null) does not throw');
ok(CF.project.nextStatus('RAW') === 'ANALYZING', 'RAW advances to ANALYZING');
ok(CF.project.nextStatus('POSTED') === null, 'POSTED is terminal');
`);

/* ============================ AI response validation ==================== */

app.run(`
section('ai-schema — a clean analysis passes through');
var good = {
  video: { duration: 20, description: 'Hands use a chopper', product: 'vegetable chopper', category: 'kitchen' },
  score: { overall: 80, hook: 16, productClarity: 17, demonstration: 16, payoff: 16, ctaPotential: 15 },
  verdict: 'MAKE',
  recommendedStructure: ['HOOK', 'DEMO', 'RESULT', 'CTA'],
  scenes: [
    { id: 's1', start: 0, end: 5, description: 'product', purpose: 'HOOK', visualStrength: 9,
      faceDetected: false, voiceoverRecommended: false, textRecommended: true,
      editingRecommendation: 'KEEP', reason: 'strong opener' },
    { id: 's2', start: 5, end: 20, description: 'chopping', purpose: 'DEMO', visualStrength: 8,
      faceDetected: false, voiceoverRecommended: true, textRecommended: false,
      editingRecommendation: 'KEEP', reason: 'clear demo' }
  ]
};
var res = CF.aiSchema.validateAnalysis(good, 20);
ok(res.ok === true, 'a well-formed analysis validates');
ok(res.value.scenes.length === 2, 'both scenes survive');
ok(res.repairs.length === 0, 'nothing needed repairing');

section('ai-schema — repairs rather than discards');
var messy = {
  video: {},
  score: { overall: 999, hook: -4, productClarity: 'nonsense' },
  verdict: 'MAYBE',
  scenes: [
    { start: 5, end: 3, description: 'backwards', purpose: 'DEMO' },
    { start: 0, end: 9, description: 'overlaps the next one', purpose: 'NONSENSE', visualStrength: 44 },
    { start: 6, end: 25, description: 'runs past the end', purpose: 'CTA', editingRecommendation: 'ZAP' },
    'not an object'
  ]
};
var fixed = CF.aiSchema.validateAnalysis(messy, 20);
ok(fixed.ok === true, 'a messy analysis is repaired rather than rejected');
ok(fixed.value.score.overall <= 100 && fixed.value.score.overall >= 0, 'out-of-range overall is clamped');
ok(fixed.value.score.hook >= 0 && fixed.value.score.hook <= 20, 'a negative sub-score is clamped');
ok(CF.aiSchema.VERDICTS.indexOf(fixed.value.verdict) >= 0, 'an unknown verdict is replaced with a real one');
ok(fixed.value.scenes.every(function (s) { return CF.aiSchema.PURPOSES.indexOf(s.purpose) >= 0; }),
   'an unknown purpose is coerced into the allowed set');
ok(fixed.value.scenes.every(function (s) { return s.editingRecommendation !== 'ZAP'; }),
   'an unknown editing recommendation is replaced');
ok(fixed.value.scenes.every(function (s) { return s.end <= 20.01; }), 'no scene runs past the clip end');
ok(fixed.value.scenes.every(function (s) { return s.end > s.start; }), 'no zero or negative-length scenes survive');
var overlapFree = true;
for (var i = 1; i < fixed.value.scenes.length; i++) {
  if (fixed.value.scenes[i].start < fixed.value.scenes[i - 1].end - 0.001) overlapFree = false;
}
ok(overlapFree, 'no repaired scene overlaps the one before it');
ok(fixed.repairs.length > 0, 'the repairs are reported, not silent');
show('repairs made', fixed.repairs.join(' | '));

section('ai-schema — score sanity');
var mismatch = CF.aiSchema.validateAnalysis({
  score: { overall: 95, hook: 2, productClarity: 2, demonstration: 2, payoff: 2, ctaPotential: 2 },
  scenes: [{ start: 0, end: 10, purpose: 'DEMO', description: 'x' }]
}, 10);
ok(mismatch.value.score.overall === 10, 'an overall that contradicts its own breakdown is recalculated');

section('ai-schema — unusable input is rejected, not half-accepted');
ok(CF.aiSchema.validateAnalysis(null, 20).ok === false, 'null is rejected');
ok(CF.aiSchema.validateAnalysis({ scenes: [] }, 20).ok === false, 'no scenes is rejected');
ok(CF.aiSchema.validateAnalysis({ scenes: [{ start: 0, end: 5 }] }, 0).ok === false, 'unknown duration is rejected');

section('ai-schema — verdict bands are advisory');
ok(CF.aiSchema.verdictFor(95).key === 'excellent', '95 reads as excellent');
ok(CF.aiSchema.verdictFor(80).key === 'worth', '80 reads as worth editing');
ok(CF.aiSchema.verdictFor(65).key === 'needswork', '65 reads as needs work');
ok(CF.aiSchema.verdictFor(30).key === 'skip', '30 reads as skip');
ok(CF.aiSchema.verdictFor(200).key === 'excellent', 'an impossible score still lands in a band');

section('ai-schema — generated content');
var gen = CF.aiSchema.validateGeneration({
  hooks: [
    { style: 'curiosity', text: 'Kenapa baru tahu benda ni?' },
    { style: 'painpoint', text: 'Kalau selalu potong bawang...' },
    { style: 'pov', text: 'POV: dapur kau' },
    { style: 'unexpected', text: 'Tak sangka' },
    { style: 'value', text: 'Berbaloi' },
    { style: 'extra', text: 'a sixth one that should be dropped' }
  ],
  captions: [{ style: 'curiosity', text: 'a' }, { style: 'problem', text: 'b' }, { style: 'casual', text: 'c' }],
  voiceovers: {
    short: { segments: [{ start: 0, end: 4, text: 'Satu dua tiga empat lima enam' }] },
    medium: { segments: [{ start: 0, end: 6, text: 'x y z' }, { start: 5, end: 10, text: 'overlaps the one before' }] },
    full: { segments: [] }
  },
  textOverlays: [
    { text: 'Jimat masa', start: 1, end: 3, position: 'center', style: 'benefit', animation: 'pop' },
    { text: 'This one overlaps and should be dropped', start: 2, end: 5, position: 'sideways', style: 'bogus' },
    { text: 'A very long overlay line that goes well past the seventy-two character limit for readability', start: 8, end: 11 }
  ]
}, 20, 'bm');

ok(gen.ok === true, 'generated content validates');
ok(gen.value.hooks.length === 5, 'a sixth hook is dropped — exactly 5 survive');
ok(gen.value.captions.length === 3, 'exactly 3 captions survive');
ok(gen.value.voiceovers.medium.segments.length === 2, 'both medium segments are kept');
ok(gen.value.voiceovers.medium.segments[1].start >= gen.value.voiceovers.medium.segments[0].end,
   'an overlapping voiceover segment is shifted, not dropped');
ok(gen.value.textOverlays.length === 2, 'an overlapping overlay IS dropped — one message on screen at a time');
ok(gen.value.textOverlays.every(function (o) { return o.text.length <= CF.aiSchema.MAX_OVERLAY_CHARS; }),
   'over-long overlay text is truncated to the readable limit');
ok(gen.value.textOverlays.every(function (o) { return CF.aiSchema.POSITIONS.indexOf(o.position) >= 0; }),
   'a nonsense position is replaced with a real one');
ok(gen.value.voiceovers.short.totalSeconds > 0, 'spoken length is estimated from the word count');
ok(typeof gen.value.voiceovers.short.fitsClip === 'boolean', 'each variant reports whether it fits the clip');
ok(CF.aiSchema.validateGeneration({}, 20, 'bm').ok === false, 'an empty content response is rejected');
`);

/* ============================ editor ==================================== */

app.run(`
/* Shared fixture: a project carrying a complete, already-validated AI result. */
function demoProject() {
  var proj = CF.project.create({
    name: 'Demo', videoId: 'v1', fingerprint: 'fp_demo',
    video: { duration: 20, width: 1080, height: 1920, size: 1000, type: 'video/mp4', name: 'c.mp4' }
  });
  proj.aiAnalysis = {
    video: { duration: 20, description: 'd', product: 'p', category: 'k' },
    score: { overall: 80, hook: 16, productClarity: 16, demonstration: 16, payoff: 16, ctaPotential: 16 },
    verdict: 'MAKE', recommendedStructure: ['HOOK', 'DEMO'],
    scenes: [
      { id: 's1', start: 0, end: 5, description: 'hook', purpose: 'HOOK', visualStrength: 9,
        faceDetected: false, voiceoverRecommended: false, textRecommended: true, editingRecommendation: 'KEEP', reason: '' },
      { id: 's2', start: 5, end: 12, description: 'demo', purpose: 'DEMO', visualStrength: 8,
        faceDetected: false, voiceoverRecommended: true, textRecommended: false, editingRecommendation: 'KEEP', reason: '' },
      { id: 's3', start: 12, end: 20, description: 'dead air', purpose: 'FILLER', visualStrength: 2,
        faceDetected: true, voiceoverRecommended: false, textRecommended: false, editingRecommendation: 'REMOVE', reason: 'weak' }
    ]
  };
  proj.aiContent = {
    language: 'bm',
    hooks: [{ id: 'h1', style: 'curiosity', text: 'Kenapa baru tahu?' }],
    captions: [{ id: 'c1', style: 'casual', text: 'Benda kecil, banyak guna.' }],
    voiceovers: {
      short: { segments: [], totalSeconds: 0, fitsClip: true },
      medium: { segments: [{ start: 5, end: 11, text: 'Masukkan bawang macam ni', estimatedSeconds: 2 }],
                totalSeconds: 2, fitsClip: true },
      full: { segments: [], totalSeconds: 0, fitsClip: true }
    },
    textOverlays: [
      { id: 'o1', text: 'Jimat masa', start: 6, end: 9, position: 'center', style: 'benefit', animation: 'fade' },
      { id: 'o2', text: 'Cut section text', start: 14, end: 17, position: 'top', style: 'proof', animation: 'fade' }
    ]
  };
  proj.score = 80;
  CF.editor.clearHistory(proj.id);
  CF.editor.ensureSegments(proj);
  return proj;
}

section('editor — building the first cut from the AI plan');
var e1 = demoProject();
ok(e1.edits.segments.length === 3, 'one segment per AI scene');
ok(e1.edits.segments[2].enabled === false, 'the REMOVE scene starts switched off');
ok(CF.editor.enabledSegments(e1).length === 2, 'two segments are live');
ok(CF.editor.outputDuration(e1) === 12, 'output duration excludes the disabled scene');

section('editor — a project with no analysis still edits');
var bare = CF.project.create({ name: 'Bare', video: { duration: 9 } });
CF.editor.ensureSegments(bare);
ok(bare.edits.segments.length === 1, 'no analysis means one full-length segment');
ok(CF.editor.outputDuration(bare) === 9, 'the untouched clip is the whole clip');

section('editor — source time maps to output time');
var e2 = demoProject();
ok(CF.editor.sourceToOutput(e2, 6) === 6, 'a moment before any cut keeps its time');
ok(CF.editor.sourceToOutput(e2, 15) === null, 'a moment inside a disabled segment has no output time');
ok(CF.editor.sourceToOutputNearest(e2, 15) !== null, 'nearest-match still finds a home for it');
CF.editor.toggleSegment(e2, e2.edits.segments[0].id);
ok(CF.editor.sourceToOutput(e2, 6) === 1, 'cutting the 5s opener shifts everything 5s earlier');

section('editor — guard rails');
var e3 = demoProject();
CF.editor.toggleSegment(e3, e3.edits.segments[0].id);
ok(CF.editor.enabledSegments(e3).length === 1, 'now one segment is live');
ok(CF.editor.toggleSegment(e3, e3.edits.segments[1].id) === false,
   'the last enabled segment refuses to switch off — an empty export is never reached silently');
var single = CF.project.create({ name: 'S', video: { duration: 5 } });
CF.editor.ensureSegments(single);
ok(CF.editor.deleteSegment(single, single.edits.segments[0].id) === false, 'the only segment cannot be deleted');

section('editor — split and trim');
var e4 = demoProject();
var firstId = e4.edits.segments[0].id;
ok(CF.editor.splitSegment(e4, firstId, 2.5) === true, 'splitting mid-segment works');
ok(e4.edits.segments.length === 4, 'the split produced one extra segment');
ok(e4.edits.segments[0].sourceEnd === 2.5 && e4.edits.segments[1].sourceStart === 2.5, 'the two halves meet exactly');
ok(CF.editor.splitSegment(e4, firstId, 0.05) === false, 'a split too close to the edge is refused');
ok(CF.editor.trimSegment(e4, firstId, 'end', -5) === false, 'a trim that would erase the segment is refused');
ok(CF.editor.trimSegment(e4, firstId, 'end', -0.5) === true, 'a sensible trim is accepted');

section('editor — reordering');
var e5 = demoProject();
var secondId = e5.edits.segments[1].id;
ok(CF.editor.moveSegment(e5, secondId, -1) === true, 'a segment moves up');
ok(e5.edits.segments[0].id === secondId, 'it is now first');
ok(CF.editor.moveSegment(e5, secondId, -1) === false, 'it cannot move above the top');

section('editor — undo and redo');
var e6 = demoProject();
var before = CF.editor.outputDuration(e6);
ok(CF.editor.canUndo(e6) === false, 'nothing to undo on a fresh project');
CF.editor.toggleSegment(e6, e6.edits.segments[0].id);
ok(CF.editor.outputDuration(e6) !== before, 'the edit changed the output');
ok(CF.editor.canUndo(e6) === true, 'undo is now available');
CF.editor.undo(e6);
ok(CF.editor.outputDuration(e6) === before, 'undo restored the previous output');
ok(CF.editor.canRedo(e6) === true, 'redo is now available');
CF.editor.redo(e6);
ok(CF.editor.outputDuration(e6) !== before, 'redo re-applied the edit');

section('editor — the source video is never touched');
var e7 = demoProject();
CF.editor.trimSegment(e7, e7.edits.segments[0].id, 'start', 1);
CF.editor.deleteSegment(e7, e7.edits.segments[1].id);
ok(e7.video.duration === 20, 'the recorded source duration is unchanged after editing');
ok(e7.videoId === 'v1', 'the project still points at the same untouched video record');

section('editor — overlays live on the output timeline');
var e8 = demoProject();
var ov = CF.editor.addOverlay(e8, { text: 'Hello', start: 1, end: 3 });
ok(!!ov, 'an overlay is added');
ok(CF.editor.overlaysAt(e8, 2).length === 1, 'it is on screen at 2s');
ok(CF.editor.overlaysAt(e8, 9).length === 0, 'it is gone by 9s');
CF.editor.updateOverlay(e8, ov.id, { start: 100, end: 200 });
ok(e8.textOverlays[0].end <= CF.editor.outputDuration(e8) + 0.01,
   'an overlay pushed past the end is clamped inside the video');
ok(CF.editor.removeOverlay(e8, ov.id) === true, 'an overlay can be removed');
ok(e8.textOverlays.length === 0, 'and it is gone');

section('editor — applying AI suggestions');
var e9 = demoProject();
var applied = CF.editor.applyAllSafe(e9);
ok(applied.overlaysAdded >= 1, 'apply-all added the AI overlays');
ok(e9.textOverlays.every(function (o) { return o.end <= CF.editor.outputDuration(e9) + 0.01; }),
   'an AI overlay from a cut section is repositioned inside the finished video, never past its end');
ok(CF.editor.hasOverlayText(e9, 'Jimat masa') === true, 'duplicate detection recognises applied text');
var again = CF.editor.applyAllSafe(e9);
ok(again.overlaysAdded === 0, 'applying twice does not duplicate overlays');
ok(CF.editor.canUndo(e9) === true, 'apply-all is undoable');

section('editor — overlap warnings surface rather than silently rewrite');
var e10 = demoProject();
CF.editor.addOverlay(e10, { text: 'First', start: 1, end: 5 });
CF.editor.addOverlay(e10, { text: 'Second', start: 3, end: 7 });
ok(CF.editor.overlapWarnings(e10).length === 1, 'a clash between two overlays is reported');
ok(e10.textOverlays.length === 2, 'but neither is deleted behind the users back');
`);

/* ============================ export ==================================== */

app.run(`
section('exporter — filenames');
ok(CF.exporter.fileName({ name: "Sara's Chopper! v2" }, 'mp4') === 'sara-s-chopper-v2.mp4',
   'a messy project name becomes a safe filename');
ok(CF.exporter.fileName({ name: '' }, 'webm') === 'clipforge.webm', 'a blank name falls back');
ok(CF.exporter.extensionFor('video/webm;codecs=vp9') === 'webm', 'webm is detected');
ok(CF.exporter.extensionFor('video/mp4;codecs=avc1') === 'mp4', 'mp4 is detected');

section('exporter — an incapable browser is reported, not crashed into');
var support = CF.exporter.support();
ok(support.ok === false, 'the harness has no MediaRecorder, so export is unavailable');
ok(support.reasons.length > 0, 'and it says why');
show('reported reason', support.reasons[0]);
`);

/* ============================ AI client plumbing ======================== */

app.run(`
section('ai-client — cache keys');
var k1 = CF.aiCache.key({ kind: 'analyze', fingerprint: 'abc', model: 'm1' });
var k2 = CF.aiCache.key({ kind: 'analyze', fingerprint: 'abc', model: 'm1' });
var k3 = CF.aiCache.key({ kind: 'analyze', fingerprint: 'abc', model: 'm2' });
var k4 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'bm' });
var k5 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'en' });
ok(k1 === k2, 'the same request produces the same cache key');
ok(k1 !== k3, 'a different model is a different cache entry');
ok(k1 !== k4, 'analysis and generation never share a cache entry');
ok(k4 !== k5, 'a different language is a different cache entry');
ok(k1.indexOf('p' + CF.ai.PROMPT_VERSION) >= 0, 'the prompt version is part of the key');

section('ai-client — refuses clearly when it cannot run');
ok(CF.ai.blockedReason() === null, 'online over http, so AI is available');
navigator.onLine = false;
ok(typeof CF.ai.blockedReason() === 'string', 'going offline produces a plain-English reason');
show('offline reason', CF.ai.blockedReason());
navigator.onLine = true;
ok(CF.ai.blockedReason() === null, 'coming back online clears it');
`);

/* ============================ storage + rendering ======================= */

function freshInstall(ctx) {
  return ctx.CF.boot().then(function () {
    app.run(`
section('storage — degraded fallback');
ok(CF.db.ready === true, 'db reports ready after boot');
ok(CF.db.degraded === true, 'the harness has no IndexedDB, so the fallback path is live');
ok(CF.state.projects.length === 0, 'no projects on a fresh install');

section('render — empty states (every tab must survive zero data)');
CF.state.tab = 'create'; CF.render();
ok(html('#view-create').includes('Upload a video'), 'create shows the dropzone');
ok(html('#view-create').includes('How much time do you have?'), 'create asks the time-budget question');
ok(html('#view-create').includes('Limited storage mode'), 'degraded storage is disclosed to the user');
ok(html('#view-create').includes('still frames'), 'the privacy note explains frames are sent, not the video');

CF.state.tab = 'projects'; CF.render();
ok(html('#view-projects').includes('No projects yet'), 'projects empty state renders');

CF.state.tab = 'queue'; CF.render();
ok(html('#view-queue').includes('Queue is empty'), 'queue empty state renders');

CF.state.tab = 'settings'; CF.render();
ok(html('#view-settings').includes('Face-free mode'), 'settings shows the face-free switch');
ok(html('#view-settings').includes('Saved AI results'), 'settings reports the AI cache');

CF.state.tab = 'studio'; CF.state.studioProject = null; CF.render();
ok(html('#view-studio').includes('No project open'), 'studio survives having no project');
`);
  });
}

function storageRoundTrip(ctx) {
  const CF = ctx.CF;
  const frames = [
    { t: 1.0, dataUrl: 'data:image/jpeg;base64,AAAA' },
    { t: 3.0, dataUrl: 'data:image/jpeg;base64,BBBB' }
  ];
  const proj = CF.project.create({
    name: "Sara's chopper <test>",
    videoId: 'vid_1',
    fingerprint: 'fp_1',
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
      return CF.db.putAi({ key: 'analyze|fp_1|p1|m|-', kind: 'analyze', value: { ok: 1 } });
    })
    .then(function () { return CF.db.getAi('analyze|fp_1|p1|m|-'); })
    .then(function (hit) {
      ctx.__aiHit = hit;
      app.run(`
section('storage — AI cache');
ok(__aiHit && __aiHit.value.ok === 1, 'a cached AI result round-trips');
ok(!!__aiHit.storedAt, 'and is timestamped');
`);
      return CF.boot();
    })
    .then(function () {
      app.run(`
section('render — populated main tabs');
ok(CF.state.projects.length === 1, 'the saved project survives a reload');
CF.state.tab = 'projects'; CF.render();
var pj = html('#view-projects');
ok(pj.includes('Sara&#39;s chopper &lt;test&gt;'), 'the project name is escaped in the list, not injected raw');
ok(pj.indexOf('<test>') === -1, 'the raw angle brackets never reach the markup');
ok(pj.includes('0:27'), 'duration renders as mm:ss');
ok(pj.includes('9:16'), 'aspect ratio renders');
ok(pj.includes('data:image/jpeg;base64,THUMB'), 'the stored cover thumbnail is used in the list');

CF.state.tab = 'queue'; CF.render();
var q = html('#view-queue');
ok(q.includes('Raw'), 'queue groups the project under Raw');
ok(q.includes('Not connected to TikTok'), 'queue states plainly that nothing auto-posts');
`);
    });
}

function studioScreens(ctx) {
  app.run(`
section('studio — before analysis');
var sp = CF.state.projects[0];
CF.state.studioProject = sp;
CF.state.tab = 'studio';
CF.state.studioTab = 'overview'; CF.render();
var ov = html('#view-studio');
ok(ov.includes('Not analysed yet'), 'overview is honest that nothing has run yet');
ok(ov.includes('still frames'), 'the privacy disclosure appears before any analysis');
ok(ov.includes('Analyse this clip'), 'the analyse action is offered');

CF.state.studioTab = 'director'; CF.render();
ok(html('#view-studio').includes('No scene plan yet'), 'director tells you to analyse first');
CF.state.studioTab = 'content'; CF.render();
ok(html('#view-studio').includes('Analyse first'), 'content tells you to analyse first');
CF.state.studioTab = 'edit'; CF.render();
ok(html('#view-studio').includes('Segments'), 'edit works even with no analysis');

section('studio — with a full AI result');
var full = demoProject();
full.id = sp.id;
full.name = 'Chopper demo';
CF.state.studioProject = full;

CF.state.studioTab = 'overview'; CF.render();
var o2 = html('#view-studio');
ok(o2.includes('80'), 'the score is shown');
ok(o2.includes('WORTH EDITING'), 'the verdict band is shown');
ok(o2.includes('not a prediction of views'), 'the score is explicitly advisory, not a virality claim');
ok(o2.includes('Face detected'), 'the face warning fires for the flagged scene');
ok(o2.includes('CTA potential'), 'the score breakdown is listed');
ok(o2.includes('Rename') && o2.includes('Delete'), 'project management lives on the overview');

CF.state.studioTab = 'director'; CF.render();
var d2 = html('#view-studio');
ok(d2.includes('DEMO'), 'scenes are listed by purpose');
ok(d2.includes('Apply all safe suggestions'), 'apply-all is offered');
ok(d2.includes('Masukkan bawang macam ni'), 'the matching voiceover line is shown against its scene');
ok(d2.includes('Switch it off'), 'the REMOVE scene offers a one-tap cut');

CF.state.studioTab = 'content'; CF.render();
var c2 = html('#view-studio');
ok(c2.includes('Kenapa baru tahu?'), 'hooks are listed');
ok(c2.includes('Put on video'), 'a hook can be applied, not just read');
ok(c2.includes('Benda kecil'), 'captions are listed');

CF.state.studioTab = 'edit'; CF.render();
var ed = html('#view-studio');
ok(ed.includes('Undo'), 'undo is offered');
ok(ed.includes('Split'), 'split is offered');
ok(ed.includes('Add text overlay'), 'overlays can be added by hand');

CF.state.studioTab = 'export'; CF.render();
ok(html('#view-studio').includes('cannot export'), 'export is honest about this browser being unable');

section('studio — no leaked placeholders on any tab');
['overview','director','content','edit','export'].forEach(function (t) {
  CF.state.studioTab = t; CF.render();
  var markup = html('#view-studio');
  ok(!/undefined|NaN/.test(markup), 'studio/' + t + ' renders with no undefined/NaN');
  ok(markup.length > 120, 'studio/' + t + ' actually rendered content');
});

section('render — no leaked placeholders on the main tabs');
['create','projects','queue','settings'].forEach(function (t) {
  CF.state.tab = t; CF.render();
  var markup = html('#view-' + t);
  ok(!/undefined|NaN/.test(markup), t + ' renders with no undefined/NaN');
  ok(markup.length > 80, t + ' actually rendered content');
});

section('projects — score badge');
CF.state.projects[0].score = 92;
CF.state.projects[0].aiAnalysis = full.aiAnalysis;
CF.state.tab = 'projects'; CF.render();
ok(html('#view-projects').includes('92/100'), 'a scored project shows its score');
ok(html('#view-projects').includes('EXCELLENT'), 'and its verdict band');

section('forms');
CF.studio.overlayForm(full, null);
ok(html('#modalRoot').includes('Add text overlay'), 'the overlay form opens');
ok(!/undefined|NaN/.test(html('#modalRoot')), 'the overlay form has no leaked placeholders');
CF.ui.closeModal();
CF.studio.splitForm(full, full.edits.segments[0].id);
ok(html('#modalRoot').includes('Split this segment'), 'the split form opens');
CF.ui.closeModal();
CF.screens.renameForm(full);
ok(html('#modalRoot').includes('Rename project'), 'the rename form opens');
CF.ui.closeModal();
ok(html('#modalRoot') === '', 'closing clears the modal root');

section('settings persistence');
CF.state.settings.language = 'mix';
CF.state.settings.faceFree = false;
CF.state.settings.aiModel = 'gemini-test';
CF.db.saveSettings(CF.state.settings);
var reloaded = CF.db.loadSettings();
ok(reloaded.language === 'mix', 'language choice survives a reload');
ok(reloaded.faceFree === false, 'the face-free toggle survives a reload');
ok(reloaded.aiModel === 'gemini-test', 'the model choice survives a reload');
`);
  return Promise.resolve();
}

app.runAsync(freshInstall)
  .then(function () { return app.runAsync(storageRoundTrip); })
  .then(function () { return app.runAsync(studioScreens); })
  .then(function () { app.done(); });
