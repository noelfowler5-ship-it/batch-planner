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

section('video-engine — spotting frames that decoded to solid black');
function pixels(n, r, g, b) {
  var out = [];
  for (var i = 0; i < n; i++) { out.push(r, g, b, 255); }
  return out;
}
var pureBlack = CF.video.peakLumaFrom(pixels(400, 0, 0, 0));
ok(pureBlack === 0, 'an all-black frame peaks at zero luma');
ok(pureBlack < CF.video.BLACK_PEAK, 'an all-black frame is below the blank threshold');
ok(CF.video.peakLumaFrom(pixels(400, 255, 255, 255)) > 250, 'a white frame peaks near maximum');
/* Real footage shot in the dark must NOT be mistaken for a decode failure:
   it is dark on average but still contains highlights. */
var nightScene = pixels(400, 4, 4, 4).concat(pixels(4, 180, 170, 160));
ok(CF.video.peakLumaFrom(nightScene) > CF.video.BLACK_PEAK,
   'genuinely dark footage with highlights is not flagged as blank');
ok(CF.video.peakLumaFrom([]) === null, 'no pixels reads as unknown, not as black');
ok(CF.video.peakLumaFrom(null) === null, 'null pixels read as unknown, not as black');

section('project — shape, defaults, migration');
var p = CF.project.create({ name: 'Chopper' });
ok(p.status === 'RAW', 'a new project starts at RAW');
ok(Array.isArray(p.clips) && p.clips.length === 0, 'a new project starts with no clips, not undefined');
ok(p.aiContent === null, 'AI content is null, not undefined');
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

section('project — migrating a pre-multi-clip project (real user data on upgrade)');
/* Exactly the shape a project had before clips[] existed: single-video
   fields directly on the project, no clips array at all. */
var legacy = CF.project.normalize({
  id: 'legacy1', name: 'Old chopper project', status: 'EDITING',
  videoId: 'v_old', fingerprint: 'fp_old', frameCount: 8, score: 72,
  video: { duration: 15, width: 1080, height: 1920, size: 5000, type: 'video/mp4', name: 'chopper.mp4' },
  aiAnalysis: {
    video: { product: 'Chopper', description: 'x' },
    score: { overall: 72 },
    scenes: [{ start: 0, end: 15, purpose: 'DEMO', description: 'd', visualStrength: 5, editingRecommendation: 'KEEP' }]
  },
  edits: { segments: [{ id: 'seg1', sourceStart: 0, sourceEnd: 15, enabled: true }], crop: '9:16', muted: false }
});
ok(legacy.clips.length === 1, 'the single video becomes exactly one clip');
ok(legacy.clips[0].videoId === 'v_old', 'the videoId is preserved');
ok(legacy.clips[0].fingerprint === 'fp_old', 'the fingerprint is preserved — the analyze cache entry is not orphaned');
ok(legacy.clips[0].duration === 15 && legacy.clips[0].width === 1080, 'video metadata is preserved');
ok(legacy.clips[0].frameCount === 8, 'the frame count is preserved');
ok(legacy.clips[0].analysis && legacy.clips[0].analysis.scenes.length === 1, 'the AI analysis is preserved, not discarded');
ok(legacy.clips[0].score === 72, 'the score is preserved');
ok(legacy.edits.segments[0].clipId === legacy.clips[0].id,
   'a segment saved before multi-clip existed is stamped with the migrated clip\\'s id');
ok(CF.project.combinedDuration(legacy) === 15, 'combined duration matches the single clip');
var noVideo = CF.project.normalize({ id: 'x2', name: 'Empty draft', status: 'RAW' });
ok(Array.isArray(noVideo.clips) && noVideo.clips.length === 0,
   'a project with no video at all (never got that far) migrates to an empty clip list, not a crash');

section('project — combined/global timeline across several clips');
var multi = CF.project.create({ name: 'Multi' });
CF.project.addClip(multi, { videoId: 'va', fingerprint: 'fa', name: 'Unboxing', duration: 10 });
CF.project.addClip(multi, { videoId: 'vb', fingerprint: 'fb', name: 'Demo', duration: 8 });
CF.project.addClip(multi, { videoId: 'vc', fingerprint: 'fc', name: 'Result', duration: 6 });
ok(multi.clips.length === 3, 'three clips were added');
ok(CF.project.combinedDuration(multi) === 24, 'combined duration is the sum of all three');
ok(CF.project.isMultiClip(multi) === true, 'a 3-clip project is reported as multi-clip');
var offsets = CF.project.clipOffsets(multi);
ok(offsets[multi.clips[0].id] === 0, 'the first clip starts at offset 0');
ok(offsets[multi.clips[1].id] === 10, 'the second clip starts right after the first');
ok(offsets[multi.clips[2].id] === 18, 'the third clip starts after the first two');
ok(CF.project.localToGlobal(multi, multi.clips[1].id, 2) === 12, 'a moment 2s into clip 2 is 12s in the combined timeline');
ok(CF.project.localToGlobal(multi, multi.clips[2].id, 0) === 18, 'the start of clip 3 lands right where clip 2 ends');
var backA = CF.project.globalToLocal(multi, 12);
ok(backA.clipId === multi.clips[1].id && backA.localTime === 2, 'a combined time inside clip 2 maps back to (clip 2, 2s)');
var backB = CF.project.globalToLocal(multi, 0);
ok(backB.clipId === multi.clips[0].id && backB.localTime === 0, 'time 0 maps to the very start of clip 1');
var backEnd = CF.project.globalToLocal(multi, 999);
ok(backEnd.clipId === multi.clips[2].id, 'a time past the end clamps into the last clip rather than returning null');
ok(CF.project.canAddClip(multi) === false, 'a 3-clip project is already at CF.MAX_CLIPS and refuses a 4th');
ok(CF.project.addClip(multi, { videoId: 'vd', duration: 5 }) === null, 'addClip actually refuses past the cap, not just canAddClip');
ok(multi.clips.length === 3, 'the 4th clip was not silently added');

section('project — combinedAnalysis describes every clip in one virtual scene list');
multi.clips[0].analysis = { video: { product: 'Chopper', description: 'unboxing it' },
  scenes: [{ start: 0, end: 4, purpose: 'HOOK', description: 'opening the box' }] };
multi.clips[1].analysis = { video: { product: 'Chopper', description: 'using it' },
  scenes: [{ start: 0, end: 8, purpose: 'DEMO', description: 'chopping an onion' }] };
var combo = CF.project.combinedAnalysis(multi);
ok(combo.scenes.length === 2, 'scenes from both analysed clips are present (clip 3 has none yet)');
ok(combo.scenes[0].start === 0 && combo.scenes[0].end === 4, 'clip 1\\'s scene keeps its own timing (offset 0)');
ok(combo.scenes[1].start === 10 && combo.scenes[1].end === 18,
   'clip 2\\'s scene is shifted by clip 1\\'s 10s duration — this is what the AI is shown, one continuous video');
ok(/Clip 2/.test(combo.scenes[1].description), 'a multi-clip scene description says which clip it is from');
ok(combo.video.description.indexOf('unboxing it') >= 0 && combo.video.description.indexOf('using it') >= 0,
   'the combined description mentions both clips');
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

section('util — sanitizing the caption style examples list');
ok(CF.util.sanitizeStyleExamples(['  Nasip baik  ', 'Nasip baik']).length === 1,
   'duplicate examples (after trimming) collapse to one');
ok(CF.util.sanitizeStyleExamples(['', '   ', 'real one']).length === 1,
   'blank entries are dropped');
ok(CF.util.sanitizeStyleExamples('not an array').length === 0, 'a non-array input yields no examples, not a throw');
ok(CF.util.sanitizeStyleExamples(null).length === 0, 'null input yields no examples');
var longOne = CF.util.sanitizeStyleExamples(['x'.repeat(500)])[0];
ok(longOne.length === CF.MAX_STYLE_EXAMPLE_CHARS, 'an over-long example is truncated to the character cap');
var many = [];
for (var mi = 0; mi < CF.MAX_STYLE_EXAMPLES + 5; mi++) many.push('example ' + mi);
ok(CF.util.sanitizeStyleExamples(many).length === CF.MAX_STYLE_EXAMPLES, 'the list is capped at MAX_STYLE_EXAMPLES');

section('db — settings defaults include the starting style examples, and stay independent per load');
var settingsA = CF.db.loadSettings();
ok(Array.isArray(settingsA.styleExamples) && settingsA.styleExamples.length === CF.DEFAULT_STYLE_EXAMPLES.length,
   'a fresh install starts with the built-in style examples');
settingsA.styleExamples.push('mutated by caller');
var settingsB = CF.db.loadSettings();
ok(settingsB.styleExamples.length === CF.DEFAULT_STYLE_EXAMPLES.length,
   'mutating one loaded settings object does not leak into the next load (no shared array reference)');

section('util — how many captions a clip of this length carries');
ok(CF.util.overlayCountFor(15).max === 1, 'a short clip gets a single caption');
ok(CF.util.overlayCountFor(19.9).max === 1, 'just under 20s is still a single caption');
ok(CF.util.overlayCountFor(22).max === 2, 'the 20-25s band allows a second');
ok(CF.util.overlayCountFor(30).min === 3 && CF.util.overlayCountFor(30).max === 4,
   'a long clip carries 3-4 changing captions');
ok(CF.util.overlayCountFor(0).max === 1, 'unknown duration falls back to one, not many');

section('ai-schema — caption count follows the clip length, not the AI');
function genWithOverlays(overlays, duration) {
  return CF.aiSchema.validateGeneration({
    hooks: [{ style: 'curiosity', text: 'a' }],
    captions: [{ style: 'casual', text: 'b' }],
    voiceovers: { short: { segments: [] }, medium: { segments: [] }, full: { segments: [] } },
    textOverlays: overlays
  }, duration, 'bm');
}
/* A 15s clip that came back with four per-scene subtitles. */
var short4 = genWithOverlays([
  { text: 'satu', start: 0.5, end: 3, position: 'center', style: 'hook' },
  { text: 'dua', start: 3.5, end: 6, position: 'center', style: 'benefit' },
  { text: 'tiga', start: 6.5, end: 9, position: 'center', style: 'proof' },
  { text: 'empat', start: 9.5, end: 12, position: 'center', style: 'cta' }
], 15);
ok(short4.value.textOverlays.length === 1, 'a 15s clip is trimmed to one caption');
ok(short4.value.textOverlays[0].text === 'satu', 'the earliest caption is the one kept');
ok(short4.value.textOverlays[0].end > 14,
   'and it is stretched to sit there for the whole clip, not just its original 3s');
ok(short4.repairs.some(function (r) { return /kept the first 1/.test(r); }),
   'the trim is reported as a repair, never silent');
ok(short4.value.textOverlays[0].id === 'o1', 'ids are renumbered after the trim');

/* A 30s clip keeps its changing captions. */
var long4 = genWithOverlays([
  { text: 'satu', start: 0.5, end: 6, position: 'center', style: 'hook' },
  { text: 'dua', start: 7, end: 13, position: 'center', style: 'benefit' },
  { text: 'tiga', start: 14, end: 20, position: 'center', style: 'proof' },
  { text: 'empat', start: 21, end: 28, position: 'center', style: 'cta' }
], 30);
ok(long4.value.textOverlays.length === 4, 'a 30s clip keeps all four changing captions');
ok(long4.value.textOverlays[3].end <= 30, 'the last one still sits inside the clip');

/* A short clip whose single caption was timed like a 2s subtitle. */
var shortStretch = genWithOverlays([
  { text: 'senang kerja', start: 0.5, end: 2.4, position: 'center', style: 'hook' }
], 16);
ok(shortStretch.value.textOverlays.length === 1, 'one caption stays one caption');
ok(shortStretch.value.textOverlays[0].end > 15, 'a too-brief single caption is held for the whole clip');
ok(shortStretch.repairs.some(function (r) { return /whole clip/.test(r); }), 'the stretch is reported');

section('ai-schema — policy check: the normal, expected result is "nothing found"');
var clean = CF.aiSchema.validatePolicyCheck({ overallRisk: 'low', summary: 'No obvious issues found.', flags: [] });
ok(clean.ok === true, 'a clean result with no flags validates');
ok(clean.value.flags.length === 0, 'and stays empty — the tool does not invent flags to seem thorough');

section('ai-schema — policy check: repairs a mismatched or messy response');
var messyPolicy = CF.aiSchema.validatePolicyCheck({
  overallRisk: 'low', /* contradicts its own flags below — should be recalculated up, not trusted blindly */
  summary: 'Looks fine',
  flags: [
    { category: 'FAKED_DANGER', severity: 'high', source: 'visual', excerpt: 'staged fall at 0:04', reason: 'looks staged for shock value', suggestion: 'cut or relabel as a demo' },
    { category: 'NONSENSE_CATEGORY', severity: 'extreme', source: 'somewhere', excerpt: 'a caption line', reason: 'unclear claim' },
    { excerpt: '', reason: '' },
    'not an object'
  ]
});
ok(messyPolicy.ok === true, 'a messy response is repaired rather than rejected');
ok(messyPolicy.value.flags.length === 2, 'the empty and non-object entries are dropped, the two real ones kept');
ok(messyPolicy.value.overallRisk === 'high', 'overallRisk is recalculated from its own flags, not trusted blindly — one HIGH flag means high');
ok(CF.aiSchema.FLAG_CATEGORIES.indexOf(messyPolicy.value.flags[1].category) >= 0, 'an unknown category is coerced into the allowed set');
ok(CF.aiSchema.RISK_LEVELS.indexOf(messyPolicy.value.flags[1].severity) >= 0, 'an unknown severity is coerced into the allowed set');
ok(messyPolicy.repairs.length > 0, 'repairs are reported');

section('ai-schema — policy check: unusable input is rejected, not half-accepted');
ok(CF.aiSchema.validatePolicyCheck(null).ok === false, 'null is rejected');
ok(CF.aiSchema.validatePolicyCheck('nonsense').ok === false, 'a non-object is rejected');

section('ai-schema — policy risk bands');
ok(CF.aiSchema.riskBand('high').tone === 'bad', 'high risk reads as bad');
ok(CF.aiSchema.riskBand('medium').tone === 'warn', 'medium risk reads as a warning');
ok(CF.aiSchema.riskBand('low').tone === 'good', 'low risk reads as good');
ok(CF.aiSchema.riskBand('garbage').tone === 'good', 'an unrecognised value falls back to the safe default, not a scary one');
`);

/* ============================ editor ==================================== */

app.run(`
/* Shared fixture: a project carrying a complete, already-validated AI result. */
/* A single-clip project. Global (combined-timeline) time and the clip's own
   local time are identical here, since there is only one clip and it starts
   at offset 0 — exactly like it worked before multi-clip existed. */
/* A bare single-clip project with no analysis — the shape a project has
   right after upload, before "Analyse" is ever pressed. */
function singleClipProject(name, duration) {
  return CF.project.create({
    name: name,
    clips: [{ videoId: 'v_' + name, fingerprint: 'fp_' + name, name: name, duration: duration }]
  });
}

function demoProject() {
  var proj = CF.project.create({
    name: 'Demo',
    clips: [{
      videoId: 'v1', fingerprint: 'fp_demo', name: 'c.mp4',
      duration: 20, width: 1080, height: 1920, size: 1000, type: 'video/mp4'
    }]
  });
  proj.clips[0].analysis = {
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
  proj.clips[0].score = 80;
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
var bare = singleClipProject('Bare', 9);
CF.editor.ensureSegments(bare);
ok(bare.edits.segments.length === 1, 'no analysis means one full-length segment');
ok(CF.editor.outputDuration(bare) === 9, 'the untouched clip is the whole clip');

section('editor — source time maps to output time');
var e2 = demoProject();
var e2clip = e2.clips[0].id;
ok(CF.editor.sourceToOutput(e2, e2clip, 6) === 6, 'a moment before any cut keeps its time');
ok(CF.editor.sourceToOutput(e2, e2clip, 15) === null, 'a moment inside a disabled segment has no output time');
ok(CF.editor.sourceToOutputNearest(e2, e2clip, 15) !== null, 'nearest-match still finds a home for it');
ok(CF.editor.sourceToOutput(e2, 'some-other-clip', 6) === null,
   'the same local time in a DIFFERENT clip is not confused for a match');
CF.editor.toggleSegment(e2, e2.edits.segments[0].id);
ok(CF.editor.sourceToOutput(e2, e2clip, 6) === 1, 'cutting the 5s opener shifts everything 5s earlier');

section('editor — guard rails');
var e3 = demoProject();
CF.editor.toggleSegment(e3, e3.edits.segments[0].id);
ok(CF.editor.enabledSegments(e3).length === 1, 'now one segment is live');
ok(CF.editor.toggleSegment(e3, e3.edits.segments[1].id) === false,
   'the last enabled segment refuses to switch off — an empty export is never reached silently');
var single = singleClipProject('S', 5);
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
ok(e7.clips[0].duration === 20, 'the recorded source duration is unchanged after editing');
ok(e7.clips[0].videoId === 'v1', 'the project still points at the same untouched video record');

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

section('editor — multi-clip: two clips sharing identical local timestamps are never confused');
/* The sharpest regression risk in supporting several clips: clip A and clip
   B can each have a scene at "0s-5s". Everything that used to match on time
   alone (REMOVE-disabling, AI overlay placement) must match on (clip, time)
   instead, or a suggestion meant for one clip could land on, or disable,
   the wrong one. */
function twoClipProject() {
  var proj = CF.project.create({ name: 'Two clips' });
  CF.project.addClip(proj, { videoId: 'vA', fingerprint: 'fA', name: 'Unboxing', duration: 10 });
  CF.project.addClip(proj, { videoId: 'vB', fingerprint: 'fB', name: 'Demo', duration: 10 });
  var a = proj.clips[0], b = proj.clips[1];
  a.analysis = {
    video: { product: 'Chopper', description: 'unboxing' },
    score: { overall: 70, hook: 14, productClarity: 14, demonstration: 14, payoff: 14, ctaPotential: 14 },
    scenes: [
      { id: 'a1', start: 0, end: 5, purpose: 'HOOK', description: 'box', visualStrength: 8,
        editingRecommendation: 'KEEP', faceDetected: false, voiceoverRecommended: false, textRecommended: false, reason: '' },
      { id: 'a2', start: 5, end: 10, purpose: 'FILLER', description: 'boring A', visualStrength: 1,
        editingRecommendation: 'REMOVE', faceDetected: false, voiceoverRecommended: false, textRecommended: false, reason: 'weak' }
    ]
  };
  b.analysis = {
    video: { product: 'Chopper', description: 'demo' },
    score: { overall: 90, hook: 18, productClarity: 18, demonstration: 18, payoff: 18, ctaPotential: 18 },
    scenes: [
      /* Same 0-5s / 5-10s local timestamps as clip A, opposite REMOVE flag —
         if matching ever falls back to time-only, this is where it shows. */
      { id: 'b1', start: 0, end: 5, purpose: 'DEMO', description: 'chopping', visualStrength: 9,
        editingRecommendation: 'KEEP', faceDetected: false, voiceoverRecommended: false, textRecommended: false, reason: '' },
      { id: 'b2', start: 5, end: 10, purpose: 'RESULT', description: 'result shot', visualStrength: 9,
        editingRecommendation: 'KEEP', faceDetected: false, voiceoverRecommended: false, textRecommended: false, reason: '' }
    ]
  };
  proj.aiContent = {
    language: 'bm', hooks: [], captions: [],
    voiceovers: { short: { segments: [] }, medium: { segments: [] }, full: { segments: [] } },
    textOverlays: [
      /* Global time 12-15s = 2s into clip B (offset 10) — must land on
         clip B's segment, never on clip A's identically-timed 2-5s span. */
      { id: 'mo1', text: 'Clip B overlay', start: 12, end: 15, position: 'center', style: 'benefit', animation: 'fade' }
    ]
  };
  CF.editor.clearHistory(proj.id);
  CF.editor.ensureSegments(proj);
  return proj;
}

var tc = twoClipProject();
ok(tc.edits.segments.length === 4, 'one segment per scene across both clips');
ok(tc.edits.segments[0].clipId === tc.clips[0].id && tc.edits.segments[2].clipId === tc.clips[1].id,
   'segments are correctly attributed to their own clip, in clip order');
ok(tc.edits.segments[1].enabled === false, 'clip A\\'s weak 5-10s scene starts switched off');
ok(tc.edits.segments[3].enabled === true, 'clip B\\'s 5-10s scene (a RESULT shot) stays on, despite sharing A\\'s timestamps');

/* buildSegments already disabled clip A's REMOVE scene at construction time,
   so re-enable it by hand first — simulating a user who switched it back on
   — to actually exercise apply-all's own REMOVE-matching rather than find
   nothing left to do. */
tc.edits.segments[1].enabled = true;
var tcApplied = CF.editor.applyAllSafe(tc);
ok(tcApplied.segmentsDisabled === 1, 'exactly one segment was disabled — clip B\\'s look-alike scene was not touched');
ok(CF.editor.enabledSegments(tc).some(function (s) { return s.clipId === tc.clips[1].id && s.sourceStart === 5; }),
   'clip B\\'s 5-10s segment is still enabled after apply-all');

var tcTimeline = CF.editor.outputTimeline(tc);
ok(tcTimeline.duration === 15, 'output duration is 5 (clip A) + 10 (clip B) after clip A\\'s weak scene is cut');
var placed = tc.textOverlays.filter(function (o) { return o.text === 'Clip B overlay'; })[0];
ok(!!placed, 'the AI overlay (written in combined/global time) was applied');
ok(placed.start >= 5 && placed.start < 15, 'it lands in clip B\\'s stretch of the output, not clip A\\'s identically-timed scene');

section('editor — overlap warnings surface rather than silently rewrite');
var e10 = demoProject();
CF.editor.addOverlay(e10, { text: 'First', start: 1, end: 5 });
CF.editor.addOverlay(e10, { text: 'Second', start: 3, end: 7 });
ok(CF.editor.overlapWarnings(e10).length === 1, 'a clash between two overlays is reported');
ok(e10.textOverlays.length === 2, 'but neither is deleted behind the users back');

section('editor — clearOverlays: reusing a clip with a different text batch');
var e11 = demoProject();
CF.editor.addOverlay(e11, { text: 'Old batch A', start: 1, end: 3 });
CF.editor.addOverlay(e11, { text: 'Old batch B', start: 10, end: 12 });
ok(CF.editor.clearOverlays(e11) === true, 'clearing removes everything in one step');
ok(e11.textOverlays.length === 0, 'the project now has no overlays');
ok(CF.editor.canUndo(e11) === true, 'clearing is a single undoable step');
CF.editor.undo(e11);
ok(e11.textOverlays.length === 2, 'undo brings the whole batch back at once, not one at a time');
ok(CF.editor.clearOverlays(singleClipProject('x', 5)) === false,
   'clearing an already-empty overlay list is a no-op, not a wasted undo step');

section('editor — setHookOverlay: trying different hooks replaces, never stacks (regression)');
/* Reported bug: tapping "Put on video" on hook A then hook B put both at the
   same 0-2.5s spot, silently overlapping — the opposite of "reusable". */
var e12 = demoProject();
var first = CF.editor.setHookOverlay(e12, { text: 'Hook A text', start: 0, end: 2.5, position: 'center', animation: 'pop' });
ok(!!first && first.style === 'hook', 'the first hook is applied and tagged as a hook overlay');
ok(e12.textOverlays.filter(function (o) { return o.style === 'hook'; }).length === 1, 'exactly one hook overlay exists');
var second = CF.editor.setHookOverlay(e12, { text: 'Hook B text', start: 0, end: 2.5, position: 'center', animation: 'pop' });
ok(!!second, 'a second hook can be applied');
ok(e12.textOverlays.filter(function (o) { return o.style === 'hook'; }).length === 1,
   'trying a different hook REPLACES the first, it does not stack a second overlay at the same spot');
ok(e12.textOverlays.filter(function (o) { return o.style === 'hook'; })[0].text === 'Hook B text',
   'the surviving hook overlay is the one just chosen');
ok(CF.editor.overlapWarnings(e12).length === 0, 'no self-overlap warning from two hooks fighting for the same 2.5s');
ok(CF.editor.canUndo(e12) === true, 'switching hooks is still undoable as one step');
`);

/* ============================ export ==================================== */

app.run(`
section('exporter — filenames');
ok(CF.exporter.fileName({ name: "Sara's Chopper! v2" }, 'mp4') === 'sara-s-chopper-v2.mp4',
   'a messy project name becomes a safe filename');
ok(CF.exporter.fileName({ name: '' }, 'webm') === 'clipforge.webm', 'a blank name falls back');
ok(CF.exporter.extensionFor('video/webm;codecs=vp9') === 'webm', 'webm is detected');
ok(CF.exporter.extensionFor('video/mp4;codecs=avc1') === 'mp4', 'mp4 is detected');

section('exporter — target canvas size follows the first clip, shared with preview');
var sizeDefault = CF.exporter.targetSizeFor({ edits: { crop: '9:16' }, clips: [{ width: 720, height: 1280 }] });
ok(sizeDefault.w === 1080 && sizeDefault.h === 1920, '9:16 crop always targets the standard export size');
var sizeNone = CF.exporter.targetSizeFor({ edits: { crop: 'none' }, clips: [{ width: 1080, height: 1920 }] });
ok(sizeNone.w === 1080 && sizeNone.h === 1920, 'keep-original at exactly 1080x1920 stays that size');
var sizeWide = CF.exporter.targetSizeFor({ edits: { crop: 'none' }, clips: [{ width: 3840, height: 2160 }] });
ok(sizeWide.w <= 1920 && sizeWide.h <= 1920, 'an oversized source is capped so the export stays a sane file size');
var sizeMulti = CF.exporter.targetSizeFor({ edits: { crop: 'none' }, clips: [{ width: 720, height: 1280 }, { width: 1080, height: 1920 }] });
ok(sizeMulti.w === 720 && sizeMulti.h === 1280,
   'a multi-clip project with mixed sizes frames against the FIRST clip — later clips still render (drawFrame reads their own dimensions), just fit into clip 1\\'s shape');

section('exporter — an incapable browser is reported, not crashed into');
var support = CF.exporter.support();
ok(support.ok === false, 'the harness has no MediaRecorder, so export is unavailable');
ok(support.reasons.length > 0, 'and it says why');
show('reported reason', support.reasons[0]);

section('exporter — drawFrame is public so preview.js can share it');
ok(typeof CF.exporter.drawFrame === 'function', 'drawFrame is exposed, not a private closure-only helper');

section("exporter — captions are painted in the creator's style");
/* A recording 2D context: drawOverlay is pure drawing, so the calls it makes
   ARE the output, and asserting on them is the only way to check the look
   without a real canvas. */
function recordingCtx() {
  var calls = { stroke: [], fill: [], rects: 0, paths: 0 };
  return {
    calls: calls,
    globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    lineWidth: 0, lineJoin: '', miterLimit: 0, fillStyle: '', strokeStyle: '',
    save: function () {}, restore: function () {},
    translate: function () {}, scale: function () {},
    measureText: function (t) { return { width: String(t).length * 20 }; },
    strokeText: function (t) { calls.stroke.push({ text: t, style: this.strokeStyle, width: this.lineWidth }); },
    fillText: function (t) { calls.fill.push({ text: t, style: this.fillStyle }); },
    fillRect: function () { calls.rects++; },
    beginPath: function () { calls.paths++; },
    moveTo: function () {}, lineTo: function () {}, quadraticCurveTo: function () {},
    closePath: function () {}, fill: function () { calls.rects++; }, stroke: function () {}
  };
}
var rc = recordingCtx();
CF.exporter.drawOverlay(rc, {
  text: 'Senang kerja mak-mak', start: 0, end: 3,
  position: 'center', style: 'benefit', animation: 'none'
}, 1080, 1920, 0.5);
ok(rc.calls.fill.length > 0, 'the caption text is actually drawn');
ok(rc.calls.fill.every(function (c) { return c.style === '#ffffff'; }),
   'caption text is white, whatever its style field says');
ok(rc.calls.stroke.length === rc.calls.fill.length,
   'every line gets an outline pass as well as a fill pass');
ok(rc.calls.stroke.every(function (c) { return c.style.indexOf('rgba(0,0,0') === 0; }),
   'the outline is black — the only thing keeping white text readable with no box');
ok(rc.calls.stroke.every(function (c) { return c.width > 1; }), 'the outline is thick enough to see');
ok(rc.calls.rects === 0 && rc.calls.paths === 0,
   'no box is drawn behind the text — the old coloured pill is gone');
/* The style field must no longer change the paint. */
var rcHook = recordingCtx();
CF.exporter.drawOverlay(rcHook, {
  text: 'Senang kerja mak-mak', start: 0, end: 3,
  position: 'center', style: 'hook', animation: 'none'
}, 1080, 1920, 0.5);
ok(rcHook.calls.fill[0].style === rc.calls.fill[0].style,
   'a hook and a benefit caption are painted identically');
ok(rcHook.calls.rects === 0, 'a hook caption gets no box either');

section('preview — guard clauses and idle safety');
ok(CF.preview.isOpen() === false, 'nothing is open at startup');
ok(CF.preview.close() === undefined, 'closing with nothing open does not throw');
ok(CF.preview.toggle() === undefined, 'toggling with nothing open does not throw');
var noScenes = singleClipProject('Empty', 5);
noScenes.edits.segments = []; /* an empty timeline — the editor UI can't normally reach this
   (toggling always refuses to disable the last segment), but it's cheap insurance against a
   corrupted or hand-edited project record opening a blank preview instead of explaining why not */
CF.preview.open(noScenes);
ok(CF.preview.isOpen() === false, 'opening a project with an empty timeline refuses rather than opening blank');
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

section('ai-client — policy check cache is keyed on the actual content, not just the video');
var contentA = { hooks: [{ id: 'h1', style: 'curiosity', text: 'Version A' }], captions: [], voiceovers: {}, textOverlays: [] };
var contentB = { hooks: [{ id: 'h1', style: 'curiosity', text: 'Version B' }], captions: [], voiceovers: {}, textOverlays: [] };
var hashA1 = CF.ai.contentHashFor(contentA);
var hashA2 = CF.ai.contentHashFor(contentA);
var hashB = CF.ai.contentHashFor(contentB);
ok(hashA1 === hashA2, 'the same generated content hashes the same way');
ok(hashA1 !== hashB, 'different hook wording hashes differently');
var pk1 = CF.aiCache.key({ kind: 'policy', fingerprint: 'abc', model: 'm1', contentHash: hashA1 });
var pk2 = CF.aiCache.key({ kind: 'policy', fingerprint: 'abc', model: 'm1', contentHash: hashB });
ok(pk1 !== pk2, 'regenerating content with different wording is treated as a fresh question to check');
var pk3 = CF.aiCache.key({ kind: 'policy', fingerprint: 'abc', model: 'm1', contentHash: hashA1 });
ok(pk1 === pk3, 'reopening the same project with the same content reuses the cached check for free');

section('ai-client — generate cache is keyed on the style examples too');
var gk1 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'bm', styleHash: undefined });
var gk2 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'bm',
  styleHash: CF.util.hashString('a real caption') });
ok(gk1 !== gk2, 'having style examples at all changes the cache key from having none');
var gk3 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'bm',
  styleHash: CF.util.hashString('a different caption') });
ok(gk2 !== gk3, 'editing Settings to a different example set produces a different key — no stale voice replayed');
var gk4 = CF.aiCache.key({ kind: 'generate', fingerprint: 'abc', model: 'm1', language: 'bm',
  styleHash: CF.util.hashString('a real caption') });
ok(gk2 === gk4, 'the same example set hashes to the same key, so the cache hit still works');

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
ok(html('#view-settings').includes('Caption style examples'), 'settings shows the style examples section');
ok(html('#view-settings').includes(CF.state.settings.styleExamples[0]), 'the default examples are listed on a fresh install');
ok(html('#view-settings').includes('Add example'), 'an add-example action is offered');
ok(html('#view-settings').includes('Reset to defaults'), 'a reset action is offered');

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
    timeBudget: 10,
    clips: [{
      videoId: 'vid_1', fingerprint: 'fp_1', name: 'clip.mp4',
      frameCount: frames.length,
      duration: 27.4, width: 1080, height: 1920, size: 8500000, type: 'video/mp4'
    }]
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
CF.state.studioTab = 'plan'; CF.render();
var pl = html('#view-studio');
ok(pl.includes('Not analysed yet'), 'plan is honest that nothing has run yet');
ok(pl.includes('still frames'), 'the privacy disclosure appears before any analysis');
ok(pl.includes('Analyse this clip'), 'the analyse action is offered');
ok(!pl.includes('No scene plan yet') && !pl.includes('Analyse first'),
   'plan does not show downstream steps before analysis has run — it stops at the analyse button');

CF.state.studioTab = 'edit'; CF.render();
ok(html('#view-studio').includes('Scenes'), 'edit works even with no analysis');

section('studio — the Overview/Director/Content merge (regression)');
/* This used to be 3 separate tabs the user had to switch between for one
   continuous flow, which was reported as confusing. They are now one
   scrolling "Plan" tab — assert the old 5-tab structure is actually gone,
   not just renamed. */
ok(CF.studio.TABS.length === 3, 'the studio now has exactly 3 tabs, not 5');
ok(CF.studio.TABS.map(function (t) { return t[0]; }).join(',') === 'plan,edit,export',
   'the tabs are Plan, Edit, Export in that order');
var subtabsHtml = html('#view-studio');
ok(!subtabsHtml.includes('data-value="director"') && !subtabsHtml.includes('data-value="content"') &&
   !subtabsHtml.includes('data-value="overview"'),
   'no button anywhere still targets the old overview/director/content tab names');

section('studio — with a full AI result, everything on one scroll');
var full = demoProject();
full.id = sp.id;
full.name = 'Chopper demo';
CF.state.studioProject = full;

CF.state.studioTab = 'plan'; CF.render();
var p2 = html('#view-studio');
ok(p2.includes('80'), 'the score is shown');
ok(p2.includes('WORTH EDITING'), 'the verdict band is shown');
ok(p2.includes('not a prediction of views'), 'the score is explicitly advisory, not a virality claim');
ok(p2.includes('Face detected'), 'the face warning fires for the flagged scene');
ok(p2.includes('CTA potential'), 'the score breakdown is listed');
ok(p2.includes('DEMO'), 'the scene plan appears on the SAME page as the score, no tab switch needed');
ok(p2.includes('Apply all safe suggestions'), 'apply-all is offered right there too');
ok(p2.includes('Masukkan bawang macam ni'), 'the matching voiceover line is shown against its scene');
ok(p2.includes('Switch it off'), 'the REMOVE scene offers a one-tap cut');

section('studio — a scene\\'s own text/VO recommendation is never silently dropped (regression)');
/* In the fixture, scene s1 (0-5s, HOOK) is flagged textRecommended:true, but
   the only generated overlay (o1, 6-9s) does not overlap it at all. Before
   the fix, the UI only ever showed a recommendation indirectly — via a
   matched overlay/voiceover line — so this scene showed no sign the AI had
   recommended text for it whatsoever. */
ok(p2.includes('📝 Text recommended'), 'the analysis\\'s own textRecommended flag is now always visible as a tag');
ok(p2.includes('🎙 VO recommended'), 'the analysis\\'s own voiceoverRecommended flag is now always visible as a tag');
ok(p2.includes('line up with this exact moment'),
   'scene 1 (text recommended, no overlapping overlay) gets an explanation instead of silence');
ok(p2.includes('Jimat masa'), 'meanwhile scene 2, which DOES have a matching voiceover line, still shows the normal suggestion box');
ok(p2.includes('Kenapa baru tahu?'), 'hooks appear on the same page, further down — still no tab switch');
ok(p2.includes('Put on video'), 'a hook can be applied, not just read');
ok(p2.includes('Benda kecil'), 'captions appear on the same page too');
ok(p2.includes('Rename') && p2.includes('Delete'), 'project management lives on the Plan tab');
ok(p2.includes('Continue to Edit'), 'a single button nudges toward Edit once planning is done');
ok(/Scene plan/.test(p2) && p2.indexOf('Scene plan') > p2.indexOf('CONTENT SCORE'),
   'sections appear in a sensible order: score, then scene plan, then content');
ok(p2.indexOf('Hooks') > p2.indexOf('Scene plan'), 'content comes after the scene plan, not before it');

/* This project has no applied overlays yet (aiContent.textOverlays are only
   suggestions until something is actually applied) — apply one so the
   delete/clear-all assertions below have something real to act on. */
CF.editor.addOverlay(full, { text: 'Applied test overlay', start: 1, end: 3 });

CF.state.studioTab = 'edit'; CF.render();
var ed = html('#view-studio');
ok(ed.includes('Undo'), 'undo is offered');

section('edit — scenes are tap-to-toggle only, no manual timing controls (per user request)');
/* The Edit tab used to expose per-second trim, split-into-two, reorder and a
   full manual overlay-editing form. Reported as too complicated: the ask was
   a pure "choose which scenes are in" workflow with the AI's own timing, plus
   add/remove-only text overlays. */
ok(ed.includes('Tap a scene to include or exclude it'), 'the simplified choose-in/out instruction is shown');
ok(ed.includes('✓ Included') && ed.includes('Excluded'), 'each scene shows a plain in/out state');
ok((ed.match(/data-action="seg-toggle"/g) || []).length === full.edits.segments.length,
   'every scene is a single toggle target, one per scene');
ok(!ed.includes('Split'), 'the split-a-scene control is gone');
ok(!/data-action="seg-move"/.test(ed), 'scene reordering is gone — order always matches the AI\\'s plan');
ok(!/data-action="seg-trim"/.test(ed), 'manual per-second trim buttons are gone');
ok(!/data-action="seg-delete"/.test(ed), 'scene deletion is gone — toggling off already excludes it');
ok(!ed.includes('Add text overlay'), 'typing a custom text overlay is no longer offered');
ok(!/data-action="overlay-edit"/.test(ed) && !/data-action="overlay-nudge"/.test(ed),
   'overlay timing can no longer be hand-edited or nudged');
ok(/data-action="overlay-delete"/.test(ed), 'deleting a single unwanted overlay is still possible');
ok(ed.includes('Clear all overlays'), 'a bulk "clear all" action exists for trying a different text batch on the same clip');

section('edit — no overlays yet: no stray Clear-all button');
var bareEdit = singleClipProject('NoOverlays', 9);
CF.editor.ensureSegments(bareEdit);
CF.state.studioProject = bareEdit;
CF.render();
ok(!html('#view-studio').includes('Clear all overlays'), 'Clear all is hidden when there is nothing to clear');
CF.state.studioProject = full;
CF.render();

CF.state.studioTab = 'export'; CF.render();
ok(html('#view-studio').includes('cannot export'), 'export is honest about this browser being unable');

section('studio — multi-clip: Plan tab shows a combined score and per-clip sections');
var mc = twoClipProject();
CF.state.studioProject = mc; CF.state.studioTab = 'plan'; CF.render();
var mcPlan = html('#view-studio');
ok(mcPlan.includes('COMBINED CONTENT SCORE'), 'a multi-clip project is explicitly labelled as a combined score');
ok(mcPlan.includes('80'), 'the combined score averages the two clips (70 + 90) / 2');
ok(mcPlan.includes('CLIP 1') && mcPlan.includes('CLIP 2'), 'each clip gets its own labelled section');
ok(mcPlan.includes('unboxing') && mcPlan.includes('demo'), 'both clips\\' own descriptions are shown, not just one');
ok(mcPlan.includes('Unboxing') && mcPlan.includes('Demo'), 'the scene plan is grouped under each clip\\'s own name');
ok(mcPlan.includes('Clip B overlay'), 'generated content (project-level) still appears once, not duplicated per clip');
ok(mcPlan.includes('Re-analyse all clips'), 'the re-analyse action is explicit that it covers every clip');

section('studio — multi-clip: not every clip analysed yet');
var partial = CF.project.create({ name: 'Partial' });
CF.project.addClip(partial, { videoId: 'vp1', fingerprint: 'fp1', name: 'Done', duration: 5, frameCount: 6 });
CF.project.addClip(partial, { videoId: 'vp2', fingerprint: 'fp2', name: 'Not yet', duration: 5, frameCount: 6 });
partial.clips[0].analysis = { video: { product: 'x', description: 'y' }, score: { overall: 50 }, scenes: [] };
CF.state.studioProject = partial; CF.render();
var partialPlan = html('#view-studio');
ok(partialPlan.includes('Not analysed yet'), 'the plan tab is honest that analysis is incomplete');
ok(partialPlan.includes('1 of 2 clips already analysed'), 'it reports exactly how much is done');
ok(partialPlan.includes('Analyse remaining clips'), 'the button is clear it will only cost quota for what is left');

section('studio — multi-clip: Edit tab shows clip labels and the add-clip control');
CF.state.studioProject = mc; CF.state.studioTab = 'edit'; CF.render();
var mcEdit = html('#view-studio');
ok(mcEdit.includes('Unboxing') && mcEdit.includes('Demo'), 'each scene row is labelled with which clip it belongs to');
ok(mcEdit.includes('Clips (2 of ' + CF.MAX_CLIPS + ')'), 'the clip count and cap are both shown');
ok(mcEdit.includes('data-action="add-clip"'), 'an add-clip action is offered');
ok(!mcEdit.includes('data-action="add-clip" disabled') && !/data-action="add-clip"[^>]*disabled/.test(mcEdit),
   'with only 2 of 3 clips used, adding another is not disabled');

section('studio — multi-clip: the add-clip control disables once the cap is reached');
var capped = twoClipProject();
CF.project.addClip(capped, { videoId: 'vC', fingerprint: 'fC', name: 'Result', duration: 5 });
CF.state.studioProject = capped; CF.state.studioTab = 'edit'; CF.render();
var cappedEdit = html('#view-studio');
ok(cappedEdit.includes('Clips (3 of ' + CF.MAX_CLIPS + ')'), 'the count reflects all three clips');
ok(/data-action="add-clip"[^>]*disabled/.test(cappedEdit), 'add-clip is disabled once CF.MAX_CLIPS is reached');
ok(cappedEdit.includes('Up to ' + CF.MAX_CLIPS + ' clips per project'), 'the cap is explained, not just silently disabled');
CF.state.studioProject = full;

section('studio — no leaked placeholders on any tab');
['plan','edit','export'].forEach(function (t) {
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
CF.state.projects[0].clips = [{ id: 'sb1', analysis: full.clips[0].analysis, score: 92 }];
CF.state.tab = 'projects'; CF.render();
ok(html('#view-projects').includes('92/100'), 'a scored project shows its score');
ok(html('#view-projects').includes('EXCELLENT'), 'and its verdict band');

section('forms');
ok(typeof CF.studio.overlayForm === 'undefined' && typeof CF.studio.splitForm === 'undefined',
   'the manual overlay-edit and scene-split forms are gone, not just unreachable');
CF.screens.renameForm(full);
ok(html('#modalRoot').includes('Rename project'), 'the rename form opens');
CF.ui.closeModal();
ok(html('#modalRoot') === '', 'closing clears the modal root');

section('settings — model picker is actually clickable');
/* Regression test: an earlier version rendered the full model list inside a
   <select onchange="void 0">, which is inert under the app's single delegated
   click listener — selecting a model there did nothing, and only the first 3
   quick-pick chips actually worked. Every model must be a real data-action
   button so tapping it in the list has an effect. */
CF.state.models = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', inputTokenLimit: 1000000 },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputTokenLimit: 1000000 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputTokenLimit: 1000000 },
  { id: 'gemini-unusual-name', label: 'A model past the old 3-chip cutoff', inputTokenLimit: 1000000 }
];
CF.state.tab = 'settings'; CF.render();
var settingsHtml = html('#view-settings');
ok(!/<select/.test(settingsHtml), 'the settings screen has no inert <select> for model choice');
ok(!/onchange/.test(settingsHtml), 'no onchange handler is relied on outside the click delegate');
ok((settingsHtml.match(/data-action="set-model"/g) || []).length === CF.state.models.length + 1,
   'every model PLUS the default option is a real set-model button — including ones past the old 3-chip cutoff');
ok(settingsHtml.includes('gemini-unusual-name'), 'a model beyond the old top-3 is actually reachable, not just visible');

/* Simulate tapping that 4th model exactly as the click handler does, and
   confirm the choice actually sticks after leaving and returning to Settings —
   the concrete symptom that was reported ("it turns back to default"). */
CF.state.settings.aiModel = 'gemini-unusual-name';
CF.db.saveSettings(CF.state.settings);
CF.state.tab = 'projects'; CF.render();
CF.state.tab = 'settings'; CF.render();
ok(html('#view-settings').includes('gemini-unusual-name'), 'the picked model is still shown as in-use after switching tabs and back');

section('settings persistence');
CF.state.settings.language = 'mix';
CF.state.settings.faceFree = false;
CF.state.settings.aiModel = 'gemini-test';
CF.db.saveSettings(CF.state.settings);
var reloaded = CF.db.loadSettings();
ok(reloaded.language === 'mix', 'language choice survives a reload');
ok(reloaded.faceFree === false, 'the face-free toggle survives a reload');
ok(reloaded.aiModel === 'gemini-test', 'the model choice survives a reload');

section('edit/export — the preview button is offered and reflects state');
CF.state.studioProject = full; CF.state.tab = 'studio'; CF.state.studioTab = 'edit'; CF.render();
ok(html('#view-studio').includes('Preview with overlays'), 'the Edit tab offers a preview');
CF.state.studioTab = 'export'; CF.render();
ok(html('#view-studio').includes('Preview before rendering'), 'the Export tab offers one last preview before the real render');

section('plan — policy check: nothing generated yet shows nothing');
var noContent = demoProject();
noContent.aiContent = null;
CF.state.studioProject = noContent; CF.state.studioTab = 'plan'; CF.render();
ok(!html('#view-studio').includes('Policy check'), 'no Policy check section renders before there is any content to check');

section('plan — policy check: content exists, not checked yet');
CF.state.studioProject = full; CF.state.studioTab = 'plan'; CF.render();
var notChecked = html('#view-studio');
ok(notChecked.includes('Policy check'), 'the section appears once content has been generated');
ok(notChecked.includes('Not checked yet'), 'and says plainly that nothing has run yet');
ok(notChecked.includes('data-action="check-policy"'), 'a manual check action is offered as a fallback to the automatic one');
ok(notChecked.includes('not a guarantee of TikTok compliance'), 'the advisory-only disclaimer is shown even before any result exists');

section('plan — policy check: a result with real flags');
full.policyCheck = {
  overallRisk: 'high',
  summary: 'One high-risk item found.',
  flags: [
    { id: 'flag1', category: 'FAKED_DANGER', severity: 'high', source: 'visual',
      excerpt: 'staged fall at 0:04', reason: 'looks staged for shock value, not an honest demo',
      suggestion: 'trim this section or relabel it clearly as a dramatization' },
    { id: 'flag2', category: 'UNDISCLOSED_AD', severity: 'medium', source: 'caption',
      excerpt: 'Benda kecil, banyak guna.', reason: 'no #ad or paid-partnership disclosure anywhere in the generated copy',
      suggestion: 'add #ad or "paid partnership" to the caption' }
  ]
};
CF.render();
var checked = html('#view-studio');
ok(checked.includes('HIGH RISK'), 'the overall risk band is shown');
ok(checked.includes('One high-risk item found.'), 'the summary is shown');
ok(checked.includes('Faked or staged danger'), 'a human-readable category label is shown, not the raw enum');
ok(checked.includes('staged fall at 0:04'), 'the flagged excerpt is quoted');
ok(checked.includes('trim this section or relabel it clearly'), 'the suggested fix is shown');
ok(checked.includes('No paid-partnership disclosure'), 'the second flag is also rendered');
ok(checked.includes('not a guarantee of TikTok compliance'), 'the advisory-only disclaimer is still shown alongside real results');
ok(checked.includes('data-action="recheck-policy"'), 'a manual re-check action is offered');
ok(!/undefined|NaN/.test(checked), 'the populated policy section has no leaked placeholders');
`);
  return Promise.resolve();
}

/* Real playback/canvas drawing needs a real browser — see the README's
   manual-check list. What's safe and worth asserting headlessly is that
   open()/close() manage the modal and their own resources correctly. */
function previewOpenClose(ctx) {
  const CF = ctx.CF;
  return CF.db.putVideo({ id: 'v1', blob: new ctx.Blob(['x']), thumb: null, frames: [], name: 'c.mp4', size: 4 })
    .then(function () {
      app.run(`
section('preview — open/close lifecycle with a real video record');
ok(CF.preview.isOpen() === false, 'nothing open before this test');
CF.preview.open(CF.state.studioProject); /* 'full', left set by the previous section */
`);
      /* open() resolves through CF.db.getVideo(...).then(...) internally — give
         the microtask/timer queue a turn to run it before asserting on the result. */
      return new Promise(function (resolve) { setTimeout(resolve, 10); });
    })
    .then(function () {
      app.run(`
ok(CF.preview.isOpen() === true, 'opening a project with a stored video record succeeds');
var modalHtml = html('#modalRoot');
ok(modalHtml.includes('previewCanvas'), 'the preview canvas is in the modal');
ok(modalHtml.includes('data-action="preview-toggle"'), 'a play/pause control is offered');
ok(modalHtml.includes('Silent preview'), 'the silent-preview disclosure is shown, matching the chosen scope');
ok(!/undefined|NaN/.test(modalHtml), 'the preview modal has no leaked placeholders');

CF.preview.close();
ok(CF.preview.isOpen() === false, 'close() tears the loop and resources down');
CF.ui.closeModal();
`);
    });
}

function previewMultiClip(ctx) {
  const CF = ctx.CF;
  return Promise.all([
    CF.db.putVideo({ id: 'vA', blob: new ctx.Blob(['a']), thumb: null, frames: [], name: 'a.mp4', size: 4 }),
    CF.db.putVideo({ id: 'vB', blob: new ctx.Blob(['b']), thumb: null, frames: [], name: 'b.mp4', size: 4 })
  ]).then(function () {
    app.run(`
section('preview — multi-clip: fetches every clip\\'s own blob, not just the first');
var mp = CF.project.create({ name: 'Preview multi' });
CF.project.addClip(mp, { videoId: 'vA', fingerprint: 'fA', name: 'A', duration: 5 });
CF.project.addClip(mp, { videoId: 'vB', fingerprint: 'fB', name: 'B', duration: 5 });
CF.editor.ensureSegments(mp);
ok(CF.editor.outputTimeline(mp).segments.length === 2, 'one full-length segment per clip, no analysis needed');
CF.preview.open(mp);
CF.state.__previewMulti = mp;
`);
    return new Promise(function (resolve) { setTimeout(resolve, 10); });
  }).then(function () {
    app.run(`
ok(CF.preview.isOpen() === true, 'a multi-clip preview opens successfully with both blobs available');
CF.preview.close();
ok(CF.preview.isOpen() === false, 'closes cleanly');
CF.ui.closeModal();
`);
  });
}

app.runAsync(freshInstall)
  .then(function () { return app.runAsync(storageRoundTrip); })
  .then(function () { return app.runAsync(studioScreens); })
  .then(function () { return app.runAsync(previewOpenClose); })
  .then(function () { return app.runAsync(previewMultiClip); })
  .then(function () { app.done(); });
