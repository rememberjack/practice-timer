/* Fireworks theme: every note played sends a shell up over a harbour town at night, in the note's colour; the goal sets off a grand finale
   that ends in a gold trophy, and the trophy card waits for it. The show is FireworkSim (sim.js); view.js draws it (in 3D by view3d.js once
   three.js has loaded); this wires them to the page (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { FW, FireworkSim, fwHue, fwSymbolShape, fwTrophyShape } = require('./sim.js');
const { makeFireworkView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);

module.exports = {
  api: 1,
  id: 'fireworks',
  name: 'Fireworks',
  line: 'Every note sends up a firework in its own colour.',
  goalHint: 'The total play time to reach. Reaching it sets off a grand finale.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pFire',
  chrome: 'pixel',
  fonts: ['Fraunces:ital,opsz,wght@0,9..144,600;1,9..144,500;1,9..144,600'],
  tests: require('./tests.js'),
  create: function (host) {
    const $ = host.$, fw = new FireworkSim();
    const view = makeFireworkView(host.panel, $('fireHud'), fw, Object.assign(Object.create(MT), { tr: tr, trn: trn, FW: FW, fwHue: fwHue, fwSymbolShape: fwSymbolShape, fwTrophyShape: fwTrophyShape }));
    let notes = 0, bannerT = 0;                      // note starts waiting to send shells up
    function banner(msg) { const b = $('fBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3200); }
    function hideBanner() { clearTimeout(bannerT); $('fBanner').classList.remove('on'); }
    /* the hint under the read-outs: Intensity is the last minute of playing (what the other themes call Power): how many shells are in the sky at once, and how big */
    function hint(v) {
      const st = v.st, shells = fw.shells;
      if (st === 'idle') return tr('Every note you play sends up a firework');
      if (st === 'stopped') return shells ? trn(shells, '{n} firework lit up the sky', '{n} fireworks lit up the sky') : tr('Press Start for a new show');
      if (st === 'paused') return tr(fw.inFinale ? 'Paused. The finale waits for you' : 'Paused. The sky waits for you');
      if (fw.inFinale) return tr('Grand finale!');
      if (!v.music) return tr('The sky is waiting. Play a note');
      if (fw.finaleDone) return tr('Goal reached. Every note is an encore');
      if (v.pw < 0.3) return tr('Keep playing: the more you play, the more fireworks');
      return tr('Every note has its own colour');
    }
    return {
      show() { view.ensure(); },                      // load three.js and move to 3D
      reset(s) { fw.reset(s.goal, s.seed); view.reset(); notes = 0; hideBanner(); },
      notes(n) { notes += n; },
      goalChanged(goal, play) { fw.goal = goal; if (play < goal && !fw.inFinale) fw.finaleDone = false; },
      /* the goal is reached: on screen, the grand finale goes first and the trophy card follows it (host.award on 'finaleEnd'). The finale plays
         once a session: if it has already ended (the goal was raised during it, then reached again), the card shows at once */
      holdAward() { return host.shown() && (!fw.finaleDone || fw.inFinale); },
      awardLine() { return fw.shells ? trn(fw.shells, 'You sent up {n} firework.', 'You sent up {n} fireworks.') : ''; },
      frame(dt, f) {
        const v = f.v;
        fw.update(dt, { state: v.st, music: v.music, notes: notes, midi: v.midi, recent: v.pw, play: v.play, shown: f.shown }); notes = 0;   // shells go up only while playing; the finale waits to be seen
        while (fw.events.length) { const e = fw.events.shift(); if (f.shown) view.event(e); if (e.k === 'finale' && host.current()) banner(tr('Grand finale!'));
          if (e.k === 'finaleEnd') host.award(); }
        if (f.shown) view.draw({ st: v.st, music: v.music, level: v.level }, dt);
      },
      /* the bar fills toward the goal and its grand finale; Shells counts the player's shells (each note's colour shows in the sky) */
      paint(v) {
        const st = v.st, text = host.text, fmt = host.fmt, p = v.goal > 0 ? v.play / v.goal : 0, playTxt = fmt(v.play), el = $('fPlay'), cls = playTxt.length > 5 ? 'big long' : 'big', reached = st !== 'idle' && v.play >= v.goal;
        text(el, playTxt); if (el.className !== cls) el.className = cls;
        host.width($('fBar'), p); text($('fPct'), Math.min(100, Math.floor(p * 100)) + '%');
        text($('fGoal'), fmt(v.goal)); text($('fGoalLeft'), reached ? tr('Reached') : host.goalLeft(v)); text($('fPauses'), String(v.pauses));
        text($('fShells'), String(fw.shells)); text($('fPw'), Math.round(v.pw * 100) + '%'); text($('fEff'), Math.round(v.eff * 100) + '%');
        text($('fHeard'), host.heardLine(v));
        text($('fHint'), hint(v));
      },
      resize() { view.resize(); },
      debugLine() { return 'fireworks ' + fw.shells + ' shells, ' + fw.colours + ' colours' + (fw.inFinale ? ', finale' : '') + ', ' + view.busy() + ' in the air' + (view.is3d ? ', 3D' : ', flat'); },
    };
  },
};
