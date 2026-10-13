/* Dash theme: a neon runner. The cube runs the course while music is heard, every new note is a jump, and the practice goal is the
   length of the course. The run itself is DashSim (sim.js); view.js draws it; this wires both to the page (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { DASH, DashSim } = require('./sim.js');
const { makeDashView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);

module.exports = {
  api: 1,
  id: 'dash',
  name: 'Dash',
  line: 'Playing runs the course; your goal is its length.',
  goalHint: 'The total play time to reach. It is also the length of the course.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pDash',
  chrome: 'pixel',
  tests: require('./tests.js'),
  create: function (host) {
    const $ = host.$, dash = new DashSim(), view = makeDashView($('dashCv'), $('dashHud'), dash, Object.assign(Object.create(MT), { tr: tr, trn: trn, DASH: DASH }));
    let notes = 0, movedAt = 0, bannerT = 0, lastSt = 'idle';   // note starts waiting to make the cube hop; when the course last moved
    /* the course moves on the frames, and on the session's ticks when no frames are drawn (the page in the background) */
    function step(dt, running, music, eff, progress) { const on = notes; notes = 0; movedAt = performance.now(); dash.update(Math.min(0.1, dt), { running: running, music: music, eff: eff, onsets: on, progress: progress }); }
    function banner(msg) { const b = $('dBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3200); }
    function result() { const pct = Math.min(100, Math.floor(dash.progress * 100)), a = dash.attempts;
      return dash.done ? trn(a, 'Level complete in {n} attempt', 'Level complete in {n} attempts') : trn(a, '{pct}% in {n} attempt', '{pct}% in {n} attempts', { pct: pct }); }
    return {
      reset() { dash.reset(); view.reset(); notes = 0; },
      notes(n) { notes += n; },
      tick(dt, s) { if (!s.follow && performance.now() - movedAt > 250) step(s.rdt, s.state === 'running', s.heard, s.recent, s.goal > 0 ? s.play / s.goal : 0); },
      frame(dt, f) {
        const v = f.v;
        if (v.st === 'paused' && lastSt === 'running') dash.mark();   // a checkpoint where the session was paused
        lastSt = v.st;
        step(dt, v.st === 'running', v.music, v.pw, v.goal > 0 ? v.play / v.goal : 0);
        const geo = f.shown ? view.draw({ running: v.st === 'running', music: v.music, level: v.level }, dt) : null;
        while (dash.events.length) { const e = dash.events.shift(); if (geo) view.event(e, geo); if (e === 'complete' && host.current()) banner(tr('Level complete!')); }
      },
      paint(v) {
        const st = v.st, p = v.goal > 0 ? v.play / v.goal : 0, playTxt = host.fmt(v.play), el = $('dPlay'), cls = playTxt.length > 5 ? 'big long' : 'big', text = host.text;
        text(el, playTxt); if (el.className !== cls) el.className = cls;
        host.width($('dBar'), p); text($('dPct'), Math.min(100, Math.floor(p * 100)) + '%');
        text($('dGoal'), host.fmt(v.goal)); host.showGoalLeft($('dGoalLeft'), v); text($('dPauses'), String(v.pauses));
        text($('dAtt'), String(dash.attempts)); text($('dJumps'), String(dash.jumps)); text($('dSpeed'), dash.tag); text($('dPw'), Math.round(v.pw * 100) + '%'); text($('dEff'), Math.round(v.eff * 100) + '%');
        text($('dHeard'), host.heardLine(v));
        let hint;
        if (st === 'idle') hint = tr('Play to run the course');
        else if (st === 'paused') hint = tr('Paused: checkpoint saved');
        else if (st === 'stopped') hint = result();
        else if (dash.mode === 'crash' || dash.mode === 'wait') hint = tr('Crashed. Play to try again');
        else if (dash.mode === 'idle') hint = tr('Play to start running');
        else if (dash.silentT > 0) hint = tr('Keep playing! Spike in {n}', { n: Math.max(1, Math.ceil(DASH.GRACE - dash.silentT)) });
        else hint = tr(dash.done ? 'Level complete! Bonus run' : 'Every new note is a jump');
        text($('dHint'), hint);
      },
      resize() { view.resize(); },
      debugLine() { return 'dash ' + dash.mode + ', attempt ' + dash.attempts + ', ' + Math.round(dash.progress * 100) + '%, ' + dash.tag; },
    };
  },
};
