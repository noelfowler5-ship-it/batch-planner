/* harness.js — run ClipForge's browser JavaScript inside Node against a stubbed
   DOM, so logic and rendered markup can be asserted without opening a browser.

   The app ships as several classic <script> files sharing a window.CF namespace.
   This loads them into one vm context in the same order index.html does, which
   means every internal function and the live CF.state object are reachable from
   assertion code passed to run().

   Usage:  node test/run.js   (from the clipforge/ directory)
*/

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SCRIPTS = [
  'js/util.js',
  'js/db.js',
  'js/video-engine.js',
  'js/project.js',
  'js/ai-schema.js',
  'js/ai-client.js',
  'js/editor.js',
  'js/export.js',
  'js/ui.js',
  'js/screens.js',
  'js/studio.js',
  'js/preview.js',
  'js/app.js'
];

function boot(rootDir, opts) {
  opts = opts || {};
  const root = rootDir || path.join(__dirname, '..');

  const store = {};   // localStorage backing
  const els = {};     // selector -> element, so innerHTML survives between calls
  const log = { toasts: [] };

  function makeEl(sel) {
    if (els[sel]) return els[sel];
    const el = {
      _sel: sel,
      innerHTML: '', outerHTML: '', value: '', textContent: '', src: '', href: '',
      style: {}, dataset: {}, files: null, checked: false, disabled: false,
      classList: {
        _set: {},
        add(c) { this._set[c] = true; },
        remove(c) { delete this._set[c]; },
        toggle(c, on) { if (on === undefined) { this._set[c] ? delete this._set[c] : this._set[c] = true; } else if (on) { this._set[c] = true; } else { delete this._set[c]; } },
        contains(c) { return !!this._set[c]; }
      },
      addEventListener() {}, removeEventListener() {},
      appendChild() {}, removeChild() {}, remove() {}, click() {},
      select() {}, focus() {}, blur() {},
      /* HTMLMediaElement stubs — real playback can't be simulated headlessly,
         but code that just calls .play()/.pause() (e.g. preview.js, export.js)
         should not crash the harness for doing so. */
      play() { return undefined; }, pause() {},
      setAttribute() {}, getAttribute() { return null; }, insertAdjacentHTML() {},
      getContext() {
        return { drawImage() {}, fillRect() {}, clearRect() {}, fillText() {} };
      },
      toDataURL() { return 'data:image/jpeg;base64,TEST'; },
      querySelector(s) { return makeEl(sel + ' ' + s); },
      querySelectorAll() { return []; },
      closest() { return null; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 360, height: 640 }; }
    };
    els[sel] = el;
    return el;
  }

  const doc = {
    querySelector: (s) => makeEl(s),
    querySelectorAll: () => [],
    getElementById: (id) => makeEl('#' + id),
    createElement: () => makeEl('__tmp' + Math.random()),
    createDocumentFragment: () => makeEl('__frag' + Math.random()),
    addEventListener() {}, removeEventListener() {},
    execCommand() { return true; },
    body: { style: {}, appendChild() {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {} },
    head: { appendChild() {} },
    readyState: 'complete'
  };

  const ctx = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, JSON, Promise, Number, String, Array, Object, Boolean, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    document: doc,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
      key: (i) => Object.keys(store)[i] || null,
      get length() { return Object.keys(store).length; }
    },
    navigator: { onLine: true, userAgent: 'node-harness' },
    location: { href: 'http://localhost/index.html', protocol: 'http:', pathname: '/index.html' },
    URL: { createObjectURL: () => 'blob:harness/' + Math.random(), revokeObjectURL() {} },
    Blob: class { constructor(p) { this.parts = p; this.size = 1024; } },
    File: class {},
    requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: () => Promise.reject(new Error('offline in harness')),
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    // MediaRecorder deliberately absent: exercises the "this browser cannot
    // export" path, which is the one users on odd browsers will actually hit.
    // indexedDB deliberately left undefined: this drives the app down its
    // degraded-storage fallback, which is exactly what Chrome does on file://.
    // Assert that path works before assuming the happy one does.
    __CF_TEST__: true
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  ctx.window.addEventListener = () => {};
  ctx.window.removeEventListener = () => {};
  ctx.window.scrollTo = () => {};

  Object.assign(ctx, opts.globals || {});
  vm.createContext(ctx);

  SCRIPTS.forEach((rel) => {
    const file = path.join(root, rel);
    let code;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.error('\n✗ missing script: ' + rel);
      process.exit(1);
    }
    try {
      vm.runInContext(code, ctx, { filename: rel });
    } catch (e) {
      console.error('\n✗ ' + rel + ' threw on load: ' + e.message);
      console.error((e.stack || '').split('\n').slice(0, 5).join('\n'));
      process.exit(1);
    }
  });

  // Assertion helpers live in the same context so app-level const/let/function
  // bindings — which never land on globalThis — are directly visible.
  ctx.__t = { pass: 0, fail: 0, failures: [] };
  ctx.ok = function (cond, label) {
    if (cond) { ctx.__t.pass++; console.log('  ✓ ' + label); }
    else { ctx.__t.fail++; ctx.__t.failures.push(label); console.log('  ✗ FAIL: ' + label); }
  };
  ctx.html = (sel) => makeEl(sel).innerHTML;
  ctx.section = (name) => console.log('\n[' + name + ']');
  ctx.show = (label, value) => console.log('    · ' + label + ': ' + value);
  ctx.harnessLog = log;

  return {
    ctx, els, log,
    html: (sel) => makeEl(sel).innerHTML,
    run(code, label) {
      try {
        vm.runInContext(code, ctx, { filename: (label || 'assertions') + '.js' });
      } catch (e) {
        ctx.__t.fail++;
        ctx.__t.failures.push('threw: ' + e.message);
        console.log('  ✗ FAIL (threw): ' + e.message);
        console.log('    ' + (e.stack || '').split('\n').slice(1, 3).join('\n    '));
      }
      return this;
    },
    /* Assertions that need to await app promises. */
    runAsync(fn) {
      return Promise.resolve(fn(ctx)).catch((e) => {
        ctx.__t.fail++;
        ctx.__t.failures.push('async threw: ' + e.message);
        console.log('  ✗ FAIL (async threw): ' + e.message);
      }).then(() => this);
    },
    done() {
      const t = ctx.__t;
      console.log('\n' + '='.repeat(46));
      console.log(t.pass + ' passed, ' + t.fail + ' failed');
      console.log('='.repeat(46));
      if (t.fail) {
        console.log('\nFailures:');
        t.failures.forEach((f) => console.log('  - ' + f));
        process.exit(1);
      }
      return t;
    }
  };
}

module.exports = { boot };
