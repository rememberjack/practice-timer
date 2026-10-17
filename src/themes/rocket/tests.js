/* Rocket's tests: run by npm test and by the debug tools' Sound tests, with the page's own */
'use strict';
const { Session, practiceStats, sampleLog } = require('../../core.js');
const { ISS, MILESTONES, PHASES, WORLD, RocketSim, rocketAt, rocketCarry, sampleFlights } = require('./sim.js');
const list = [];
list.push({ name: 'Rocket: timeline from ignition to Moon orbit', run: () => {
  const sim = new RocketSim(), s = new Session(), at = {}; s.start();
  for (let t = 0; t < 1830; t += 0.1) { s.tick(0.1, true); sim.update(0.1, { running: true, playing: true, eff: s.efficiency });
    while (sim.events.length) { const e = sim.events.shift(); if (at[e] == null) at[e] = t + 0.1; } }
  const th1 = sim.th; for (let i = 0; i < 300; i++) { sim.update(0.1, { running: true, playing: false, eff: 0.2 }); while (sim.events.length) { const e = sim.events.shift(); if (at[e] == null) at[e] = 1830 + i * 0.1; } }
  const want = { ignition: 0, liftoff: 1, tower: 8, stage1: 163, space: 205, iss: 420, earthOrbit: 710, tli: 770, stage2: 850, gps: 887, geo: 904, roll: 968, halfway: 1157, correction: 1195, pull: 1556,
    orbit: 1800, spin: 1803 };
  let ok = sim.mode === 'orbit' && sim.th !== th1 && sim.spinUp === 1 && sim.spinA !== 0;
  for (const k in want) if (!(Math.abs(at[k] - want[k]) <= 2)) ok = false;
  return { name: 'Rocket: timeline from ignition to Moon orbit', expect: 'lift-off 1 s, tower 8 s, stage 1 2:43, space 3:25, Earth orbit 11:50, off to the Moon 12:50, stage 2 14:10; in the coast GPS satellites 14:47, weather satellites 15:04, slow roll 16:08, halfway 19:17, course correction 19:55, the Moon\'s pull 25:56; Moon orbit 30:00, module spinning 3 s later, then keeps orbiting',
    got: Object.keys(want).map(k => k + ' ' + (at[k] == null ? 'never' : Math.round(at[k]) + ' s')).join(', ') + (sim.mode === 'orbit' && sim.th !== th1 ? ', orbiting' : ', not orbiting'), pass: ok }; } });
list.push({ name: 'Rocket: carries on from earlier the same day', run: () => {
  const fly = (sim, secs, eff, playing) => { for (let t = 0; t < secs; t += 0.1) sim.update(0.1, { running: true, playing: playing !== false, eff: eff }); };
  const a = new RocketSim(); fly(a, 130, 1); const low = a.save(); fly(a, 300, 1); const high = a.save(); fly(a, 1500, 1); const orb = a.save();
  const f = new RocketSim(); fly(f, 60, 1); fly(f, 1, 0.2, false); const falling = f.mode === 'fall' && f.save() === null;
  const c = new RocketSim(), d = new RocketSim(), pad = new RocketSim(), forged = new RocketSim();
  const carriedHigh = c.restore(high) && c.mode === 'ascent' && c.fp === high.fp; fly(c, 5, 0.2, false); d.restore(orb); fly(d, 1, 1);
  const below = !forged.restore({ mode: 'ascent', fp: 130, l: 0.02, stage: 0, inSpace: false, th: 0, tOrb: 0 }) && forged.mode === 'pad' && forged.fp === 0;
  const at = (dd, h) => new Date(2026, 9, dd, h).getTime(), now = at(9, 18), rec = (dd, h, rk) => ({ start: at(dd, h), themes: { rocket: rk } });
  const carry = [rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now) === high, rocketCarry([rec(8, 20, orb)], now) === null, rocketCarry([rec(9, 12, high), rec(9, 15, null)], now) === null,
    rocketCarry([rec(9, 8, orb), rec(9, 12, high)], now, at(9, 13)) === null,                                  // a new flight after both sessions: the pad
    rocketCarry([rec(9, 8, orb), { start: at(9, 12), end: at(9, 14), themes: { rocket: high } }], now, at(9, 13)) === high,  // chosen during a session: that session's flight carries on
    rocketCarry([rec(9, 8, orb), rec(9, 14, high)], now, at(9, 13)) === high];                                  // a session after the new flight carries on
  const ok = low === null && falling && below && high && high.inSpace && carriedHigh && c.mode === 'ascent' && c.events.indexOf('fall') < 0 && orb.mode === 'orbit'
    && d.mode === 'orbit' && d.spinUp === 1 && d.events.indexOf('spin') < 0 && pad.save() === null && !pad.restore({ mode: 'pad' }) && !pad.restore(null) && carry.every(Boolean);
  return { name: 'Rocket: carries on from earlier the same day', expect: 'in space and in Moon orbit it carries on; below the edge of space, falling, on a new day or after a new flight is chosen it starts on the pad',
    got: 'below space ' + (low === null && below ? 'back to the pad' : 'carried') + ', falling ' + (falling ? 'back to the pad' : 'carried') + '; in space ' + c.mode + '; orbit ' + d.mode + ' spin ' + d.spinUp + '; carry ' + carry.join(','), pass: ok }; } });
list.push({ name: 'Rocket: lifts off at 50% engine power', run: () => {
  const fly = eff => { const sim = new RocketSim(); let at = -1; for (let t = 0; t < 30; t += 0.1) { sim.update(0.1, { running: true, playing: true, eff: eff }); if (at < 0 && sim.events.indexOf('liftoff') >= 0) at = t + 0.1; sim.events.length = 0; } return at; };
  const a = fly(0.55), b = fly(0.45), ok = Math.abs(a - 1) <= 0.3 && b < 0;
  return { name: 'Rocket: lifts off at 50% engine power', expect: 'at 55%: lift-off after 1 s; at 45%: stays on the pad',
    got: 'at 55%: ' + (a < 0 ? 'no lift-off' : 'lift-off at ' + a.toFixed(1) + ' s') + '; at 45%: ' + (b < 0 ? 'stays on the pad' : 'lift-off at ' + b.toFixed(1) + ' s'), pass: ok }; } });
list.push({ name: 'Rocket: falls and explodes when power drops in the atmosphere', run: () => {
  const sim = new RocketSim(), s = new Session(), ev = []; s.start();
  for (let t = 0; t < 400; t += 0.1) { const p = t < 120; s.tick(0.1, p); sim.update(0.1, { running: true, playing: p, eff: s.efficiency });
    while (sim.events.length) ev.push(sim.events.shift()); }
  const ok = ev.indexOf('liftoff') >= 0 && ev.indexOf('fall') > ev.indexOf('liftoff') && ev.indexOf('crash') > ev.indexOf('fall') && sim.mode === 'pad' && sim.fp === 0;
  return { name: 'Rocket: falls and explodes when power drops in the atmosphere', expect: 'lift-off, fall below 50%, explosion, new rocket on the pad', got: ev.join(', '), pass: ok }; } });
list.push({ name: 'Rocket: keeps flying when power drops in space', run: () => {
  const sim = new RocketSim(), ev = []; let fell = false;
  for (let t = 0; t < 420; t += 0.1) { sim.update(0.1, { running: true, playing: true, eff: 1 }); sim.events.length = 0; }
  for (let t = 0; t < 120; t += 0.1) { sim.update(0.1, { running: true, playing: false, eff: 0.3 }); while (sim.events.length) ev.push(sim.events.shift()); if (sim.mode === 'fall') fell = true; }
  const ok = !fell && sim.mode === 'ascent' && !sim.ignited && sim.inSpace;
  return { name: 'Rocket: keeps flying when power drops in space', expect: 'no fall once outside the atmosphere, engine off', got: 'mode ' + sim.mode + ', engine ' + (sim.ignited ? 'on' : 'off') + (ev.length ? ', events ' + ev.join(', ') : ''), pass: ok }; } });
list.push({ name: 'Rocket: a new flight while a session is still running', run: () => {
  const at = (d, h) => new Date(2026, 9, d, h).getTime(), now = at(12, 18), up = { mode: 'ascent', fp: 400 }, orb = { mode: 'orbit', fp: 2000 };
  const got = [rocketCarry([{ start: at(12, 8), end: at(12, 9), themes: { rocket: up } }], now, at(12, 9)),              // ended just as the new flight was chosen: the pad
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, at(12, 8)),                                          // no end saved, and started by then: the pad
    rocketCarry([{ start: at(12, 8), end: at(12, 20), themes: { rocket: up } }], now, at(12, 19)),                        // chosen while it still ran: carries on
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, at(12, 7)),                                          // chosen before it started: carries on
    rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now, 0), rocketCarry([{ start: at(12, 8), themes: { rocket: up } }], now),   // never chosen
    rocketCarry([{ start: at(12, 14), themes: { rocket: orb } }, { start: at(11, 20), themes: { rocket: up } }, { start: at(12, 8), themes: { rocket: up } }], now),   // the day's latest, whatever the order
    rocketCarry([], now), rocketCarry([{ start: at(12, 8) }], now), rocketCarry([{ start: at(11, 8), themes: { rocket: orb } }], now)];
  const want = [null, null, up, up, up, up, orb, null, null, null];
  return { name: 'Rocket: a new flight while a session is still running', expect: 'a session that had ended (or, with no end saved, had started) by the time the new flight was chosen starts on the pad; one still running then, or started later, carries on; the latest session of the day wins in any order; yesterday, no sessions or no saved flight give the pad',
    got: got.map(g => g ? g.mode : 'pad').join(', '), pass: got.every((g, i) => g === want[i]) }; } });list.push({ name: 'Rocket: sample practice logs carry the flight on', run: () => {
  const now = new Date(2026, 9, 9, 18).getTime(), today = sampleFlights(sampleLog('today', now)), carried = new RocketSim().restore(rocketCarry(today, now));
  const space = new RocketSim(), orbit = new RocketSim(), T = practiceStats(today, now);
  const ok = T.today.sessions === 2 && carried && rocketAt(MILESTONES.space - 1) === null && space.restore(rocketAt(MILESTONES.space)) && space.mode === 'ascent' && orbit.restore(rocketAt(MILESTONES.orbit)) && orbit.mode === 'orbit'
    && sampleFlights(sampleLog('first', now)).length === 0;
  return { name: 'Rocket: sample practice logs carry the flight on', expect: 'in a sample log each day\'s sessions fly one flight on, so today\'s rocket carries on; below the edge of space a flight starts on the pad',
    got: 'today ' + T.today.sessions + ' sessions, rocket ' + (carried ? 'carried on' : 'on the pad'), pass: !!ok }; } });
list.push({ name: 'Rocket: the flight plan follows the flight', run: () => {
  const sim = new RocketSim(), at = {}, T = MILESTONES; let up = true, last = 0, fellTo = 1;
  for (let t = 0; t < 1830; t += 0.1) { sim.update(0.1, { running: true, playing: true, eff: 1 }); sim.events.length = 0; const p = sim.plan(); if (p < last - 1e-9) up = false; last = p;
    for (const k of ['stage1', 'space', 'stage2']) if (at[k] == null && sim.fp >= T[k]) at[k] = p; }
  const orbit = sim.plan(), f = new RocketSim(); for (let t = 0; t < 120; t += 0.1) f.update(0.1, { running: true, playing: true, eff: 1 });
  const before = f.plan(); for (let t = 0; t < 60 && f.mode !== 'pad'; t += 0.1) { f.update(0.1, { running: true, playing: false, eff: 0.2 }); if (f.mode === 'fall') fellTo = Math.min(fellTo, f.plan()); }
  const near = (a, b) => Math.abs(a - b) < 0.002, ok = up && near(at.stage1, 0.25) && near(at.space, 0.5) && near(at.stage2, 0.75) && orbit === 1 && fellTo < before * 0.2 && f.plan() === 0;
  return { name: 'Rocket: the flight plan follows the flight', expect: 'only rises while flying: a quarter at stage 1, half at the edge of space, three quarters at stage 2, full in Moon orbit; drops back in a fall, empty on the pad',
    got: 'stage 1 ' + (at.stage1 || 0).toFixed(3) + ', space ' + (at.space || 0).toFixed(3) + ', stage 2 ' + (at.stage2 || 0).toFixed(3) + ', orbit ' + orbit + (up ? '' : ', went down while flying') + ', falling ' + before.toFixed(2) + ' to ' + fellTo.toFixed(2) + ', then ' + f.plan(), pass: ok }; } });
list.push({ name: 'Rocket: flies to scale, with a real launch\'s timing', run: () => {
  const sim = new RocketSim(), T = MILESTONES, P = PHASES, M = WORLD.MOON, R = 6371, deg = 180 / Math.PI, at = t => { sim.mode = 'ascent'; sim.l = sim.lenAt(t); return sim.pose(); };
  const tiltAt = q => ((q.ang - Math.atan2(q.x, q.y)) * deg + 540) % 360 - 180, km = q => (Math.hypot(q.x, q.y) - 1) * R;   // from upright, where the rocket is; height
  const tower = tiltAt(at(T.tower)), st1 = at(T.stage1), sp = at(T.space), st1Tilt = tiltAt(st1);
  let level = 0, low = 1e9, high = 0, readout = 0;
  for (let t = P.insert; t <= P.tli; t += 5) { const q = at(t); level = Math.max(level, Math.abs(tiltAt(q) - 90)); low = Math.min(low, km(q)); high = Math.max(high, km(q)); }
  for (let t = 5; t < T.orbit; t += 7) { const q = at(t); readout = Math.max(readout, Math.abs(sim.kmAt(sim.l) - km(q)) / Math.max(1, km(q))); }   // the read-out is what is drawn
  let down = 0, nearMoon = 1e9, kink = 0;
  for (let i = 1; i < sim.px.length; i++) { const dx = sim.px[i] - sim.px[i - 1], dy = sim.py[i] - sim.py[i - 1], r = Math.hypot(sim.px[i], sim.py[i]), d = Math.hypot(dx, dy);
    if (d > 0) down = Math.max(down, -(dx * sim.px[i] + dy * sim.py[i]) / (r * d)); if (i < sim.px.length - 1) nearMoon = Math.min(nearMoon, Math.hypot(sim.px[i] - M.x, sim.py[i] - M.y));
    if (i > 1 && d > 0) { const a0 = Math.atan2(sim.px[i - 1] - sim.px[i - 2], sim.py[i - 1] - sim.py[i - 2]), a1 = Math.atan2(dx, dy); let dd = Math.abs(a1 - a0) * deg; if (dd > 180) dd = 360 - dd; kink = Math.max(kink, dd); } }
  const e = sim.px.length - 1, endGap = Math.abs(Math.hypot(sim.px[e] - M.x, sim.py[e] - M.y) - WORLD.ORBIT), endAng = Math.atan2(sim.px[e] - sim.px[e - 1], sim.py[e] - sim.py[e - 1]);
  const joinErr = Math.abs(endAng - Math.atan2(Math.sin(sim.th0), -Math.cos(sim.th0))) * deg, dist = Math.hypot(M.x, M.y) * R;
  const ok = Math.abs(tower) < 1 && Math.abs(km(st1) - 67) < 2 && st1Tilt > 60 && st1Tilt < 75 && Math.abs(km(sp) - 100) < 2 && level < 2 && low > 189 && high < 193 && readout < 1e-3
    && down < 1e-3 && kink < 1.5 && endGap < 1e-3 && joinErr < 1.5 && nearMoon > WORLD.ORBIT * 0.999 && Math.abs(dist - 384400) < 1 && Math.abs(M.r * R - 1737.4) < 0.1 && Math.abs((WORLD.ORBIT - M.r) * R - 110) < 0.1;
  return { name: 'Rocket: flies to scale, with a real launch\'s timing', expect: 'upright past the tower; at stage 1 67 km up and pitched 60-75° over; 100 km at the edge of space; level at 191 km in Earth orbit; the read-out matching the picture; never heading back down, on a smooth path; the Moon 384,400 km away, its orbit 110 km up, met on a tangent',
    got: 'tower ' + tower.toFixed(1) + '°, stage 1 ' + km(st1).toFixed(0) + ' km and ' + st1Tilt.toFixed(0) + '°, space ' + km(sp).toFixed(1) + ' km, Earth orbit ' + low.toFixed(0) + '-' + high.toFixed(0) + ' km within ' + level.toFixed(1) + '° of level, read-out off by ' + (readout * 100).toFixed(3) + '%, heading down '
      + down.toFixed(4) + ', sharpest bend ' + kink.toFixed(2) + '°, ' + endGap.toExponential(1) + ' from the Moon\'s orbit, ' + joinErr.toFixed(2) + '° off its tangent, closest to the Moon ' + (nearMoon / WORLD.ORBIT).toFixed(3) + ' orbit radii, Moon ' + Math.round(dist) + ' km away', pass: ok }; } });

list.push({ name: 'Rocket: passes under the ISS, then overtakes it after the burn for the Moon', run: () => {
  const sim = new RocketSim(), R = 6371, at = t => { sim.l = sim.lenAt(t); return sim.pose(); };
  const ahead = t => { const q = at(t), i = sim.issAt(t); let d = Math.atan2(i.x, i.y) - Math.atan2(q.x, q.y); d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; return d * R; };
  const over = Math.abs(ahead(ISS.at)), up = (Math.hypot(sim.issAt(ISS.at).x, sim.issAt(ISS.at).y) - 1) * R;
  let behind = 0, pass = 0, under = 0;
  for (let t = ISS.at + 10; t <= PHASES.coast; t += 5) if (ahead(t) <= 0) behind++;
  for (let t = PHASES.coast; t < PHASES.coast + 30; t += 0.1) if (ahead(t) > 0 && ahead(t + 0.1) <= 0) { pass = t; const q = at(t), i = sim.issAt(t); under = (Math.hypot(i.x, i.y) - Math.hypot(q.x, q.y)) * R; break; }
  const ok = over < 1 && Math.abs(up - 420) < 1 && behind === 0 && pass > PHASES.coast && under > 20 && under < 150;
  return { name: 'Rocket: passes under the ISS, then overtakes it after the burn for the Moon', expect: 'the ISS right overhead at 7:00, 420 km up, and ahead from then to the end of the burn; the rocket passing 20-150 km under it once the burn is over',
    got: (over < 1 ? 'overhead' : over.toFixed(0) + ' km off overhead') + ' at 7:00, ' + up.toFixed(0) + ' km up, behind it ' + behind + ' times before the end of the burn, ' + (pass ? 'passes ' + under.toFixed(0) + ' km under it at ' + Math.floor(pass / 60) + ':' + String(Math.round(pass % 60)).padStart(2, '0') : 'never passes it'), pass: ok }; } });

module.exports = list;
