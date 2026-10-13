// Detection, timer and practice log tests, and each installed theme's own tests, at the two common microphone sample rates. Exits 1 on any failure.
const fs = require('fs'), path = require('path');
const MT = require('../src/core.js'); require('../src/lang.js');   // the words in Chinese and French, for the languages test
const installed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'themes', 'themes.json'), 'utf8'));
for (const id of installed) { const bad = MT.addTheme(require('../src/themes/' + id + '/theme.js')); if (bad.length) { console.log('FAIL theme ' + id + ' was not installed: ' + bad.join('; ')); process.exitCode = 1; } }
let fail = 0;
for (const sr of [44100, 48000]) {
  for (const r of MT.runDetectionTests(sr)) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + sr + ' ' + r.name + ' | ' + r.got); }
}
for (const def of MT.themes()) for (const t of def.tests || []) {   // a theme's tests do not depend on the sample rate: once each
  let r; try { r = MT.inLang('en', t.run); } catch (e) { r = { pass: false, got: 'error: ' + (e && e.message) }; }
  if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + def.id + ' ' + t.name + ' | ' + r.got);
}
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail || process.exitCode ? 1 : 0);
