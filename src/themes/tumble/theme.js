/* Tumble theme: every note played falls into a wooden crate as a toy block with its name on its face and piles up into a wall, the colour
   of each note round the circle of fifths, the width how long it was held. Three notes of one chord in a row light up gold. Minutes are
   written on the crate's wall as the pile reaches them, the practice goal is a gold line, and reaching it drops a trophy block. The logic is
   TumbleSim (sim.js); the blocks tumble under a physics engine (pile.js, loaded when the theme is shown) or stack plainly until it loads;
   view.js draws it; this wires them to the page (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { TU, TumbleSim, StackPile, tuColour, tuName, unitsFor } = require('./sim.js');
const { makePhysicsPile } = require('./pile.js');
const { makeTumbleView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);
const MATTER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';

module.exports = {
  api: 1,
  id: 'tumble',
  name: 'Tumble',
  line: 'Every note falls in as a toy block and piles up.',
  goalHint: 'The total play time to reach. The wall reaches the gold line there.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pTumble',
  chrome: 'pixel',
  fonts: ['Fredoka:wght@500;600;700'],
  tests: require('./tests.js'),
  create: function (host) {
    const $ = host.$, sim = new TumbleSim(new StackPile());
    const noteLabel = b => host.noteText(tuName(b.pc)), chordLabel = e => host.noteText(tuName(e.root)) + e.suffix;
    const view = makeTumbleView($('tuCv'), $('tuHud'), sim, { TU: TU, tuColour: tuColour, label: noteLabel, unitsFor: unitsFor, reduceMotion: host.reduceMotion });
    let notes = 0, awardIn = 0, bannerT = 0, physics = null, loading = null, failedAt = 0;
    if (document.fonts && document.fonts.load) document.fonts.load('600 14px Fredoka').catch(() => {});   // the names on the blocks' faces
    /* the physics engine is loaded when the theme is first shown, and takes over at the next session (a pile already standing keeps its own) */
    function loadMatter() {
      return new Promise((res, rej) => {
        if (window.Matter) return res();
        const s = [...document.scripts].find(x => x.src === MATTER_URL) || document.head.appendChild(Object.assign(document.createElement('script'), { src: MATTER_URL, async: true }));
        s.addEventListener('load', () => res()); s.addEventListener('error', () => { s.remove(); rej(new Error('Matter.js did not load')); });
      });
    }
    function ensure() {
      if (physics || loading || Date.now() - failedAt < 10e3) return;
      loading = loadMatter().then(() => { physics = makePhysicsPile(window.Matter); if (!sim.pile.count) { sim.pile = physics; sim.pile.reset(); } })
        .catch(() => { physics = null; failedAt = Date.now(); }).then(() => { loading = null; });
    }
    function banner(msg) { const b = $('tuBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2600); }
    function hideBanner() { clearTimeout(bannerT); $('tuBanner').classList.remove('on'); }
    /* the hint under the read-outs */
    function hint(v) {
      const st = v.st, n = sim.blocks;
      if (st === 'idle') return tr('Every note you play falls in as a block');
      if (st === 'stopped') return n ? trn(n, '{n} block in the wall', '{n} blocks in the wall') : tr('Press Start to build a new wall');
      if (st === 'paused') return tr('Paused. The wall waits for you');
      if (!v.music) return tr('The wall waits. Play a note');
      if (sim.goalDone) return tr('Goal reached. Every block from here is a bonus');
      if (v.pw < 0.3) return tr('Keep playing: every note is another block');
      const tips = [tr('Low notes land on the left, high notes on the right'), tr('Hold a note for a longer plank'), tr('Three notes of one chord in a row light up gold')];
      return tips[Math.floor(v.play / 20) % tips.length];
    }
    return {
      show() { ensure(); },
      reset(s) { if (physics && sim.pile !== physics) sim.pile = physics; sim.reset(s.goal, s.seed); view.reset(); notes = 0; awardIn = 0; hideBanner(); },
      notes(n) { notes += n; },
      goalChanged(goal, play) { sim.goalChanged(goal, play); },
      /* the goal is reached: on screen, the trophy block falls first and the trophy card follows it */
      holdAward() { return host.shown() && !sim.goalDone; },
      awardLine() { return sim.blocks ? trn(sim.blocks, 'You stacked {n} block.', 'You stacked {n} blocks.') : ''; },
      frame(dt, f) {
        const v = f.v;
        sim.update(dt, { state: v.st, music: v.music, notes: notes, midi: v.midi, play: v.play, follow: v.follow }); notes = 0;   // blocks fall only while playing
        while (sim.events.length) { const e = sim.events.shift(); if (f.shown) view.event(e);
          if (e.k === 'chord' && host.current()) banner(tr('{chord} chord', { chord: chordLabel(e) }));
          if (e.k === 'goal') awardIn = 1.6; }
        view.tick(dt);
        if (f.shown) view.draw(dt, { st: v.st, music: v.music, goalText: tr('Goal') + ' ' + host.fmt(v.goal) });
        if (awardIn > 0) { awardIn -= dt; if (awardIn <= 0) host.award(); }
      },
      /* the bar is the wall rising toward the goal; Blocks and Chords count the session's, Power the last minute of playing */
      paint(v) {
        const text = host.text, fmt = host.fmt, p = v.goal > 0 ? v.play / v.goal : 0, playTxt = fmt(v.play), el = $('tuPlay'), cls = playTxt.length > 5 ? 'big long' : 'big';
        text(el, playTxt); if (el.className !== cls) el.className = cls;
        host.width($('tuBar'), p); text($('tuPct'), Math.min(100, Math.floor(p * 100)) + '%');
        text($('tuGoal'), fmt(v.goal)); host.showGoalLeft($('tuGoalLeft'), v); text($('tuPauses'), String(v.pauses));
        text($('tuBlocks'), String(sim.blocks)); text($('tuChords'), String(sim.chords)); text($('tuPw'), Math.round(v.pw * 100) + '%'); text($('tuEff'), Math.round(v.eff * 100) + '%');
        text($('tuHeard'), host.heardLine(v));
        text($('tuHint'), hint(v));
      },
      share() { return sim.share(); },
      follow(data) { sim.follow(data); },
      keep() { return sim.save(); },
      resize() { view.resize(); },
      langChanged() { view.relabel(); },
      debugLine() { return 'tumble ' + sim.blocks + ' blocks, ' + sim.chords + ' chords, ' + sim.pile.live.length + ' live, ' + sim.pile.settled.length + ' settled, ' + sim.pile.kind + (loading ? ' (loading)' : ''); },
    };
  },
};
