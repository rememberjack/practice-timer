/* Grand Prix theme: a ten-car race on session time. Every car's speed is its player's efficiency over the last minute, so only playing makes
   your car faster. The race is RaceSim (sim.js); view.js draws it; this wires both to the page: the timing screen, the race order, the start
   lights and the banners (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { RACE, RACE_PIT, RaceSim } = require('./sim.js');
const { makeRaceView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);
/* a gap in laps, in words for the read-outs: seconds at full speed, or whole laps */
/* the rivals' full names, shown in the race order for a moment when one overtakes */
const RIVAL_NAMES = { BAC: MT.word('Bach'), MOZ: MT.word('Mozart'), BEE: MT.word('Beethoven'), CHO: MT.word('Chopin'), VIV: MT.word('Vivaldi'),
  DEB: MT.word('Debussy'), HAN: MT.word('Handel'), RAV: MT.word('Ravel'), SCH: MT.word('Schubert') }, WIDE_MS = 3000;
function raceGap(l) { const a = Math.abs(l); return a >= 1 ? trn(Math.floor(a), '{n} lap', '{n} laps') : Math.max(0.1, a * RACE.LAPU / RACE.VNOM).toFixed(1); }

module.exports = {
  api: 1,
  id: 'race',
  name: 'Grand Prix',
  line: 'Playing races a car; your last minute is its speed.',
  goalHint: 'The total play time to reach. The race runs until you reach it.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pRace',
  chrome: 'pixel',
  fonts: ['Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,700;1,800'],
  tests: require('./tests.js'),
  credits: ['Jayden Chen'],
  create: function (host) {
    const $ = host.$, race = new RaceSim(), view = makeRaceView($('raceCv'), $('raceHud'), race, Object.assign(Object.create(MT), { tr: tr, trn: trn, RACE: RACE, RACE_PIT: RACE_PIT }));
    let notes = 0, doneAt = 0, bannerT = 0;          // note starts for the sparks under the car; when the chequered flag fell
    const order = new Map(), wideUntil = new Map();   // each rival's place in the race order at the last paint; until when an overtaker's row shows their name
    function banner(msg, sub, kind, ms) {
      const b = $('gBanner'); b.textContent = msg; if (sub) { const s = document.createElement('small'); s.textContent = sub; b.append(s); }
      b.dataset.kind = kind || ''; b.classList.add('on'); clearTimeout(bannerT); if (ms) bannerT = setTimeout(() => b.classList.remove('on'), ms);
    }
    function hideBanner() { clearTimeout(bannerT); $('gBanner').classList.remove('on'); }
    function event(e, shown) {
      if (shown) view.event(e);
      if (e === 'go') banner(tr('Lights out'), tr('And away you go'), 'red', 1800);
      else if (e === 'up' && !race.finished) banner(tr('Up to P{n}', { n: race.pos }), race.pos === 1 ? tr('You lead the race') : '', '', 1600);
      else if (e === 'red') banner(tr('Red flag'), tr('The race is paused'), 'red', 0);
      else if (e === 'green') banner(tr('Green flag'), tr('Rejoining the race in P{n}', { n: race.pos }), 'green', 1800);
      else if (e === 'finish') doneAt = performance.now();   // the trophy card names the place
    }
    const gapText = l => Math.abs(l) >= 1 ? raceGap(l) : tr('{n} s', { n: raceGap(l) });   // seconds, or whole laps
    function hint(v) {
      const st = v.st, a = race.ahead, b = race.behind, laps = trn(Math.floor(race.dist / RACE.LAPU), '{n} lap', '{n} laps');
      if (st === 'idle') return tr('You start at the back of the grid. Play to start the race');
      if (st === 'stopped') return race.racing ? tr(race.finished ? 'Finished P{p} after {laps}' : 'P{p} after {laps}', { p: race.finished ? race.finishPos : race.pos, laps: laps }) : tr('Press Start for a new race');
      if (race.mode === 'grid' || race.mode === 'lights') return st === 'paused' ? tr('Paused on the grid') : race.lit < 5 ? tr('Keep playing to light the start lights: {n} of 5', { n: race.lit }) : tr('Lights out any moment now');
      if (race.mode === 'red') return tr(race.pit && race.pit.phase === 'in' ? 'Red flag. Heading into the pit lane' : 'Waiting in the pit. Every car holds its place');
      if (race.inPit) return tr(race.limiter ? 'Pit lane speed limit. Rejoining in P{n}' : 'Leaving the pit lane. Rejoining in P{n}', { n: race.pos });
      if (race.finished && performance.now() - doneAt < 8000) return tr('Chequered flag. You finished P{n}', { n: race.finishPos });
      if (!v.music) return b && -b.lead * RACE.LAPU / RACE.VNOM < 1.2 ? tr('Quiet seconds slow you. {code} is {gap} behind', { code: b.code, gap: gapText(b.lead) }) : tr('Quiet seconds are slowing you down');
      if (!a) return b ? tr('Leading the race by {gap}', { gap: gapText(b.lead) }) : tr('Leading the race');
      if (a.lead * RACE.LAPU / RACE.VNOM < 1) return tr('DRS open. {code} is {gap} ahead', { code: a.code, gap: gapText(a.lead) });
      return tr('Chasing {code} for P{n}', { code: a.code, n: race.pos - 1 });
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { view.rebuild(); host.layoutChanged(); }, () => {});   // its boards and read-outs are drawn in its condensed type
    return {
      /* a new field each session; a following device races the same one (the seed is shared) */
      reset(s) { race.reset(s.goal, s.seed); view.reset(); notes = 0; order.clear(); wideUntil.clear(); hideBanner(); },
      notes(n) { notes += n; },
      tick(dt, s) { race.update(dt, { state: s.state, music: s.music, recent: s.recent, play: s.play }); },   // the race runs on session time, like the clock
      stopped(s) { race.update(0, { state: 'stopped', music: false, recent: 0, play: s.play }); hideBanner(); },   // the car slows to a stop; the race order stays as it ended
      goalChanged(goal, play) { race.goal = goal; if (play < goal) race.finished = false; },
      awardLine() { return race.racing ? tr('You finished the race in P{n}.', { n: race.finished ? race.finishPos : race.pos }) : ''; },
      frame(dt, f) {
        race.move(dt);                                                  // the car on screen, on real time; the race itself runs in tick()
        while (race.events.length) event(race.events.shift(), f.shown);
        if (notes) { if (f.shown && f.v.music && race.racing) view.event('note'); notes = 0; }
        if (f.shown) view.draw({ minute: f.v.minute }, dt);
      },
      paint(v) {
        const st = v.st, text = host.text, fmt = host.fmt, playTxt = fmt(v.play), el = $('gPlay'), cls = playTxt.length > 5 ? 'big long' : 'big';
        text(el, playTxt); if (el.className !== cls) el.className = cls;
        text($('gLap'), race.finished ? tr('{n}, extra', { n: race.lap }) : String(race.lap)); host.width($('gBar'), v.goal > 0 ? v.play / v.goal : 0);
        const box = $('gBarBox'); if (box.classList.contains('flag') !== race.finished) box.classList.toggle('flag', race.finished);   // chequered once the goal is reached
        text($('gGoal'), fmt(v.goal)); host.showGoalLeft($('gGoalLeft'), v); text($('gPauses'), String(v.pauses));
        text($('gPos'), 'P' + race.pos);
        const gapIn = c => !race.racing || !c ? '–' : gapText(c.lead);
        text($('gGap'), gapIn(race.ahead)); text($('gBehind'), gapIn(race.behind));
        text($('gPw'), Math.round(v.pw * 100) + '%'); text($('gEff'), Math.round(v.eff * 100) + '%');
        text($('gHeard'), host.heardLine(v));
        text($('gHint'), hint(v));
        const red = race.mode === 'red' ? 'red' : ''; if ((host.panel.dataset.flag || '') !== red) host.panel.dataset.flag = red;
        const L = $('gLights'), lights = race.mode === 'lights' && st !== 'idle'; if (L.hidden === lights) L.hidden = !lights;
        if (lights) [...L.children].forEach((p, i) => { if (p.classList.contains('on') !== i < race.lit) p.classList.toggle('on', i < race.lit); });
        // the race order: the leader, and you with the cars either side of you
        const all = race.cars.map(c => ({ code: c.code, lead: c.lead, col: c.c1, me: false })); all.push({ code: tr('YOU'), lead: 0, col: RACE.YOU[2], me: true });
        all.sort((p, q) => q.lead - p.lead);
        const me = all.findIndex(o => o.me), rows = new Set([0]), now = performance.now();
        if (me <= 3) [1, 2, 3].forEach(i => rows.add(i)); else [me - 1, me, me + 1].forEach(i => { if (i < all.length) rows.add(i); });
        all.forEach((o, i) => { if (!o.me && race.racing && order.has(o.code) && i < order.get(o.code)) wideUntil.set(o.code, now + WIDE_MS); order.set(o.code, i); });   // a rival who overtakes shows their name a moment
        const T = $('gTower'), want = [];
        let last = -1;
        for (const i of [...rows].sort((p, q) => p - q)) { if (i > last + 1) want.push(-1); want.push(i); last = i; }
        while (T.children.length < want.length) T.append(document.createElement('li'));
        while (T.children.length > want.length) T.lastChild.remove();
        want.forEach((i, k) => {
          const li = T.children[k];
          if (i < 0) { if (li.className !== 'gap') { li.className = 'gap'; li.textContent = ''; li.style.width = ''; } return; }
          if (!li.firstChild) li.innerHTML = '<span class="p"></span><span class="s"></span><span class="c"></span><span class="g"></span>';
          const o = all[i], gap = o.me && race.inPit ? tr('PIT') : !race.racing ? '' : i === 0 ? tr('Leader') : '+' + raceGap(all[i - 1].lead - o.lead), wide = !o.me && (wideUntil.get(o.code) || 0) > now;
          const [p, sw, c, g] = li.children;
          if (li.classList.contains('gap')) li.classList.remove('gap'); if (li.classList.contains('me') !== o.me) li.classList.toggle('me', o.me);
          text(p, String(i + 1)); text(g, gap); if (sw.style.background !== o.col) sw.style.background = o.col;
          if (wide !== li.classList.contains('wide')) {   // the row grows to fit the full name, then goes back to its size
            li.classList.toggle('wide', wide); text(c, wide ? tr(RIVAL_NAMES[o.code]) : o.code);
            if (wide) { const from = li.offsetWidth; li.style.width = 'max-content'; if (from) { const to = Math.max(from, li.offsetWidth); li.style.width = from + 'px'; void li.offsetWidth; li.style.width = to + 'px'; } } else li.style.width = '';
          } else text(c, wide ? tr(RIVAL_NAMES[o.code]) : o.code);
        });
      },
      resize() { view.resize(); },
      langChanged() { view.rebuild(); },
      debugLine() { return 'race ' + race.mode + (race.pit ? ' (pit ' + race.pit.phase + ')' : '') + ', P' + race.pos + ', lap ' + race.lap; },
    };
  },
};
