/* Invaders' tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { INV, InvaderSim, hiScore } = require('./sim.js');
const { SPRITES } = require('./sprites.js');
const list = [];
/* minutes of playing, a note every 0.45 s, at a steady power: the waves cleared, the time to the first, and the lowest the fleet came */
function play(pw, dt, minutes) {
  const s = new InvaderSim(7); let acc = 0, first = 0;
  for (let t = 0; t < minutes * 60; t += dt) { acc += dt; let n = 0; if (acc > 0.45) { acc = 0; n = 1; }
    s.update(dt, { running: true, music: true, pw: pw, notes: n }); s.events.length = 0; if (!first && s.wave > 1) first = t; }
  return { s: s, first: first, waves: s.wave - 1 + (55 - s.left) / 55 };
}
list.push({ name: 'Invaders: playing clears waves, faster with more power', run: () => {
  const r = [0.3, 0.5, 0.8, 1].map(pw => play(pw, 1 / 30, 20)), rising = r.every((x, i) => !i || x.waves > r[i - 1].waves), m = r[2].first / 60;
  return { name: 'Invaders: playing clears waves, faster with more power', expect: 'more waves in 20 minutes at each higher power; at 80% the first wave falls in 2 to 3.5 minutes',
    got: r.map((x, i) => [30, 50, 80, 100][i] + '%: ' + x.waves.toFixed(1) + ' waves').join(', ') + '; first wave at 80% in ' + m.toFixed(1) + ' min', pass: rising && m >= 2 && m <= 3.5 }; } });
list.push({ name: 'Invaders: the fleet never comes below the shields', run: () => {
  const r = play(0.05, 1 / 30, 30);
  return { name: 'Invaders: the fleet never comes below the shields', expect: 'after 30 minutes of playing at 5% power, the fleet\'s foot no lower than ' + INV.FLOOR + ' (the shields at ' + INV.SHIELD_Y + ')',
    got: 'its foot came down to ' + r.s.lowest, pass: r.s.lowest > INV.TOP && r.s.lowest <= INV.FLOOR }; } });
list.push({ name: 'Invaders: nothing moves on without playing', run: () => {
  const s = new InvaderSim(3); for (let t = 0; t < 30; t += 1 / 30) s.update(1 / 30, { running: true, music: true, pw: 0.8, notes: 1 });
  const at = () => [s.fx, s.fy, s.score, s.shots, s.left, s.wave].join(), before = at();
  for (let t = 0; t < 60; t += 1 / 30) s.update(1 / 30, { running: true, music: false, pw: 0.8, notes: 1 });
  const quiet = at(), fy = s.fy, b = s.bombs.length;
  for (let t = 0; t < 60; t += 1 / 30) s.update(1 / 30, { running: false, music: true, pw: 1, notes: 1 });
  const paused = at();
  return { name: 'Invaders: nothing moves on without playing', expect: 'a minute of quiet: the fleet waits, no shot and no score; a minute of pause: nothing at all',
    got: (quiet.split(',').slice(0, 2).join() === before.split(',').slice(0, 2).join() && quiet.split(',')[3] <= before.split(',')[3] + 1 ? 'quiet: the fleet waited' : 'quiet: moved ' + before + ' → ' + quiet) + ', ' + b + ' bombs left, ' + (paused === quiet && s.fy === fy ? 'pause holds' : 'moved while paused'),
    pass: quiet.split(',').slice(0, 2).join() === before.split(',').slice(0, 2).join() && +quiet.split(',')[3] <= +before.split(',')[3] + 1 && b === 0 && paused === quiet }; } });
list.push({ name: 'Invaders: the same game at any frame rate', run: () => {
  const a = play(0.8, 1 / 60, 10), b = play(0.8, 0.1, 10), c = play(0.8, 1 / 144, 10);
  const same = Math.abs(a.waves - b.waves) < 0.25 && Math.abs(a.waves - c.waves) < 0.25;
  return { name: 'Invaders: the same game at any frame rate', expect: 'the same waves cleared in 10 minutes at 60, 10 and 144 frames a second',
    got: [a, b, c].map(x => x.waves.toFixed(2)).join(', ') + ' waves', pass: same }; } });
list.push({ name: 'Invaders: the pictures and the best score', run: () => {
  const bad = Object.keys(SPRITES).filter(k => SPRITES[k].some(f => f.length !== SPRITES[k][0].length || f.some(r => r.length !== f[0].length || /[^X.]/.test(r))));
  const kinds = INV.KINDS.every(k => SPRITES[k].length === 2 && SPRITES[k][0].length === 8 && SPRITES[k][0][0].length <= INV.CELL);
  const hi = hiScore([{ themes: { invaders: { score: 120 } } }, {}, { themes: { invaders: { score: 450 } } }, { themes: { rocket: {} } }]);
  return { name: 'Invaders: the pictures and the best score', expect: 'every picture square, each invader two frames of 8 rows within its cell; the best score of the log 450',
    got: (bad.length ? 'uneven: ' + bad.join(', ') : 'all square') + ', ' + (kinds ? 'invaders fit' : 'an invader does not fit') + ', best ' + hi, pass: !bad.length && kinds && hi === 450 }; } });
list.push({ name: 'Invaders: the shields stop the cannon\'s shots too', run: () => {
  const s = new InvaderSim(5), sh = s.shields[1], mid = sh.x + 11, before = sh.bits.reduce((a, b) => a + b, 0);
  s.shot = { x: mid, y: INV.CANNON_Y - 4 }; let k = 0;
  while (s.shot && k++ < 400) s.moveShot(1 / 120);
  const worn = before - sh.bits.reduce((a, b) => a + b, 0), stopped = s.blocked === 1 && s.left === 55;
  const r = play(0.8, 1 / 30, 10).s, share = r.blocked / r.shots;
  return { name: 'Invaders: the shields stop the cannon\'s shots too', expect: 'a shot fired up under a shield stops there, hits no invader and wears a hole; in play the cannon mostly fires up clear lanes (under a third of its shots stopped)',
    got: (stopped ? 'stopped' : 'not stopped (' + s.blocked + ' blocked, ' + s.left + ' left)') + ', ' + worn + ' pixels worn away; in play ' + Math.round(share * 100) + '% stopped',
    pass: stopped && worn > 0 && share > 0 && share < 0.33 }; } });
module.exports = list;
