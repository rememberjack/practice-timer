(function () {
'use strict';
const MT = window.MT, $ = id => document.getElementById(id), app = $('app');
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmt(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); }
const cache = new Map();
function text(el, s) { if (cache.get(el) !== s) { cache.set(el, s); el.textContent = s; } }
function width(el, f) { const s = Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10 + '%'; if (cache.get(el) !== s) { cache.set(el, s); el.style.width = s; } }
function left(el, f) { const s = Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10 + '%'; if (cache.get(el) !== s) { cache.set(el, s); el.style.left = s; } }

/* ---------- settings ---------- */
const DEF = { v: 2, goalMin: 30, name: '', sens: 'normal', hold: '5', record: false, source: 'mic', skin: 'classic', themesOff: '', inst: '', lang: '', prefs: {} };   // prefs: each theme's own, by its id (host.pref)
const S = Object.assign({}, DEF);
try { const j = JSON.parse(localStorage.getItem('musicTimer.settings') || 'null');
  if (j && typeof j === 'object') { for (const k in DEF) if (typeof j[k] === typeof DEF[k] && j[k] !== null) S[k] = j[k];
    if (j.v !== 2 && S.goalMin === 20) S.goalMin = 30;             // settings saved before the default changed: the old default of 20 moves to 30 once
    if (Array.isArray(S.prefs)) S.prefs = {};
    if (typeof j.viz === 'string' && !(S.prefs.classic && S.prefs.classic.viz)) S.prefs = Object.assign({}, S.prefs, { classic: { viz: j.viz } }); }   // Classic's sound picture, saved before themes kept their own
  S.v = 2; } catch (e) {}
if (!(S.goalMin >= 5 && S.goalMin <= 180)) S.goalMin = 30;
if (['0', '5', '10', '20'].indexOf(S.hold) < 0) S.hold = DEF.hold;
if (S.lang && !MT.LANGS.some(l => l[0] === S.lang)) S.lang = '';
function saveS() { try { localStorage.setItem('musicTimer.settings', JSON.stringify(S)); } catch (e) {} }
/* debug tools, for the developer only: a sheet opened by holding a Settings button down (or by opening the page with ?debug).
   on: they have been opened on this device, so Settings shows a way back to them and the demo sound can be chosen.
   rocket: where the next session's rocket starts ('pad', 'space', 'orbit'), if set */
const DBG = { on: false, readout: false, rocket: '', r: null, fps: 0 };
try { const j = JSON.parse(localStorage.getItem('musicTimer.debug') || 'null'); if (j && j.on === true) { DBG.on = true; DBG.readout = j.readout === true; } } catch (e) {}
try { const q = new URLSearchParams(location.search).get('debug'); if (q != null) DBG.on = q !== '0'; } catch (e) {}
if (!DBG.on && S.source === 'demo') S.source = 'mic';     // the demo sound is a debug tool now
function saveDbg() { try { if (DBG.on) localStorage.setItem('musicTimer.debug', JSON.stringify({ on: true, readout: DBG.readout })); else localStorage.removeItem('musicTimer.debug'); } catch (e) {} }

/* ---------- language: the one chosen in Settings (S.lang), or with none chosen the device's own. Every word comes from MT.tr,
   which is given in English. The page's own words (in src/template.html) are kept here in English, so they can change language again;
   what is marked translate="no" is left alone (the debug tools stay in English) ---------- */
const tr = MT.tr, trn = MT.trn;
const deviceLangs = () => navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
const PAGE_WORDS = [];   // { n: a text node, or e and a: an element's attribute; en: its English; cur: what is shown; t: the tr of the theme whose panel it is in }
const PANEL_TR = {}; for (const d of MT.themes()) PANEL_TR[d.panel] = MT.translator(d.words).tr;   // a theme's panel speaks in its own words
(function collect(n, t) {
  if (n.nodeType === 3) { if (/[A-Za-z]/.test(n.nodeValue)) PAGE_WORDS.push({ n: n, en: n.nodeValue, cur: n.nodeValue, t: t }); return; }
  if (n.nodeType !== 1 || /^(script|style|svg)$/i.test(n.nodeName) || n.getAttribute('translate') === 'no') return;   // the debug tools, and figures the app fills in
  if (n.classList.contains('panel') && PANEL_TR[n.id]) t = PANEL_TR[n.id];
  for (const a of ['aria-label', 'title']) if (n.hasAttribute(a)) PAGE_WORDS.push({ e: n, a: a, en: n.getAttribute(a), cur: n.getAttribute(a), t: t });
  for (const c of n.childNodes) collect(c, t);
})(document.body, tr);
function applyLang() {
  const id = MT.setLang(MT.pickLang(S.lang, deviceLangs())); document.documentElement.lang = id === 'zh' ? 'zh-CN' : id;
  for (const w of PAGE_WORDS) { if ((w.n ? w.n.nodeValue : w.e.getAttribute(w.a)) !== w.cur) continue;   // the app has written its own words there since
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(w.en), x = w.t(m[2]), cjk = /[\u3000-\u9FFF\uFF00-\uFFEF]/;   // no space beside Chinese
    const t = (cjk.test(x[0]) ? '' : m[1]) + x + (cjk.test(x[x.length - 1]) ? '' : m[3]); w.cur = t; if (w.n) w.n.nodeValue = t; else w.e.setAttribute(w.a, t); }
}
applyLang();
/* French names the notes do, ré, mi; the others keep the letters */
const SOLFEGE = { C: 'Do', D: 'R\u00E9', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
const noteText = n => n && MT.getLang() === 'fr' && SOLFEGE[n[0]] ? SOLFEGE[n[0]] + n.slice(1) : n;
const gap = () => MT.both('', '');   // the space between two sentences: none in Chinese
const listText = a => a.join(tr(', '));

/* ---------- model ---------- */
const session = new MT.Session(); session.goal = S.goalMin * 60;
const onsets = new MT.OnsetTracker();
let onsetN = 0, seed = 7;                           // note starts so far, a running count for followers; the session's seed, shared with them (the same race field)
let awardWait = 0, awardBy = null;                  // a goal whose trophy card waits for the theme on screen (holdAward: the Fireworks finale), and that theme
/* the goal is reached: the trophy card, unless the theme on screen holds it back (holdAward) and shows it when it is ready (host.award) */
function goalReached(goal) { const t = TH[skin]; if (t.inst.holdAward && t.inst.holdAward()) { awardWait = goal; awardBy = t; } else award(goal); }
function releaseAward() { if (!awardWait) return; const g = awardWait; awardWait = 0; awardBy = null; award(g); }
const NB = 44, bars = new Float32Array(NB);
const heard = { label: '', detail: '', note: '', midi: null };      // midi: the pitch heard, as a (fractional) piano key number
let mode = 'local';            // 'local' | 'follow'
let music = false, goalHit = false, vote = {}, kbInst = S.inst;
/* what the screen shows, filled from the local session or from the device being followed */
const V = { st: 'idle', play: 0, active: 0, total: 0, pauses: 0, goal: session.goal, eff: 0, pw: 0, music: false, hold: false, label: '', detail: '', note: '', midi: null, inst: '',
  follow: false, followName: '', demo: false, level: 0, minute: null };   // level: how loud, 0..1; minute: the last minute, a second at a time (null while following)

/* ---------- platform capabilities (all optional) ---------- */
let room = null, downloads = null;
if (window.claude && typeof window.claude.use === 'function') {
  try {
    window.claude.use('room').then(r => { if (!r) return; room = r; try { r.onPeers(onPeers, () => { room = null; }); } catch (e) {} }, () => {});
    window.claude.use('downloads').then(d => { downloads = d || null; }, () => {});
  } catch (e) {}
}

/* ---------- messages ---------- */
let toastT = 0, noticeKind = '', noticeFn = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
function showNotice(kind, msg, actLabel, fn) { noticeKind = kind; noticeFn = fn || null; $('noticeText').textContent = msg;
  $('noticeAct').hidden = !actLabel; $('noticeAct').textContent = actLabel || ''; $('notice').hidden = false; layoutChanged(); }
function hideNotice(kind) { if (kind && kind !== noticeKind) return; if ($('notice').hidden) return; $('notice').hidden = true; noticeKind = ''; layoutChanged(); }
$('noticeAct').onclick = () => { const f = noticeFn; if (f) f(); };
$('noticeClose').onclick = () => { if (noticeKind === 'follow') followDismissed = true; hideNotice(); };

/* ---------- trophy: awarded when play time reaches the practice goal ---------- */
const TROPHY_PX = ['....YYYYYYYY....', '.YY.YWYYYYYD.YY.', '.Y..YWYYYYYD..Y.', '.Y..YWYYYYYD..Y.', '.YY.YWYYYYYD.YY.', '..YYYYYYYYYDYY..', '....YYYYYYYD....', '.....YYYYYD.....',
  '......YYYD......', '.......YD.......', '.......YD.......', '......YYYD......', '.....DDDDDD.....', '....BBBBBBBB....', '....BbbbbbbB....', '................'];
function drawPixelTrophy(cv) { const g = cv.getContext('2d'), pal = { Y: '#FFD23F', W: '#FFF3B0', D: '#C99A1E', B: '#8A5A2B', b: '#6E4420' };
  TROPHY_PX.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (pal[row[i]]) { g.fillStyle = pal[row[i]]; g.fillRect(i, j, 1, 1); } }); }
drawPixelTrophy($('awardPx'));
let awardT = 0;
function award(goal) {
  const t = TH[skin], place = t.inst.awardLine ? t.inst.awardLine() : '', reachedLine = tr('You reached your {n}-minute practice goal.', { n: Math.round(goal / 60) });   // the theme on screen may add a line
  $('awardSub').textContent = place ? MT.both(reachedLine, place) : reachedLine;
  const el = $('award'); el.hidden = true; void el.offsetWidth; el.hidden = false;          // restart the entrance
  clearTimeout(awardT); awardT = setTimeout(hideAward, 7000);
}
function hideAward() { clearTimeout(awardT); $('award').hidden = true; }
$('awardCard').onclick = hideAward;

/* ---------- audio ---------- */
const A = { kind: '', ctx: null, stream: null, an: null, det: null, buf: null, bytes: null, clip: null, pos: 0, demoKey: 'violin', warp: 1, band: null };
const DEMO = [['violin', 'Violin'], ['piano', 'Piano'], ['clarinet', 'Clarinet'], ['flute', 'Flute'], ['talk', 'Talking'], ['pink', 'Noise'], ['quiet', 'Quiet']];
const demoCache = {};
function setDetector(sr) {
  A.det = new MT.MusicDetector(sr, { sensitivity: S.sens }); A.buf = new Float32Array(A.det.N);
  const d = A.det, e = new Int32Array(NB + 1);
  for (let i = 0; i <= NB; i++) e[i] = Math.max(1, Math.round(70 * Math.pow(5000 / 70, i / NB) / d.binHz));
  for (let i = 1; i <= NB; i++) if (e[i] <= e[i - 1]) e[i] = e[i - 1] + 1;
  A.band = e;
}
const framed = (function () { try { return window.top !== window.self; } catch (e) { return true; } })();
function micPolicyBlocked() { try { const fp = document.featurePolicy || document.permissionsPolicy; if (fp && fp.allowsFeature) return !fp.allowsFeature('microphone'); } catch (e) {} return false; }
/* Called straight from the tap, before anything is awaited, so phones let the audio engine start. */
function makeContext() { try { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; const c = new AC(); if (c.state === 'suspended') c.resume().catch(() => {}); return c; } catch (e) { return null; } }
async function openMic(ctx) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { const er = new Error('unsupported'); er.name = window.isSecureContext === false ? 'Insecure' : 'Unsupported'; throw er; }
  if (!ctx) { const er = new Error('no audio engine'); er.name = 'Unsupported'; throw er; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
  catch (e) { if (e && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: true }); else throw e; }
  try {
    if (ctx.state === 'suspended') await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 1200))]);
    const track = stream.getAudioTracks()[0];
    if (track) track.onended = () => { if (session.state === 'running' || session.state === 'paused') showNotice('mic', tr('The microphone stopped. End the session and start again to reconnect it.'), '', null); };
    setDetector(ctx.sampleRate);
    const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = A.det.N; an.smoothingTimeConstant = 0; src.connect(an);
    const z = ctx.createGain(); z.gain.value = 0; an.connect(z); z.connect(ctx.destination);   // keeps the graph pulling on every browser, silently
    A.kind = 'mic'; A.ctx = ctx; A.stream = stream; A.an = an;
  } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
}
function openDemo() { setDetector(44100); A.kind = 'demo'; setDemoClip(A.demoKey); }
function setDemoClip(key) {
  A.demoKey = key; if (!demoCache[key]) demoCache[key] = MT.CLIPS[key](44100);
  A.clip = demoCache[key]; A.pos = A.det ? A.det.N : 4096; paintDemoBar();
}
function closeAudio() {
  if (A.stream) A.stream.getTracks().forEach(t => t.stop());
  if (A.ctx) { try { A.ctx.close(); } catch (e) {} }
  A.kind = ''; A.ctx = A.stream = A.an = null;
}
function getFrame(dt) {
  const b = A.buf;
  if (A.kind === 'mic') {
    if (A.an.getFloatTimeDomainData) A.an.getFloatTimeDomainData(b);
    else { if (!A.bytes) A.bytes = new Uint8Array(b.length); A.an.getByteTimeDomainData(A.bytes); for (let i = 0; i < b.length; i++) b[i] = (A.bytes[i] - 128) / 128; }
    return b;
  }
  if (A.kind === 'demo' && A.clip) {
    const c = A.clip, n = c.length; A.pos = (A.pos + dt * 44100) % n;
    let j = ((Math.floor(A.pos) - b.length) % n + n) % n;
    for (let i = 0; i < b.length; i++) { b[i] = c[j]; if (++j === n) j = 0; }
    return b;
  }
  return null;
}
function levelBars() {
  const P = A.det.P, e = A.band;
  for (let i = 0; i < NB; i++) { let s = 0; for (let k = e[i]; k < e[i + 1]; k++) s += P[k];
    const v = (10 * Math.log10(s + 1e-12) + 74) / 64; bars[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
}
/* iPhone and iPad (iPadOS reports itself as a Mac with touch): every browser there takes its microphone permission from the Settings app */
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const MIC_FRAMED = () => tr('The microphone is not available inside this Claude view. Open the standalone Music Timer file in a browser to time real playing.');
function micMessage(e) {
  const n = e && e.name;
  if (n === 'Insecure') return tr('The microphone only works on a secure address (https) or on localhost.');
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'Unsupported') {
    if (framed) return MIC_FRAMED();
    return tr(n === 'Unsupported' ? 'This browser cannot use the microphone.'
      : iOS ? 'Microphone access was not allowed. Open the Settings app, go to Apps, choose this browser and turn on Microphone, then press Start again.'
      : 'Microphone access was not allowed. Allow the microphone for this page in the browser settings, then press Start again.');
  }
  if (n === 'NotFoundError') return tr('No microphone was found on this device.');
  if (n === 'NotReadableError') return tr('Another app is using the microphone. Close it and press Start again.');
  return n ? tr('The microphone could not be started ({n}). Press Start to try again.', { n: n }) : tr('The microphone could not be started. Press Start to try again.');
}
function useDemoAction() { setSource('demo'); hideNotice('mic'); }
/* a microphone problem; with the debug tools on, it also offers the demo sound */
function micNotice(msg, then) {
  if (!DBG.on) { showNotice('mic', msg); return; }
  showNotice('mic', msg + ' You can try the demo sound instead.', 'Use demo sound', () => { useDemoAction(); if (then) then(); });
}

/* ---------- recording ---------- */
const rec = { mr: null, chunks: [], blob: null, url: '', ext: 'webm' };
function startRecording() {
  rec.blob = null; rec.chunks = []; if (rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) {} rec.url = ''; }
  if (!S.record || A.kind !== 'mic' || typeof MediaRecorder === 'undefined') return;
  try {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    let type = ''; for (const t of types) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) { type = t; break; }
    const mr = new MediaRecorder(A.stream, type ? { mimeType: type } : undefined);
    mr.ondataavailable = ev => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    mr.onstop = () => { const tp = mr.mimeType || type || 'audio/webm'; rec.ext = tp.indexOf('mp4') >= 0 ? 'mp4' : 'webm';
      if (rec.chunks.length) { rec.blob = new Blob(rec.chunks, { type: tp }); showRecording(); } };
    mr.start(1000); rec.mr = mr;
  } catch (e) { rec.mr = null; toast(tr('Recording is not available here')); }
}
function recCall(fn) { try { if (rec.mr && rec.mr.state !== 'inactive') rec.mr[fn](); } catch (e) {} }

/* ---------- session control ---------- */
let timer = 0, lastT = 0, busy = false, wake = null, lastPush = 0;
async function keepAwake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
function letSleep() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

async function start() {
  if (busy || mode === 'follow' || session.state === 'running' || session.state === 'paused') return;
  busy = true;
  const ctx = S.source === 'demo' ? null : makeContext();
  try { if (S.source === 'demo') openDemo(); else await openMic(ctx); }
  catch (e) { busy = false; if (ctx) { try { ctx.close(); } catch (er) {} }
    micNotice(micMessage(e), start); return; }
  busy = false; hideNotice();
  session.goal = S.goalMin * 60; session.hold = +S.hold; session.start(); onsets.reset();
  seed = 1 + Math.floor(Math.random() * 2e9);       // a new race field each session
  each('reset', { why: 'start', goal: session.goal, seed: seed });
  music = false; goalHit = false; awardWait = 0; awardBy = null; vote = {}; bars.fill(0); hideAward();
  heard.label = tr('Listening'); heard.detail = tr('Play your instrument to start the clock'); heard.note = ''; heard.midi = null;
  startRecording();
  lastT = performance.now(); clearInterval(timer); timer = setInterval(tick, 46);
  keepAwake(); paintControls(); push(); writeLive();
}
function pause() { if (!session.pause()) return; music = false; recCall('pause'); paintControls(); push(); writeLive(); }
/* opening the practice log or Settings pauses a running session, so nothing counts while you look; closing it carries on,
   unless the session was already paused by hand */
let sheetPaused = false;
function pauseForSheet() { if (mode === 'local' && session.state === 'running') { pause(); sheetPaused = true; } }
function resumeAfterSheet() { if (!sheetPaused || $('dlgSettings').open || $('dlgLog').open || $('dlgDebug').open) return; sheetPaused = false; if (session.state === 'paused') resume(); }
function resume() { sheetPaused = false; if (!session.resume()) return; if (A.ctx && A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); if (A.det) { A.det.score = 0; A.det.isMusic = false; } recCall('resume'); lastT = performance.now(); paintControls(); push(); }
function stop() {
  if (!session.stop()) return;
  clearLive();                                   // ended here, so nothing was cut short
  clearInterval(timer); timer = 0; music = false; recCall('stop'); rec.mr = null; hideAward(); awardWait = 0; awardBy = null;
  each('stopped', { play: session.play });
  closeAudio(); letSleep(); paintControls(); push();
  current = finishSession(); openSummary(current.rec, false);
}

function tick() {
  const now = performance.now(), dt = (now - lastT) / 1000; if (!(dt > 0)) return; lastT = now;
  if (now - liveAt > 5000) writeLive();          // keep the session so far, in case the app is closed
  const w = A.kind === 'demo' ? A.warp : 1;
  let m = false;
  if (session.state === 'running') {
    const f = getFrame(dt);
    if (f) { const r = A.det.process(f, Math.min(dt, 1)); DBG.r = r;
      m = r.isMusic && dt < 1.5;                 // a long gap means the page was asleep: no credit
      if (dt >= 1.5) session.quietFor = Infinity;   // and no hold across it
      heard.label = r.label; heard.detail = r.detail; heard.note = r.isMusic ? r.note : '';   // a note name only for an instrument, not for talking or noise
      heard.midi = r.pitch > 0 ? 69 + 12 * Math.log2(r.pitch / 440) : null; levelBars();
      if (onsets.feed(dt, { music: m, midi: heard.midi, levelDb: r.levelDb })) { onsetN++; each('notes', 1); }
      if (A.kind === 'mic' && A.ctx && A.ctx.state !== 'running') { m = false; heard.label = tr('The microphone is asleep'); heard.detail = tr('Press Pause, then Resume to wake it'); heard.note = ''; heard.midi = null; }
      if (m && r.instrument) vote[r.instrument] = (vote[r.instrument] || 0) + dt; }
    let best = '', bs = 0; for (const k in vote) { vote[k] *= Math.exp(-dt / 25); if (vote[k] > bs) { bs = vote[k]; best = k; } }
    if (best && best !== kbInst && bs >= 1.2 && bs > (vote[kbInst] || 0) * 1.25 + 0.4) { kbInst = best; S.inst = best; saveS(); }
  }
  const away = dt >= 1.5 && session.state === 'running';   // the page was asleep or in the background: that time counts like a pause
  if (away) { session.away(dt * w); music = false; }
  else music = session.tick(dt * w, m);        // a short quiet after playing still counts (the hold set in Settings)
  if (session.holdLeft > 0) heard.detail = tr('Short pauses still count as playing');
  // the themes on session time (time away counts for nothing); what they show follows the last minute of playing
  each('tick', away ? 0 : dt * w, { state: session.state, heard: m, music: music, recent: session.recentEfficiency, play: session.play, goal: session.goal, rdt: dt, away: away, follow: false });
  if (!goalHit && session.play >= session.goal) { goalHit = true; goalReached(session.goal); }
  if (now - lastPush > 330) push();
}

/* ---------- following another device ---------- */
let followPeer = '', R = null, followDismissed = false, offerPeer = '';
function push() {
  lastPush = performance.now(); if (!room || mode !== 'local') return;
  let br = ''; for (let i = 0; i < NB; i++) br += Math.min(9, Math.floor(bars[i] * 10));
  const r1 = v => Math.round(v * 10) / 10;
  const o = { st: session.state, pl: r1(session.play), ac: r1(session.active), to: r1(session.total), pa: session.pauses, go: session.goal,
    pw: Math.round(V.pw * 1000) / 1000, mu: music ? 1 : 0, lb: heard.label, dt: heard.detail, nt: heard.note, pm: heard.midi != null ? Math.round(heard.midi * 10) / 10 : -1, iv: kbInst, on: onsetN, br: br,
    gs: seed, nm: S.name, th: {} };
  for (const t of TH) if (t.inst.share) o.th[t.id] = t.inst.share();   // each theme's own, by its id
  try { room.presence({ mt: session.state === 'idle' ? null : o }).catch(() => {}); } catch (e) {}
}
function parseRemote(x) {
  if (!x || typeof x !== 'object') return null;
  const st = ['running', 'paused', 'stopped'].indexOf(x.st) >= 0 ? x.st : ''; if (!st) return null;
  const n = (v, max) => typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  const s = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  return { st: st, play: n(x.pl, 1e6), active: n(x.ac, 1e6), total: n(x.to, 1e6), pauses: Math.round(n(x.pa, 999)), goal: n(x.go, 1e6) || 1800,
    pw: n(x.pw, 1), music: x.mu === 1, label: s(x.lb, 60), detail: s(x.dt, 80), note: s(x.nt, 4), midi: typeof x.pm === 'number' && x.pm > 0 && x.pm < 130 ? x.pm : null, inst: s(x.iv, 12), on: Math.round(n(x.on, 1e9)), bars: typeof x.br === 'string' && /^[0-9]{44}$/.test(x.br) ? x.br : '',
    gs: Math.round(n(x.gs, 2147483646)), name: s(x.nm, 40), th: x.th && typeof x.th === 'object' && !Array.isArray(x.th) ? x.th : {} };   // each theme reads its own (follow)
}
function onPeers(ch) {
  const peers = ch && ch.peers || [];
  if (mode === 'follow') {
    let cur = null; for (const p of peers) if (p.peer === followPeer) cur = p;
    const m = cur && parseRemote(cur.presence && cur.presence.mt);
    if (m) applyRemote(m); else if (R && R.st !== 'stopped') { R.st = 'stopped'; R.music = false; R.label = tr('The session has ended'); R.detail = ''; paintControls(); }
    return;
  }
  let best = null;
  for (const p of peers) { if (p.sameTab || p.kind === 'agent') continue; const m = parseRemote(p.presence && p.presence.mt);
    if (m && m.st !== 'stopped' && (!best || p.updatedAt > best.updatedAt)) best = p; }
  const idle = session.state === 'idle' || session.state === 'stopped';
  if (best && idle && !followDismissed) { if (offerPeer !== best.peer || noticeKind !== 'follow') { offerPeer = best.peer;
    showNotice('follow', tr('A practice session is live on another device.'), tr('Follow'), () => startFollow(offerPeer)); } }
  else if (!best) { offerPeer = ''; followDismissed = false; hideNotice('follow'); }
  else if (!idle) hideNotice('follow');
}
function applyRemote(m) {
  const first = !R, prev = R; R = m;
  if (prev && prev.play < prev.goal && m.play >= m.goal && m.st === 'running') goalReached(m.goal);
  if (first) each('reset', { why: 'follow', goal: m.goal, seed: m.gs || 7 });   // the same race field as the device followed
  else if (m.on > prev.on) each('notes', Math.min(3, m.on - prev.on));
  if (prev && prev.st !== m.st) paintControls();
  for (const t of TH) if (t.inst.follow) { const x = m.th[t.id]; t.inst.follow(x && typeof x === 'object' ? x : {}, { first: first, state: m.st, recent: m.pw }); }
  for (let i = 0; i < NB; i++) bars[i] = m.bars ? (m.bars.charCodeAt(i) - 48) / 9 : 0;
}
function startFollow(peer) {
  if (!room || !peer || session.state === 'running' || session.state === 'paused') return;
  mode = 'follow'; followPeer = peer; R = null; hideNotice(); $('dlgSummary').open && $('dlgSummary').close();
  onPeers({ peers: room.peers() }); if (!R) { stopFollow(); return; }
  paintControls(); paintDemoBar();
}
function stopFollow() { hideAward(); mode = 'local'; followPeer = ''; R = null; each('reset', { why: 'local' }); bars.fill(0); session.reset(); paintControls(); paintDemoBar(); }
function followStep(dt) {
  if (!R) return;
  if (R.st === 'running') { R.total += dt; R.active += dt; if (R.music) R.play += dt; } else if (R.st === 'paused') R.total += dt;
  each('tick', dt, { state: R.st, heard: R.music, music: R.music, recent: R.pw, play: R.play, goal: R.goal, rdt: dt, away: false, follow: true });
}

/* ---------- screen: the view model (V), from the local session or from the device being followed, and the themes' read-outs ---------- */
function paint() {
  if (mode === 'follow' && R) { V.st = R.st; V.play = R.play; V.active = R.active; V.total = R.total; V.pauses = R.pauses; V.goal = R.goal;
    V.eff = R.active > 0 ? Math.min(1, R.play / R.active) : 0; V.pw = R.pw; V.music = R.music && R.st === 'running'; V.hold = false; V.label = R.label; V.detail = R.detail; V.note = R.note; V.midi = R.midi; V.inst = R.inst; }
  else { V.st = session.state; V.play = session.play; V.active = session.active; V.total = session.total; V.pauses = session.pauses;
    V.goal = session.state === 'idle' ? S.goalMin * 60 : session.goal; V.eff = session.efficiency;
    V.pw = session.recentEfficiency; V.music = music; V.hold = session.holdLeft > 0; V.label = heard.label; V.detail = heard.detail; V.note = heard.note; V.midi = heard.midi; V.inst = kbInst; }
  V.follow = mode === 'follow'; V.followName = V.follow && R ? R.name : ''; V.demo = S.source === 'demo'; V.minute = V.follow ? null : session.minute;
  let lv = 0; for (let i = 0; i < NB; i++) lv += bars[i]; V.level = Math.min(1, lv / NB * 2.2);
  if (app.dataset.music !== (V.music ? '1' : '0')) app.dataset.music = V.music ? '1' : '0';
  const won = V.st !== 'idle' && V.play >= V.goal ? '1' : '0'; if (app.dataset.goal !== won) app.dataset.goal = won;
}
/* the line under each theme's read-outs: what is heard while running, else the session's state */
function heardLine(v) { return v.st === 'running' ? v.label : tr(v.st === 'paused' ? 'Paused: not listening' : v.st === 'idle' ? 'Press Start, then play' : 'Session finished'); }
function goalLeft(v) { return tr('{t} left', { t: fmt(Math.ceil(v.goal - v.play)) }); }   // the play time still to go to the goal
/* the same into el, its figure in <b> like the read-outs' other figures, or Reached once the goal is reached */
function showGoalLeft(el, v) { html(el, v.st !== 'idle' && v.play >= v.goal ? tr('Reached') : tr('{t} left', { t: '<b>' + fmt(Math.ceil(v.goal - v.play)) + '</b>' })); }
/* a power bar (Rocket and City): the fill and Power are the last minute of playing, the tick and Efficiency the whole session.
   els: { fill, tick, power, eff }, the bar's fill, its tick and the two figures */
function powerBar(els, v, cls) {
  const on = v.active > 0; width(els.fill, v.pw); if (els.fill.className !== cls) els.fill.className = cls;
  text(els.power, Math.round(v.pw * 100) + '%'); text(els.eff, Math.round(v.eff * 100) + '%');
  if (els.tick.hidden === on) els.tick.hidden = !on; if (on) left(els.tick, v.eff);
}
function paintControls() {
  const st = mode === 'follow' ? 'follow' : session.state;
  app.dataset.state = st;
  $('btnStart').hidden = !(st === 'idle' || st === 'stopped'); $('btnStart').textContent = tr(st === 'stopped' ? 'New session' : 'Start');
  $('btnSummary').hidden = st !== 'stopped';
  $('btnPause').hidden = st !== 'running'; $('btnResume').hidden = st !== 'paused'; $('btnStop').hidden = !(st === 'running' || st === 'paused');
  $('btnUnfollow').hidden = st !== 'follow';
  if (st === 'running' || st === 'paused' || st === 'follow') hideHome();
  const lock = st === 'running' || st === 'paused' || st === 'follow';
  for (const b of $('segSource').children) b.disabled = lock;
  $('btnTests').disabled = st === 'running' || testing;
}
$('btnStart').onclick = start; $('btnPause').onclick = pause; $('btnResume').onclick = resume; $('btnStop').onclick = askEnd;
/* End asks first, so a tap on it by mistake does not cut a session short */
function askEnd() {
  if (session.state !== 'running' && session.state !== 'paused') return;
  $('endP').textContent = MT.both(tr('You have played for {time}.', { time: MT.durationText(Math.floor(session.play)) }), tr(MT.worthKeeping({ play: session.play })
    ? 'The session will be saved to your practice log.' : 'Sessions with less than 10 seconds of playing are not saved.'));
  themeSheet($('dlgEnd'), false); if (!$('dlgEnd').open) $('dlgEnd').showModal();
}
/* a question asked over a theme takes its look; asked from the Home Screen (or in Classic) it keeps the plain one */
function themeSheet(d, home) { if (home || skin === 0) delete d.dataset.skin; else d.dataset.skin = TH[skin].id; }
/* a question a theme asks (host.ask): o = { title, text, yes, no, home }, in its own words; true if the answer is yes */
let askDone = null;
function ask(o) {
  if (askDone) askDone(false);
  $('askH').textContent = o.title; $('askP').textContent = o.text; $('askYes').textContent = o.yes; $('askNo').textContent = o.no;
  themeSheet($('dlgAsk'), o.home); if (!$('dlgAsk').open) $('dlgAsk').showModal();
  return new Promise(res => { askDone = res; });
}
function answer(yes) { const f = askDone; askDone = null; if ($('dlgAsk').open) $('dlgAsk').close(); if (f) f(yes); }
$('askYes').onclick = () => answer(true);
$('askNo').onclick = () => answer(false);
$('dlgAsk').addEventListener('close', () => answer(false));
$('endYes').onclick = () => { $('dlgEnd').close(); stop(); };
$('endNo').onclick = () => $('dlgEnd').close();
$('btnUnfollow').onclick = stopFollow; $('btnSummary').onclick = () => { if (current) openSummary(current.rec, false); };

let lastF = 0;
function frame(t) {
  const dt = Math.min(0.1, Math.max(0, (t - lastF) / 1000)); if (DBG.readout) dbgFrame(t - lastF); lastF = t;
  if (mode === 'follow') followStep(dt);
  paint();
  for (let i = 0; i < TH.length; i++) { const t = TH[i], shown = visible(i); if (t.inst.frame) t.inst.frame(dt, { shown: shown, v: V }); if (shown && t.inst.paint) t.inst.paint(V); }   // only the theme on screen is drawn
  requestAnimationFrame(frame);
}

/* ---------- themes: the modules installed in the page (src/themes/, docs/theme-modules.md), in swipe order ----------
   Each theme's create(host) is called once, here; the page then drives it through its hooks. A theme that fails to start is left out (and
   said in the console and the debug tools), so one broken theme never stops the others */
const stage = $('stage'), track = $('track');
let lastSwipe = 0;                                  // when a swipe last landed: Classic's picture changes on a tap, not on the lift of a swipe
function html(el, s) { if (cache.get(el) !== s) { cache.set(el, s); el.innerHTML = s; } }
const themeErrors = (MT.themeErrors || []).slice();
/* what the page offers a theme (docs/theme-modules.md, The host) */
function makeHost(t) {
  const T = MT.translator(t.def.words);
  return {
    id: t.id, panel: t.panel, $: $, tr: T.tr, trn: T.trn, view: V, reduceMotion: reduceMotion,
    fmt: fmt, text: text, html: html, width: width, left: left, heardLine: heardLine, goalLeft: goalLeft, showGoalLeft: showGoalLeft, powerBar: powerBar, noteText: noteText, drawPixelTrophy: drawPixelTrophy,
    locale: () => MT.getLang() === 'en' ? 'en-US' : loc(),
    audio: { bars: bars, det: () => A.det },
    shown: () => visible(t.i), current: () => skin === t.i, following: () => mode === 'follow',
    between: () => mode === 'local' && session.state !== 'running' && session.state !== 'paused',
    award: releaseAward, ask: ask, log: () => log, push: push, layoutChanged: layoutChanged, lastSwipe: () => lastSwipe,
    homeChanged: () => { if (homeOn) renderHome(); },
    pref: function (k, v) { const p = S.prefs[t.id] || {}; if (arguments.length < 2) return p[k]; S.prefs = Object.assign({}, S.prefs, { [t.id]: Object.assign({}, p, { [k]: v }) }); saveS(); },
  };
}
const TH = [];
for (const def of MT.themes()) {
  const t = { id: def.id, def: def, panel: $(def.panel), i: TH.length, inst: null };
  try {
    if (!t.panel) throw new Error('its panel #' + def.panel + ' is not in the page');
    t.inst = def.create(makeHost(t)); const bad = MT.checkInstance(t.inst); if (bad.length) throw new Error(bad.join('; '));
    TH.push(t);
  } catch (e) { themeErrors.push(def.id + ': ' + e.message); console.error('Music Timer: the ' + def.id + ' theme did not start. ' + (e && e.message)); if (t.panel) t.panel.remove(); }
}
/* calls a hook on every theme that has it */
function each(hook) { const a = [].slice.call(arguments, 1); for (const t of TH) if (t.inst[hook]) t.inst[hook].apply(t.inst, a); }
const themeName = t => MT.translator(t.def.words).tr(t.def.name);   // in its own words
let skin = Math.max(0, TH.findIndex(t => t.id === S.skin)), dragging = false, peek = -1;   // peek: the theme a swipe is pulling into view
/* Whether a theme can be chosen yet. Every theme is open for now; to hold one back until a condition is met, return false for it here
   and call refreshSkins() when the condition changes. A locked theme keeps its icon in the theme bar (faint, with a padlock) but leaves the swipe
   track, so swipes, arrow keys and the bar all skip it. The base theme (Classic) is always open, so there is somewhere to land. */
function skinOpen(i) { return true; }   // eslint-disable-line no-unused-vars -- i is for when a theme is held back
/* Themes the player turned off (Settings, Themes; S.themesOff), and themes not written for the page's language, leave the swipe track and the
   theme bar altogether, with no padlock: nothing to earn back */
const offered = i => MT.themesOpen(TH.map(t => t.def), S.themesOff, MT.getLang()).indexOf(TH[i].id) >= 0;
let open = [];   // indices of the open themes, in swipe order
function refreshSkins() {
  open = TH.map((_, i) => i).filter(i => i === 0 || (skinOpen(i) && offered(i)));
  TH.forEach((t, i) => { t.panel.hidden = !open.includes(i); });
  track.style.width = open.length * 100 + '%';
  setSkin(TH.findIndex(t => t.id === MT.themeLanding(open.map(i => TH[i].id), TH[skin].id)), false);
}
function stepSkin(d) { const p = open.indexOf(skin) + d; return open[Math.max(0, Math.min(open.length - 1, p))]; }   // the next open theme that way, or the same one at either end
/* Only the theme on screen is drawn, plus the one a swipe is revealing. Each scene is costly (City is WebGL), so drawing every theme while a finger is down made swipes lag.
   Nothing is drawn while the Home Screen covers the themes. */
let homeOn = false;
function visible(i) { return !homeOn && (i === skin || (dragging && i === peek)); }
function setSkin(i, animate) {
  if (awardWait && TH[i] !== awardBy) releaseAward();   // left the theme holding the trophy card (the Fireworks finale): the card shows now
  const was = skin; skin = i; app.dataset.skin = TH[i].id; app.dataset.chrome = TH[i].def.chrome; S.skin = TH[i].id; saveS();
  if (was !== i && TH[was].inst.hide) TH[was].inst.hide();
  if (TH[i].inst.show) TH[i].inst.show();
  track.style.transition = animate && !reduceMotion ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
  track.style.transform = 'translateX(' + (-open.indexOf(i) * 100 / open.length) + '%)';
  TH.forEach((t, j) => { t.panel.inert = j !== i; });
  paintSkinBar(); if (homeOn) paintHomeThemes();
  layoutChanged();
}
/* The theme bar: each theme's icon (the #ico-<theme> symbols in the page), the current one lit. Tapping an icon goes to that theme. */
const skinBar = $('skinBar');
TH.forEach((t, i) => { const b = document.createElement('button'); b.type = 'button';
  b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#ico-' + t.id + '"/></svg><svg class="lk" aria-hidden="true"><use href="#ico-lock"/></svg>';
  b.onclick = () => { if (open.includes(i) && i !== skin) setSkin(i, true); }; skinBar.appendChild(b); });
function paintSkinBar() {
  [...skinBar.children].forEach((b, i) => {
    const locked = !open.includes(i), on = i === skin, name = themeName(TH[i]);
    b.hidden = i > 0 && !offered(i); b.disabled = locked; b.dataset.state = locked ? 'locked' : on ? 'on' : 'off';
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    b.setAttribute('aria-label', tr(locked ? '{name} theme, locked' : '{name} theme', { name: name })); b.title = locked ? tr('{name} (locked)', { name: name }) : name;
  });
}
/* Event banners sit just under the read-outs, clear of the scene: each panel gets --hud-b, the bottom of its read-out card (.hud-card), for the CSS to use */
function layoutChanged() { requestAnimationFrame(() => { each('resize');
  for (const t of TH) { const el = t.panel.querySelector('.hud-card'); if (el) t.panel.style.setProperty('--hud-b', el.offsetTop + el.offsetHeight + 'px'); } }); }
const swipe = new MT.DragSwipe();
stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; swipe.down(e.pointerId, e.clientX, e.clientY, performance.now(), stage.clientWidth); });
stage.addEventListener('pointermove', e => {
  if (!swipe.has(e.pointerId)) return;
  if (e.pointerType === 'mouse' && !e.buttons) { endDrag(e); return; }   // the button was let go somewhere else
  const was = swipe.locked, dx = swipe.move(e.clientX, e.clientY); if (dx == null) return;
  if (!was) { dragging = true; try { stage.setPointerCapture(e.pointerId); } catch (er) {} each('resize'); }   // the scene coming into view at its size
  peek = stepSkin(dx < 0 ? 1 : -1);
  track.style.transition = 'none'; track.style.transform = 'translateX(' + swipe.offset(dx, open.indexOf(skin), open.length) + 'px)';
});
function endDrag(e) {
  if (e && !swipe.has(e.pointerId)) return; const s = swipe.up(e ? e.clientX : null, performance.now()); if (s == null) return;
  dragging = false; lastSwipe = performance.now(); setSkin(s ? stepSkin(s) : skin, true);
}
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', () => endDrag(null));
window.addEventListener('pointerup', endDrag);   // let go outside the scene
stage.addEventListener('dragstart', e => e.preventDefault());   // a native drag would cancel the pointer stream mid-swipe
const wheel = new MT.WheelSwipe();   // a two-finger trackpad swipe arrives as horizontal wheel events: one theme per swipe, however quickly they follow
document.addEventListener('wheel', e => {   // the whole page: on a computer the pointer is often over the theme bar or beside the column
  if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // pinch zoom; mostly vertical: Classic and the sheets scroll
  const row = e.target.closest && e.target.closest('#demoClips');
  if (row && (e.deltaX > 0 ? row.scrollLeft + row.clientWidth < row.scrollWidth - 1 : row.scrollLeft > 0)) return;   // the row of demo sounds scrolls sideways while it can
  e.preventDefault();   // also stops the browser reading it as back/forward, which would leave the page and lose the session
  if (e.target.closest && e.target.closest('#logWeekSec')) { const n = performance.now(), d = weekWheel.feed({ t: e.timeStamp || n, now: n, drawn: n, dx: e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? weekSec.clientWidth : 1) });
    if (d) showWeek(logBack - d, d); return; }   // over the practice log's week: the week changes instead
  if (row || document.querySelector('dialog[open]')) return;   // no theme change over the demo sounds or behind an open sheet
  const now = performance.now(), d = wheel.feed({ t: e.timeStamp || now, now: now, drawn: lastF, dx: e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientWidth : 1) });
  if (d) setSkin(stepSkin(d), true);
}, { passive: false });
document.addEventListener('keydown', e => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const top = [...document.querySelectorAll('dialog[open]')].pop();
  if (top) { if (top.id === 'dlgLog' && /^Arrow(Left|Right)$/.test(e.key)) showWeek(logBack + (e.key === 'ArrowLeft' ? 1 : -1), e.key === 'ArrowLeft' ? -1 : 1); return; }   // the practice log: the week before or after
  if (e.key === 'ArrowRight') setSkin(stepSkin(1), true); else if (e.key === 'ArrowLeft') setSkin(stepSkin(-1), true); });
window.addEventListener('resize', layoutChanged);
window.addEventListener('pagehide', writeLive);   // the app is being closed: keep the session so far
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { writeLive(); return; }
  if (session.state === 'running' || session.state === 'paused') keepAwake();
  if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
  if (homeOn && mode === 'local' && session.state !== 'running' && session.state !== 'paused') { each('restore', log); renderHome(); }   // a new day since: fresh words, and the rocket on the pad
  checkVersion(); });
window.addEventListener('pageshow', e => { if (e.persisted) checkVersion(); });   // back from the browser's page cache

/* ---------- new versions: a Home Screen app keeps the page it first loaded until iOS discards it, so when it comes back
   to the screen between sessions it looks at the live page, and reloads into a newer version. Never during a session ---------- */
const BUILD = (document.querySelector('meta[name="build"]') || {}).content || '';
let verAt = 0;
const between = () => !busy && mode === 'local' && session.state !== 'running' && session.state !== 'paused' && !document.querySelector('dialog[open]');
async function checkVersion() {
  if (framed || !/^https?:$/.test(location.protocol) || !between() || Date.now() - verAt < 60e3) return;
  verAt = Date.now();
  try { const r = await fetch(location.pathname, { cache: 'no-store' }); if (!r.ok) return;
    if (MT.newerBuild(BUILD, await r.text()) && between()) { try { sessionStorage.setItem('musicTimer.updated', '1'); } catch (e) {} location.reload(); } }
  catch (e) {}   // offline: try again next time
}

/* ---------- demo bar ---------- */
function chip(parent, label, on, fn) { const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-pressed', on); b.onclick = fn; parent.appendChild(b); }
function paintDemoBar() {
  const show = S.source === 'demo' && mode === 'local'; if ($('demoBar').hidden === show) { $('demoBar').hidden = !show; layoutChanged(); }
  const c = $('demoClips'), w = $('demoWarp'); c.textContent = ''; w.textContent = '';
  for (const d of DEMO) chip(c, d[1], A.demoKey === d[0], () => { if (A.det && A.kind === 'demo') setDemoClip(d[0]); else { A.demoKey = d[0]; paintDemoBar(); } });
  for (const x of [1, 10, 60]) chip(w, x + '\u00D7', A.warp === x, () => { A.warp = x; paintDemoBar(); });
}

/* ---------- settings sheet ---------- */
function seg(id, key, after) {
  const el = $(id), upd = () => { for (const b of el.children) b.setAttribute('aria-pressed', b.dataset.v === S[key]); };
  for (const b of el.children) b.onclick = () => { S[key] = b.dataset.v; saveS(); upd(); if (after) after(); };
  upd(); return upd;
}
const updSource = seg('segSource', 'source', () => { hideNotice('mic'); paintDemoBar(); });
function setSource(v) { S.source = v; saveS(); updSource(); paintDemoBar(); }
seg('segSens', 'sens', () => { if (A.det) A.det.setSensitivity(S.sens); });
seg('segHold', 'hold', () => { session.hold = +S.hold; });
function paintGoal() { $('goalOut').textContent = tr('{m} min', { m: S.goalMin }); }
function bumpGoal(d) { S.goalMin = Math.max(5, Math.min(180, S.goalMin + d)); saveS(); paintGoal(); if (session.state === 'running' || session.state === 'paused') { session.goal = S.goalMin * 60; each('goalChanged', session.goal, session.play); if (session.play < session.goal) { goalHit = false; awardWait = 0; awardBy = null; hideAward(); } } }
$('goalDn').onclick = () => bumpGoal(-5); $('goalUp').onclick = () => bumpGoal(5);
$('nameIn').value = S.name; $('nameIn').oninput = () => { S.name = $('nameIn').value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '').slice(0, 40); saveS(); };   // eslint-disable-line no-control-regex -- strips control and invisible characters from the name
$('recIn').checked = S.record; $('recIn').onchange = () => { S.record = $('recIn').checked; saveS(); };
/* the goal's hint in the words of the theme Settings is opened from (its goalHint) */
function paintSettingsSkin() { const d = TH[skin].def; $('goalHint').textContent = d.goalHint ? MT.translator(d.words).tr(d.goalHint) : tr('The total play time to reach.'); }
/* Settings, Themes: a page of its own in the sheet, with a switch for each theme. The base theme (Classic) is always on and its switch can't be turned off;
   turning off the one on screen moves to Classic, the first one on (MT.themeLanding), during a session too. A theme not written for the page's
   language is dimmed, its switch kept as it is, until a language it is written for is chosen */
const themeRows = TH.map(t => { const li = document.createElement('li'), sw = document.createElement('input'); li.className = 'trow'; li.dataset.theme = t.id;
  li.innerHTML = '<span class="tile" aria-hidden="true"><svg><use href="#ico-' + t.id + '"/></svg></span><span class="tx"><b></b><span></span></span>';
  sw.type = 'checkbox'; sw.setAttribute('role', 'switch'); sw.className = 'tg';
  sw.onchange = () => { const was = skin; S.themesOff = MT.themeSwitch(TH.map(x => x.id), S.themesOff, t.id, sw.checked); saveS(); refreshSkins(); paintThemes(skin !== was); };
  li.append(sw); $('themeList').append(li); return li; });
function paintThemes(moved) {
  const ids = TH.map(t => t.id), on = MT.themesOn(ids, S.themesOff), names = on.map(id => themeName(TH[ids.indexOf(id)]));
  themeRows.forEach((li, i) => { const t = TH[i], sw = li.querySelector('input'), o = on.includes(t.id), here = t.def.langs.indexOf(MT.getLang()) >= 0;
    sw.checked = o; sw.disabled = i === 0 || !here; li.classList.toggle('off', !o || !here);
    li.querySelector('b').textContent = themeName(t); li.querySelector('.tx span').textContent = here ? MT.translator(t.def.words).tr(t.def.line) : tr('Not in this language yet.'); sw.setAttribute('aria-label', themeName(t)); });
  $('themesSum').textContent = on.length === ids.length ? tr('All of them are on.') : on.length === 1 ? tr('Only {name} is on.', { name: names[0] })
    : tr('{list} and {last} are on.', { list: listText(names.slice(0, -1)), last: names[names.length - 1] });
  $('themesMini').innerHTML = on.map(id => '<i data-theme="' + id + '"><svg><use href="#ico-' + id + '"/></svg></i>').join('');
  $('themesNote').textContent = moved ? tr('Now playing with {name}.', { name: themeName(TH[skin]) }) : '';
}
/* About, from Settings: the credits roll up over the whole screen like the end of a film, round and round while open; a tap pauses them, holding speeds them up.
   With reduced motion they stand still in a box that scrolls */
const CREDITS = [
  ['Product and design', [['Product Manager', 'Jack Chen'], ['UX Designer', 'Claude'], ['UI / Visual Designer', 'Claude'], ['Motion / Game Artist (2D and 3D)', 'Claude'], ['UX Writer / Copywriter', 'Claude']]],
  ['Engineering', [['Front-end Developer (JavaScript / HTML / CSS)', 'Claude'], ['Audio / DSP Engineer', 'Claude'], ['Graphics / Game Developer', 'Claude'], ['Mobile Web / iOS Specialist', 'Claude']]],
  ['Quality and operations', [['QA Engineer', 'Claude'], ['Human QA Engineer', 'Jack Chen'], ['Student Beta Tester', 'Jayden Chen'], ['Test Automation Engineer', 'Claude'], ['DevOps / Release Engineer', 'Claude']]],
];
function paintCredits() {
  $('rollIn').innerHTML = '<li class="t">Music Timer</li><li class="lead">' + tr('Music Timer counts your practice only while it hears your instrument, so every minute it shows is a minute you played.') + '</li>' + CREDITS.map(([h, rows]) => '<li class="h">' + tr(h) + '</li>' +
    rows.map(([r, n]) => '<li><span class="r">' + tr(r) + '</span><span class="n">' + (n === 'Claude' ? '<svg class="ai" aria-hidden="true"><use href="#ico-claude"/></svg>' : '') + n + '</span></li>').join('')).join('') + '<li class="end">' + tr('Starring you, every time you play.') + '</li>';
}
paintCredits();
let rollAnim = null, rollHold = 0, rollFast = false, rollDown = false, rollDrag = false, rollWasPaused = false, rollY0 = 0, rollT0 = 0;
function rollCredits(on) {
  clearTimeout(rollHold); rollFast = rollDown = rollDrag = false; if (rollAnim) { rollAnim.cancel(); rollAnim = null; }
  if (!on || reduceMotion || !$('rollIn').animate) return;
  const h = $('roll').clientHeight, len = $('rollIn').offsetHeight;
  rollAnim = $('rollIn').animate([{ transform: 'translateY(' + h + 'px)' }, { transform: 'translateY(' + -len + 'px)' }], { duration: (h + len) / 32 * 1000, iterations: Infinity });   // 32 px a second
  rollAnim.currentTime = h * 0.6 / 32 * 1000;   // the first time round, the title starts on screen rather than below it
}
function rollHint() { $('rollHint').textContent = tr(rollAnim && rollAnim.playState === 'paused' ? 'Tap to carry on.' : 'Tap to pause. Hold to speed up. Drag to move.'); }
function pauseRoll() { if (!rollAnim) return; if (rollAnim.playState === 'paused') rollAnim.play(); else rollAnim.pause(); rollHint(); }
function rollLetGo(tap) { clearTimeout(rollHold); const down = rollDown; rollDown = false; if (!rollAnim || !down) return;
  if (rollDrag) { rollDrag = false; if (!rollWasPaused) rollAnim.play(); rollHint(); return; }   // let go after a drag: carry on from there, or stay paused
  if (rollFast) { rollAnim.playbackRate = 1; rollFast = false; } else if (tap) pauseRoll(); }
$('roll').onpointerdown = e => { if (!rollAnim || e.button > 0) return; clearTimeout(rollHold); rollFast = false; rollDown = true; rollDrag = false; rollY0 = e.clientY; try { $('roll').setPointerCapture(e.pointerId); } catch (x) {}   // held for a moment: six times as fast until let go, even from paused
  rollHold = setTimeout(() => { rollFast = true; rollAnim.playbackRate = 6; rollAnim.play(); rollHint(); }, 250); };
$('roll').onpointermove = e => {   // a finger dragged up or down moves the credits with it, like scrubbing a film; down goes back
  if (!rollDown || !rollAnim) return;
  if (!rollDrag) { if (Math.abs(e.clientY - rollY0) < 8) return;
    rollDrag = true; clearTimeout(rollHold); if (rollFast) { rollAnim.playbackRate = 1; rollFast = false; }
    rollWasPaused = rollAnim.playState === 'paused'; rollAnim.pause(); rollT0 = rollAnim.currentTime; }   // from where the finger went down, so the names stay under it
  const D = rollAnim.effect.getTiming().duration;
  rollAnim.currentTime = ((rollT0 - (e.clientY - rollY0) / 32 * 1000) % D + D) % D;   // 32 px a second, as it rolls; round and round either way
};
$('roll').onpointerup = () => rollLetGo(true);
$('roll').onpointercancel = () => rollLetGo(false);   // the browser took the touch over: back to normal speed, no pause
$('roll').oncontextmenu = e => { if (rollAnim) e.preventDefault(); };   // a long press would open the menu over the credits
$('roll').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pauseRoll(); } };
let setPage = '';
function settingsPage(page) {   // '' for Settings itself, 'themes' or 'lang'
  const from = setPage; setPage = page;
  $('setMain').hidden = !!page; $('setThemes').hidden = page !== 'themes'; $('setLang').hidden = page !== 'lang'; $('setH').hidden = !!page; $('setBack').hidden = !page;
  $('dlgSettings').setAttribute('aria-labelledby', page ? page + 'H' : 'setH'); paintThemes(false); paintLang(); (page ? $(page === 'lang' ? 'setLang' : 'setThemes') : $('setMain')).scrollTop = 0;
  if (!page && from) $(from === 'lang' ? 'openLang' : 'openThemes').focus(); }
$('openThemes').onclick = () => settingsPage('themes');
$('openLang').onclick = () => settingsPage('lang');
$('setBack').onclick = () => settingsPage('');
/* Settings, Language: a page of its own. Automatic follows the device; each language is named in its own words, with what it is in the page's language under it */
const LANG_ABOUT = { en: 'English', zh: 'Chinese (Simplified)', fr: 'French' };
const langRows = [''].concat(MT.LANGS.map(l => l[0])).map(id => { const b = document.createElement('button'); b.className = 'lrow'; b.type = 'button'; b.setAttribute('role', 'radio');
  b.innerHTML = '<span class="tx"><b></b><span></span></span><svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  b.onclick = () => { if (S.lang === id) return; S.lang = id; saveS(); langChanged(); };
  const li = document.createElement('li'); li.append(b); $('langList').append(li); return [id, b]; });
const langName = id => MT.LANGS.find(l => l[0] === id)[1];
function paintLang() {
  const dev = MT.pickLang('', deviceLangs());
  for (const [id, b] of langRows) {
    const name = id ? langName(id) : tr('Automatic'), sub = id ? tr(LANG_ABOUT[id]) : tr('This device\u2019s language: {name}', { name: langName(dev) });
    b.querySelector('b').textContent = name; b.querySelector('.tx span').textContent = sub === name ? '' : sub;
    b.querySelector('.tx span').hidden = sub === name; b.setAttribute('aria-checked', String(S.lang === id)); if (id) b.querySelector('b').lang = id === 'zh' ? 'zh-CN' : id; }
  $('langSum').textContent = S.lang ? langName(S.lang) : tr('Automatic: {name}', { name: langName(dev) });
}
/* the language changed in Settings: the page's own words at once, and everything the app writes, which is drawn again */
function langChanged() {
  applyLang(); refreshSkins(); paintLang(); paintThemes(false); paintSkinBar(); paintHomeThemes(); paintCredits(); paintGoal(); paintSettingsSkin(); paintControls(); paintVersion();
  each('langChanged'); if (homeOn) renderHome(); layoutChanged();   // a theme not written for the new language leaves the swipe
}
$('openAbout').onclick = () => { $('dlgCredits').showModal(); rollCredits(true); rollHint(); };   // over Settings, which is still there when it closes
$('creditsClose').onclick = () => $('dlgCredits').close();
$('dlgCredits').addEventListener('close', () => { rollCredits(false); $('openAbout').focus(); });
$('btnSettings').onclick = () => { if (heldOpen()) return; pauseForSheet(); paintSettingsSkin(); paintGoal(); paintControls(); paintDbg(); $('dlgSettings').showModal(); settingsPage(''); };
$('setClose').onclick = () => $('dlgSettings').close();
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => {   // a tap on the backdrop closes; not on a sheet's own edge (Settings fills the screen), nor the lift of the finger that held Settings down
  const r = d.getBoundingClientRect(), out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if (e.target === d && out && !heldOpen()) d.close(); });

let testing = false;
$('btnTests').onclick = async () => {
  if (testing || session.state === 'running') return; testing = true; paintControls();
  const list = $('tests'), sum = $('testSum'); list.textContent = '';
  const tests = MT.detectionTests(A.det ? A.det.sr : 44100).concat(...TH.map(t => (t.def.tests || []).map(x => ({ name: x.name, run: () => MT.inLang('en', x.run) })))); let pass = 0;   // the themes' own after the page's
  for (let i = 0; i < tests.length; i++) {
    sum.textContent = 'Running ' + (i + 1) + ' of ' + tests.length;
    await new Promise(r => setTimeout(r, 30));
    let res; try { res = tests[i].run(); } catch (e) { res = { name: tests[i].name, got: 'error: ' + (e && e.message), pass: false }; }
    if (res.pass) pass++;
    const li = document.createElement('li'), a = document.createElement('span'), b = document.createElement('span'), c = document.createElement('span');
    a.className = 'r ' + (res.pass ? 'pass' : 'fail'); a.textContent = res.pass ? 'Pass' : 'Fail'; b.textContent = res.name; c.className = 'g'; c.textContent = res.got;
    li.appendChild(a); li.appendChild(b); li.appendChild(c); list.appendChild(li);
  }
  sum.textContent = pass + ' of ' + tests.length + ' passed'; testing = false; paintControls();
};

/* ---------- summary ---------- */
let current = null, onSheet = null;   // the session just finished { rec, note }, and the record on the summary sheet
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
/* dates and times in the page's language: English keeps the device's own format, unless the device is set to another language */
const loc = () => MT.getLang() === 'en' && !/^en\b/i.test(deviceLangs()[0]) ? 'en' : MT.locale();
const at = ms => new Date(ms).toLocaleTimeString(loc(), { hour: 'numeric', minute: '2-digit' });
const date = (ms, o) => new Date(ms).toLocaleDateString(loc(), o);
function dayName(ms) { const k = MT.dayKey(ms), now = new Date();
  return k === MT.dayKey(now) ? tr('Today') : k === MT.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) ? tr('Yesterday')
    : date(ms, { weekday: 'short', day: 'numeric', month: 'short' }); }
function showRecording() { if (!rec.blob) return; $('recBox').hidden = false;
  try { rec.url = URL.createObjectURL(rec.blob); const a = $('recAudio'); a.hidden = false; a.onerror = () => { a.hidden = true; }; a.src = rec.url; } catch (e) { $('recAudio').hidden = true; } }
/* the session just stopped: keep it in the practice log unless it was too short. Demo sound sessions are kept like any other */
function finishSession() {
  const R = MT.sessionReport(session.runs), r = MT.sessionRecord(session, R, S.name, kept());
  let note;
  if (!MT.worthKeeping(R)) note = { text: tr('Sessions with less than 10 seconds of playing are not saved to your practice log.') };
  else if (!addToLog(r)) note = { text: tr('This session could not be saved on this device.') };
  else { const P = MT.practiceStats(log, Date.now()); note = P.weekPlay > 0 ? { lead: tr('{time} of music this week.', { time: MT.durationText(P.weekPlay) }), text: tr('Saved to your practice log.') }
    : { text: tr('Saved to your practice log.') }; }   // a Sunday-night session that ran past midnight is filed under last week
  return { rec: r, note: note };
}
function openSummary(r, past) {
  const R = r.R, reached = R.play >= r.goal, T = R.total || 1, dur = MT.clockText;   // every time on the sheet comes from R, rounded down alike
  onSheet = r;
  const pct = x => Math.round(x * 100) + '%';
  $('sWhen').textContent = (past ? dayName(r.start) + ', ' : '') + at(r.start) + '\u2013' + at(r.end);
  $('sPlay').textContent = fmt(R.play); $('sCap').textContent = tr(r.name ? 'of playing, {name}' : 'of playing', { name: r.name });
  $('sEff').textContent = pct(R.efficiency);
  // the goal
  $('sGoalBox').classList.toggle('done', reached); width($('sGoalBar'), r.goal > 0 ? R.play / r.goal : 0);
  $('sGoal').textContent = tr('Goal {n} minutes', { n: Math.round(r.goal / 60) }); $('sTrophy').toggleAttribute('hidden', !reached);   // an svg, which has no .hidden
  $('sGoalLeft').textContent = reached ? tr('Reached, trophy earned') : tr('{t} to go', { t: dur(Math.ceil(r.goal - R.play)) });
  // was it saved to the practice log, and the week it adds to (only for the session just finished)
  const note = !past && current && current.rec === r ? current.note : null; $('sSaved').hidden = !note;
  if (note) $('sSaved').replaceChildren(...(note.lead ? [el('b', null, note.lead), gap()] : []), note.text);
  // the rest of its day, when it had more than one session: each session a block, this one bright. The goal is for each session, so the day is not measured against it
  const D = MT.dayRecap(log, r), L = MT.dayLine(D, Date.now()), box = $('sDayBox'); box.hidden = !L;
  if (L) {
    const today = D.key === MT.dayKey(Date.now());
    $('sDayH').textContent = tr(today ? 'Today' : 'That day');
    $('sDaySegs').replaceChildren(...D.sessions.map(x => { const i = el('i', x.id === r.id ? 'me' : ''); i.style.flexGrow = String(x.play); return i; }));
    $('sDayBar').setAttribute('aria-label', tr(today ? '{n} sessions today: {list}.' : '{n} sessions that day: {list}.', { n: D.count, list: listText(D.sessions.map(x => MT.durationText(x.play))) }));
    $('sDay').replaceChildren(el('b', null, L.lead), gap(), L.text);
  }
  // where the time went
  for (const [k, v] of [['P', R.play], ['Q', R.quiet], ['X', R.paused]]) { const i = $('sSplit' + k); i.hidden = v < 0.5; i.style.flexGrow = String(v); }
  for (const [k, v] of [['Play', R.play], ['Quiet', R.quiet], ['Paused', R.paused]]) { $('sT' + k).textContent = dur(v); $('sP' + k).textContent = pct(v / T); }
  // minute by minute: one column per step, filled with how much of it was playing, quiet and paused
  const strip = R.total >= 120, min = R.bin / 60, len = R.longest.b - R.longest.a;
  $('sStrip').hidden = !strip;
  $('sStripH').textContent = !strip ? tr('Stretches and breaks') : min === 1 ? tr('Minute by minute') : tr('Every {n} minutes', { n: min });
  if (strip) {
    $('sCols').replaceChildren(...R.columns.map(c => { const d = el('div'); d.style.flexGrow = String(c.t);
      for (const k of ['play', 'quiet', 'paused']) if (c[k] > 0) { const i = el('i', 'k-' + k); i.style.height = (c[k] / c.t * 100) + '%'; d.append(i); } return d; }));
    const third = i => R.thirds[i] == null ? tr('not measured') : pct(R.thirds[i]);
    $('sCols').setAttribute('aria-label', MT.both(tr(min === 1 ? 'Playing time in each minute.' : 'Playing time in every {n} minutes.', { n: min }),
      tr('Efficiency at the start {a}, in the middle {b}, at the end {c}.', { a: third(0), b: third(1), c: third(2) })));
    const st = $('sStretch'), sl = $('sStretchL'), a = R.longest.a / T * 100, b = R.longest.b / T * 100;
    st.hidden = sl.hidden = len < 1;
    st.style.left = a + '%'; st.style.width = Math.max(0.5, b - a) + '%'; sl.textContent = tr('Longest stretch {t}', { t: dur(len) });
    if (a < 50) { sl.style.left = a + '%'; sl.style.right = ''; } else { sl.style.left = ''; sl.style.right = (100 - b) + '%'; }
    const totalMin = R.total / 60, step = [1, 2, 5, 10, 15, 20, 30, 60].find(m => totalMin / m <= 5) || 120, ticks = [];
    for (let m = 0; m * 60 / T <= 0.94; m += step) ticks.push(m);
    $('sAxis').replaceChildren(...ticks.map((m, i) => { const x = el('span', null, i ? String(m) : tr('{m} min', { m: 0 })); x.style.left = (m * 60 / T * 100) + '%'; return x; }));
    const first = R.thirds[0];
    $('sThirds').replaceChildren(...[tr('Start|part'), tr('Middle|part'), tr('End|part')].map((w, i) => { const v = R.thirds[i], d = el('div', v != null && first != null && first - v >= 0.2 ? 'low' : '');
      d.append(el('b', null, v == null ? '\u2013' : pct(v)), w); return d; }));
  }
  const times = n => trn(n, 'once', '{n} times'), fromTo = (a, b) => tr('from {a} to {b}', { a: dur(a), b: dur(b) }), inAll = t => tr('{t} in all', { t: dur(t) }), facts = [
    [tr('Longest stretch'), len >= 1 ? dur(len) : tr('None'), len >= 1 ? fromTo(R.longest.a, R.longest.b) : tr('No playing heard')],
    R.best ? [tr('Best {n} minutes', { n: R.best.len / 60 }), tr('{pct} playing', { pct: pct(R.best.eff) }), fromTo(R.best.a, R.best.b)]
           : [tr('Short gaps'), R.gaps ? String(R.gaps) : tr('None'), R.gaps ? inAll(R.gapTime) : '\u00a0'],
    [tr('Quiet breaks over 30 s'), R.breaks ? String(R.breaks) : tr('None|breaks'), R.breaks ? inAll(R.breakTime) : '\u00a0'],
    [tr('Paused'), R.pauses ? dur(R.paused) : tr('No pauses'), R.pauses ? times(R.pauses) : '\u00a0'],
  ];
  $('sFacts').replaceChildren(...facts.map(f => { const d = el('div'), dd = el('dd', null, f[1]); dd.append(el('small', null, f[2])); d.append(el('dt', null, f[0]), dd); return d; }));
  $('recBox').hidden = past || !rec.blob;                 // recordings are not kept with saved sessions
  $('sumDelete').hidden = !past; disarm($('sumDelete'), tr('Delete session'));
  $('dlgSummary').querySelector('.sh-body').scrollTop = 0;
  if (!$('dlgSummary').open) $('dlgSummary').showModal();
}
$('sumClose').onclick = () => $('dlgSummary').close();
async function saveFile(filename, data) {
  if (downloads) { try { await downloads.save({ filename: filename, data: data }); } catch (e) { if (!e || e.code !== 'declined') toast(tr('The file could not be saved here')); } return; }
  try { const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' }), a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 8000); }
  catch (e) { toast(tr('The file could not be saved here')); }
}
function stamp() { const d = new Date(session.startedAt || Date.now()), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
$('btnSaveRec').onclick = () => { if (rec.blob) saveFile('practice-recording-' + stamp() + '.' + rec.ext, rec.blob); };

/* ---------- a session cut short: while a session runs, the session so far is kept every few seconds and whenever the app
   goes to the background. If the app is closed or iOS discards it before End, the next time it opens it offers to save it ---------- */
const LIVE_KEY = 'musicTimer.live';
let liveAt = 0, lost = null;
function writeLive() {
  if (mode !== 'local' || (session.state !== 'running' && session.state !== 'paused')) return;
  liveAt = performance.now();
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(MT.liveSnapshot(session, S.name, kept(), Date.now()))); } catch (e) {}
}
function clearLive() { try { localStorage.removeItem(LIVE_KEY); } catch (e) {} }
function readLive() { try { return JSON.parse(localStorage.getItem(LIVE_KEY) || 'null'); } catch (e) { return null; } }
function checkLost(prev) {
  const x = readLive(); if (!x || session.state === 'running' || session.state === 'paused') return;
  const age = Date.now() - (x.savedAt || 0);
  if (!prev && age >= 0 && age < 12e3) { setTimeout(() => { const y = readLive(); if (y && y.savedAt === x.savedAt) checkLost(true); }, 12e3 - age + 500); return; }   // it may still be running in another tab
  const r = MT.liveRecord(x);
  if (!r || !MT.worthKeeping(r.R) || log.some(o => o.id === r.id)) { clearLive(); return; }
  lost = r;
  $('lostP').textContent = tr('Music Timer closed during your session {when}, after {time} of playing. You can still save it to your practice log.', { when: whenText(r.start), time: MT.durationText(r.play) });
  if (!$('dlgLost').open) $('dlgLost').showModal();
}
function whenText(ms) { const k = MT.dayKey(ms), now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return tr(k === MT.dayKey(now) ? 'today at {time}' : k === MT.dayKey(y) ? 'yesterday at {time}' : 'on {date} at {time}', { date: date(ms, { weekday: 'long', day: 'numeric', month: 'long' }), time: at(ms) }); }
$('lostYes').onclick = () => { $('dlgLost').close(); clearLive(); if (!lost) return;
  toast(tr(addToLog(lost) ? 'Saved to your practice log.' : 'This session could not be saved on this device.')); lost = null; logChanged(); if (homeOn) renderHome(); };
$('lostNo').onclick = () => { $('dlgLost').close(); clearLive(); lost = null; };

/* ---------- practice log: finished sessions, kept on this device (no audio) ---------- */
const LOG_KEY = 'musicTimer.log';
function readLog() { try { const j = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (Array.isArray(j)) return j.filter(r => r && r.v === 1 && r.R && r.start > 0).map(MT.upgradeRecord).sort((a, b) => a.start - b.start); } catch (e) {} return []; }
let log = readLog(), logShown = 30;
function writeLog() {
  for (;;) { try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); return true; }
    catch (e) { const full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);   // storage full: drop the oldest fifth and try again
      if (!full || log.length < 2) return false; log.splice(0, Math.ceil(log.length / 5)); } }
}
/* what each theme keeps with the session (keep: the rocket's flight), by its id */
function kept() { const o = {}; for (const t of TH) if (t.inst.keep) { const x = t.inst.keep(); if (x != null) o[t.id] = x; } return o; }
/* the practice log changed between sessions: the themes pick up where it leaves off (restore: the rocket carries on from the day's latest session) */
function logChanged() { if (mode === 'local' && (session.state === 'idle' || session.state === 'stopped')) each('restore', log); }
/* add a session; if it cannot be written, the log stays as it was, so nothing shows that is not saved */
function addToLog(r) { const was = log; log = log.filter(x => x.id !== r.id); log.push(r); log.sort((a, b) => a.start - b.start); if (log.length > MT.LOG_MAX) log.splice(0, log.length - MT.LOG_MAX);
  if (writeLog()) return true; log = was; return false; }
/* a destructive button asks twice: the first tap arms it for a few seconds */
const said = x => typeof x === 'function' ? x() : x;   // a label, or a function that gives it in the page's language at the time
function disarm(b, label) { b.classList.remove('armed'); b.textContent = said(label); clearTimeout(b._t); }
function twoTap(b, label, armedLabel, act) { b.onclick = () => {
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = said(armedLabel); clearTimeout(b._t); b._t = setTimeout(() => disarm(b, label), 4000); return; }
  disarm(b, label); act(); }; }
twoTap($('sumDelete'), () => tr('Delete session'), () => tr('Tap again to delete'), () => {
  const id = onSheet && onSheet.id; log = log.filter(x => x.id !== id); writeLog();
  if (current && current.rec.id === id) current.note = { text: tr('Deleted from your practice log.') };
  logChanged(); $('dlgSummary').close(); if ($('dlgLog').open) renderLog(); toast(tr('Session deleted'));
});
twoTap($('logClear'), () => tr('Delete all sessions'), () => tr('Tap again to delete all'), () => { log = []; writeLog(); logChanged(); logShown = 30; renderLog(); toast(tr('All sessions deleted')); });
const compact = s => { if (s <= 0) return ''; const m = Math.round(s / 60); return m < 1 ? tr('<1m') : m < 60 ? tr('{m}m', { m: m }) : m % 60 ? tr('{h}h{mm}', { h: Math.floor(m / 60), mm: String(m % 60).padStart(2, '0') }) : tr('{h}h', { h: m / 60 }); };
const TROPHY_SVG = '<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true"><path d="M19 13H9c0 10 5 15 12 16M45 13h10c0 10-5 15-12 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path fill="currentColor" d="M18 7h28v15c0 10-6 17-14 17s-14-7-14-17zM29 38h6v9h-6zM20 49h24v9H20z"/></svg>';
const dayWhat = c => c.play > 0 ? (c.sessions > 1 ? tr('{time} in {n} sessions', { time: MT.durationText(c.play), n: c.sessions }) : MT.durationText(c.play)) : tr('no practice');
/* the week bars: this week, or one of the four before it (logBack weeks back), Monday to Sunday. Each day's bar is as tall as its playing next to
   the others (a full bar is the longest day, or 30 minutes), one block a session. The goal is for one session, so a day is not measured against it */
let logBack = 0, logP = null;
function renderWeek(P) {
  logP = P; const W = MT.weekAt(P, logBack); logBack = W.back;
  const top = Math.max(1800, ...W.days.map(c => c.play));
  $('logWeek').replaceChildren(...W.days.map(c => { const d = el('div', 'd' + (c.today ? ' today' : '') + (c.future ? ' future' : '')), bar = el('div', 'bar');
    if (c.play > 0) { const i = el('i', c.plays.length > 1 ? 'segs' : ''); i.style.height = Math.max(4, c.play / top * 100) + '%';
      if (c.plays.length > 1) for (const p of c.plays) { const b = el('b'); b.style.flexGrow = String(p); i.append(b); }
      bar.append(i); }
    d.append(el('span', 't', compact(c.play)), bar, el('span', null, date(c.date, { weekday: 'narrow' }))); return d; }));
  const name = W.back === 0 ? tr('This week') : W.back === 1 ? tr('Last week') : tr('Week of {date}', { date: date(W.days[0].date, { day: 'numeric', month: 'long' }) });
  $('logWeekH').textContent = name;
  $('logWeek').setAttribute('aria-label', tr('{week}: {list}.', { week: name, list: listText(W.days.filter(c => !c.future).map(c => tr('{day} {what}', { day: date(c.date, { weekday: 'long' }), what: dayWhat(c) }))) }));
  $('logWeekLine').textContent = W.back ? MT.pastWeekLine(W) : MT.weekLine(P);
  $('logWeekPrev').disabled = W.back >= MT.WEEKS_BACK; $('logWeekNext').disabled = W.back === 0;
}
/* to the week `back` weeks before this one; dir: the way it came (-1 an earlier week, in from the left; 1 a later one, in from the right; 0 back into place) */
function showWeek(back, dir) {
  const wk = $('logWeek'), was = logBack; logBack = Math.max(0, Math.min(MT.WEEKS_BACK, back));
  if (logBack !== was && logP) renderWeek(logP); else dir = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (dir && !still) { wk.style.transition = 'none'; wk.style.transform = 'translateX(' + dir * 40 + '%)'; wk.style.opacity = '0'; void wk.offsetWidth; }
  wk.style.transition = still ? 'none' : 'transform .26s cubic-bezier(.2,.8,.2,1), opacity .2s'; wk.style.transform = ''; wk.style.opacity = '';
}
$('logWeekPrev').onclick = () => showWeek(logBack + 1, -1);
$('logWeekNext').onclick = () => showWeek(logBack - 1, 1);
const weekSwipe = new MT.DragSwipe(), weekSec = $('logWeekSec');   // a finger or the mouse drags the bars: right to the week before, left to the week after
weekSec.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; weekSwipe.down(e.pointerId, e.clientX, e.clientY, performance.now(), $('logWeek').clientWidth); });
weekSec.addEventListener('pointermove', e => {
  if (!weekSwipe.has(e.pointerId)) return;
  if (e.pointerType === 'mouse' && !e.buttons) { weekDragEnd(e); return; }
  const was = weekSwipe.locked, dx = weekSwipe.move(e.clientX, e.clientY); if (dx == null) return;
  if (!was) try { weekSec.setPointerCapture(e.pointerId); } catch (er) {}
  const at = MT.WEEKS_BACK - logBack, w = $('logWeek').clientWidth;   // the weeks in a row, the earliest on the left: it gives a little past either end
  $('logWeek').style.transition = 'none'; $('logWeek').style.transform = 'translateX(' + (weekSwipe.offset(dx, at, MT.WEEKS_BACK + 1) + at * w) + 'px)';
});
function weekDragEnd(e) { if (e && !weekSwipe.has(e.pointerId)) return; const s = weekSwipe.up(e ? e.clientX : null, performance.now()); if (s == null) return; showWeek(logBack - s, s); }
weekSec.addEventListener('pointerup', weekDragEnd); weekSec.addEventListener('pointercancel', () => weekDragEnd(null));
weekSec.addEventListener('dragstart', e => e.preventDefault());
const weekWheel = new MT.WheelSwipe();   // a two-finger trackpad swipe over the week, one week a swipe
function renderLog() {
  const P = MT.practiceStats(log, Date.now()), empty = !log.length, pct = x => Math.round(x * 100) + '%';
  $('logEmpty').hidden = !empty; $('logMain').hidden = empty; $('logMore').hidden = empty;
  const idle = mode === 'local' && (session.state === 'idle' || session.state === 'stopped');
  $('logStart').hidden = !idle;
  $('logStart').textContent = tr(empty ? 'Start your first session' : P.practicedToday ? 'Play again' : 'Start playing');
  if (empty) return;
  // what has been played: this week, and all together. Only totals that grow, nothing that can be lost by missing a day
  const week = P.weekPlay > 0;
  $('logBig').textContent = MT.durationText(week ? P.weekPlay : P.totalPlay); $('logBigCap').textContent = tr(week ? 'of music this week' : 'of music so far');
  $('logTotalBox').hidden = !week; $('logTotal').textContent = MT.durationText(P.totalPlay); $('logNudge').textContent = MT.practiceNudge(P);
  renderWeek(P);
  // the last 12 weeks, one column a week, a month name where a month begins
  const cells = [], months = []; let lastLabel = -9, lastMonth = -1;
  P.grid.forEach((col, w) => { const m = col[0].date.getMonth();
    if (m !== lastMonth && w - lastLabel >= 3) { const sp = el('span', null, date(col[0].date, { month: 'short' })); sp.style.gridColumn = String(w + 1); months.push(sp); lastLabel = w; }
    lastMonth = m;
    for (const c of col) { const i = el('i', (c.level ? 'lv' + c.level : '') + (c.today ? ' today' : '') + (c.future ? ' future' : ''));
      if (!c.future) i.title = tr('{date}: {what}', { date: date(c.date, { weekday: 'short', day: 'numeric', month: 'short' }), what: dayWhat(c) }); cells.push(i); } });
  $('logMonths').replaceChildren(...months); $('logCal').replaceChildren(...cells);
  const all = P.grid.flat(), on = all.filter(c => c.play > 0).length;
  $('logCal').setAttribute('aria-label', tr('Practiced on {n} of the last {days} days.', { n: on, days: all.filter(c => !c.future).length }));
  [...$('logCalDays').children].forEach((d, i) => { d.textContent = i % 2 || i > 4 ? '' : date(P.grid[0][i].date, { weekday: 'narrow' }); });   // Monday, Wednesday and Friday
  // all time
  const first = log[0].start, facts = [
    [tr('Sessions'), String(P.sessions), tr('since {date}', { date: date(first, { day: 'numeric', month: 'short', year: 'numeric' }) })],
    [tr('Total playing'), MT.durationText(P.totalPlay), trn(P.daysPlayed, 'on {n} day', 'on {n} days')],
    [tr('Longest session'), MT.clockText(P.longest.play), dayName(P.longest.start)],
    [tr('Average efficiency'), pct(P.efficiency), tr('playing while the timer ran')],
  ];
  $('logTotals').replaceChildren(...facts.map(f => { const d = el('div'), dd = el('dd', null, f[1]); dd.append(el('small', null, f[2])); d.append(el('dt', null, f[0]), dd); return d; }));
  // the sessions, newest first, by day
  const list = log.slice().reverse().slice(0, logShown), groups = [], dayPlay = {}, dayN = {};
  for (const r of log) { const k = MT.dayKey(r.start); dayPlay[k] = (dayPlay[k] || 0) + r.play; dayN[k] = (dayN[k] || 0) + 1; }
  for (const r of list) { const k = MT.dayKey(r.start); if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k: k, recs: [] }); groups[groups.length - 1].recs.push(r); }
  $('logList').replaceChildren(...groups.map(g => { const d = el('div', 'log-day'), h = el('h4', null, dayName(g.recs[0].start)); h.append(el('span', null, dayN[g.k] > 1 ? tr('{n} sessions, {time}', { n: dayN[g.k], time: MT.durationText(dayPlay[g.k]) }) : MT.durationText(dayPlay[g.k])));
    d.append(h); for (const r of g.recs) { const b = el('button', 'log-row'), pl = el('div', 'pl'), big = el('b', null, MT.clockText(r.play)), mini = el('div', 'mini'), fill = el('i');
      if (r.play >= r.goal) big.insertAdjacentHTML('beforeend', TROPHY_SVG);
      fill.style.width = Math.min(100, r.goal ? r.play / r.goal * 100 : 0) + '%'; mini.append(fill); pl.append(big, mini);
      b.append(el('span', 'tm', at(r.start)), pl, el('span', 'ef', pct(r.eff)));
      b.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>');
      b.setAttribute('aria-label', tr(r.play >= r.goal ? '{day} at {time}: {play} of playing, {eff} efficiency, goal reached. Open its summary' : '{day} at {time}: {play} of playing, {eff} efficiency. Open its summary',
        { day: dayName(r.start), time: at(r.start), play: MT.durationText(r.play), eff: pct(r.eff) }));
      b.onclick = () => openSummary(r, true); d.append(b); } return d; }));
  $('logOlder').hidden = log.length <= logShown;
}
function openLog() { pauseForSheet(); logShown = 30; logBack = 0; disarm($('logClear'), tr('Delete all sessions')); renderLog(); $('dlgLog').querySelector('.sh-body').scrollTop = 0; if (!$('dlgLog').open) $('dlgLog').showModal(); }
$('logClose').onclick = () => $('dlgLog').close();
$('logOlder').onclick = () => { logShown += 30; renderLog(); };
$('logStart').onclick = () => { $('dlgLog').close(); if ($('dlgSummary').open) $('dlgSummary').close(); start(); };

/* ---------- Home Screen: shown when the app opens and after a finished session's summary is closed. Start playing goes into the chosen theme ---------- */
const homeEl = $('home');
$('homeIcon').src = document.querySelector('#top .app-icon img').src;     // the same embedded icon as the title row
const homeChips = TH.map((t, i) => { const b = el('button'); b.type = 'button';
  b.innerHTML = '<svg aria-hidden="true"><use href="#ico-' + t.id + '"/></svg>'; b.onclick = () => { if (open.includes(i)) setSkin(i, false); }; $('homeThemes').append(b); return b; });
let homeLink = null;
function paintHomeThemes() {
  homeChips.forEach((b, i) => { b.hidden = !open.includes(i); b.setAttribute('aria-pressed', String(i === skin)); b.setAttribute('aria-label', themeName(TH[i])); });
  $('homeTheme').textContent = themeName(TH[skin]);
  // the chosen theme's link after its name, if it has one (homeLink: Rocket's "Start a new flight" while today's flight carries on)
  homeLink = TH[skin].inst.homeLink ? TH[skin].inst.homeLink() : null;
  $('homeLink').hidden = !homeLink; $('homeLink').textContent = homeLink ? homeLink.text : '';
}
$('homeLink').onclick = () => { if (homeLink) homeLink.run(); };
let homeSeed = 0;                                                     // which playful words: new each time the Home Screen shows, the same while it stays
function renderHome() {
  const now = Date.now(), P = MT.practiceStats(log, now), c = MT.homeCopy(P, log.length ? log[log.length - 1] : null, now, { seed: homeSeed, name: S.name });
  // with no name set, the word for the player ("Ahoy, Captain") is the link that adds one
  $('homeHello').textContent = c.friend ? c.hello.slice(0, -c.friend.length) : c.hello;
  $('homeName').hidden = !c.friend; $('homeName').textContent = c.friend || ''; $('homeName').setAttribute('aria-label', c.friend ? tr('{friend}. Add your name', { friend: c.friend }) : '');
  $('homeHead').textContent = c.head; $('homeLede').textContent = c.lede;
  $('homeFirst').hidden = c.kind !== 'first'; $('homeWeek').hidden = c.kind === 'first';
  if (c.kind !== 'first') {
    const week = P.weekPlay > 0;
    $('homeBig').hidden = !week; $('homeTime').textContent = MT.durationText(P.weekPlay);
    $('homeFresh').hidden = week; $('homeFresh').textContent = c.fresh || '';
    $('homeDots').hidden = !week;
    // today's sessions, when there has been more than one: each opens its summary
    const todays = log.filter(r => MT.dayKey(r.start) === P.today.key); $('homeToday').hidden = todays.length < 2;
    $('homeSess').replaceChildren(...(todays.length < 2 ? [] : todays.map(r => { const b = el('button', null, at(r.start)); b.type = 'button'; b.append(el('b', null, MT.durationText(r.play)));
      b.setAttribute('aria-label', tr('Session at {time}, {play} of playing. Open its summary', { time: at(r.start), play: MT.durationText(r.play) })); b.onclick = () => openSummary(r, true); return b; })));
    $('homeDots').replaceChildren(...P.week.map(d => { const w = el('div', d.today ? 't' : ''); w.append(el('i', d.play > 0 ? 'on' : ''), date(d.date, { weekday: 'narrow' })); return w; }));
    $('homeDots').setAttribute('aria-label', tr('Days with music this week: {list}.', { list: listText(P.week.filter(d => d.play > 0).map(d => date(d.date, { weekday: 'long' }))) || tr('none yet') }));
    $('homeNote').textContent = c.note || '';
  }
  $('homeGo').textContent = tr(c.kind === 'today' ? 'Play again' : 'Start playing');
  paintHomeThemes();
}
function showHome() {
  if (mode === 'follow' || session.state === 'running' || session.state === 'paused') return;
  homeSeed = 1 + Math.floor(Math.random() * 2e9); renderHome(); homeEl.hidden = false; homeOn = true; app.inert = true; checkVersion();
}
function hideHome() { if (!homeOn) return; homeEl.hidden = true; homeOn = false; app.inert = false; layoutChanged(); }
$('homeGo').onclick = () => { hideHome(); start(); };
$('homeLog').onclick = openLog;
$('homeSet').onclick = () => $('btnSettings').click();
$('homeName').onclick = () => { $('btnSettings').click(); const n = $('nameIn'); try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } n.scrollIntoView({ block: 'center' }); };   // straight to the name, keyboard up
// back to the Home Screen once a finished session's summary is put away (not when going on to the practice log)
$('dlgSummary').addEventListener('close', () => { if (homeOn) renderHome(); else if (session.state === 'stopped' && !$('dlgLog').open) showHome(); });   // a session deleted from its summary
$('dlgSettings').addEventListener('close', () => { if (homeOn) renderHome(); resumeAfterSheet(); });   // a new name shows in the greeting
$('dlgLog').addEventListener('close', () => { if (homeOn) renderHome(); resumeAfterSheet(); });     // sessions deleted from the log

/* ---------- debug tools, for the developer only: sample data, a detector read-out, where the rocket starts, and shortcuts ---------- */
let dbgAt = 0, holdT = 0, held = false, holdXY = null;
/* holding any Settings button for half a second opens the debug tools; the click that ends the hold does not open Settings too */
function heldOpen() { const h = held; held = false; return h; }
document.addEventListener('pointerdown', () => { if (!holdT) held = false; }, true);   // a hold that ended without a click is forgotten at the next touch
for (const b of [$('btnSettings'), $('homeSet')]) {
  const cancel = () => { clearTimeout(holdT); holdT = 0; };
  b.addEventListener('pointerdown', e => { held = false; holdXY = [e.clientX, e.clientY]; cancel();
    holdT = setTimeout(() => { holdT = 0; held = true; try { if (navigator.vibrate) navigator.vibrate(12); } catch (er) {} openDebug(); }, 500); });
  b.addEventListener('pointermove', e => { if (holdT && holdXY && Math.hypot(e.clientX - holdXY[0], e.clientY - holdXY[1]) > 12) cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, cancel);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
function openDebug() {
  if ($('dlgDebug').open) return;
  if ($('dlgSettings').open) $('dlgSettings').close();
  pauseForSheet(); if (!DBG.on) { DBG.on = true; saveDbg(); }
  dbgView(false); paintDbg(); updSource(); $('dlgDebug').showModal();
}
/* the debug sheet's two pages: the tools, and the sound tests */
function dbgView(tests) {
  $('dbgMain').hidden = tests; $('dbgTests').hidden = !tests; $('dbgBack').hidden = !tests;
  $('dbgH').textContent = tests ? 'Sound tests' : 'Debug tools'; $('dlgDebug').querySelector('.sh-body').scrollTop = 0;
}
$('dbgOpenTests').onclick = () => dbgView(true);
$('dbgBack').onclick = () => dbgView(false);
$('dbgClose').onclick = () => $('dlgDebug').close();
$('setDebug').onclick = openDebug;
$('dlgDebug').addEventListener('close', () => { if (homeOn) renderHome(); resumeAfterSheet(); });
function paintDbg() {
  $('setDebugRow').hidden = !DBG.on; $('dbgRead').hidden = !(DBG.on && DBG.readout);
  if (!DBG.on) return;
  const c = $('dbgSample'); c.textContent = '';
  for (const [k, label] of MT.SAMPLE_LOGS) { const b = el('button', null, label); b.type = 'button'; c.append(b);   // asks twice: it replaces the saved log
    twoTap(b, label, 'Tap again to replace', () => setSample(k, label)); }
  // each theme's own tools (debugTools: where the next session's rocket starts), and any theme that did not install or start
  const box = $('dbgThemes'); box.textContent = '';
  for (const t of TH) if (t.inst.debugTools) { const f = el('div', 'field'); box.append(f); t.inst.debugTools(f); }
  if (themeErrors.length) { const f = el('div', 'field'); f.append(el('span', 'lab', 'Themes that did not start'), el('p', 'hint', themeErrors.join(' '))); box.append(f); }
  $('dbgReadIn').checked = DBG.readout;
}
/* replace the saved practice log with a sample one. From then on it is the practice log: sessions are added to it and the rocket carries on from it */
function setSample(k, label) { log = MT.sampleLog(k, Date.now()); each('sampleLog', log); logShown = 30;
  if (!writeLog()) { log = readLog(); toast('The sample log could not be saved on this device'); return; }
  logChanged(); if (homeOn) renderHome(); toast('Your practice log is now \u201c' + label + '\u201d'); }
function dbgFrame(ms) {
  if (ms > 0 && ms < 1000) DBG.fps = DBG.fps ? DBG.fps * 0.9 + 100 / ms : 1000 / ms;
  const now = performance.now(); if (now - dbgAt < 250) return; dbgAt = now;
  const r = session.state === 'running' && A.det ? DBG.r : null, f1 = v => (+v).toFixed(1);
  $('dbgRead').textContent = [
    Math.round(DBG.fps) + ' fps  ' + (A.kind || 'no input') + (A.det ? ' ' + A.det.sr + ' Hz' : '') + '  ' + session.state + (mode === 'follow' ? ' (following)' : ''),
    r ? 'level ' + f1(r.levelDb) + ' dB' + (r.active ? '' : ' (too soft)') + '  pitch ' + (r.pitch > 0 ? Math.round(r.pitch) + ' Hz ' + r.note : 'none') : 'not listening',
    r ? 'score ' + f1(r.score) + '  ' + (r.isMusic ? 'music, ' + r.instrument : r.kind) : '',
    'play ' + fmt(session.play) + ' of ' + fmt(session.active) + (session.holdLeft > 0 ? '  hold ' + f1(session.holdLeft) + ' s' : ''),
  ].concat(TH.map(t => t.inst.debugLine ? t.inst.debugLine() : '')).filter(Boolean).join('\n');   // a line from each theme that has one
}
$('dbgReadIn').onchange = () => { DBG.readout = $('dbgReadIn').checked; saveDbg(); paintDbg(); };
$('dbgTrophy').onclick = () => { $('dlgDebug').close(); hideHome(); award(session.goal || S.goalMin * 60); };
$('dbgHome').onclick = () => { $('dlgDebug').close(); showHome(); };
$('dbgSave').onclick = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  saveFile('music-timer-log-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json', JSON.stringify(readLog())); };
$('dbgOff').onclick = () => { DBG.on = false; DBG.readout = false; each('debugTools', null); if (S.source === 'demo') setSource('mic');
  saveDbg(); paintDbg(); logChanged(); hideNotice('mic'); $('dlgDebug').close(); };

/* ---------- go ---------- */
each('restore', log); refreshSkins(); paintGoal(); paintControls(); paintDemoBar(); paintDbg(); showHome(); checkLost();
try { if (sessionStorage.getItem('musicTimer.updated')) { sessionStorage.removeItem('musicTimer.updated'); toast(tr('Music Timer has been updated.')); } } catch (e) {}
function paintVersion() { const b = document.querySelector('meta[name="build"]'); $('ver').textContent = tr('Version {n}', { n: b && b.content && b.content.indexOf('__') < 0 ? b.content : 'dev' }); }
paintVersion();
if (S.source === 'mic' && (micPolicyBlocked() || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia))
  micNotice(framed ? MIC_FRAMED() : micMessage({ name: window.isSecureContext === false ? 'Insecure' : 'Unsupported' }));
requestAnimationFrame(t => { lastF = t; frame(t); });
window.__mt = { session: session, themes: TH, errors: themeErrors, A: A, S: S, V: V, start: start, stop: stop };
})();
