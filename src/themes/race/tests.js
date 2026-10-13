/* Grand Prix's tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { RACE, RACE_PIT, RaceSim, raceTrack } = require('./sim.js');
const list = [];
const gpRun = (s, sec, inp, dt) => { dt = dt || 0.05; for (let t = 0; t < sec - 1e-9; t += dt) { if (inp.state === 'running' && inp.music) inp.play = (inp.play || 0) + dt; s.update(dt, inp); s.move(dt); } };
const gpStart = s => { const inp = { state: 'running', music: true, recent: 1, play: 0 }; for (let i = 0; i < 200 && s.mode !== 'race'; i++) gpRun(s, 0.1, inp); return inp; };
list.push({ name: 'Grand Prix: the start lights', run: () => {
  const s = new RaceSim(); s.reset(1800, 3); const ev = [], inp = { state: 'running', music: true, recent: 1, play: 0 }, take = () => { while (s.events.length) ev.push(s.events.shift()); };
  gpRun(s, 3.02, inp); take(); const a = s.lit; inp.music = false; gpRun(s, 3, inp); take(); const b = s.lit, mb = s.mode, d0 = s.dist;
  inp.music = true; gpRun(s, 2.02, inp); take(); const c = s.lit; gpRun(s, 2, inp); take();
  const ok = a === 3 && b === 3 && mb === 'lights' && d0 === 0 && c === 5 && s.mode === 'race' && ev.filter(e => e === 'light').length === 5 && ev.filter(e => e === 'go').length === 1;
  return { name: 'Grand Prix: the start lights', expect: 'a light for each second of playing, none while quiet and the cars still, then lights out once', got: 'lights ' + a + ', ' + b + ' (' + mb + '), ' + c + ', then ' + s.mode + '; events ' + ev.join(' '), pass: ok }; } });
list.push({ name: 'Grand Prix: speed is the last minute', run: () => {
  const s = new RaceSim(); s.reset(1800, 5); const inp = gpStart(s); inp.recent = 0.75; const d0 = s.dist;
  gpRun(s, 120, inp); const want = 0.75 * RACE.VNOM * 120, kmh = s.v * 300 / RACE.VNOM, bend = s.cornerAt((s.d + RACE.PZ) / RACE.SEG), kmhWant = 300 * Math.min(0.75, bend);
  inp.recent = 0; gpRun(s, 10, inp); const stopped = s.v, d1 = s.dist;
  const ok = Math.abs(s.dist - d0 - want) < 1 && Math.abs(kmh - kmhWant) < 12 && stopped === 0 && d1 === s.dist && s.lap === 1 + Math.floor(s.dist / RACE.LAPU);
  return { name: 'Grand Prix: speed is the last minute', expect: 'at 75% of the last minute the car runs at 225 km/h (slower in a bend) and covers 75% of full-speed distance; at 0% it stops',
    got: Math.round((s.dist - d0) / want * 1000) / 10 + '% of the distance expected, ' + Math.round(kmh) + ' km/h (' + Math.round(kmhWant) + ' here), then ' + Math.round(stopped) + ' km/h at 0%, lap ' + s.lap, pass: ok }; } });
list.push({ name: 'Grand Prix: the car brakes for the bends, and the race does not', run: () => {
  const s = new RaceSim(); s.reset(1800, 4); const inp = gpStart(s); s.cars = []; const T = s.T, at = [], d0 = s.dist; let t = 0;
  for (; t < 60; t += 1 / 60) { s.update(1 / 60, inp); s.move(1 / 60); at.push([Math.floor((s.d + RACE.PZ) / RACE.SEG) % T.n, s.v]); }
  const slowest = {}; let top = 0;
  for (const [i, v] of at) { if (T.corner[i] >= 1) top = Math.max(top, v); if (Math.abs(T.curve[i]) > 3) slowest[i] = Math.min(slowest[i] == null ? 1e9 : slowest[i], v); }
  const corners = []; for (let i = 0; i < T.n;) { if (Math.abs(T.curve[i]) <= 3) { i++; continue; } let e = i, lim = 1; while (e < T.n && Math.abs(T.curve[e]) > 3) lim = Math.min(lim, T.corner[e++]); corners.push({ s: i, e: e, lim: lim }); i = e; }
  const kmh = v => Math.round(v * 300 / RACE.VNOM), bad = [];
  for (const c of corners) { let lo = 1e9; for (let i = c.s; i < c.e; i++) if (slowest[i] != null) lo = Math.min(lo, slowest[i]); if (lo === 1e9) continue;
    if (lo > c.lim * RACE.VNOM + 150 || lo > 0.85 * RACE.VNOM) bad.push('bend at ' + c.s + ' taken at ' + kmh(lo) + ' km/h'); }
  const ok = !bad.length && top > 0.98 * RACE.VNOM && corners.length >= 4 && Math.abs(s.dist - d0 - RACE.VNOM * t) < RACE.VNOM * 0.02;
  return { name: 'Grand Prix: the car brakes for the bends, and the race does not', expect: 'full speed on the straights, each sharp bend taken at its corner speed (braking before it), and the race distance still full speed all the way',
    got: 'top ' + kmh(top) + ' km/h; ' + corners.map(c => { let lo = 1e9; for (let i = c.s; i < c.e; i++) if (slowest[i] != null) lo = Math.min(lo, slowest[i]); return lo < 1e9 ? kmh(lo) : '-'; }).join(', ') + ' km/h in the sharp bends' + (bad.length ? '; ' + bad.join('; ') : '') + '; race distance ' + Math.round((s.dist - d0) / (RACE.VNOM * t) * 100) + '% of full speed', pass: ok }; } });
list.push({ name: 'Grand Prix: a pause freezes the race and parks the car in the pit lane', run: () => {
  const s = new RaceSim(); s.reset(1800, 9); const inp = gpStart(s); inp.recent = 0.8; gpRun(s, 60, inp);
  const pos = s.pos, mine = s.dist, theirs = s.cars.map(c => c.dist).join(), ev = [];
  inp.state = 'paused'; gpRun(s, 1, inp); const red = s.mode; gpRun(s, 300, inp, 0.5); while (s.events.length) ev.push(s.events.shift());
  const frozen = s.dist === mine && s.cars.map(c => c.dist).join() === theirs, boxed = s.pit && s.pit.phase === 'box' && s.v === 0 && Math.abs(s.x - 1.48) < 0.05;
  inp.state = 'running'; s.update(0, inp); const back = s.mode, samePos = s.pos === pos; gpRun(s, 12, inp); while (s.events.length) ev.push(s.events.shift());
  const ok = red === 'red' && frozen && boxed && back === 'race' && samePos && !s.pit && Math.abs(s.x) < 0.7 && ['red', 'box', 'green', 'release', 'exit'].every(e => ev.includes(e));
  return { name: 'Grand Prix: a pause freezes the race and parks the car in the pit lane', expect: 'red flag; no car moves on while paused; the car waits in its box; on resume it rejoins in the same place and leaves the pit lane',
    got: red + ', ' + (frozen ? 'frozen' : 'moved') + ', ' + (boxed ? 'in the box' : 'not in the box') + ', back in ' + back + ' at P' + s.pos + ' (P' + pos + ' before), ' + (s.pit ? 'still in the pit lane' : 'out of the pit lane') + '; ' + ev.join(' '), pass: ok }; } });
list.push({ name: 'Grand Prix: the car keeps to the pit lane, in and out', run: () => {
  const s = new RaceSim(); s.reset(1800, 11); const inp = gpStart(s); inp.recent = 0.9; gpRun(s, 30, inp); s.x = s.tx = -0.5;   // on the far side of the track when the flag comes out
  let worst = 0, off = 0, last = s.x, joined = null, boxOk = false, m0 = null, moved = false; const step = (sec, state) => { inp.state = state;
    for (let t = 0; t < sec; t += 1 / 60) { s.update(1 / 60, inp); s.move(1 / 60);
      const pa = (s.d + RACE.PZ) / RACE.SEG, lane = s.inPit ? s.pitX(pa) : null;
      if (lane != null && Math.abs(s.x - lane) > 1e-9) off++;
      worst = Math.max(worst, Math.abs(s.x - last)); last = s.x;
      if (s.pit && s.pit.phase === 'box') boxOk = s.pit.boxSeg >= s.pit.a + RACE_PIT.IN + 12;
      if (s.pit) { if (m0 == null) m0 = s.pit.m0; else if (s.pit.m0 !== m0) moved = true; }
      if (joined == null && s.pit && s.pit.exitAt) joined = s.x; } };
  step(6, 'paused'); step(14, 'running');
  const ok = off === 0 && worst < 0.05 && boxOk && !moved && joined != null && Math.abs(joined - RACE_PIT.JOIN) < 0.05 && !s.pit && Math.abs(s.x) <= RACE.APEX;
  return { name: 'Grand Prix: the car keeps to the pit lane, in and out', expect: 'the car follows the middle of the pit lane all the way, with no sudden sideways step; the box is past the bend in; where the lane bends out is set when the car turns in (so the garages stay put); it joins the track on the right and races on',
    got: (off ? off + ' frames off the lane' : 'always on the lane') + ', largest sideways step ' + worst.toFixed(3) + ' a frame, box ' + (boxOk ? 'past the bend' : 'too early') + ', joined at ' + (joined == null ? 'never' : joined.toFixed(2)) + ', ' + (s.pit ? 'still in the pit lane' : 'back racing at ' + s.x.toFixed(2)), pass: ok }; } });
list.push({ name: 'Grand Prix: the racing line puts the inside tyres on the kerb at every corner', run: () => {
  const T = raceTrack(), L = T.line, N = T.n, half = 380 / RACE.ROADW, bad = []; let n = 0, step = 0;   // half the car's width, in road half-widths
  for (let i = 0; i < N; i++) step = Math.max(step, Math.abs(L[(i + 1) % N] - L[i]));
  for (let i = 0; i < N;) { if (Math.abs(T.curve[i]) <= RACE.KERB) { i++; continue; } const sg = Math.sign(T.curve[i]); let e = i, best = -9;
    while (e < N && Math.abs(T.curve[e]) > RACE.KERB && Math.sign(T.curve[e]) === sg) { best = Math.max(best, sg * L[e]); e++; }
    n++; if (best + half < 0.97) bad.push('corner at ' + i + ' reaches ' + (best + half).toFixed(2)); i = e; }
  // and the car keeps to it: a lap alone at full speed
  const s = new RaceSim(); s.reset(1800, 2); const inp = gpStart(s); s.cars = []; let off = 0;
  for (let t = 0; t < 40; t += 1 / 60) { s.update(1 / 60, inp); s.move(1 / 60); const pa = (s.d + RACE.PZ) / RACE.SEG; if (t > 6) off = Math.max(off, Math.abs(s.x - s.lineAt(pa))); }
  const ok = n >= 10 && !bad.length && Math.max(...L) <= RACE.APEX + 1e-6 && Math.min(...L) >= -RACE.APEX - 1e-6 && step < 0.07 && off < 0.08;
  return { name: 'Grand Prix: the racing line puts the inside tyres on the kerb at every corner', expect: 'at every corner the inside tyres reach the kerb (0.97 road half-widths out), the line stays on the road and bends smoothly, and the car keeps to it',
    got: n + ' corners' + (bad.length ? ', ' + bad.join('; ') : ', every one on the kerb') + ', largest step ' + step.toFixed(3) + ' a segment, car at most ' + off.toFixed(3) + ' off the line', pass: ok }; } });
list.push({ name: 'Grand Prix: the same field however time is cut up', run: () => {
  const a = new RaceSim(), b = new RaceSim(); a.reset(1800, 42); b.reset(1800, 42);
  for (const s of [a, b]) { s.mode = 'race'; s.st = 'running'; }
  for (let i = 0; i < 300; i++) a.update(1, { state: 'running', music: true, recent: 0.8, play: i });
  for (let t = 0; t < 300 - 1e-9; t += 0.046) b.update(Math.min(0.046, 300 - t), { state: 'running', music: true, recent: 0.8, play: t });
  const worst = Math.max(...a.cars.map((c, i) => Math.abs(c.dist - b.cars[i].dist) / c.dist));
  return { name: 'Grand Prix: the same field however time is cut up', expect: 'one-second steps and 46 ms steps give the rivals the same distances (a following device races the same field)',
    got: 'largest difference ' + (worst * 100).toFixed(4) + '%', pass: worst < 1e-6 }; } });
list.push({ name: 'Grand Prix: the steadier the session, the better the chance of first place', run: () => {
  const E = [0.7, 0.8, 0.9], wins = E.map(() => 0), place = E.map(() => 0), N = 60;
  for (let k = 0; k < N; k++) {
    const s = new RaceSim(); s.reset(600, 1000 + k * 7919); s.mode = 'race'; s.st = 'running';
    for (let t = 0; t < 600; t++) s.update(1, { state: 'running', music: true, recent: 0, play: 0 });   // the rivals race; you stand still, then are placed at each efficiency
    E.forEach((e, j) => { const mine = e * RACE.VNOM * 600, ahead = s.cars.filter(c => c.dist > mine).length; if (!ahead) wins[j]++; place[j] += 1 + ahead; });
  }
  const p = wins.map(w => w / N), avg = place.map(x => x / N);
  const ok = p[0] <= 0.15 && p[1] >= 0.25 && p[1] <= 0.75 && p[2] >= 0.8 && p[0] < p[1] && p[1] < p[2] && avg[0] > avg[1] && avg[1] > avg[2];
  return { name: 'Grand Prix: the steadier the session, the better the chance of first place', expect: 'in 10-minute races, first place rarely at 70% efficiency, about half the time at 80%, nearly always at 90%',
    got: E.map((e, j) => Math.round(e * 100) + '%: P1 in ' + Math.round(p[j] * 100) + '%, average P' + avg[j].toFixed(1)).join('; '), pass: ok }; } });
module.exports = list;
