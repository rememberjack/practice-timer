/* Invaders theme: an arcade invasion in the manner of the 1978 cabinets. Playing fires the laser cannon at a marching fleet, wave after
   wave; in a quiet moment the invaders wait. The game is InvaderSim (sim.js); view.js draws it; this wires both to the page
   (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { INV, InvaderSim, hiScore } = require('./sim.js');
const { SPRITES } = require('./sprites.js');
const { makeInvadersView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);
const pad = n => String(n).padStart(4, '0');   // scores as the arcade shows them: 0120

module.exports = {
  api: 1,
  id: 'invaders',
  name: 'Invaders',
  line: 'Playing fires a laser cannon at the invaders.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pInvaders',
  chrome: 'pixel',
  fonts: ['Press+Start+2P'],
  tests: require('./tests.js'),
  create: function (host) {
    const $ = host.$, sim = new InvaderSim(1), view = makeInvadersView($('ivCv'), $('ivHud'), sim, { INV: INV, SPRITES: SPRITES });
    let notes = 0, bank = 0, frameAt = 0, bannerT = 0, hi = 0;   // bank: session time the ticks have given that the frames have not yet played
    host.drawPixelTrophy($('ivTrophy'));
    if (document.fonts && document.fonts.load) document.fonts.load('8px "Press Start 2P"').catch(() => {});   // the lettering it draws on its canvas
    function banner(msg) { const b = $('ivBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2000); }   // while the field is empty between waves
    /* the game runs on session time: the ticks bank it and the frames play it out smoothly, a little behind (all at once on the ticks when no
       frames are drawn, the page in the background). Its effects are drawn only while it is on screen, so none play at once on coming back */
    function step(dt, running, music, pw) {
      const n = notes; notes = 0; sim.update(dt, { running: running, music: music, pw: pw, notes: n });
      while (sim.events.length) { const ev = sim.events.shift();
        if (host.shown()) view.event(ev);
        if (!host.current()) continue;
        if (ev.e === 'cleared') banner(tr('Wave {n} cleared!', { n: ev.wave })); }   // the mystery ship's points show where it was hit, as on the cabinet
    }
    return {
      reset(s) { sim.reset(s.seed); view.reset(); notes = 0; bank = 0; },
      restore(log) { hi = hiScore(log); },
      notes(n) { notes += n; },
      tick(dt, s) { if (s.state !== 'running') { bank = 0; return; } bank += dt; if (performance.now() - frameAt > 250) { step(bank, true, s.heard, s.recent); bank = 0; } },
      frame(dt, f) {
        const v = f.v, take = Math.min(bank, dt * Math.max(0.5, bank / 0.08)); frameAt = performance.now(); bank -= take;
        step(take, v.st === 'running', v.music, v.pw); if (f.shown) view.draw(dt, { running: v.st === 'running', wave: tr('Wave {n}', { n: sim.wave }), left: trn(sim.left, '{n} invader left', '{n} invaders left') });
      },
      paint(v) {
        const st = v.st, text = host.text, fmt = host.fmt, playTxt = fmt(v.play), el = $('ivPlay'), cls = playTxt.length > 5 ? 'big long' : 'big';
        text(el, playTxt); if (el.className !== cls) el.className = cls;
        text($('ivGoal'), fmt(v.goal)); host.showGoalLeft($('ivGoalLeft'), v); text($('ivPauses'), String(v.pauses));
        host.powerBar({ fill: $('ivPw'), tick: $('ivAvg'), power: $('ivPwN'), eff: $('ivEff') }, v, v.pw >= 0.8 ? 'go' : v.pw >= 0.5 ? 'ok' : '');
        text($('ivScore'), pad(sim.score)); text($('ivHi'), pad(Math.max(hi, sim.score))); text($('ivWave'), String(sim.wave)); text($('ivLeft'), String(sim.left));
        text($('ivHeard'), host.heardLine(v));
        let hint;
        if (st === 'idle') hint = tr('Play to fire the laser cannon');
        else if (st === 'paused') hint = tr('Paused: the invaders wait');
        else if (st === 'stopped') hint = tr('Score {score}, wave {wave}', { score: sim.score, wave: sim.wave });
        else if (sim.gap > 0) hint = tr('Wave {n} is coming', { n: sim.wave + 1 });
        else if (!v.music) hint = tr('The invaders wait. Play to fire');
        else hint = trn(sim.left, '{n} invader left in this wave', '{n} invaders left in this wave');
        text($('ivHint'), hint);
      },
      keep() { return sim.save(); },
      awardLine() { return sim.score ? trn(sim.score, 'You scored {n} point.', 'You scored {n} points.') : ''; },
      resize() { view.resize(); },
      debugLine() { return 'invaders wave ' + sim.wave + ', ' + sim.left + ' left, score ' + sim.score + ', ' + sim.hits + '/' + sim.shots + ' hits, charge ' + sim.charge.toFixed(2); },
    };
  },
};
