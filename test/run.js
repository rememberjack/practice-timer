// Detection, timer and rocket tests, at the two common microphone sample rates. Exits 1 on any failure.
const MT = require('../src/core.js');
let fail = 0;
for (const sr of [44100, 48000]) {
  for (const r of MT.runDetectionTests(sr)) { if (!r.pass) fail++; console.log((r.pass ? 'PASS ' : 'FAIL ') + sr + ' ' + r.name + ' | ' + r.got); }
}
console.log(fail ? fail + ' FAILED' : 'all passed');
process.exit(fail ? 1 : 0);
