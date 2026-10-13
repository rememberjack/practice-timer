/* City theme, after "Block City Defense": a voxel city at dusk defended by three cannons, which fire only while an instrument is heard.
   view.js builds and runs the city in three.js (loaded the first time the theme is shown); this writes its read-outs and banners
   (docs/theme-modules.md). */
'use strict';
const MT = require('../../core.js');
const { makeCityView } = require('./view.js');
const words = require('./words.js');
const { tr, trn } = MT.translator(words);
const CITY_TEXT = { impact: MT.word('Impact!'), building: MT.word('A building was hit'), cannonLost: MT.word('A cannon was hit'), cannonBack: MT.word('Cannon repaired'), rebuilt: MT.word('Building rebuilt') };

module.exports = {
  api: 1,
  id: 'city',
  name: 'City',
  line: 'Playing fires the cannons that keep the city safe.',
  langs: ['en', 'zh', 'fr'],
  words: words,
  panel: 'pCity',
  chrome: 'pixel',
  create: function (host) {
    const $ = host.$, city = makeCityView(host.panel);
    let bannerAt = 0, bannerT = 0, wasArmed = false;
    host.drawPixelTrophy($('yTrophy'));
    function banner(msg, force) { const now = performance.now(); if (!force && now - bannerAt < 2500) return; bannerAt = now;
      const b = $('yBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2600); }
    return {
      show() { city.ensure(); },
      reset(s) { city.reset(); if (s.why === 'start') bannerAt = 0; },
      frame(dt, f) { if (!f.shown) return; if (!city.ready) { city.ensure(); return; } city.frame(dt, { running: f.v.st === 'running', music: f.v.music, power: f.v.pw }); },
      paint(v) {
        const st = v.st, text = host.text, fmt = host.fmt, cs = city.stats, armed = st === 'running' && v.music;
        while (city.events.length) { const e = city.events.shift(); if (CITY_TEXT[e]) banner(tr(CITY_TEXT[e]), e === 'cannonBack' || e === 'rebuilt'); }
        if (armed && !wasArmed) banner(tr('Cannons firing')); wasArmed = armed;
        const playTxt = fmt(v.play), playEl = $('yPlay'), longCls = playTxt.length > 5 ? 'big long' : 'big'; text(playEl, playTxt); if (playEl.className !== longCls) playEl.className = longCls;
        text($('yDown'), String(cs.down)); text($('yImp'), String(cs.imp));
        text($('yBld'), city.ready ? cs.standing + '/' + cs.total : '-');
        const can = $('yCan'), cc = cs.cannons === 3 ? 'ok' : cs.cannons === 0 ? 'bad' : ''; text(can, cs.cannons + '/3'); if (can.className !== cc) can.className = cc;
        host.powerBar({ fill: $('yPw'), tick: $('yAvg'), power: $('yPwN'), eff: $('yEff') }, v, v.pw >= 0.8 ? 'go' : v.pw >= 0.5 ? 'ok' : '');
        text($('yGoal'), fmt(v.goal)); host.showGoalLeft($('yGoalLeft'), v); text($('yPauses'), String(v.pauses));
        text($('yHeard'), host.heardLine(v));
        let hint;
        if (st === 'idle') hint = tr('Play to defend the city');
        else if (st === 'paused') hint = tr('Paused: the sky is frozen');
        else if (st === 'stopped') hint = tr('{down} shot down, {impacts}', { down: cs.down, impacts: trn(cs.imp, '{n} impact', '{n} impacts') });
        else if (!v.music) hint = tr('Cannons silent. Play to fire');
        else if (city.next) hint = tr(city.next.what === 'cannon' ? 'Cannon back in {t} of play' : 'Next rebuild in {t} of play', { t: fmt(Math.ceil(city.next.left)) });
        else hint = tr('Cannons firing');
        text($('yHint'), hint);
        const msg = $('yMsg'), m = city.failed ? tr('The 3D city could not load. It needs an internet connection.') : !city.ready ? tr('Building the city…') : '';
        if (msg.hidden !== !m) msg.hidden = !m; if (m) text(msg, m);
      },
      resize() { city.resize(); },
      debugLine() { const cs = city.stats; return 'city ' + (city.ready ? cs.standing + '/' + cs.total + ' standing, ' + cs.cannons + ' cannons, ' + cs.down + ' shot down' : city.failed ? 'did not load' : 'loading'); },
    };
  },
};
