/* server.mjs — checks for the Netlify Gemini proxy helpers.
   Run from the clipforge/ directory:  node test/server.mjs

   These functions handle untrusted model output and user-supplied model names,
   so they get their own pass rather than riding along with the browser suite. */

import {
  extractJson, framesToParts, resolveModel, DEFAULT_MODEL, MAX_BODY_BYTES
} from '../../netlify/functions/lib/gemini.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ FAIL: ' + label); }
}
function section(name) { console.log('\n[' + name + ']'); }

section('extractJson — Gemini wraps JSON in prose more often than it should');
ok(extractJson('{"a":1}').a === 1, 'bare JSON parses');
ok(extractJson('```json\n{"a":2}\n```').a === 2, 'a json code fence is stripped');
ok(extractJson('```\n{"a":3}\n```').a === 3, 'a bare code fence is stripped');
ok(extractJson('Here you go:\n{"a":4}\nHope that helps!').a === 4, 'surrounding prose is discarded');
ok(extractJson('not json at all') === null, 'unparseable text returns null rather than throwing');
ok(extractJson(null) === null, 'null input returns null');
ok(extractJson('') === null, 'empty input returns null');
ok(extractJson('{"nested":{"deep":[1,2]}}').nested.deep[1] === 2, 'nested structures survive');

section('framesToParts — only real image data reaches the upstream API');
const parts = framesToParts([
  { t: 1.5, dataUrl: 'data:image/jpeg;base64,AAAA' },
  { t: 2.0, dataUrl: 'data:image/png;base64,BBBB' },
  { t: 3.0, dataUrl: 'https://evil.example.com/pixel.jpg' },
  { t: 4.0, dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
  { t: 5.0 },
  null,
  'nonsense'
]);
const images = parts.filter((p) => p.inlineData);
ok(images.length === 2, 'only the two genuine image data URLs are forwarded');
ok(images[0].inlineData.mimeType === 'image/jpeg', 'the jpeg mime type is preserved');
ok(images[1].inlineData.mimeType === 'image/png', 'the png mime type is preserved');
ok(!parts.some((p) => JSON.stringify(p).includes('evil.example.com')), 'a remote URL is never forwarded');
ok(!parts.some((p) => p.inlineData && p.inlineData.mimeType === 'text/html'), 'a non-image data URL is rejected');
ok(parts.some((p) => p.text && p.text.includes('1.50s')), 'each frame is labelled with its timestamp');
ok(framesToParts(null).length === 0, 'null frames yields no parts');
ok(framesToParts([], 20).length === 0, 'an empty list yields no parts');

const many = framesToParts(
  Array.from({ length: 50 }, (_, i) => ({ t: i, dataUrl: 'data:image/jpeg;base64,AAAA' })),
  20
);
ok(many.filter((p) => p.inlineData).length === 20, 'the frame count is capped so a request cannot balloon');

section('resolveModel — a model name is interpolated into a URL, so it is validated');
ok(resolveModel('gemini-2.5-flash') === 'gemini-2.5-flash', 'a normal model id passes through');
ok(resolveModel('') === DEFAULT_MODEL, 'an empty request falls back to the default');
ok(resolveModel(null) === DEFAULT_MODEL, 'null falls back to the default');
ok(resolveModel('../../secret') === DEFAULT_MODEL, 'a path-traversal attempt is rejected');
ok(resolveModel('a/b') === DEFAULT_MODEL, 'a slash is rejected');
ok(resolveModel('a?key=x') === DEFAULT_MODEL, 'a query-string injection is rejected');
ok(resolveModel('x'.repeat(200)) === DEFAULT_MODEL, 'an absurdly long name is rejected');
ok(resolveModel('gemini_2.5-flash') === 'gemini_2.5-flash', 'dots, dashes and underscores are allowed');

section('limits');
ok(MAX_BODY_BYTES < 6 * 1024 * 1024,
   'the body cap sits under the Netlify synchronous function limit');

console.log('\n' + '='.repeat(46));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(46));
if (fail) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
