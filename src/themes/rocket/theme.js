/* Rocket theme: playing flies a pixel rocket from the launch pad to Moon orbit in about 30 minutes. Each saved session keeps where the rocket
   got to (keep), and the next session that day carries on from it (restore); "Start a new flight" puts it back on the pad. The flight is
   RocketSim (sim.js); view.js draws it; this wires both to the page (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { HOLD, LIFTOFF, MILESTONES, WORLD, RocketSim, rocketAt, rocketCarry, sampleFlights, smooth } = require('./sim.js');
const { makeRocketView } = require('./view.js');
const words = require('./words.js');
const { tr } = MT.translator(words);
const W = MT.word;
const EVENT_TEXT = { ignition: W('Engines lit'), liftoff: W('Lift-off!'), tower: W('Tower cleared'), stage1: W('Stage 1 separation'), space: W('You have left the atmosphere'),
  stage2: W('Stage 2 separation'), orbit: W('Moon orbit reached!'), spin: W('Module spinning'), fall: W('Engines out. Falling!'), crash: W('The rocket exploded!') };
const NEXT = [['tower', W('Clearing the tower in {t}')], ['stage1', W('Stage 1 separation in {t}')], ['space', W('Leaving the atmosphere in {t}')], ['stage2', W('Stage 2 separation in {t}')], ['orbit', W('Moon orbit in {t}')]];
/* the flight plan beside the scene: Earth at the foot, the Moon at the top, and between them stage 1, the edge of space and stage 2,
   evenly spaced (RocketSim.plan). Small pixel pictures, drawn as SVG so they stay sharp */
const PLAN_PAL = { E: '#2F6FD0', G: '#5DA831', M: '#D8DCE4', m: '#9AA2B2', W: '#F4F6FA', w: '#B8C0CE', R: '#D23B2E', B: '#5CC8FF' };
const PLAN_PIX = {
  earth: ['..EEE..', '.EGGEE.', 'EGGGEEE', 'EEGEEGE', 'EEEEGGE', '.EEEEE.', '..EEE..'],
  moon: ['..MMM..', '.MMMmM.', 'MmMMMMM', 'MMMMmMM', 'MMmMMMM', '.MMMMM.', '..MMM..'],
  ship: ['..W..', '.WWw.', '.WBw.', '.WWw.', '.RRR.', '.WWw.', 'RWWwR', 'R...R'],
};
function pix(rows) {
  let r = '';
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (PLAN_PAL[row[x]]) r += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + PLAN_PAL[row[x]] + '"/>'; });
  return '<svg viewBox="0 0 ' + rows[0].length + ' ' + rows.length + '" shape-rendering="crispEdges">' + r + '</svg>';
}
const PLAN_STOPS = [['stage', 0.25], ['space', 0.5], ['stage', 0.75]];
const FLIGHT_KEY = 'musicTimer.newFlight';   // when a new flight was last started: sessions that had ended by then no longer carry their flight on (rocketCarry)

module.exports = {
  api: 1,
  id: 'rocket',
  name: 'Rocket',
  line: 'Playing flies a rocket up to Moon orbit.',
  goalHint: 'The total play time to reach. The rocket gets to Moon orbit after about 30 minutes of playing. If your last session today left the rocket in space, the next one carries on from there.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pRocket',
  chrome: 'pixel',
  tests: require('./tests.js'),
  credits: ['Jayden Chen'],
  create: function (host) {
    const $ = host.$, sim = new RocketSim(), view = makeRocketView($('rk'), $('hud'), sim, Object.assign(Object.create(MT), { tr: tr, MILESTONES: MILESTONES, WORLD: WORLD, smooth: smooth }));
    let flightFrom = 0, flightAt = -1e9, bannerT = 0, forced = '', shared = null;   // forced: where the next session's rocket starts (debug tools)
    try { flightFrom = +localStorage.getItem(FLIGHT_KEY) || 0; } catch (e) {}
    host.drawPixelTrophy($('rTrophy'));
    const plan = $('rPlan'); let planP = -1, planMode = '';
    plan.innerHTML = '<i class="pl-end pl-moon">' + pix(PLAN_PIX.moon) + '</i><span class="pl-rail"><i class="pl-fill"></i>'
      + PLAN_STOPS.map(s => '<b class="pl-stop pl-' + s[0] + '" style="bottom:' + s[1] * 100 + '%"></b>').join('')
      + '<i class="pl-ship">' + pix(PLAN_PIX.ship) + '</i></span><i class="pl-end pl-earth">' + pix(PLAN_PIX.earth) + '</i>';
    const stops = plan.querySelectorAll('.pl-stop');
    function paintPlan() {
      const p = Math.round(sim.plan() * 1000) / 1000, mode = sim.mode === 'fall' ? 'fall' : p >= 1 ? 'done' : '';
      if (p === planP && mode === planMode) return;
      planP = p; planMode = mode; plan.style.setProperty('--p', p); plan.dataset.mode = mode;
      let next = true;
      PLAN_STOPS.forEach((s, i) => { const passed = p >= s[1] - 1e-6; stops[i].classList.toggle('on', passed); stops[i].classList.toggle('next', !passed && next); if (!passed) next = false; });
    }
    function banner(msg) { const b = $('rBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3600); }
    /* the rocket's own effects (explosions, falling stages, the flash) only while it is on screen: they age only as it is drawn,
       so effects from another theme would all play at once on coming back to Rocket. A new flight's banner is not replaced at once by "Engines lit" */
    function fire(e) { if (EVENT_TEXT[e] && !(e === 'ignition' && performance.now() - flightAt < 3000)) banner(tr(EVENT_TEXT[e])); if (host.shown()) view.event(e); }
    /* where the rocket starts: forced from the debug tools, or where the day's latest saved session left it (true if it carries on) */
    function carry() { if (forced) return sim.restore(forced === 'pad' ? null : rocketAt(MILESTONES[forced])); return sim.restore(rocketCarry(host.log(), Date.now(), flightFrom)); }
    const flying = () => !host.following() && (sim.mode === 'ascent' || sim.mode === 'orbit');
    /* Start a new flight: the rocket goes back to the launch pad. Play time, the goal and the trophy are not touched */
    function askFlight(home) {
      host.ask({ home: home, title: tr('Start a new flight?'), yes: tr('Start a new flight'), no: tr('Keep flying'),
        text: tr(home ? 'The rocket goes back to the launch pad, and your next session lifts off from there.' : 'The rocket goes back to the launch pad and lifts off again as you play. Your playing time stays as it is.') })
        .then(yes => { if (!yes) return;
          flightFrom = Date.now(); try { localStorage.setItem(FLIGHT_KEY, String(flightFrom)); } catch (e) {}
          sim.reset(); view.reset(); banner(tr('A new flight')); flightAt = performance.now(); host.push(); host.homeChanged(); });
    }
    function tools(el) {   // the debug tools: where the next session's rocket starts (in English, like the rest of them)
      if (!el) { forced = ''; return; }                               // the debug tools were turned off
      el.textContent = '';
      const lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = 'The next session’s rocket starts'; el.append(lab);
      const chips = document.createElement('div'); chips.className = 'chips dbg-chips'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'Where the next session\'s rocket starts'); el.append(chips);
      for (const [k, label] of [['', 'As usual'], ['pad', 'On the pad'], ['space', 'In space'], ['orbit', 'In Moon orbit']]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-pressed', String(forced === k));
        b.onclick = () => { forced = k; if (host.between()) { carry(); view.reset(); } tools(el); };   // shown at once while no session is on
        chips.append(b);
      }
    }
    $('rFlight').onclick = () => { if (flying()) askFlight(false); };
    return {
      reset(s) {
        if (s.why === 'start') { const was = forced, carried = carry(); forced = ''; view.reset(); if (carried && !was) banner(tr('Carrying on from earlier today')); }
        else if (s.why === 'follow') { sim.reset(); view.reset(); shared = null; }
        else { carry(); view.reset(); }
      },
      restore() { carry(); view.reset(); },
      tick(dt, s) {
        if (!s.follow) { sim.update(dt, { running: s.state === 'running', playing: s.heard, eff: s.recent, rdt: s.rdt }); return; }   // the rocket and its power follow the last minute of playing
        if (!shared) return;                                            // following: glide to where the other device's rocket is
        sim.l += (shared.l - sim.l) * Math.min(1, s.rdt * 4);
        if (sim.down > 0) sim.down -= s.rdt;
        if (sim.mode === 'orbit' && s.state === 'running') { sim.th -= sim.wOrbit * s.rdt; sim.spin(s.rdt); }
      },
      frame(dt, f) { while (sim.events.length) fire(sim.events.shift()); if (f.shown) view.draw({ running: f.v.st === 'running', playing: f.v.music, power: f.v.pw }, dt); },
      paint(v) {
        const st = v.st, text = host.text, fmt = host.fmt, fol = v.follow, play = fmt(v.play);
        const rp = $('rPlay'), rpc = play.length > 5 ? 'big long' : 'big'; text(rp, play); if (rp.className !== rpc) rp.className = rpc;
        text($('rActive'), fmt(v.active)); text($('rGoal'), fmt(v.goal)); host.showGoalLeft($('rGoalLeft'), v); text($('rTotal'), fmt(v.total)); text($('rPauses'), String(v.pauses));
        const km = sim.kmAt(sim.l); text($('rAltK'), tr(km < 1 ? 'Alt m' : 'Alt km')); text($('rAlt'), km < 1 ? String(Math.round(km * 1000)) : km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString(host.locale()));
        host.powerBar({ fill: $('rPw'), tick: $('rAvg'), power: $('rPwN'), eff: $('rEff') }, v, v.pw >= LIFTOFF ? 'go' : '');
        text($('rHeard'), host.heardLine(v));
        let next = '';
        if (st === 'idle') next = tr(sim.mode !== 'pad' ? 'Carrying on from earlier today' : 'Power follows your last minute');
        else if (sim.mode === 'pad') next = sim.down > 0 ? tr('Rolling out a new rocket') : !fol && sim.ignited && sim.hold > 0 ? tr('Lift-off in {n}', { n: Math.max(1, Math.ceil(HOLD - sim.hold)) }) : tr('Lift-off at {n}% engine power', { n: Math.round(LIFTOFF * 100) });
        else if (sim.mode === 'fall') next = tr('Falling back to Earth');
        else if (sim.mode === 'orbit') next = tr(sim.spinUp > 0 ? 'In Moon orbit, module spinning' : 'In orbit around the Moon');
        else if (v.pw < 0.5) next = tr('Power below 50%: drifting');
        else if (st === 'running' && !v.music && !sim.inSpace) next = tr('Losing power: falls below 50%');
        else if (st === 'running' && !v.music) next = tr('Losing power. Keep playing');
        else for (const n of NEXT) { const at = MILESTONES[n[0]]; if (sim.fp < at) { next = tr(n[1], { t: fmt(Math.ceil(at - sim.fp)) }); break; } }
        text($('rNext'), next);
        paintPlan();
        const nf = flying(); if ($('rFlight').hidden === nf) { $('rFlight').hidden = !nf; $('hud').classList.toggle('has-flight', nf); }   // New flight, once off the pad
      },
      keep() { return sim.save(); },                                    // where the rocket got to, if in space or Moon orbit
      sampleLog(records) { sampleFlights(records); },
      /* following another device: its rocket, as small as it can be said */
      share() { return { m: sim.mode, l: Math.round(sim.l * 1e5) / 1e5, s: sim.stage, i: sim.ignited ? 1 : 0, f: Math.round(sim.fp * 10) / 10, a: Math.round(sim.th * 100) / 100, c: Math.round(sim.spinUp * 100) / 100 }; },
      follow(x, from) {
        const n = (v, max) => typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
        const m = { mode: ['pad', 'ascent', 'fall', 'orbit'].indexOf(x.m) >= 0 ? x.m : 'pad', l: n(x.l, sim.L), stage: Math.min(2, Math.round(n(x.s, 2))), ignited: x.i === 1, fp: n(x.f, 1e6),
          th: typeof x.a === 'number' && isFinite(x.a) ? Math.max(-4, Math.min(4, x.a)) : 0, spin: n(x.c, 1) };
        const prev = shared; shared = m;
        if (from.first || !prev) { sim.reset(); view.reset(); sim.l = m.l; sim.th = m.th; }
        else {
          if (prev.mode === 'pad' && m.mode === 'ascent') fire('liftoff');
          if (m.mode === 'ascent' && prev.fp < MILESTONES.tower && m.fp >= MILESTONES.tower) fire('tower');
          if (m.mode === 'ascent' && prev.fp < MILESTONES.space && m.fp >= MILESTONES.space) fire('space');
          if (prev.mode === 'ascent' && m.mode === 'fall') fire('fall');
          if (prev.mode === 'fall' && m.mode === 'pad') { fire('crash'); sim.down = 2.6; sim.l = 0; }
          if (prev.mode !== 'orbit' && m.mode === 'orbit') { fire('orbit'); sim.th = m.th; }
          if (prev.spin === 0 && m.spin > 0) fire('spin');
          if (m.stage > prev.stage) fire(m.stage === 1 ? 'stage1' : 'stage2');
        }
        sim.mode = m.mode; sim.stage = m.stage; sim.ignited = m.ignited && from.state === 'running'; sim.power = from.recent; sim.fp = m.fp; sim.spinUp = m.mode === 'orbit' ? m.spin : 0;
        sim.inSpace = m.mode === 'orbit' || (m.mode === 'ascent' && m.fp >= MILESTONES.space);
        if (m.mode === 'orbit') { let d = m.th - sim.th; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(d) > 0.5) sim.th = m.th; }
      },
      /* with Rocket chosen and today's flight carrying on, the next session can start a new one instead */
      homeLink() { return !host.following() && rocketCarry(host.log(), Date.now(), flightFrom) ? { text: tr('Start a new flight'), run: () => askFlight(true) } : null; },
      resize() { view.resize(); },
      debugLine() { return 'rocket ' + sim.mode + ', ' + Math.round(sim.fp) + ' s flown, power ' + Math.round(sim.power * 100) + '%'; },
      debugTools: tools,
    };
  },
};
