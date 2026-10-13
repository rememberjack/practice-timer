/* Dash's tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { DASH, DASH_PIECES, DashSim } = require('./sim.js');
const list = [];
list.push({ name: 'Dash: never crashes while music is heard', run: () => {
  let scr = 0, fl = 0, crashes = 0, jumps = 0, hops = 0, dist = 0;
  for (const eff of [0.3, 0.6, 0.9, 1]) { const d = new DashSim(); let acc = 0;
    for (let t = 0; t < 300; t += 1 / 60) { acc += 1 / 60; let on = 0; if (acc >= 0.37 + 0.3 * d.rnd()) { acc = 0; on = 1; } d.update(1 / 60, { running: true, music: true, eff: eff, onsets: on, progress: t / 300 }); }
    scr += d.scrapes; fl += d.floats; crashes += d.attempts - 1; jumps += d.jumps; hops += d.used.hop || 0; dist += d.x; }
  return { name: 'Dash: never crashes while music is heard', expect: 'no crash, no touch and never standing on air, at any speed, over 20 minutes; notes add hops',
    got: crashes + ' crashes, ' + scr + ' touches, ' + fl + ' steps on air, ' + jumps + ' jumps (' + hops + ' on notes), ' + Math.round(dist) + ' cube lengths run', pass: scr === 0 && fl === 0 && crashes === 0 && jumps > 400 && hops > 300 }; } });
list.push({ name: 'Dash: every kind of piece, cleared at any frame rate', run: () => {
  const d = new DashSim(), steps = [1 / 60, 1 / 30, 0.1, 1 / 144, 0.05]; let acc = 0, t = 0;
  for (let k = 0; t < 600; k++) { const dt = steps[k % 5]; t += dt; acc += dt; let on = 0; if (acc >= 0.45) { acc = 0; on = 1; }
    d.update(dt, { running: true, music: true, eff: [0.3, 0.6, 0.9, 1][Math.floor(t / 40) % 4], onsets: on, progress: t / 400 }); }
  const pieces = DASH_PIECES.map(q => q[0]).filter(k => !d.built[k]), moves = ['jump', 'hop', 'pad', 'orb', 'fall'].filter(k => !d.used[k]);
  return { name: 'Dash: every kind of piece, cleared at any frame rate', expect: 'all ' + DASH_PIECES.length + ' kinds of piece laid and every kind of move taken, with no crash, no touch and never standing on air while frames come unevenly',
    got: (pieces.length ? 'never laid: ' + pieces.join(', ') : 'all pieces laid') + ', ' + (moves.length ? 'never taken: ' + moves.join(', ') : 'all moves taken') + ', ' + (d.attempts - 1) + ' crashes, ' + d.scrapes + ' touches, ' + d.floats + ' steps on air',
    pass: !pieces.length && !moves.length && d.attempts === 1 && d.scrapes === 0 && d.floats === 0 }; } });
list.push({ name: 'Dash: silence crashes once after the grace time, short gaps do not', run: () => {
  const d = new DashSim(), ev = []; let tCrash = -1, x1, x2;
  const run = (sec, music) => { for (let t = 0; t < sec; t += 1 / 60) { d.update(1 / 60, { running: true, music: music, eff: 0.9, onsets: 0, progress: 0 }); while (d.events.length) { const e = d.events.shift(); if (e !== 'jump' && e !== 'land') ev.push(e); if (e === 'crash' && tCrash < 0) tCrash = clock; } clock += 1 / 60; } };
  let clock = 0; run(10, true); run(2, false); run(6, true); const mark = clock; run(12, false); const after = d.attempts; x1 = d.x; run(3, true); x2 = d.x;
  for (let t = 0; t < 5; t += 1 / 60) d.update(1 / 60, { running: false, music: true, eff: 0.9, onsets: 1, progress: 0 }); const frozen = d.x === x2;
  const ok = ev.filter(e => e === 'crash').length === 1 && Math.abs(tCrash - mark - DASH.GRACE) < 0.4 && after === 2 && x2 > x1 + 5 && frozen && d.scrapes === 0;
  return { name: 'Dash: silence crashes once after the grace time, short gaps do not', expect: 'a 2 s gap is survived; a long silence crashes once, ' + DASH.GRACE + ' s in; it runs again with the music; pause freezes it',
    got: 'crashes ' + ev.filter(e => e === 'crash').length + (tCrash >= 0 ? ', ' + (tCrash - mark).toFixed(1) + ' s into the silence' : '') + ', attempt ' + after + ', ' + (x2 > x1 + 5 ? 'ran on' : 'stuck') + ', ' + (frozen ? 'pause holds' : 'moved while paused'), pass: ok }; } });
list.push({ name: 'Dash: silence anywhere on the course', run: () => {
  const at = { ground: 0, platform: 0, air: 0 }, wrong = []; let lo = 1e9, hi = -1e9;
  for (let k = 0; k < 48; k++) {
    const d = new DashSim(), eff = [0.3, 0.6, 0.9, 1][k % 4], progress = [0, 0.15, 0.35, 0.7][(k >> 2) % 4]; let clock = 0, crashes = 0, tCrash = -1;
    const run = (sec, music) => { for (let t = 0; t < sec; t += 1 / 60) { d.update(1 / 60, { running: true, music: music, eff: eff, onsets: music && Math.round(clock * 60) % 25 === 0 ? 1 : 0, progress: progress });
      clock += 1 / 60; while (d.events.length) if (d.events.shift() === 'crash') { crashes++; if (tCrash < 0) tCrash = clock; } } };
    const where = () => at[d.arc ? 'air' : d.y > 0 ? 'platform' : 'ground']++;
    run(3 + (k * 2.71) % 17, true); where(); run(2, false); const c1 = crashes; run(3 + (k * 1.37) % 5, true);
    where(); const mark = clock; run(7, false); const c2 = crashes - c1, x1 = d.x; run(4, true);
    if (tCrash >= 0) { lo = Math.min(lo, tCrash - mark); hi = Math.max(hi, tCrash - mark); }
    if (c1 || c2 !== 1 || Math.abs(tCrash - mark - DASH.GRACE) >= 0.4 || d.x < x1 + 10 || d.scrapes || d.floats)
      wrong.push('#' + k + ': ' + c1 + '+' + c2 + ' crashes' + (tCrash >= 0 ? ' at ' + (tCrash - mark).toFixed(1) + ' s' : '') + ', ' + d.scrapes + ' touches, ' + d.floats + ' on air');
  }
  return { name: 'Dash: silence anywhere on the course', expect: 'wherever the music stops (on the ground, up on a platform, in mid-air), a 2 s gap is survived and a long silence crashes once, ' + DASH.GRACE + ' s in; then it runs on with no touch',
    got: (at.ground + at.platform + at.air) + ' silences (' + at.ground + ' on the ground, ' + at.platform + ' on a platform, ' + at.air + ' in the air), crashes ' + lo.toFixed(1) + ' to ' + hi.toFixed(1) + ' s in' + (wrong.length ? '; wrong: ' + wrong.slice(0, 3).join('; ') : ''),
    pass: !wrong.length && at.platform > 0 && at.air > 0 }; } });
module.exports = list;
