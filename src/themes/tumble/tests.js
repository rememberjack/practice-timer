/* Tumble's tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { TU, TumbleSim, StackPile, chordOf, unitsFor, tuColour, tuName, PALETTE, wallMarks } = require('./sim.js');
const list = [];
const DT = 0.05;
/* secs of sound at notesPerSec note starts a second, all on the same pitch; returns the events */
function run(s, secs, inp, notesPerSec) { const ev = []; let owed = 0;
  for (let t = 0; t < secs - 1e-9; t += DT) { owed += (notesPerSec || 0) * DT; const n = Math.floor(owed + 1e-9); owed -= n;
    s.update(DT, Object.assign({ state: 'running', music: true, midi: 60, play: 0 }, inp, { notes: n })); while (s.events.length) ev.push(s.events.shift()); }
  return ev; }
/* one note: held for secs, then let go (a moment of quiet); returns the blocks it dropped */
function note(s, midi, secs, gap) { const ev = [];
  for (let t = 0; t < secs - 1e-9; t += DT) { s.update(DT, { state: 'running', music: true, midi: midi, notes: t === 0 ? 1 : 0, play: s.play }); while (s.events.length) ev.push(s.events.shift()); }
  for (let t = 0; t < (gap || DT) - 1e-9; t += DT) { s.update(DT, { state: 'running', music: false, midi: null, notes: 0, play: s.play }); while (s.events.length) ev.push(s.events.shift()); }
  return ev; }
const blocks = ev => ev.filter(e => e.k === 'block').map(e => e.b);
const settle = (p, secs) => { for (let t = 0; t < (secs || 3); t += DT) p.step(DT); };

list.push({ name: 'Tumble: only playing drops blocks', run: () => {
  const s = new TumbleSim(); s.reset(1800, 3);
  const a = run(s, 20, { state: 'paused' }, 2).length, b = run(s, 20, { state: 'running', music: false }, 2).length, c = run(s, 20, { state: 'stopped' }, 2).length;
  const d = blocks(run(s, 20, { state: 'running', music: true }, 2)).length;
  return { name: 'Tumble: only playing drops blocks', expect: 'none while paused, quiet or stopped; one for each note while playing (40 notes in 20 s: 39 dropped, the last still held)',
    got: a + ' paused, ' + b + ' quiet, ' + c + ' stopped, ' + d + ' playing; ' + s.blocks + ' counted', pass: a === 0 && b === 0 && c === 0 && d >= 38 && d <= 40 && s.blocks === d }; } });
list.push({ name: 'Tumble: a block is as wide as the note was long', run: () => {
  const s = new TumbleSim(); s.reset(1800, 5);
  const w = [note(s, 60, 0.2), note(s, 62, 1.0), note(s, 64, 2.4)].map(ev => blocks(ev).map(b => b.units).join('+'));
  const glitch = blocks(note(s, 65, 0.03)).length;
  const ok = w[0] === '1' && w[1] === '4' && w[2] === '8+2' && glitch === 0 && unitsFor(0.3) === 1 && unitsFor(0.6) === 2 && unitsFor(9) === TU.MAXU;
  return { name: 'Tumble: a block is as wide as the note was long', expect: 'a unit for each quarter second: 0.2 s → 1, 1 s → 4, 2.4 s → a plank of 8 then 2; a 0.03 s glitch drops nothing',
    got: w.join(', ') + '; glitch ' + glitch, pass: ok }; } });
list.push({ name: 'Tumble: the twelve notes are twelve colours round the circle of fifths', run: () => {
  const cols = new Set(); for (let pc = 0; pc < 12; pc++) cols.add(tuColour(pc));
  const fifth = PALETTE.indexOf(tuColour(7)) - PALETTE.indexOf(tuColour(0)), fourth = PALETTE.indexOf(tuColour(5)), names = [tuName(60), tuName(61), tuName(63), tuName(66), tuName(71)].join(' ');
  const ok = cols.size === 12 && fifth === 1 && fourth === 11 && tuColour(60) === tuColour(72) && names === 'C C♯ E♭ F♯ B';
  return { name: 'Tumble: the twelve notes are twelve colours round the circle of fifths', expect: '12 colours; G is the colour after C and F the one before; C4 and C5 the same; names C C♯ E♭ F♯ B',
    got: cols.size + ' colours, G at +' + fifth + ', F at ' + fourth + ', names ' + names, pass: ok }; } });
list.push({ name: 'Tumble: low notes land on the left, high notes on the right', run: () => {
  const s = new TumbleSim(); s.reset(1800, 7); const x1 = s.pitchX(48), x2 = s.pitchX(60), x3 = s.pitchX(84), lo = s.lo, x4 = s.pitchX(36), x5 = s.pitchX(48);
  const inside = [x1, x2, x3, x4, x5].every(x => x >= 1.5 && x <= TU.COLS - 1.5);
  return { name: 'Tumble: low notes land on the left, high notes on the right', expect: 'C3 left of C4 left of C6, all inside the crate; a C2 widens the range and lands at the left edge',
    got: [x1, x2, x3].map(x => x.toFixed(1)).join(' < ') + '; C2 at ' + x4.toFixed(1) + ' (range from ' + lo + ' to ' + s.lo + '), C3 now ' + x5.toFixed(1), pass: x1 < x2 && x2 < x3 && inside && s.lo < lo && x4 < x5 && x5 < x2 }; } });
list.push({ name: 'Tumble: three or four notes of one chord in a row are a chord outline', run: () => {
  const play = seq => { const s = new TumbleSim(); s.reset(1800, 11); const ev = []; for (const [m, held, gap] of seq) ev.push(...note(s, m, held, gap)); return { ch: ev.filter(e => e.k === 'chord'), bl: blocks(ev), s: s }; };
  const c = play([[60, 0.3, 0.1], [64, 0.3, 0.1], [67, 0.3, 0.1]]), am = play([[57, 0.3, 0.1], [60, 0.3, 0.1], [64, 0.3, 0.1]]), g7 = play([[55, 0.3, 0.1], [59, 0.3, 0.1], [62, 0.3, 0.1], [65, 0.3, 0.1]]);
  const scale = play([[60, 0.3, 0.1], [62, 0.3, 0.1], [64, 0.3, 0.1], [65, 0.3, 0.1], [67, 0.3, 0.1]]), slow = play([[60, 0.3, 1.0], [64, 0.3, 1.0], [67, 0.3, 1.0]]), held = play([[60, 1.5, 0.1], [64, 1.5, 0.1], [67, 1.5, 0.1]]);
  const name = r => r.ch.map(e => tuName(e.root) + e.suffix).join(' ');
  const twice = play([[60, 0.3, 0.1], [64, 0.3, 0.1], [67, 0.3, 0.1], [60, 0.3, 0.1], [64, 0.3, 0.1], [67, 0.3, 0.1]]);
  const ok = name(c) === 'C' && name(am) === 'Am' && name(g7) === 'G G7' && g7.ch[1].ids.length === 4 && g7.s.chords === 1 && g7.bl.every(b => b.chord === 'G7') && c.bl.every(b => b.chord === 'C') && !scale.ch.length && !slow.ch.length && !held.ch.length && c.s.chords === 1
    && name(twice) === 'C C' && twice.s.chords === 2
    && chordOf([60, 63, 67]).suffix === 'm' && chordOf([60, 64, 68]).suffix === '+' && chordOf([62, 65, 69, 72]) && chordOf([62, 65, 69, 72]).suffix === 'm7' && chordOf([60, 62]) === null && chordOf([60, 61, 62]) === null;
  return { name: 'Tumble: three or four notes of one chord in a row are a chord outline', expect: 'C E G → C; A C E → Am; G B D, then F → G, then G7 (one chord, 4 blocks renamed); the blocks marked; the arpeggio twice → C twice; a scale, notes a second apart, or long notes name nothing',
    got: 'C E G → ' + (name(c) || 'none') + ', A C E → ' + (name(am) || 'none') + ', G B D F → ' + (name(g7) || 'none') + ' (' + g7.s.chords + ' counted, marked ' + g7.bl.map(b => b.chord || '-').join(' ') + '), twice → ' + (name(twice) || 'none') + '; scale ' + scale.ch.length + ', slow ' + slow.ch.length + ', held ' + held.ch.length + '; marked ' + c.bl.map(b => b.chord || '-').join(' '), pass: ok }; } });
list.push({ name: 'Tumble: the plain pile stacks into a heap, inside the crate', run: () => {
  const p = new StackPile(), cube = (i, x) => ({ id: i, kind: 'note', pc: i % 12, oct: 4, units: 1, h: 1, x: x, chord: '' }); p.spawnY = 30;
  for (let i = 0; i < 24; i++) { p.add(cube(i, 10 + (i % 3) * 0.5)); settle(p, 0.4); }
  settle(p, 4); const rest = p.live.every(k => k.rest), inside = p.live.every(k => k.x - k.w / 2 >= -1e-6 && k.x + k.w / 2 <= TU.COLS + 1e-6 && k.y - k.h / 2 >= -1e-6);
  const tallest = Math.max(...p.live.map(k => k.y + k.h / 2)), spread = new Set(p.live.map(k => k.x)).size;
  p.add({ id: 99, kind: 'note', pc: 0, oct: 4, units: 8, h: 1, x: 10, chord: '' }); settle(p, 4); const plank = p.live[p.live.length - 1];
  const under = p.live.filter(k => k !== plank && k.rest && Math.abs(k.y + k.h / 2 - (plank.y - plank.h / 2)) < 1e-6 && Math.abs(k.x - plank.x) < plank.w / 2).length;
  for (let i = 0; i < 60; i++) { p.add(cube(100 + i, 0.5 + (i * 7) % 20)); settle(p, 0.3); }   // across the whole crate: the surface (the middle column) rises
  settle(p, 4); const one = p.surface(), gone = p.settleBelow(2).length, after = p.surface();
  const ok = rest && inside && spread >= 5 && tallest <= 8 && tallest >= 3 && plank.rest && under >= 1 && one > 1 && gone > 0 && p.settled.length === gone && Math.abs(after - one) < 1e-6;
  return { name: 'Tumble: the plain pile stacks into a heap, inside the crate', expect: '24 cubes dropped near the middle spread into a heap (3 to 8 high, never out of the crate); a plank of 8 rests across it; cubes across the crate raise the surface; settling the deep ones leaves the height as it was',
    got: p.live.length + gone + ' blocks; heap ' + spread + ' columns, ' + tallest.toFixed(1) + ' high' + (rest ? '' : ', some still falling') + (inside ? '' : ', one outside') + '; plank ' + (plank.rest ? 'rests on ' + under : 'falling') + '; surface ' + one.toFixed(1) + ', ' + gone + ' settled, surface ' + after.toFixed(1), pass: ok }; } });
list.push({ name: 'Tumble: the goal line rises with the wall, and past walls are marked on the crate', run: () => {
  const s = new TumbleSim(); s.reset(1800, 13); s.pile.spawnY = 30; let play = 0, owed = 0;
  for (let t = 0; t < 150; t += DT) { play += DT; owed += 1.5 * DT; const n = Math.floor(owed + 1e-9); owed -= n; s.update(DT, { state: 'running', music: true, notes: n, midi: 55 + Math.floor(t * 3) % 24, play: play }); s.pile.step(DT); s.events.length = 0; }
  const rate = s.perMin(), rateOk = rate > 0.3 && Math.abs(rate - s.surface / 2.5) < s.surface / 2.5 * 0.5;
  const rec = h => ({ themes: { tumble: { blocks: 9, chords: 0, notes: [], height: h } } });
  const none = wallMarks([]), old = wallMarks([{ themes: { tumble: { blocks: 9 } } }, { themes: { rocket: {} } }, {}]), empty = wallMarks([rec(0)]);
  const two = wallMarks([rec(12), rec(30.5), rec(0), rec(18)]), one = wallMarks([rec(12), rec(18), rec(30.5)]), lone = wallMarks([rec(7)]);
  const str = m => m.map(x => x.k + '@' + x.y).join(' ');
  const ok = rateOk && !none.length && !old.length && !empty.length && str(two) === 'last@18 best@30.5' && str(one) === 'best@30.5' && str(lone) === 'best@7';
  return { name: 'Tumble: the goal line rises with the wall, and past walls are marked on the crate', expect: 'after 2½ minutes of playing the rise a minute is near the pile\'s own; marks from the log: none without a wall; walls of 12, 30.5, (none) and 18 → last 18 and tallest 30.5, lowest first; the last wall the tallest → one mark; a first wall → one',
    got: 'rising ' + rate.toFixed(1) + ' a minute, the pile ' + s.surface.toFixed(1) + '; marks: ' + [none, old, empty].map(m => m.length).join('/') + ' with no wall, ' + str(two) + '; ' + str(one) + '; ' + str(lone), pass: ok }; } });
list.push({ name: 'Tumble: reaching the goal drops one trophy block', run: () => {
  const s = new TumbleSim(); s.reset(30, 17); const ev = []; let play = 0;
  for (let t = 0; t < 40; t += DT) { play += DT; s.update(DT, { state: 'running', music: true, notes: t % 0.5 < DT / 2 ? 1 : 0, midi: 64, play: play }); while (s.events.length) ev.push(s.events.shift()); }
  const goals = ev.filter(e => e.k === 'goal'), at = goals.length ? ev.indexOf(goals[0]) : -1, trophies = s.pile.live.filter(k => k.b.kind === 'trophy').length;
  const paused = new TumbleSim(); paused.reset(30, 17); for (let t = 0; t < 40; t += DT) paused.update(DT, { state: 'paused', music: false, notes: 0, midi: null, play: 35 });
  const ok = goals.length === 1 && s.goalDone && trophies === 1 && at > 0 && goals[0].b.units === TU.TROPHY_W && !s.pile.live.slice(0, at).some(k => k.b.kind === 'trophy') && s.blocks === s.pile.count - 1 && !paused.goalDone;
  return { name: 'Tumble: reaching the goal drops one trophy block', expect: 'at 30 s of play, one goal event and one trophy block (not counted as a block); none while paused',
    got: goals.length + ' goal event(s), ' + trophies + ' trophy, ' + s.blocks + ' blocks of ' + s.pile.count + ' in the pile' + (paused.goalDone ? ', one while paused' : ''), pass: ok }; } });
list.push({ name: 'Tumble: a following device drops the blocks it is told about, each once', run: () => {
  const a = new TumbleSim(), b = new TumbleSim(); a.reset(1800, 19); b.reset(1800, 19);
  for (const m of [60, 64, 67, 72]) note(a, m, 0.3, 0.1);
  const d1 = a.share(); b.follow(d1); b.follow(d1); const once = b.blocks; note(a, 74, 0.5, 0.1); const d2 = a.share(); b.follow(d2);
  b.update(DT, { state: 'running', music: true, notes: 1, midi: 60, play: 1, follow: true }); b.update(DT, { state: 'running', music: false, notes: 0, midi: null, play: 1, follow: true });
  const same = b.pile.count === a.pile.count && b.pile.live.map(k => k.b.units + '@' + k.b.pc).join() === a.pile.live.map(k => k.b.units + '@' + k.b.pc).join();
  const ok = once === 4 && b.blocks === 5 && same && b.chords === a.chords && a.chords === 1 && JSON.stringify(d2).length < 400 && b.pile.live.filter(k => k.b.chord).length === 3;
  return { name: 'Tumble: a following device drops the blocks it is told about, each once', expect: 'the same 5 blocks (sizes, notes and the chord\'s gold) once each, however often it is told; the sound it hears drops nothing; under 400 bytes a share',
    got: once + ' after twice the same share, ' + b.blocks + ' blocks, ' + b.chords + ' chords, ' + (same ? 'the same pile' : 'a different pile') + ', ' + JSON.stringify(d2).length + ' bytes', pass: ok }; } });
list.push({ name: 'Tumble: what a session keeps', run: () => {
  const s = new TumbleSim(); s.reset(1800, 23); for (const m of [60, 64, 67]) note(s, m, 0.3, 0.1); const k = s.save();
  for (let i = 0; i < 60; i++) note(s, 48 + (i * 7) % 37, 0.3, 0.1);   // across the whole crate, so the wall has a height
  settle(s.pile, 4); const k2 = s.save();
  const ok = k.blocks === 3 && k.chords === 1 && Array.isArray(k.notes) && k.notes.length === 12 && k.notes[0] === 1 && k.notes[4] === 1 && k.notes[7] === 1 && JSON.stringify(k) === JSON.stringify(JSON.parse(JSON.stringify(k)))
    && typeof k.height === 'number' && k2.height > 0 && Math.abs(k2.height - s.surface) < 0.1;
  return { name: 'Tumble: what a session keeps', expect: 'the blocks, the chords, how often each of the twelve notes was played and the wall\'s height once the blocks have landed, as a plain object', got: JSON.stringify(k2), pass: ok }; } });
module.exports = list;
