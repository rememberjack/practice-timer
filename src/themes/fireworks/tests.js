/* Fireworks' tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { FW, FW_SYMBOLS, FireworkSim, fwHue, fwSymbolShape, fwTrophyShape } = require('./sim.js');
const list = [];
const fwRun = (s, secs, inp, notesPerSec) => { const ev = []; let owed = 0;
  for (let t = 0; t < secs - 1e-9; t += 0.05) { owed += (notesPerSec || 0) * 0.05; const n = Math.floor(owed + 1e-9); owed -= n;
    s.update(0.05, Object.assign({}, inp, { notes: n })); while (s.events.length) ev.push(s.events.shift()); }
  return ev; };
list.push({ name: 'Fireworks: only playing sends shells up', run: () => {
  const s = new FireworkSim(); s.reset(1800, 3);
  const a = fwRun(s, 20, { state: 'paused', music: true, midi: 60, recent: 0.8, play: 0 }, 1).length,
    b = fwRun(s, 20, { state: 'running', music: false, midi: 60, recent: 0.8, play: 0 }, 1).length,
    c = fwRun(s, 20, { state: 'stopped', music: true, midi: 60, recent: 0.8, play: 0 }, 1).length,
    d = fwRun(s, 20, { state: 'running', music: true, midi: 60, recent: 0, play: 0 }, 1).filter(e => e.k === 'shell').length;
  return { name: 'Fireworks: only playing sends shells up', expect: 'none while paused, quiet or stopped, however intense; with no intensity, one for each note played (20 notes, 20 shells)',
    got: a + ' paused, ' + b + ' quiet, ' + c + ' stopped, ' + d + ' playing; ' + s.shells + ' counted', pass: a === 0 && b === 0 && c === 0 && d === 20 && s.shells === 20 }; } });
list.push({ name: 'Fireworks: each note is a colour, higher notes burst higher', run: () => {
  const s = new FireworkSim(); s.reset(1800, 5); const shot = midi => { s.tokens = FW.BURST; s.update(0.05, { state: 'running', music: true, notes: 1, midi: midi, recent: 0, play: 0 }); return s.events.pop(); };
  const lo = [], hi = []; for (let k = 0; k < 20; k++) { lo.push(shot(48)); hi.push(shot(84)); }
  const avg = a => a.reduce((x, e) => x + e.h, 0) / a.length, c4 = shot(60), c5 = shot(72), g4 = shot(67);
  const before = s.colours; for (let m = 60; m < 72; m++) shot(m);
  const hues = new Set(); for (let pc = 0; pc < 12; pc++) hues.add(fwHue(pc));
  const ok = c4.hue === c5.hue && c4.hue !== g4.hue && avg(hi) > avg(lo) + 0.2 && before === 2 && s.colours === 12 && hues.size === 12;
  return { name: 'Fireworks: each note is a colour, higher notes burst higher', expect: 'C4 and C5 the same colour, G another; C6 bursts well above C3; twelve notes, twelve colours',
    got: 'C4 ' + c4.hue + ', C5 ' + c5.hue + ', G4 ' + g4.hue + '; height ' + avg(lo).toFixed(2) + ' low, ' + avg(hi).toFixed(2) + ' high; colours ' + before + ' then ' + s.colours + ', ' + hues.size + ' hues', pass: ok }; } });
list.push({ name: 'Fireworks: fast scales do not flood the sky', run: () => {
  const s = new FireworkSim(); s.reset(1800, 7);
  const ev = fwRun(s, 10, { state: 'running', music: true, midi: 64, recent: 1, play: 0 }, 12).filter(e => e.k === 'shell');
  const cap = (FW.RATE + FW.PER) * 10 + FW.BURST + FW.BURSTPER, big = ev.filter(e => e.size > 1.01).length;
  return { name: 'Fireworks: fast scales do not flood the sky', expect: '12 notes a second for 10 s sends up at most ' + cap + ' shells, the notes over that making shells bigger',
    got: ev.length + ' shells for 120 notes, ' + big + ' bigger than full size', pass: ev.length <= cap && ev.length >= cap - 6 && big > 0 }; } });
list.push({ name: 'Fireworks: the last minute sets the size and the kinds', run: () => {
  const kinds = recent => { const s = new FireworkSim(); s.reset(1800, 11); const ev = fwRun(s, 60, { state: 'running', music: true, midi: 62, recent: recent, play: 0 }, 1);
    return { size: ev.reduce((x, e) => x + e.size, 0) / ev.length, kinds: new Set(ev.filter(e => e.kind !== 'symbol').map(e => e.kind)) }; };   // symbols are a surprise of their own
  const lo = kinds(0.2), mid = kinds(0.5), hi = kinds(0.9);
  const ok = hi.size > mid.size && mid.size > lo.size && lo.kinds.size === 1 && lo.kinds.has('peony') && !mid.kinds.has('willow') && mid.kinds.has('ring') && hi.kinds.has('willow') && hi.kinds.size >= 5;
  return { name: 'Fireworks: the last minute sets the size and the kinds', expect: 'bigger shells with more of the last minute played; round ones only at 20%, rings at 50%, willows and more at 90%',
    got: [['20%', lo], ['50%', mid], ['90%', hi]].map(p => p[0] + ': size ' + p[1].size.toFixed(2) + ', ' + [...p[1].kinds].sort().join(' ')).join('; '), pass: ok }; } });
list.push({ name: 'Fireworks: a held note still sends shells up', run: () => {
  const s = new FireworkSim(); s.reset(1800, 13); const ev = fwRun(s, 20, { state: 'running', music: true, midi: 55, recent: 0.7, play: 0 }, 0).filter(e => e.k === 'shell');
  const want = FW.PACE * 0.7 * 20, same = ev.every(e => e.pc === 7);
  return { name: 'Fireworks: a held note still sends shells up', expect: 'the pace of the intensity (about ' + Math.round(want) + ' in 20 s of one long G at 70%), all in its colour',
    got: ev.length + ' shells' + (same ? ', all G' : ', not all G'), pass: same && ev.length >= want - 2 && ev.length <= want + 1 }; } });
list.push({ name: 'Fireworks: the higher the intensity, the more shells in the sky at once', run: () => {
  const E = [0.2, 0.5, 0.9], slow = [], fast = [];
  for (const [rate, out] of [[1, slow], [8, fast]]) for (const e of E) { const s = new FireworkSim(); s.reset(1800, 21); let sum = 0, n = 0, owed = 0;
    for (let t = 0; t < 60; t += 0.05) { owed += rate * 0.05; const k = Math.floor(owed + 1e-9); owed -= k; s.update(0.05, { state: 'running', music: true, notes: k, midi: 64, recent: e, play: t }); s.events.length = 0; if (t > 10) { sum += s.aloft; n++; } }
    out.push(sum / n); }
  const up = a => a[0] < a[1] && a[1] < a[2], ok = up(slow) && up(fast) && slow[2] >= slow[0] * 2 && fast[2] >= fast[0] * 2;
  return { name: 'Fireworks: the higher the intensity, the more shells in the sky at once', expect: 'more shells aloft at 50% than 20%, more again at 90% (at least twice as many as at 20%), for slow notes and fast runs alike',
    got: E.map((e, j) => Math.round(e * 100) + '%: ' + slow[j].toFixed(1) + ' (1 note/s), ' + fast[j].toFixed(1) + ' (8 notes/s)').join('; '), pass: ok }; } });
list.push({ name: 'Fireworks: a grand finale at the goal, once, ending in a trophy', run: () => {
  const s = new FireworkSim(); s.reset(60, 17); const ev = [], take = () => { while (s.events.length) ev.push(s.events.shift()); };
  const run = (secs, st, shown, t0) => { for (let t = 0; t < secs - 1e-9; t += 0.05) { s.update(0.05, { state: st, music: false, notes: 0, midi: null, recent: 0.8, play: t0 + t, shown: shown }); take(); } };
  run(70, 'running', false, 0); const away = ev.length;                            // the goal passes on another theme: the finale waits
  run(4, 'running', true, 70); const early = ev.filter(e => e.finale).length;
  run(5, 'paused', true, 74); const paused = ev.filter(e => e.finale).length;
  run(20, 'running', true, 74);
  const starts = ev.filter(e => e.k === 'finale').length, shells = ev.filter(e => e.finale), ends = ev.filter(e => e.k === 'finaleEnd').length;
  const last = shells[shells.length - 1], endAt = ev.findIndex(e => e.k === 'finaleEnd'), lastAt = ev.indexOf(last);
  const ok = away === 0 && starts === 1 && shells.length === FW.FINALE && last.kind === 'trophy' && ends === 1 && endAt > lastAt && early > 0 && early < FW.FINALE && paused === early && s.shells === 0 && !s.inFinale;
  return { name: 'Fireworks: a grand finale at the goal, once, ending in a trophy', expect: 'nothing while the theme is not shown; then one finale of ' + FW.FINALE + ' shells, held through a pause, the last a trophy, then the end of the finale (for the trophy card); not counted as the player\'s shells',
    got: away + ' events away, ' + starts + ' finale, ' + shells.length + ' shells (' + early + ' before the pause, ' + paused + ' after it), last ' + (last && last.kind) + ', ' + ends + ' end' + (endAt > lastAt ? ' after it' : ' before it') + ', ' + s.shells + ' counted', pass: ok }; } });
list.push({ name: 'Fireworks: now and then a shell bursts into a musical symbol', run: () => {
  const s = new FireworkSim(); s.reset(3600, 31); const ev = fwRun(s, 600, { state: 'running', music: true, midi: 62, recent: 0.8, play: 0 }, 2).filter(e => e.k === 'shell');
  const sym = ev.filter(e => e.kind === 'symbol'), names = new Set(sym.map(e => e.symbol)), share = sym.length / ev.length;
  let gaps = true, repeats = false, at = -1e9, last = ''; for (const e of ev) { if (e.kind === 'symbol') { if (e.symbol === last) repeats = true; last = e.symbol; } }
  const s2 = new FireworkSim(); s2.reset(3600, 31); let tt = 0; for (let k = 0; k < 600 * 20; k++) { s2.update(0.05, { state: 'running', music: true, notes: k % 10 === 0 ? 1 : 0, midi: 62, recent: 0.8, play: 0 }); tt += 0.05;
    for (const e of s2.events) if (e.kind === 'symbol') { if (tt - at < FW.SYMBOL_GAP - 1e-6) gaps = false; at = tt; } s2.events.length = 0; }
  const colour = sym.every(e => e.hue === fwHue(2) && e.pc === 2);
  const ok = share > 0.03 && share < 0.12 && names.size >= 6 && gaps && !repeats && colour && sym.every(e => FW_SYMBOLS.includes(e.symbol));
  return { name: 'Fireworks: now and then a shell bursts into a musical symbol', expect: 'a few in a hundred shells, at least ' + FW.SYMBOL_GAP + ' s apart, never the same twice running, in the note\'s colour, many different symbols',
    got: sym.length + ' of ' + ev.length + ' shells (' + (share * 100).toFixed(1) + '%), ' + names.size + ' symbols' + (gaps ? '' : ', too close') + (repeats ? ', a repeat' : '') + (colour ? '' : ', wrong colour'), pass: ok }; } });
list.push({ name: 'Fireworks: every musical symbol is drawn', run: () => {
  const bad = FW_SYMBOLS.filter(n => { const p = fwSymbolShape(n, 0.05), xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    return p.length < 40 || p.length > 220 || Math.max(...ys) > 0.8 || Math.min(...ys) < -0.8 || Math.max(...xs.map(Math.abs)) > 0.8 || Math.max(...ys) - Math.min(...ys) < 0.5; });
  return { name: 'Fireworks: every musical symbol is drawn', expect: FW_SYMBOLS.length + ' symbols, each 40 to 220 points inside the trophy\'s box', got: FW_SYMBOLS.map(n => n + ' ' + fwSymbolShape(n, 0.05).length).join(', ') + (bad.length ? '; wrong: ' + bad.join(' ') : ''), pass: !bad.length && fwSymbolShape('nothing').length === 0 }; } });
list.push({ name: 'Fireworks: the trophy burst is a trophy', run: () => {
  const p = fwTrophyShape(0.05), xs = p.map(q => q[0]), ys = p.map(q => q[1]), key = q => Math.round(q[0] * 20) + ',' + Math.round(q[1] * 20), set = new Set(p.map(key));
  const mirrored = p.filter(q => set.has(Math.round(-q[0] * 20) + ',' + Math.round(q[1] * 20))).length / p.length;
  const rim = p.filter(q => q[1] > 0.74).length, base = p.filter(q => q[1] < -0.74).length, handles = p.filter(q => Math.abs(q[0]) > 0.7).length, stem = p.filter(q => q[1] < -0.05 && q[1] > -0.44).length;
  const ok = p.length >= 100 && p.length <= 200 && Math.min(...ys) >= -0.76 && Math.max(...ys) <= 0.76 && Math.max(...xs.map(Math.abs)) <= 0.8 && mirrored > 0.95 && rim > 15 && base > 12 && handles > 4 && stem >= 14;
  return { name: 'Fireworks: the trophy burst is a trophy', expect: '100 to 200 points, the same on both sides, 1.5 high and under 1.6 wide, with a rim, handles, a stem and a base',
    got: p.length + ' points, ' + Math.round(mirrored * 100) + '% mirrored, ' + (Math.max(...ys) - Math.min(...ys)).toFixed(2) + ' high, ' + (Math.max(...xs) - Math.min(...xs)).toFixed(2) + ' wide; rim ' + rim + ', handles ' + handles + ', stem ' + stem + ', base ' + base, pass: ok }; } });
module.exports = list;
