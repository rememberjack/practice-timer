/* A small theme kept outside the app, for the tests: it is installed with the build's --theme-dir, written for English only, and uses most of
   the hooks, counting each call in its panel (data-calls) so the browser test can see the page drive it (docs/theme-modules.md) */
'use strict';
const MT = require('../../core.js');
const { pulse } = require('./pulse.js');
const words = require('./words.js');
const { tr } = MT.translator(words);

module.exports = {
  api: 1,
  id: 'sample',
  name: 'Sample',
  line: 'A test theme: a dot that grows as you play.',
  langs: ['en'],
  words: words,
  panel: 'pSample',
  chrome: 'pixel',
  tests: [{ name: 'Sample: the dot grows with the last minute', run: () => {
    const got = [pulse(0, 0), pulse(1, 0), pulse(0.5, 1)].map(v => v.toFixed(2)).join(' ');
    return { name: 'Sample: the dot grows with the last minute', expect: '0.20 1.00 0.80', got: got, pass: got === '0.20 1.00 0.80' }; } }],
  create: function (host) {
    const $ = host.$, calls = {}, count = k => { calls[k] = (calls[k] || 0) + 1; host.panel.dataset.calls = JSON.stringify(calls); };
    let notes = 0;
    return {
      show() { count('show'); }, hide() { count('hide'); },
      reset(s) { count('reset:' + s.why); notes = 0; },
      tick() { count('tick'); },
      notes(n) { notes += n; count('notes'); },
      frame(dt, f) { count('frame'); if (f.shown) $('smDot').style.transform = 'scale(' + pulse(f.v.pw, notes > 0 ? 1 : 0).toFixed(3) + ')'; notes = 0; },
      paint(v) { count('paint'); host.text($('smPlay'), host.fmt(v.play)); host.text($('smHeard'), host.heardLine(v)); host.text($('smHint'), tr(v.st === 'running' ? 'Keep playing' : 'Press Start to grow the dot')); },
      stopped() { count('stopped'); },
      keep() { return { notes: 1 }; },
      langChanged() { count('langChanged'); },
      resize() { count('resize'); },
    };
  },
};
