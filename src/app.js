(function () {
'use strict';
const MT = window.MT, $ = id => document.getElementById(id), app = $('app');
const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmt(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0'); }
const cache = new Map();
function text(el, s) { if (cache.get(el) !== s) { cache.set(el, s); el.textContent = s; } }
function width(el, f) { const s = Math.round(Math.max(0, Math.min(1, f)) * 1000) / 10 + '%'; if (cache.get(el) !== s) { cache.set(el, s); el.style.width = s; } }

/* ---------- settings ---------- */
const DEF = { v: 2, goalMin: 30, name: '', sens: 'normal', rocketEff: 'session', record: false, source: 'mic', skin: 'classic', viz: 'piano', inst: '', hudCompact: false };
const S = Object.assign({}, DEF);
try { const j = JSON.parse(localStorage.getItem('musicTimer.settings') || 'null');
  if (j && typeof j === 'object') { for (const k in DEF) if (typeof j[k] === typeof DEF[k]) S[k] = j[k];
    if (j.v !== 2 && S.goalMin === 20) S.goalMin = 30; }          // settings saved before the default changed: the old default of 20 moves to 30 once
  S.v = 2; } catch (e) {}
if (!(S.goalMin >= 5 && S.goalMin <= 180)) S.goalMin = 30;
function saveS() { try { localStorage.setItem('musicTimer.settings', JSON.stringify(S)); } catch (e) {} }

/* ---------- model ---------- */
const session = new MT.Session(); session.goal = S.goalMin * 60;
const sim = new MT.RocketSim();
const rocket = makeRocketView($('rk'), $('hud'), sim, MT);
const city = makeCityView($('pCity'));
const dash = new MT.DashSim(), dashView = makeDashView($('dashCv'), $('dashHud'), dash, MT), onsets = new MT.OnsetTracker();
let pendingOnsets = 0, onsetN = 0, dashAt = 0;      // note starts waiting to be used; a running count for followers; when the course last moved
const NB = 44, bars = new Float32Array(NB), shown = new Float32Array(NB);
const heard = { label: '', detail: '', note: '', midi: null };      // midi: the pitch heard, as a (fractional) piano key number
let mode = 'local';            // 'local' | 'follow'
let music = false, goalHit = false, vote = {}, kbInst = S.inst;
/* what the screen shows, filled from the local session or from the device being followed */
const V = { st: 'idle', play: 0, active: 0, total: 0, pauses: 0, goal: session.goal, eff: 0, pw: 0, music: false, label: '', detail: '', note: '', midi: null, inst: '' };

/* ---------- platform capabilities (all optional) ---------- */
let room = null, downloads = null;
if (window.claude && typeof window.claude.use === 'function') {
  try {
    window.claude.use('room').then(r => { if (!r) return; room = r; try { r.onPeers(onPeers, () => { room = null; }); } catch (e) {} }, () => {});
    window.claude.use('downloads').then(d => { downloads = d || null; }, () => {});
  } catch (e) {}
}

/* ---------- messages ---------- */
let toastT = 0, bannerT = 0, noticeKind = '', noticeFn = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }
function banner(msg) { const b = $('rBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 3600); }
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
drawPixelTrophy($('rTrophy')); drawPixelTrophy($('awardPx')); drawPixelTrophy($('yTrophy'));
let awardT = 0;
function goalText(goal) { return Math.round(goal / 60) + '-minute'; }
function award(goal) {
  $('awardSub').textContent = 'You reached your ' + goalText(goal) + ' practice goal.';
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
    if (track) track.onended = () => { if (session.state === 'running' || session.state === 'paused') showNotice('mic', 'The microphone stopped. End the session and start again to reconnect it.', '', null); };
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
const MIC_FRAMED = 'The microphone is not available inside this Claude view. Use the demo sound here, or open the standalone Music Timer file in a browser to time real playing.';
function micMessage(e) {
  const n = e && e.name;
  if (n === 'Insecure') return 'The microphone only works on a secure address (https) or on localhost. You can try the demo sound instead.';
  if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'Unsupported') {
    if (framed) return MIC_FRAMED;
    return n === 'Unsupported' ? 'This browser cannot use the microphone. You can try the demo sound instead.'
      : iOS ? 'Microphone access was not allowed. Open the Settings app, go to Apps, choose this browser and turn on Microphone, then press Start again.'
      : 'Microphone access was not allowed. Allow the microphone for this page in the browser settings, then press Start again.';
  }
  if (n === 'NotFoundError') return 'No microphone was found on this device. You can try the demo sound instead.';
  if (n === 'NotReadableError') return 'Another app is using the microphone. Close it and press Start again.';
  return 'The microphone could not be started' + (n ? ' (' + n + ')' : '') + '. You can try the demo sound instead.';
}
function useDemoAction() { setSource('demo'); hideNotice('mic'); }

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
  } catch (e) { rec.mr = null; toast('Recording is not available here'); }
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
    showNotice('mic', micMessage(e), 'Use demo sound', () => { useDemoAction(); start(); }); return; }
  busy = false; hideNotice();
  session.goal = S.goalMin * 60; session.start(); sim.reset(); rocket.reset(); city.reset(); cityBannerAt = 0;
  dash.reset(); dashView.reset(); onsets.reset(); pendingOnsets = 0;
  music = false; goalHit = false; vote = {}; bars.fill(0); hideAward();
  heard.label = 'Listening'; heard.detail = 'Play your instrument to start the clock'; heard.note = ''; heard.midi = null;
  startRecording();
  lastT = performance.now(); clearInterval(timer); timer = setInterval(tick, 46);
  keepAwake(); paintControls(); push(true);
}
function pause() { if (!session.pause()) return; dash.mark(); music = false; recCall('pause'); paintControls(); push(true); }
function resume() { if (!session.resume()) return; if (A.ctx && A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); if (A.det) { A.det.score = 0; A.det.isMusic = false; } recCall('resume'); lastT = performance.now(); paintControls(); push(true); }
function stop() {
  if (!session.stop()) return;
  clearInterval(timer); timer = 0; music = false; recCall('stop'); rec.mr = null; hideAward();
  const demo = A.kind === 'demo';
  closeAudio(); letSleep(); paintControls(); push(true);
  current = finishSession(demo); openSummary(current.rec, false);
}

function tick() {
  const now = performance.now(), dt = (now - lastT) / 1000; if (!(dt > 0)) return; lastT = now;
  const w = A.kind === 'demo' ? A.warp : 1;
  let m = false;
  if (session.state === 'running') {
    const f = getFrame(dt);
    if (f) { const r = A.det.process(f, Math.min(dt, 1));
      m = r.isMusic && dt < 1.5;                 // a long gap means the page was asleep: no credit
      heard.label = r.label; heard.detail = r.detail; heard.note = r.note; heard.midi = r.pitch > 0 ? 69 + 12 * Math.log2(r.pitch / 440) : null; levelBars();
      if (onsets.feed(dt, { music: m, midi: heard.midi, levelDb: r.levelDb })) { pendingOnsets++; onsetN++; }
      if (A.kind === 'mic' && A.ctx && A.ctx.state !== 'running') { m = false; heard.label = 'The microphone is asleep'; heard.detail = 'Press Pause, then Resume to wake it'; heard.note = ''; heard.midi = null; }
      if (m && r.instrument) vote[r.instrument] = (vote[r.instrument] || 0) + dt; }
    let best = '', bs = 0; for (const k in vote) { vote[k] *= Math.exp(-dt / 25); if (vote[k] > bs) { bs = vote[k]; best = k; } }
    if (best && best !== kbInst && bs >= 1.2 && bs > (vote[kbInst] || 0) * 1.25 + 0.4) { kbInst = best; S.inst = best; saveS(); }
  }
  music = m;
  session.tick(dt * w, m);
  const pw = S.rocketEff === 'recent' ? session.recentEfficiency : session.efficiency;
  sim.update(dt * w, { running: session.state === 'running', playing: m, eff: pw, rdt: dt });
  if (!goalHit && session.play >= session.goal) { goalHit = true; award(session.goal); }
  if (now - dashAt > 250) dashStep(dt, session.state === 'running', m, pw, session.goal > 0 ? session.play / session.goal : 0);   // frames are not being drawn (tab in the background): keep the course moving
  if (now - lastPush > 330) push(false);
}

/* ---------- following another device ---------- */
let followPeer = '', R = null, followDismissed = false, offerPeer = '';
function push(force) {
  lastPush = performance.now(); if (!room || mode !== 'local') return;
  let br = ''; for (let i = 0; i < NB; i++) br += Math.min(9, Math.floor(bars[i] * 10));
  const r1 = v => Math.round(v * 10) / 10;
  const o = { st: session.state, pl: r1(session.play), ac: r1(session.active), to: r1(session.total), pa: session.pauses, go: session.goal,
    pw: Math.round(V.pw * 1000) / 1000, mu: music ? 1 : 0, lb: heard.label, dt: heard.detail, nt: heard.note, pm: heard.midi != null ? Math.round(heard.midi * 10) / 10 : -1, iv: kbInst, on: onsetN, br: br,
    rm: sim.mode, rl: Math.round(sim.l * 1e5) / 1e5, rs: sim.stage, ri: sim.ignited ? 1 : 0, rf: r1(sim.fp), ra: Math.round(sim.th * 100) / 100, rc: Math.round(sim.spinUp * 100) / 100, nm: S.name };
  try { room.presence({ mt: session.state === 'idle' ? null : o }).catch(() => {}); } catch (e) {}
}
function parseRemote(x) {
  if (!x || typeof x !== 'object') return null;
  const st = ['running', 'paused', 'stopped'].indexOf(x.st) >= 0 ? x.st : ''; if (!st) return null;
  const n = (v, max) => typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  const s = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  return { st: st, play: n(x.pl, 1e6), active: n(x.ac, 1e6), total: n(x.to, 1e6), pauses: Math.round(n(x.pa, 999)), goal: n(x.go, 1e6) || 1800,
    pw: n(x.pw, 1), music: x.mu === 1, label: s(x.lb, 60), detail: s(x.dt, 80), note: s(x.nt, 4), midi: typeof x.pm === 'number' && x.pm > 0 && x.pm < 130 ? x.pm : null, inst: s(x.iv, 12), on: Math.round(n(x.on, 1e9)), bars: typeof x.br === 'string' && /^[0-9]{44}$/.test(x.br) ? x.br : '',
    rm: ['pad', 'ascent', 'fall', 'orbit'].indexOf(x.rm) >= 0 ? x.rm : 'pad', rl: n(x.rl, sim.L), rs: Math.min(2, Math.round(n(x.rs, 2))), ri: x.ri === 1,
    rf: n(x.rf, 1e6), ra: typeof x.ra === 'number' && isFinite(x.ra) ? Math.max(-4, Math.min(4, x.ra)) : 0, rc: n(x.rc, 1), name: s(x.nm, 40) };
}
function onPeers(ch) {
  const peers = ch && ch.peers || [];
  if (mode === 'follow') {
    let cur = null; for (const p of peers) if (p.peer === followPeer) cur = p;
    const m = cur && parseRemote(cur.presence && cur.presence.mt);
    if (m) applyRemote(m); else if (R && R.st !== 'stopped') { R.st = 'stopped'; R.music = false; R.label = 'The session has ended'; R.detail = ''; paintControls(); }
    return;
  }
  let best = null;
  for (const p of peers) { if (p.sameTab || p.kind === 'agent') continue; const m = parseRemote(p.presence && p.presence.mt);
    if (m && m.st !== 'stopped' && (!best || p.updatedAt > best.updatedAt)) best = p; }
  const idle = session.state === 'idle' || session.state === 'stopped';
  if (best && idle && !followDismissed) { if (offerPeer !== best.peer || noticeKind !== 'follow') { offerPeer = best.peer;
    showNotice('follow', 'A practice session is live on another device.', 'Follow', () => startFollow(offerPeer)); } }
  else if (!best) { offerPeer = ''; followDismissed = false; hideNotice('follow'); }
  else if (!idle) hideNotice('follow');
}
function applyRemote(m) {
  const first = !R, prev = R; R = m;
  if (prev && prev.play < prev.goal && m.play >= m.goal && m.st === 'running') award(m.goal);
  if (first) { sim.reset(); rocket.reset(); city.reset(); dash.reset(); dashView.reset(); pendingOnsets = 0; sim.l = m.rl; sim.th = m.ra; }
  else if (m.on > prev.on) pendingOnsets += Math.min(3, m.on - prev.on);
  else {
    if (prev.rm === 'pad' && m.rm === 'ascent') fire('liftoff');
    if (m.rm === 'ascent' && prev.rf < MT.MILESTONES.tower && m.rf >= MT.MILESTONES.tower) fire('tower');
    if (m.rm === 'ascent' && prev.rf < MT.MILESTONES.space && m.rf >= MT.MILESTONES.space) fire('space');
    if (prev.rm === 'ascent' && m.rm === 'fall') fire('fall');
    if (prev.rm === 'fall' && m.rm === 'pad') { fire('crash'); sim.down = 2.6; sim.l = 0; }
    if (prev.rm !== 'orbit' && m.rm === 'orbit') { fire('orbit'); sim.th = m.ra; }
    if (prev.rc === 0 && m.rc > 0) fire('spin');
    if (m.rs > prev.rs) fire(m.rs === 1 ? 'stage1' : 'stage2');
    if (prev.st !== m.st) paintControls();
  }
  sim.mode = m.rm; sim.stage = m.rs; sim.ignited = m.ri && m.st === 'running'; sim.power = m.pw; sim.fp = m.rf; sim.spinUp = m.rm === 'orbit' ? m.rc : 0; sim.inSpace = m.rm === 'orbit' || (m.rm === 'ascent' && m.rf >= MT.MILESTONES.space);
  if (m.rm === 'orbit') { let d = m.ra - sim.th; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(d) > 0.5) sim.th = m.ra; }
  for (let i = 0; i < NB; i++) bars[i] = m.bars ? (m.bars.charCodeAt(i) - 48) / 9 : 0;
}
function startFollow(peer) {
  if (!room || !peer || session.state === 'running' || session.state === 'paused') return;
  mode = 'follow'; followPeer = peer; R = null; hideNotice(); $('dlgSummary').open && $('dlgSummary').close();
  onPeers({ peers: room.peers() }); if (!R) { stopFollow(); return; }
  paintControls(); paintDemoBar();
}
function stopFollow() { hideAward(); mode = 'local'; followPeer = ''; R = null; sim.reset(); rocket.reset(); city.reset(); dash.reset(); dashView.reset(); bars.fill(0); session.reset(); paintControls(); paintDemoBar(); }
function followStep(dt) {
  if (!R) return;
  if (R.st === 'running') { R.total += dt; R.active += dt; if (R.music) R.play += dt; } else if (R.st === 'paused') R.total += dt;
  sim.l += (R.rl - sim.l) * Math.min(1, dt * 4);
  if (sim.down > 0) sim.down -= dt;
  if (sim.mode === 'orbit' && R.st === 'running') { sim.th += sim.wOrbit * dt; sim.spin(dt); }
}

/* ---------- rocket events ---------- */
const EVENT_TEXT = { ignition: 'Engines lit', liftoff: 'Lift-off!', tower: 'Tower cleared', stage1: 'Stage 1 separation', space: 'You have left the atmosphere',
  stage2: 'Stage 2 separation', orbit: 'Moon orbit reached!', spin: 'Module spinning', fall: 'Engines out. Falling!', crash: 'The rocket exploded!' };
function fire(e) { if (EVENT_TEXT[e]) banner(EVENT_TEXT[e]); rocket.event(e); }

/* ---------- screen ---------- */
const clockEl = $('cClock'); let clockTxt = '';
function clock(t) {
  if (t === clockTxt) return;
  if (t.length !== clockTxt.length) { clockEl.textContent = ''; for (const ch of t) { const s = document.createElement('span'); s.className = ch === ':' ? 'c' : 'd'; s.textContent = ch; clockEl.appendChild(s); } }
  else for (let i = 0; i < t.length; i++) if (t[i] !== clockTxt[i]) clockEl.children[i].textContent = t[i];
  clockTxt = t;
}
const NEXT = [['tower', 'Clearing the tower'], ['stage1', 'Stage 1 separation'], ['space', 'Leaving the atmosphere'], ['stage2', 'Stage 2 separation'], ['orbit', 'Moon orbit']];
function paint() {
  if (mode === 'follow' && R) { V.st = R.st; V.play = R.play; V.active = R.active; V.total = R.total; V.pauses = R.pauses; V.goal = R.goal;
    V.eff = R.active > 0 ? Math.min(1, R.play / R.active) : 0; V.pw = R.pw; V.music = R.music && R.st === 'running'; V.label = R.label; V.detail = R.detail; V.note = R.note; V.midi = R.midi; V.inst = R.inst; }
  else { V.st = session.state; V.play = session.play; V.active = session.active; V.total = session.total; V.pauses = session.pauses;
    V.goal = session.state === 'idle' ? S.goalMin * 60 : session.goal; V.eff = session.efficiency;
    V.pw = S.rocketEff === 'recent' ? session.recentEfficiency : session.efficiency; V.music = music; V.label = heard.label; V.detail = heard.detail; V.note = heard.note; V.midi = heard.midi; V.inst = kbInst; }
  const st = V.st, fol = mode === 'follow';
  if (app.dataset.music !== (V.music ? '1' : '0')) app.dataset.music = V.music ? '1' : '0';
  const won = V.st !== 'idle' && V.play >= V.goal ? '1' : '0'; if (app.dataset.goal !== won) app.dataset.goal = won;

  let status, label = V.label, detail = V.detail, note = st === 'running' ? V.note : '';
  if (st === 'idle') { status = 'Ready when you are'; label = 'Press Start, then play'; detail = 'The timer only counts while an instrument is heard.'; }
  else if (st === 'running') status = V.music ? 'Counting: music heard' : 'Waiting for music';
  else if (st === 'paused') { status = 'Paused'; label = 'Not listening'; detail = 'Sound is ignored until you resume.'; }
  else { status = 'Session finished'; label = fol ? 'The session has ended' : 'Nicely done'; detail = fol ? '' : 'Start again whenever you like.'; }
  if (fol) status = 'Following live' + (R && R.name ? ' (' + R.name + ')' : '') + ': ' + status.toLowerCase();

  const play = fmt(V.play), effTxt = Math.round(V.eff * 100) + '%', reached = V.play >= V.goal && st !== 'idle';
  clock(play); text($('cTenths'), '.' + Math.floor(V.play * 10) % 10);
  text($('cMic'), st === 'running' ? (V.music ? 'Music' : fol ? 'Live' : S.source === 'demo' ? 'Demo' : 'Listening') : st === 'paused' ? 'Paused' : 'Mic off');
  text($('cStatus'), status); text($('cHeard'), label); text($('cDetail'), detail); text($('cNote'), note);
  text($('cEff'), (V.eff * 100).toFixed(1) + '%'); width($('cEffBar'), V.eff);
  text($('cGoalV'), fmt(V.goal)); text($('cGoal'), reached ? '' : fmt(Math.ceil(V.goal - V.play)) + ' left'); text($('cGoalK'), reached ? 'Goal reached' : 'Practice goal'); width($('cGoalBar'), V.play / V.goal);
  text($('cActive'), fmt(V.active));
  text($('cTotal'), fmt(V.total)); text($('cPauses'), V.pauses === 1 ? '1 pause' : V.pauses + ' pauses');

  const rp = $('rPlay'), rpc = play.length > 5 ? 'big long' : 'big'; text(rp, play); if (rp.className !== rpc) rp.className = rpc;
  text($('rActive'), fmt(V.active)); text($('rGoal'), fmt(V.goal)); text($('rGoalLeft'), reached ? 'Reached' : fmt(Math.ceil(V.goal - V.play)) + ' left'); text($('rTotal'), fmt(V.total)); text($('rPauses'), String(V.pauses));
  const km = sim.kmAt(sim.l); text($('rAltK'), km < 1 ? 'Alt m' : 'Alt km'); text($('rAlt'), km < 1 ? String(Math.round(km * 1000)) : km < 100 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US'));
  const pwEl = $('rPw'), cls = V.pw >= MT.LIFTOFF ? 'go' : ''; width(pwEl, V.pw); if (pwEl.className !== cls) pwEl.className = cls;
  text($('rPwN'), Math.round(V.pw * 100) + '%');
  text($('rHeard'), st === 'running' ? label : st === 'paused' ? 'Paused: not listening' : st === 'idle' ? 'Press Start, then play' : 'Session finished');
  let next = '';
  if (st === 'idle') next = 'Power follows efficiency';
  else if (sim.mode === 'pad') next = sim.down > 0 ? 'Rolling out a new rocket' : !fol && sim.ignited && sim.hold > 0 ? 'Lift-off in ' + Math.max(1, Math.ceil(3 - sim.hold)) : 'Lift-off at ' + Math.round(MT.LIFTOFF * 100) + '% engine power';
  else if (sim.mode === 'fall') next = 'Falling back to Earth';
  else if (sim.mode === 'orbit') next = sim.spinUp > 0 ? 'In Moon orbit, module spinning' : 'In orbit around the Moon';
  else if (V.pw < 0.5) next = 'Engine below 50%: drifting';
  else if (st === 'running' && !V.music && !sim.inSpace) next = 'Losing power: falls below 50%';
  else if (st === 'running' && !V.music) next = 'Losing power. Keep playing';
  else for (const n of NEXT) { const at = MT.MILESTONES[n[0]]; if (sim.fp < at) { next = n[1] + ' in ' + fmt(Math.ceil(at - sim.fp)); break; } }
  text($('rNext'), next);
  if (visible(2)) paintCity(st, fol, label);
  if (visible(3)) paintDash(st, label);
}
/* dash theme */
function dashStep(dt, running, mus, eff, progress) { const on = pendingOnsets; pendingOnsets = 0; dashAt = performance.now(); dash.update(Math.min(0.1, dt), { running: running, music: mus, eff: eff, onsets: on, progress: progress }); }
function dashResult() { const pct = Math.min(100, Math.floor(dash.progress * 100)), a = dash.attempts; return (dash.done ? 'Level complete in ' : pct + '% in ') + a + (a === 1 ? ' attempt' : ' attempts'); }
let dBannerT = 0;
function dashBanner(msg) { const b = $('dBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(dBannerT); dBannerT = setTimeout(() => b.classList.remove('on'), 3200); }
function paintDash(st, label) {
  const p = V.goal > 0 ? V.play / V.goal : 0, playTxt = fmt(V.play), el = $('dPlay'), cls = playTxt.length > 5 ? 'big long' : 'big', reached = st !== 'idle' && V.play >= V.goal;
  text(el, playTxt); if (el.className !== cls) el.className = cls;
  width($('dBar'), p); text($('dPct'), Math.min(100, Math.floor(p * 100)) + '%');
  text($('dGoal'), fmt(V.goal)); text($('dGoalLeft'), reached ? 'Reached' : fmt(Math.ceil(V.goal - V.play)) + ' left'); text($('dPauses'), String(V.pauses));
  text($('dAtt'), String(dash.attempts)); text($('dJumps'), String(dash.jumps)); text($('dSpeed'), dash.tag); text($('dPw'), Math.round(V.pw * 100) + '%');
  text($('dHeard'), st === 'running' ? label : st === 'paused' ? 'Paused: not listening' : st === 'idle' ? 'Press Start, then play' : 'Session finished');
  let hint;
  if (st === 'idle') hint = 'Play to run the course';
  else if (st === 'paused') hint = 'Paused: checkpoint saved';
  else if (st === 'stopped') hint = dashResult();
  else if (dash.mode === 'crash' || dash.mode === 'wait') hint = 'Crashed. Play to try again';
  else if (dash.mode === 'idle') hint = 'Play to start running';
  else if (dash.silentT > 0) hint = 'Keep playing! Spike in ' + Math.max(1, Math.ceil(MT.DASH.GRACE - dash.silentT));
  else hint = dash.done ? 'Level complete! Bonus run' : 'Every new note is a jump';
  text($('dHint'), hint);
}
/* city theme read-outs */
const CITY_TEXT = { impact: 'Impact!', building: 'A building was hit', cannonLost: 'A cannon was hit', cannonBack: 'Cannon repaired', rebuilt: 'Building rebuilt' };
let cityBannerAt = 0, cityBannerT = 0, cityWasArmed = false;
function cityBanner(msg, force) { const now = performance.now(); if (!force && now - cityBannerAt < 2500) return; cityBannerAt = now;
  const b = $('yBanner'); b.textContent = msg; b.classList.add('on'); clearTimeout(cityBannerT); cityBannerT = setTimeout(() => b.classList.remove('on'), 2600); }
function paintCity(st, fol, label) {
  const cs = city.stats, armed = st === 'running' && V.music;
  while (city.events.length) { const e = city.events.shift(); if (CITY_TEXT[e]) cityBanner(CITY_TEXT[e], e === 'cannonBack' || e === 'rebuilt'); }
  if (armed && !cityWasArmed && st === 'running') cityBanner('Cannons firing'); cityWasArmed = armed;
  const playTxt = fmt(V.play), playEl = $('yPlay'), longCls = playTxt.length > 5 ? 'big long' : 'big'; text(playEl, playTxt); if (playEl.className !== longCls) playEl.className = longCls;
  text($('yDown'), String(cs.down)); text($('yImp'), String(cs.imp));
  text($('yBld'), city.ready ? cs.standing + '/' + cs.total : '-');
  const can = $('yCan'), cc = cs.cannons === 3 ? 'ok' : cs.cannons === 0 ? 'bad' : ''; text(can, cs.cannons + '/3'); if (can.className !== cc) can.className = cc;
  const pw = $('yPw'), pc = V.pw >= 0.8 ? 'go' : V.pw >= 0.5 ? 'ok' : ''; width(pw, V.pw); if (pw.className !== pc) pw.className = pc; text($('yPwN'), Math.round(V.pw * 100) + '%');
  const reached = st !== 'idle' && V.play >= V.goal;
  text($('yGoal'), fmt(V.goal)); text($('yGoalLeft'), reached ? 'Reached' : fmt(Math.ceil(V.goal - V.play)) + ' left'); text($('yPauses'), String(V.pauses));
  text($('yHeard'), st === 'running' ? label : st === 'paused' ? 'Paused: not listening' : st === 'idle' ? 'Press Start, then play' : 'Session finished');
  let hint;
  if (st === 'idle') hint = 'Play to defend the city';
  else if (st === 'paused') hint = 'Paused: the sky is frozen';
  else if (st === 'stopped') hint = cs.down + ' shot down, ' + cs.imp + (cs.imp === 1 ? ' impact' : ' impacts');
  else if (!V.music) hint = 'Cannons silent. Play to fire';
  else if (city.next) hint = (city.next.what === 'cannon' ? 'Cannon back in ' : 'Next rebuild in ') + fmt(Math.ceil(city.next.left)) + ' of play';
  else hint = 'Cannons firing';
  text($('yHint'), hint);
  const msg = $('yMsg'), m = city.failed ? 'The 3D city could not load. It needs an internet connection.' : !city.ready ? 'Building the city\u2026' : '';
  if (msg.hidden !== !m) msg.hidden = !m; if (m) text(msg, m);
}
function drawCity(dt) { if (!city.ready) { city.ensure(); return; } city.frame(dt, { running: V.st === 'running', music: V.music, power: V.pw }); }
function paintControls() {
  const st = mode === 'follow' ? 'follow' : session.state;
  app.dataset.state = st;
  $('btnStart').hidden = !(st === 'idle' || st === 'stopped'); $('btnStart').textContent = st === 'stopped' ? 'New session' : 'Start';
  $('btnSummary').hidden = st !== 'stopped';
  $('btnPause').hidden = st !== 'running'; $('btnResume').hidden = st !== 'paused'; $('btnStop').hidden = !(st === 'running' || st === 'paused');
  $('btnUnfollow').hidden = st !== 'follow';
  const lock = st === 'running' || st === 'paused' || st === 'follow';
  for (const b of $('segSource').children) b.disabled = lock;
  $('btnTests').disabled = st === 'running' || testing;
}
$('btnStart').onclick = start; $('btnPause').onclick = pause; $('btnResume').onclick = resume; $('btnStop').onclick = stop;
$('btnUnfollow').onclick = stopFollow; $('btnSummary').onclick = () => { if (current) openSummary(current.rec, false); };

/* ---------- classic sound pictures: tap the picture to change it ----------
   piano       - the notes you play rise as bars from a keyboard, the key under each one lit
   spectrogram - the full spectrum over the last few seconds on a musical scale: the note and every overtone as bright lines
   trail       - the melody drawn as a line across a treble staff
   waterfall   - a scrolling picture of the overtones: clean stripes for an instrument, smears for talking and noise
   halo        - a ring of bars around the note name */
const VIZ = [['piano', 'Piano roll'], ['spectrogram', 'Spectrogram'], ['trail', 'Pitch trail'], ['waterfall', 'Harmonic waterfall'], ['halo', 'Halo']];
const viz = $('viz'), vg = viz.getContext('2d'), vizBox = $('vizBox');
let COL = { rule: '#2C3A4F', mute: '#7C8AA1', accent: '#86DCC0', ink: '#F4F7FB' }, colN = 0, vizI = Math.max(0, VIZ.findIndex(v => v[0] === S.viz)), vizNameT = 0, lastSwipe = 0;
function setViz(i, announce) {
  vizI = ((i % VIZ.length) + VIZ.length) % VIZ.length; S.viz = VIZ[vizI][0]; saveS();
  vizBox.setAttribute('aria-label', 'Sound picture: ' + VIZ[vizI][1] + '. Tap to change');
  if (announce) { const n = $('vizName'); n.textContent = VIZ[vizI][1]; n.classList.add('on'); clearTimeout(vizNameT); vizNameT = setTimeout(() => n.classList.remove('on'), 1700); }
}
vizBox.addEventListener('click', () => { if (performance.now() - lastSwipe > 400) setViz(vizI + 1, true); });
vizBox.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViz(vizI + 1, true); } });
setViz(vizI, false);

/* what was played, kept for the pictures that show time: a pitch history, and whole notes for the piano roll */
const hist = [], notes = [], sparks = []; let vt = 0, curKey = null, candKey = null, candT = 0;
function trackNotes(dt) {
  vt += dt; const live = V.st === 'running', m = live && V.midi != null ? V.midi : null, mu = live && V.music;
  hist.push({ t: vt, m: m, mu: mu }); while (hist.length && vt - hist[0].t > 6) hist.shift();
  let k = mu && m != null ? Math.round(m) : null;
  if (k != null && curKey != null && Math.abs(m - curKey) < 0.7) k = curKey;          // vibrato does not break a note in two
  if (k === curKey) { candKey = k; candT = 0; }
  else { if (k !== candKey) { candKey = k; candT = 0; } candT += dt;
    if (candT >= (k == null ? 0.09 : 0.05)) { if (curKey != null && notes.length) notes[notes.length - 1].t1 = vt; curKey = k; if (k != null) notes.push({ k: k, t0: vt, t1: -1 }); } }
  while (notes.length && notes[0].t1 > 0 && vt - notes[0].t1 > 8) notes.shift();
}
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); const n = m ? parseInt(m[1], 16) : 0x86DCC0; return [n >> 16, (n >> 8) & 255, n & 255]; };
function rrect(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else g.rect(x, y, w, h); }

/* piano roll, after the falling-note piano videos: a dark stage, glowing bars, a lit key, a blue glow along the keyboard */
/* The keyboard fits the instrument that has been heard: its whole range and nothing more, so the keys are as wide as they can be.
   Sounding ranges, as piano key numbers (middle C = 60). A note played outside the range stretches the keyboard to reach it. */
const RANGES = { Violin: [55, 100], Cello: [36, 81], Flute: [60, 96], Clarinet: [50, 94], Piano: [21, 108] }, ANY_RANGE = [36, 96];
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0], WIDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], KEYN = ['C', 'C\u266F', 'D', 'E\u266D', 'E', 'F', 'F\u266F', 'G', 'A\u266D', 'A', 'B\u266D', 'B'];
const pc = k => ((k % 12) + 12) % 12, whiteU = k => 7 * Math.floor(k / 12) + WIDX[pc(k)], keyName = k => KEYN[pc(k)] + (Math.floor(k / 12) - 1);
let kbLo = whiteU(ANY_RANGE[0]), kbHi = whiteU(ANY_RANGE[1]) + 1, kbShown = null, kbEnds = ANY_RANGE;
function fitKeyboard(dt) {
  const inst = RANGES[V.inst] ? V.inst : '', r = RANGES[inst] || ANY_RANGE; let lo = r[0], hi = r[1];
  for (const n of notes) if (n.t1 < 0 || vt - n.t1 < 3.4) { if (n.k < lo) lo = n.k; if (n.k > hi) hi = n.k; }      // every note still on the stage stays in view
  lo = Math.max(12, lo); hi = Math.min(120, hi); if (BLACK[pc(lo)]) lo--; if (BLACK[pc(hi)]) hi++;
  const tLo = whiteU(lo), tHi = whiteU(hi) + 1, f = kbShown === null || reduceMotion ? 1 : Math.min(1, dt * 5);
  kbLo += (tLo - kbLo) * f; kbHi += (tHi - kbHi) * f; kbEnds = [lo, hi];
  if (kbShown !== inst) { if (kbShown !== null && inst && VIZ[vizI][0] === 'piano') { const n = $('vizName'); n.textContent = inst + ' keyboard, ' + keyName(r[0]) + ' to ' + keyName(r[1]); n.classList.add('on'); clearTimeout(vizNameT); vizNameT = setTimeout(() => n.classList.remove('on'), 2600); }
    kbShown = inst; }
}
/* where a key sits across the picture: white keys one unit wide, black keys on the line between two whites */
function keyBox(k, ww) { const u = whiteU(k); return BLACK[pc(k)] ? { x: (u + 1 - kbLo) * ww, w: Math.max(3, ww * 0.62), black: true } : { x: (u + 0.5 - kbLo) * ww, w: ww, black: false }; }
function drawPiano(w, h, dt) {
  fitKeyboard(dt);
  // keys in a piano's proportions, 5.5 times as long as they are wide, but no more than 40% of the picture, so the notes keep room to fall
  const g = vg, ww = w / (kbHi - kbLo), kbH = Math.max(14, Math.min(ww * 5.5, h * 0.4)), top = h - kbH, speed = top / 3.2, lit = curKey != null ? curKey : -1;
  g.save(); rrect(g, 0, 0, w, h, 10); g.clip();
  g.fillStyle = '#080D15'; g.fillRect(0, 0, w, h);
  for (const n of notes) { const yB = n.t1 < 0 ? top : top - (vt - n.t1) * speed, yT = Math.max(-6, top - (vt - n.t0) * speed); if (yB < 0) continue;
    const b = keyBox(n.k, ww), bw = Math.max(4, b.w * (b.black ? 1 : 0.74));
    g.fillStyle = COL.accent; g.globalAlpha = 0.92; rrect(g, b.x - bw / 2, yT, bw, Math.max(3, yB - yT), 3); g.fill();
    g.globalAlpha = 0.9; g.strokeStyle = '#E3FFF5'; g.lineWidth = 1; rrect(g, b.x - bw / 2 + 0.5, yT + 0.5, bw - 1, Math.max(2, yB - yT - 1), 3); g.stroke(); }
  g.globalAlpha = 1;
  if (top > 40) { g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = COL.mute; g.textBaseline = 'alphabetic';                // the lowest and highest notes on the keyboard
    g.textAlign = 'left'; g.fillText(keyName(kbEnds[0]), 6, top - 16); g.textAlign = 'right'; g.fillText(keyName(kbEnds[1]), w - 6, top - 16); g.textAlign = 'start'; }
  const glow = g.createLinearGradient(0, top - 12, 0, top); glow.addColorStop(0, 'rgba(60,130,255,0)'); glow.addColorStop(1, 'rgba(60,130,255,0.5)');
  g.fillStyle = glow; g.fillRect(0, top - 12, w, 12); g.fillStyle = '#5B9BFF'; g.fillRect(0, top - 1, w, 2);
  const gap = ww > 5 ? 1 : 0.5, u0 = Math.floor(kbLo) - 1, u1 = Math.ceil(kbHi) + 1, litU = lit >= 0 && !BLACK[pc(lit)] ? whiteU(lit) : -1;
  // white keys shaded under the glow line and rounded at the near end; black keys with a lighter front edge
  const ivory = g.createLinearGradient(0, top, 0, h); ivory.addColorStop(0, '#CDD5E0'); ivory.addColorStop(Math.min(0.5, 10 / kbH), '#EEF2F7'); ivory.addColorStop(1, '#F8FAFC');
  const end = (x, y, bw, bh, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, bw, bh, [0, 0, r, r]); else g.rect(x, y, bw, bh); g.fill(); };
  const rW = Math.min(4, ww * 0.12), bH = kbH * 0.62, lip = Math.max(1, Math.min(5, bH * 0.07));
  for (let u = u0; u <= u1; u++) { g.fillStyle = u === litU ? COL.accent : ivory; end((u - kbLo) * ww + gap / 2, top + 1, ww - gap, kbH - 1, rW); }
  const kA = 12 * Math.floor(u0 / 7) - 1, kZ = 12 * Math.ceil(u1 / 7) + 12;
  for (let k = kA; k <= kZ; k++) if (BLACK[pc(k)]) { const b = keyBox(k, ww); if (b.x < -b.w || b.x > w + b.w) continue;
    g.fillStyle = k === lit ? COL.accent : '#0B1019'; end(b.x - b.w / 2, top + 1, b.w, bH, rW * 0.6);
    if (k !== lit) { g.fillStyle = '#323C4E'; g.fillRect(b.x - b.w / 2 + 1, top + 1 + bH - lip - 1, b.w - 2, lip); } }
  if (lit >= 0) { const b = keyBox(lit, ww);                                               // where the note meets the key: a flash and a few sparks
    g.fillStyle = COL.accent; g.globalAlpha = 0.35; g.beginPath(); g.arc(b.x, top, 11, 0, 7); g.fill();
    g.fillStyle = '#FFFFFF'; g.globalAlpha = 0.95; g.beginPath(); g.arc(b.x, top, 4.5, 0, 7); g.fill(); g.globalAlpha = 1;
    if (!reduceMotion && Math.random() < dt * 40 && sparks.length < 40) sparks.push({ x: b.x + (Math.random() - 0.5) * 8, y: top - 2, vx: (Math.random() - 0.5) * 46, vy: -18 - Math.random() * 46, t: 0, life: 0.45 + Math.random() * 0.45 }); }
  for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.t += dt; if (s.t >= s.life) { sparks.splice(i, 1); continue; }
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 30 * dt; g.globalAlpha = 1 - s.t / s.life; g.fillStyle = i % 3 ? COL.accent : '#FFFFFF'; g.fillRect(s.x, s.y, 1.6, 1.6); }
  g.globalAlpha = 1; g.restore();
}

function drawTrail(w, h) {
  const g = vg, y = m => Math.max(5, Math.min(h - 5, h - (m - 46) / 40 * h)), head = w - 48, pps = head / 4.5;
  g.fillStyle = COL.rule; for (const m of [64, 67, 71, 74, 77]) g.fillRect(0, Math.round(y(m)), w, 1);
  g.lineCap = 'round';
  for (let i = 1; i < hist.length; i++) { const a = hist[i - 1], b = hist[i], x = head - (vt - b.t) * pps; if (x < -4) continue;
    if (a.mu && b.mu && a.m != null && b.m != null) { g.strokeStyle = COL.accent; g.globalAlpha = 0.3 + 0.7 * Math.max(0, x / head); g.lineWidth = 3; g.beginPath(); g.moveTo(head - (vt - a.t) * pps, y(a.m)); g.lineTo(x, y(b.m)); g.stroke(); }
    else if (b.m != null) { g.fillStyle = COL.mute; g.globalAlpha = 0.5 * Math.max(0, x / head); g.fillRect(x - 1, y(b.m) - 1, 2, 2); } }
  g.globalAlpha = 1; const last = hist[hist.length - 1];
  if (last && last.mu && last.m != null) { const hy = y(last.m); g.fillStyle = COL.accent; g.beginPath(); g.arc(head, hy, 5, 0, 7); g.fill();
    g.font = '800 15px Inter, system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(V.note || '', head + 10, Math.max(10, Math.min(h - 10, hy))); }
}

/* spectrogram: one column per detector frame (46 ms), taken from the detector's full power spectrum, about 11 Hz per bin.
   Rows run from 60 Hz to 6 kHz on a log scale, so each octave gets the same height, like the keyboard. Colour follows the
   loudest recent sound over a 70 dB range, so a quiet microphone still shows its overtones while silence stays dark.
   A device following a session has no spectrum, only the 44 shared level bands, so it draws its columns from those. */
const SG_ROWS = 192, SG_COLS = 150, SG_LO = 60, SG_HI = 6000, SG_DT = 0.046, SG_RANGE = 70;
const sgCv = document.createElement('canvas'); sgCv.width = SG_COLS; sgCv.height = SG_ROWS;
const sgG = sgCv.getContext('2d'), sgCol = sgG.createImageData(1, SG_ROWS), sgV = new Float32Array(SG_ROWS);
let sgAt = 0, sgAcc = 0, sgRef = -40, sgInit = false;
const SG_LUT = (function () {                                   // near black, violet, magenta, orange, yellow, then pale yellow: each step louder is a new colour
  const stops = [[0, 0x080D15], [0.18, 0x2A1260], [0.38, 0x7A1FA2], [0.56, 0xD8327E], [0.72, 0xFF6A3D], [0.87, 0xFFC23A], [1, 0xFFF6C8]], lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) { const t = i / 255; let j = 0; while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, c0] = stops[j], [t1, c1] = stops[j + 1], u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let k = 0; k < 3; k++) { const sh = 16 - 8 * k, a = (c0 >> sh) & 255, b = (c1 >> sh) & 255; lut[i * 3 + k] = Math.round(a + (b - a) * u); } }
  return lut;
})();
const sgY = (f, h) => h * (1 - Math.log(f / SG_LO) / Math.log(SG_HI / SG_LO));   // where a frequency sits in a picture h high
function sgColumn(live) {
  if (!live) sgV.fill(0);
  else if (A.det && mode !== 'follow') {
    const P = A.det.P, bh = A.det.binHz, top = P.length - 2, step = Math.pow(SG_HI / SG_LO, 1 / SG_ROWS); let peak = -200;
    for (let r = 0, f0 = SG_LO; r < SG_ROWS; r++, f0 *= step) {
      const x0 = f0 / bh, x1 = f0 * step / bh; let p;
      if (x1 - x0 < 1) { const x = Math.min(top, (x0 + x1) / 2), k = Math.floor(x), u = x - k; p = P[k] * (1 - u) + P[k + 1] * u; }   // low notes: between two bins
      else { p = 0; for (let k = Math.floor(x0), e = Math.min(top, Math.ceil(x1)); k <= e; k++) if (P[k] > p) p = P[k]; }          // high notes: the strongest bin in the row
      const d = 10 * Math.log10(p + 1e-20); sgV[r] = d; if (d > peak) peak = d; }
    sgRef = Math.max(peak, sgRef - 0.15, -40);                      // follows a louder sound at once and a quieter one by about 3 dB a second
    for (let r = 0; r < SG_ROWS; r++) { const v = (sgV[r] - sgRef + SG_RANGE) / SG_RANGE; sgV[r] = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, 1.25); }
  } else {
    const L = Math.log(5000 / 70), step = Math.pow(SG_HI / SG_LO, 1 / SG_ROWS);
    for (let r = 0, f = SG_LO * Math.sqrt(step); r < SG_ROWS; r++, f *= step) {
      const x = NB * Math.log(f / 70) / L - 0.5, k = Math.floor(x), u = x - k;
      const a = k >= 0 && k < NB ? bars[k] : 0, b = k + 1 >= 0 && k + 1 < NB ? bars[k + 1] : 0; sgV[r] = Math.pow(a + (b - a) * u, 1.3); }
  }
  const d = sgCol.data;
  for (let r = 0; r < SG_ROWS; r++) { const o = (SG_ROWS - 1 - r) * 4, c = Math.round(sgV[r] * 255) * 3; d[o] = SG_LUT[c]; d[o + 1] = SG_LUT[c + 1]; d[o + 2] = SG_LUT[c + 2]; d[o + 3] = 255; }
  sgG.putImageData(sgCol, sgAt, 0); sgAt = (sgAt + 1) % SG_COLS;
}
function drawSpectrogram(w, h, dt) {
  const g = vg;
  if (!sgInit) { sgInit = true; sgG.fillStyle = '#080D15'; sgG.fillRect(0, 0, SG_COLS, SG_ROWS); }
  sgAcc += dt; let n = 0; while (sgAcc >= SG_DT && n++ < 8) { sgAcc -= SG_DT; sgColumn(V.st === 'running'); } if (sgAcc > 0.5) sgAcc = 0;
  g.save(); rrect(g, 0, 0, w, h, 10); g.clip(); g.imageSmoothingEnabled = true;
  const cw = w / (SG_COLS - 1), x0 = -sgAcc / SG_DT * cw, a = SG_COLS - sgAt;          // oldest column on the left; slides a little each frame so the scroll is smooth
  g.drawImage(sgCv, sgAt, 0, a, SG_ROWS, x0, 0, a * cw, h);
  if (sgAt > 0) g.drawImage(sgCv, 0, 0, sgAt, SG_ROWS, x0 + a * cw, 0, sgAt * cw, h);
  g.font = '11px Inter, system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const oct = sgY(SG_LO, h) - sgY(2 * SG_LO, h), every = oct < 22 ? 2 : 1;                 // a short picture labels every other C
  for (let o = 2; o <= 8; o++) { const y = Math.round(sgY(440 * Math.pow(2, (12 * (o + 1) - 69) / 12), h)) + 0.5; if (y < 8 || y > h - 6) continue;   // each C, from C2 up
    g.fillStyle = 'rgba(244,247,251,.08)'; g.fillRect(0, y, w, 1);
    if (o % every === 0) { g.shadowColor = 'rgba(8,13,21,.95)'; g.shadowBlur = 4; g.fillStyle = COL.mute; g.fillText('C' + o, 6, y - 7); g.shadowBlur = 0; } }
  g.shadowColor = 'rgba(8,13,21,.95)'; g.shadowBlur = 4;                                         // labels stay readable over bright overtones
  if (V.st === 'running' && V.music && V.midi != null) {                                        // the note being played, at the right edge
    const f = 440 * Math.pow(2, (V.midi - 69) / 12), y = sgY(f, h);
    if (y > 4 && y < h - 4) { g.fillStyle = COL.accent; g.beginPath(); g.moveTo(w - 2, y - 6); g.lineTo(w - 10, y); g.lineTo(w - 2, y + 6); g.closePath(); g.fill();
      if (V.note) { g.font = '800 13px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(V.note, w - 14, Math.max(9, Math.min(h - 9, y))); } }
  }
  g.restore();
}

const WCOLS = 180, wcv = document.createElement('canvas'); wcv.width = WCOLS; wcv.height = NB;
const wg = wcv.getContext('2d'), wimg = wg.createImageData(WCOLS, NB); let wAcc = 0, wInit = false;
function drawWaterfall(w, h, dt) {
  const d = wimg.data, bg = [20, 29, 43], ac = hexRgb(COL.accent), gr = hexRgb(COL.mute), hi = [244, 247, 251], live = V.st === 'running';
  if (!wInit) { wInit = true; for (let i = 0; i < d.length; i += 4) { d[i] = bg[0]; d[i + 1] = bg[1]; d[i + 2] = bg[2]; d[i + 3] = 255; } }
  wAcc += dt; let n = 0;
  while (wAcc >= 1 / 40 && n++ < 6) { wAcc -= 1 / 40;
    for (let r = 0; r < NB; r++) { const row = r * WCOLS * 4, o = row + (WCOLS - 1) * 4, v = live ? bars[NB - 1 - r] : 0; d.copyWithin(row, row + 4, row + WCOLS * 4);
      let c0 = bg, c1 = gr, u = Math.min(1, v * 1.25);
      if (V.music) { if (v < 0.6) { c1 = ac; u = v / 0.6; } else { c0 = ac; c1 = hi; u = Math.min(1, (v - 0.6) / 0.4); } }
      d[o] = c0[0] + (c1[0] - c0[0]) * u; d[o + 1] = c0[1] + (c1[1] - c0[1]) * u; d[o + 2] = c0[2] + (c1[2] - c0[2]) * u; } }
  if (wAcc > 0.2) wAcc = 0;
  wg.putImageData(wimg, 0, 0);
  const g = vg; g.save(); rrect(g, 0, 0, w, h, 10); g.clip(); g.imageSmoothingEnabled = true; g.drawImage(wcv, 0, 0, w, h);
  if (h > 56) { g.font = '11px Inter, system-ui, sans-serif'; g.fillStyle = COL.mute; g.textBaseline = 'middle';
    for (const f of [[200, '200 Hz'], [1000, '1 kHz'], [3000, '3 kHz']]) g.fillText(f[1], 6, h - Math.log(f[0] / 70) / Math.log(5000 / 70) * h); }
  g.restore();
}

function drawHalo(w, h) {
  const g = vg, cx = w / 2, cy = h / 2, r0 = Math.max(10, h * 0.25), maxLen = Math.max(4, h / 2 - r0 - 3);
  g.strokeStyle = COL.rule; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, Math.max(4, r0 - 5), 0, 7); g.stroke();
  g.lineCap = 'round'; g.lineWidth = Math.max(2, Math.min(3.5, h / 40)); g.strokeStyle = V.music ? COL.accent : COL.mute; g.globalAlpha = V.music ? 1 : 0.6;
  for (let i = 0; i < NB; i++) { const a = -Math.PI / 2 + i / NB * 2 * Math.PI, len = 2 + shown[i] * maxLen, c = Math.cos(a), s = Math.sin(a);
    g.beginPath(); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * (r0 + len), cy + s * (r0 + len)); g.stroke(); }
  g.globalAlpha = 1;
  if (V.music && V.note && r0 > 16) { g.fillStyle = COL.accent; g.font = '800 ' + Math.round(Math.min(24, r0 * 0.8)) + 'px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(V.note, cx, cy + 1); g.textAlign = 'start'; }
}

function drawViz(dt) {
  trackNotes(dt);
  const w = viz.clientWidth, h = viz.clientHeight; if (w < 10 || h < 10) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.round(w * dpr), chh = Math.round(h * dpr);
  if (viz.width !== cw || viz.height !== chh) { viz.width = cw; viz.height = chh; }
  if (colN-- <= 0) { colN = 40; const cs = getComputedStyle(app), v = (n, f) => cs.getPropertyValue(n).trim() || f;
    COL = { rule: v('--rule', COL.rule), mute: v('--mute-2', COL.mute), accent: v('--accent', COL.accent), ink: v('--ink', COL.ink) }; }
  vg.setTransform(dpr, 0, 0, dpr, 0, 0); vg.clearRect(0, 0, w, h);
  const live = V.st === 'running', a = Math.min(1, dt * 16);
  for (let i = 0; i < NB; i++) shown[i] += ((live ? bars[i] : 0) - shown[i]) * a;
  const kind = VIZ[vizI][0];
  if (kind === 'piano') drawPiano(w, h, dt); else if (kind === 'spectrogram') drawSpectrogram(w, h, dt); else if (kind === 'trail') drawTrail(w, h); else if (kind === 'waterfall') drawWaterfall(w, h, dt); else drawHalo(w, h);
}

let lastF = 0;
function frame(t) {
  const dt = Math.min(0.1, Math.max(0, (t - lastF) / 1000)); lastF = t;
  if (mode === 'follow') followStep(dt);
  while (sim.events.length) fire(sim.events.shift());
  paint();
  if (visible(0)) drawViz(dt);
  if (visible(1)) rocket.draw({ running: V.st === 'running', playing: V.music, power: V.pw }, dt);
  if (visible(2)) drawCity(dt);
  dashStep(dt, V.st === 'running', V.music, V.pw, V.goal > 0 ? V.play / V.goal : 0);
  let geo = null;
  if (visible(3)) { let lv = 0; for (let i = 0; i < NB; i++) lv += bars[i]; geo = dashView.draw({ running: V.st === 'running', music: V.music, level: Math.min(1, lv / NB * 2.2) }, dt); }
  while (dash.events.length) { const e = dash.events.shift(); if (geo) dashView.event(e, geo); if (e === 'complete' && skin === 3) dashBanner('Level complete!'); }
  requestAnimationFrame(frame);
}

/* ---------- themes: swipe (touch, mouse drag or trackpad) or arrow keys ---------- */
const SKINS = ['classic', 'rocket', 'city', 'dash'], SKIN_NAMES = ['Classic', 'Rocket', 'City', 'Dash'], PANELS = ['pClassic', 'pRocket', 'pCity', 'pDash'], stage = $('stage'), track = $('track');
let skin = Math.max(0, SKINS.indexOf(S.skin)), dragging = false, drag = null, peek = -1;   // peek: the theme a swipe is pulling into view
/* Whether a theme can be chosen yet. Every theme is open for now; to hold one back until a condition is met, return false for it here
   and call refreshSkins() when the condition changes. A locked theme keeps its icon in the theme bar (faint, with a padlock) but leaves the swipe
   track, so swipes, arrow keys and the bar all skip it. Classic is always open, so there is somewhere to land. */
function skinOpen(i) { return true; }
let open = [];   // indices of the open themes, in swipe order
function refreshSkins() {
  open = SKINS.map((_, i) => i).filter(i => i === 0 || skinOpen(i));
  PANELS.forEach((id, i) => { $(id).hidden = !open.includes(i); });
  track.style.width = open.length * 100 + '%';
  setSkin(open.includes(skin) ? skin : 0, false);
}
function stepSkin(d) { const p = open.indexOf(skin) + d; return open[Math.max(0, Math.min(open.length - 1, p))]; }   // the next open theme that way, or the same one at either end
/* Only the theme on screen is drawn, plus the one a swipe is revealing. Each scene is costly (City is WebGL), so drawing every theme while a finger is down made swipes lag. */
function visible(i) { return i === skin || (dragging && i === peek); }
function setSkin(i, animate) {
  skin = i; app.dataset.skin = SKINS[i]; app.dataset.chrome = i === 0 ? 'clean' : 'pixel'; S.skin = SKINS[i]; saveS();
  if (i === 2) city.ensure();
  track.style.transition = animate && !reduceMotion ? 'transform .3s cubic-bezier(.2,.8,.2,1)' : 'none';
  track.style.transform = 'translateX(' + (-open.indexOf(i) * 100 / open.length) + '%)';
  PANELS.forEach((id, j) => { $(id).inert = j !== i; });
  paintSkinBar();
  layoutChanged();
}
/* The theme bar: each theme's icon (the #ico-<theme> symbols in the page), the current one lit. Tapping an icon goes to that theme. */
const skinBar = $('skinBar');
SKINS.forEach((id, i) => { const b = document.createElement('button'); b.type = 'button';
  b.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#ico-' + id + '"/></svg><svg class="lk" aria-hidden="true"><use href="#ico-lock"/></svg>';
  b.onclick = () => { if (open.includes(i) && i !== skin) setSkin(i, true); }; skinBar.appendChild(b); });
function paintSkinBar() {
  [...skinBar.children].forEach((b, i) => {
    const locked = !open.includes(i), on = i === skin;
    b.disabled = locked; b.dataset.state = locked ? 'locked' : on ? 'on' : 'off';
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    b.setAttribute('aria-label', SKIN_NAMES[i] + ' theme' + (locked ? ', locked' : '')); b.title = SKIN_NAMES[i] + (locked ? ' (locked)' : '');
  });
}
/* Event banners sit just under the read-outs, clear of the scene: each panel gets --hud-b, the bottom of its read-outs, for the CSS to use */
function layoutChanged() { requestAnimationFrame(() => { rocket.resize(); city.resize(); dashView.resize();
  for (const [p, h] of [['pRocket', 'hud'], ['pCity', 'cityHud'], ['pDash', 'dashHud']]) { const el = $(h); $(p).style.setProperty('--hud-b', el.offsetTop + el.offsetHeight + 'px'); } }); }
stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId, w: stage.clientWidth, lock: false, t: performance.now() }; });
stage.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.lock) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) { drag.lock = true; dragging = true; try { stage.setPointerCapture(drag.id); } catch (er) {} rocket.resize(); } else { if (Math.abs(dy) > 14) drag = null; return; } }
  peek = stepSkin(dx < 0 ? 1 : -1);
  const end = -(open.length - 1) * drag.w; let x = -open.indexOf(skin) * drag.w + dx; if (x > 0) x *= 0.3; if (x < end) x = end + (x - end) * 0.3;
  track.style.transition = 'none'; track.style.transform = 'translateX(' + x + 'px)';
});
function endDrag(e) {
  if (!drag || (e && e.pointerId !== drag.id)) return; const d = drag; drag = null; if (!d.lock) return; dragging = false; lastSwipe = performance.now();
  const dx = (e ? e.clientX : d.x) - d.x, fast = performance.now() - d.t < 350 && Math.abs(dx) > 40;
  let i = skin; if (dx < 0 && (dx < -d.w * 0.25 || fast)) i = stepSkin(1); else if (dx > 0 && (dx > d.w * 0.25 || fast)) i = stepSkin(-1);
  setSkin(i, true);
}
stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', () => endDrag(null));
stage.addEventListener('dragstart', e => e.preventDefault());   // a native drag would cancel the pointer stream mid-swipe
const wheel = new MT.WheelSwipe();   // a two-finger trackpad swipe arrives as horizontal wheel events: one theme per swipe, however quickly they follow
document.addEventListener('wheel', e => {   // the whole page: on a computer the pointer is often over the theme bar or beside the column
  if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;   // pinch zoom; mostly vertical: Classic and the sheets scroll
  const row = e.target.closest && e.target.closest('#demoClips');
  if (row && (e.deltaX > 0 ? row.scrollLeft + row.clientWidth < row.scrollWidth - 1 : row.scrollLeft > 0)) return;   // the row of demo sounds scrolls sideways while it can
  e.preventDefault();   // also stops the browser reading it as back/forward, which would leave the page and lose the session
  if (row || document.querySelector('dialog[open]')) return;   // no theme change over the demo sounds or behind an open sheet
  const now = performance.now(), d = wheel.feed({ t: e.timeStamp || now, now: now, drawn: lastF, dx: e.deltaX * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientWidth : 1) });
  if (d) setSkin(stepSkin(d), true);
}, { passive: false });
document.addEventListener('keydown', e => { if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') setSkin(stepSkin(1), true); else if (e.key === 'ArrowLeft') setSkin(stepSkin(-1), true); });
window.addEventListener('resize', layoutChanged);
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') return;
  if (session.state === 'running' || session.state === 'paused') keepAwake();
  if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume().catch(() => {}); });

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
seg('segEff', 'rocketEff');
function paintGoal() { $('goalOut').textContent = S.goalMin + ' min'; }
function bumpGoal(d) { S.goalMin = Math.max(5, Math.min(180, S.goalMin + d)); saveS(); paintGoal(); if (session.state === 'running' || session.state === 'paused') { session.goal = S.goalMin * 60; if (session.play < session.goal) { goalHit = false; hideAward(); } } }
$('goalDn').onclick = () => bumpGoal(-5); $('goalUp').onclick = () => bumpGoal(5);
$('nameIn').value = S.name; $('nameIn').oninput = () => { S.name = $('nameIn').value.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '').slice(0, 40); saveS(); };
$('recIn').checked = S.record; $('recIn').onchange = () => { S.record = $('recIn').checked; saveS(); };
$('btnSettings').onclick = () => { paintGoal(); paintControls(); $('dlgSettings').showModal(); };
$('btnSettings2').onclick = () => $('btnSettings').click();          // on phones the Rocket and City themes keep Settings beside the buttons
$('setClose').onclick = () => $('dlgSettings').close();
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });

let testing = false;
$('btnTests').onclick = async () => {
  if (testing || session.state === 'running') return; testing = true; paintControls();
  const list = $('tests'), sum = $('testSum'); list.textContent = '';
  const tests = MT.detectionTests(A.det ? A.det.sr : 44100); let pass = 0;
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
const at = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayName(ms) { const k = MT.dayKey(ms), now = new Date();
  return k === MT.dayKey(now) ? 'Today' : k === MT.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)) ? 'Yesterday'
    : new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }); }
function showRecording() { if (!rec.blob) return; $('recBox').hidden = false;
  try { rec.url = URL.createObjectURL(rec.blob); const a = $('recAudio'); a.hidden = false; a.onerror = () => { a.hidden = true; }; a.src = rec.url; } catch (e) { $('recAudio').hidden = true; } }
/* the session just stopped: keep it in the practice log unless it was a demo or too short */
function finishSession(demo) {
  const R = MT.sessionReport(session.runs), r = MT.sessionRecord(session, R, S.name);
  let note;
  if (demo) note = { text: 'Demo sessions are not saved to your practice log.' };
  else if (!MT.worthKeeping(R)) note = { text: 'Sessions with less than 10 seconds of playing are not saved to your practice log.' };
  else if (!addToLog(r)) note = { text: 'This session could not be saved on this device.' };
  else { const P = MT.practiceStats(log, Date.now()); note = { lead: MT.durationText(P.weekPlay) + ' of music this week.', text: 'Saved to your practice log.' }; }
  return { rec: r, note: note };
}
function openSummary(r, past) {
  const R = r.R, reached = R.play >= r.goal, T = R.total || 1, dur = MT.clockText;   // every time on the sheet comes from R, rounded down alike
  onSheet = r;
  const pct = x => Math.round(x * 100) + '%';
  $('sWhen').textContent = (past ? dayName(r.start) + ', ' : '') + at(r.start) + '\u2013' + at(r.end);
  $('sPlay').textContent = fmt(R.play); $('sCap').textContent = 'of playing' + (r.name ? ', ' + r.name : '');
  $('sEff').textContent = pct(R.efficiency);
  // the goal
  $('sGoalBox').classList.toggle('done', reached); width($('sGoalBar'), r.goal > 0 ? R.play / r.goal : 0);
  $('sGoal').textContent = 'Goal ' + Math.round(r.goal / 60) + ' minutes'; $('sTrophy').toggleAttribute('hidden', !reached);   // an svg, which has no .hidden
  $('sGoalLeft').textContent = reached ? 'Reached, trophy earned' : dur(Math.ceil(r.goal - R.play)) + ' to go';
  // was it saved to the practice log, and the week it adds to (only for the session just finished)
  const note = !past && current && current.rec === r ? current.note : null; $('sSaved').hidden = !note;
  if (note) $('sSaved').replaceChildren(...(note.lead ? [el('b', null, note.lead), ' '] : []), note.text);
  // where the time went
  for (const [k, v] of [['P', R.play], ['Q', R.quiet], ['X', R.paused]]) { const i = $('sSplit' + k); i.hidden = v < 0.5; i.style.flexGrow = String(v); }
  for (const [k, v] of [['Play', R.play], ['Quiet', R.quiet], ['Paused', R.paused]]) { $('sT' + k).textContent = dur(v); $('sP' + k).textContent = pct(v / T); }
  // minute by minute: one column per step, filled with how much of it was playing, quiet and paused
  const strip = R.total >= 120, min = R.bin / 60, len = R.longest.b - R.longest.a;
  $('sStrip').hidden = !strip;
  $('sStripH').textContent = !strip ? 'Stretches and breaks' : min === 1 ? 'Minute by minute' : 'Every ' + min + ' minutes';
  if (strip) {
    $('sCols').replaceChildren(...R.columns.map(c => { const d = el('div'); d.style.flexGrow = String(c.t);
      for (const k of ['play', 'quiet', 'paused']) if (c[k] > 0) { const i = el('i', 'k-' + k); i.style.height = (c[k] / c.t * 100) + '%'; d.append(i); } return d; }));
    $('sCols').setAttribute('aria-label', 'Playing time ' + (min === 1 ? 'in each minute' : 'in every ' + min + ' minutes') + '. Efficiency ' +
      ['at the start', 'in the middle', 'at the end'].map((w, i) => w + ' ' + (R.thirds[i] == null ? 'not measured' : pct(R.thirds[i]))).join(', ') + '.');
    const st = $('sStretch'), sl = $('sStretchL'), a = R.longest.a / T * 100, b = R.longest.b / T * 100;
    st.hidden = sl.hidden = len < 1;
    st.style.left = a + '%'; st.style.width = Math.max(0.5, b - a) + '%'; sl.textContent = 'Longest stretch ' + dur(len);
    if (a < 50) { sl.style.left = a + '%'; sl.style.right = ''; } else { sl.style.left = ''; sl.style.right = (100 - b) + '%'; }
    const totalMin = R.total / 60, step = [1, 2, 5, 10, 15, 20, 30, 60].find(m => totalMin / m <= 5) || 120, ticks = [];
    for (let m = 0; m * 60 / T <= 0.94; m += step) ticks.push(m);
    $('sAxis').replaceChildren(...ticks.map((m, i) => { const x = el('span', null, i ? String(m) : '0 min'); x.style.left = (m * 60 / T * 100) + '%'; return x; }));
    const first = R.thirds[0];
    $('sThirds').replaceChildren(...['Start', 'Middle', 'End'].map((w, i) => { const v = R.thirds[i], d = el('div', v != null && first != null && first - v >= 0.2 ? 'low' : '');
      d.append(el('b', null, v == null ? '\u2013' : pct(v)), w); return d; }));
  }
  const times = n => n === 1 ? 'once' : n + ' times', facts = [
    ['Longest stretch', len >= 1 ? dur(len) : 'None', len >= 1 ? 'from ' + dur(R.longest.a) + ' to ' + dur(R.longest.b) : 'No playing heard'],
    R.best ? ['Best ' + R.best.len / 60 + ' minutes', pct(R.best.eff) + ' playing', 'from ' + dur(R.best.a) + ' to ' + dur(R.best.b)]
           : ['Short gaps', R.gaps ? String(R.gaps) : 'None', R.gaps ? dur(R.gapTime) + ' in all' : '\u00a0'],
    ['Quiet breaks over 30 s', R.breaks ? String(R.breaks) : 'None', R.breaks ? dur(R.breakTime) + ' in all' : '\u00a0'],
    ['Paused', R.pauses ? dur(R.paused) : 'No pauses', R.pauses ? times(R.pauses) : '\u00a0'],
  ];
  $('sFacts').replaceChildren(...facts.map(f => { const d = el('div'), dd = el('dd', null, f[1]); dd.append(el('small', null, f[2])); d.append(el('dt', null, f[0]), dd); return d; }));
  $('recBox').hidden = past || !rec.blob;                 // recordings are not kept with saved sessions
  $('sumLog').hidden = !!past; $('sumDelete').hidden = !past; disarm($('sumDelete'), 'Delete session');
  $('dlgSummary').querySelector('.sh-body').scrollTop = 0;
  if (!$('dlgSummary').open) $('dlgSummary').showModal();
}
$('sumClose').onclick = () => $('dlgSummary').close();
async function saveFile(filename, data) {
  if (downloads) { try { await downloads.save({ filename: filename, data: data }); } catch (e) { if (!e || e.code !== 'declined') toast('The file could not be saved here'); } return; }
  try { const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' }), a = document.createElement('a'), u = URL.createObjectURL(blob);
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 8000); }
  catch (e) { toast('The file could not be saved here'); }
}
function stamp() { const d = new Date(session.startedAt || Date.now()), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
$('btnSaveRec').onclick = () => { if (rec.blob) saveFile('practice-recording-' + stamp() + '.' + rec.ext, rec.blob); };

/* ---------- practice log: finished sessions, kept on this device (no audio) ---------- */
const LOG_KEY = 'musicTimer.log';
let log = [], logShown = 30;
try { const j = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (Array.isArray(j)) log = j.filter(r => r && r.v === 1 && r.R && r.start > 0).sort((a, b) => a.start - b.start); } catch (e) {}
function writeLog() {
  for (;;) { try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); return true; }
    catch (e) { const full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);   // storage full: drop the oldest fifth and try again
      if (!full || log.length < 2) return false; log.splice(0, Math.ceil(log.length / 5)); } }
}
function addToLog(r) { log = log.filter(x => x.id !== r.id); log.push(r); log.sort((a, b) => a.start - b.start); if (log.length > MT.LOG_MAX) log.splice(0, log.length - MT.LOG_MAX); return writeLog(); }
/* a destructive button asks twice: the first tap arms it for a few seconds */
function disarm(b, label) { b.classList.remove('armed'); b.textContent = label; clearTimeout(b._t); }
function twoTap(b, label, armedLabel, act) { b.onclick = () => {
  if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = armedLabel; clearTimeout(b._t); b._t = setTimeout(() => disarm(b, label), 4000); return; }
  disarm(b, label); act(); }; }
twoTap($('sumDelete'), 'Delete session', 'Tap again to delete', () => {
  const id = onSheet && onSheet.id; log = log.filter(x => x.id !== id); writeLog();
  if (current && current.rec.id === id) current.note = { text: 'Deleted from your practice log.' };
  $('dlgSummary').close(); if ($('dlgLog').open) renderLog(); toast('Session deleted');
});
twoTap($('logClear'), 'Delete all sessions', 'Tap again to delete all', () => { log = []; writeLog(); logShown = 30; renderLog(); toast('All sessions deleted'); });
const compact = s => { if (s <= 0) return ''; const m = Math.round(s / 60); return m < 1 ? '<1m' : m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : ''); };
const TROPHY_SVG = '<svg class="trophy" viewBox="0 0 64 64" aria-hidden="true"><path d="M19 13H9c0 10 5 15 12 16M45 13h10c0 10-5 15-12 16" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path fill="currentColor" d="M18 7h28v15c0 10-6 17-14 17s-14-7-14-17zM29 38h6v9h-6zM20 49h24v9H20z"/></svg>';
function renderLog() {
  const P = MT.practiceStats(log, Date.now()), empty = !log.length, pct = x => Math.round(x * 100) + '%';
  $('logEmpty').hidden = !empty; $('logMain').hidden = empty; $('logMore').hidden = empty;
  const idle = mode === 'local' && (session.state === 'idle' || session.state === 'stopped');
  $('logStart').hidden = !idle;
  $('logStart').textContent = empty ? 'Start your first session' : P.practicedToday ? 'Play again' : 'Start playing';
  if (empty) return;
  // what has been played: this week, and all together. Only totals that grow, nothing that can be lost by missing a day
  const week = P.weekPlay > 0;
  $('logBig').textContent = MT.durationText(week ? P.weekPlay : P.totalPlay); $('logBigCap').textContent = week ? 'of music this week' : 'of music so far';
  $('logTotalBox').hidden = !week; $('logTotal').textContent = MT.durationText(P.totalPlay); $('logNudge').textContent = MT.practiceNudge(P);
  // this week, Monday to Sunday, each day's bar filled towards that day's goal
  $('logWeek').replaceChildren(...P.week.map(c => { const d = el('div', 'd' + (c.today ? ' today' : '') + (c.future ? ' future' : '')), bar = el('div', 'bar');
    if (c.play > 0) { const i = el('i', c.level === 4 ? 'met' : ''); i.style.height = Math.max(4, Math.min(1, c.goal ? c.play / c.goal : 1) * 100) + '%'; bar.append(i); }
    d.append(el('span', 't', compact(c.play)), bar, el('span', null, c.date.toLocaleDateString([], { weekday: 'narrow' }))); return d; }));
  $('logWeek').setAttribute('aria-label', 'This week: ' + P.week.filter(c => !c.future).map(c => c.date.toLocaleDateString([], { weekday: 'long' }) + ' ' + (c.play > 0 ? MT.durationText(c.play) : 'no practice')).join(', ') + '.');
  $('logWeekLine').textContent = MT.weekLine(P);
  // the last 12 weeks, one column a week, a month name where a month begins
  const cells = [], months = []; let lastLabel = -9, lastMonth = -1;
  P.grid.forEach((col, w) => { const m = col[0].date.getMonth();
    if (m !== lastMonth && w - lastLabel >= 3) { const sp = el('span', null, col[0].date.toLocaleDateString([], { month: 'short' })); sp.style.gridColumn = String(w + 1); months.push(sp); lastLabel = w; }
    lastMonth = m;
    for (const c of col) { const i = el('i', (c.level ? 'lv' + c.level : '') + (c.today ? ' today' : '') + (c.future ? ' future' : ''));
      if (!c.future) i.title = c.date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (c.play > 0 ? MT.durationText(c.play) : 'no practice'); cells.push(i); } });
  $('logMonths').replaceChildren(...months); $('logCal').replaceChildren(...cells);
  const all = P.grid.flat(), on = all.filter(c => c.play > 0).length, met = all.filter(c => c.level === 4).length;
  $('logCal').setAttribute('aria-label', 'Practiced on ' + on + ' of the last ' + all.filter(c => !c.future).length + ' days, reaching the goal on ' + met + '.');
  // all time
  const first = log[0].start, facts = [
    ['Sessions', String(P.sessions), 'since ' + new Date(first).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })],
    ['Total playing', MT.durationText(P.totalPlay), 'on ' + P.daysPlayed + (P.daysPlayed === 1 ? ' day' : ' days')],
    ['Longest session', MT.clockText(P.longest.play), dayName(P.longest.start)],
    ['Average efficiency', pct(P.efficiency), 'playing while the timer ran'],
  ];
  $('logTotals').replaceChildren(...facts.map(f => { const d = el('div'), dd = el('dd', null, f[1]); dd.append(el('small', null, f[2])); d.append(el('dt', null, f[0]), dd); return d; }));
  // the sessions, newest first, by day
  const list = log.slice().reverse().slice(0, logShown), groups = [], dayPlay = {};
  for (const r of log) { const k = MT.dayKey(r.start); dayPlay[k] = (dayPlay[k] || 0) + r.play; }
  for (const r of list) { const k = MT.dayKey(r.start); if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k: k, recs: [] }); groups[groups.length - 1].recs.push(r); }
  $('logList').replaceChildren(...groups.map(g => { const d = el('div', 'log-day'), h = el('h4', null, dayName(g.recs[0].start)); h.append(el('span', null, MT.durationText(dayPlay[g.k])));
    d.append(h); for (const r of g.recs) { const b = el('button', 'log-row'), pl = el('div', 'pl'), big = el('b', null, MT.clockText(r.play)), mini = el('div', 'mini'), fill = el('i');
      if (r.play >= r.goal) big.insertAdjacentHTML('beforeend', TROPHY_SVG);
      fill.style.width = Math.min(100, r.goal ? r.play / r.goal * 100 : 0) + '%'; mini.append(fill); pl.append(big, mini);
      b.append(el('span', 'tm', at(r.start)), pl, el('span', 'ef', pct(r.eff)));
      b.insertAdjacentHTML('beforeend', '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>');
      b.setAttribute('aria-label', dayName(r.start) + ' at ' + at(r.start) + ': ' + MT.durationText(r.play) + ' of playing, ' + pct(r.eff) + ' efficiency' + (r.play >= r.goal ? ', goal reached' : '') + '. Open its summary');
      b.onclick = () => openSummary(r, true); d.append(b); } return d; }));
  $('logOlder').hidden = log.length <= logShown;
}
function openLog() { logShown = 30; disarm($('logClear'), 'Delete all sessions'); renderLog(); $('dlgLog').querySelector('.sh-body').scrollTop = 0; if (!$('dlgLog').open) $('dlgLog').showModal(); }
$('btnLog').onclick = openLog; $('btnLog2').onclick = openLog;
$('logClose').onclick = () => $('dlgLog').close();
$('logOlder').onclick = () => { logShown += 30; renderLog(); };
$('logStart').onclick = () => { $('dlgLog').close(); if ($('dlgSummary').open) $('dlgSummary').close(); start(); };
$('sumLog').onclick = () => { $('dlgSummary').close(); openLog(); };

/* ---------- go ---------- */
/* Rocket and City read-outs: tap them to fold them down to play time and power, leaving more of the scene in view */
function setHudCompact(on) { S.hudCompact = on; saveS();
  for (const el of [$('hud'), $('cityHud'), $('dashHud')]) { el.classList.toggle('compact', on); el.setAttribute('aria-expanded', String(!on)); }
  layoutChanged(); }
for (const el of [$('hud'), $('cityHud'), $('dashHud')]) {
  el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', 'Read-outs. Tap to show more or less');
  el.addEventListener('click', () => { if (performance.now() - lastSwipe > 400) setHudCompact(!S.hudCompact); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHudCompact(!S.hudCompact); } });
}
setHudCompact(!!S.hudCompact);
refreshSkins(); paintGoal(); paintControls(); paintDemoBar();
try { const b = document.querySelector('meta[name="build"]'); $('ver').textContent = 'Version ' + (b && b.content && b.content.indexOf('__') < 0 ? b.content : 'dev'); } catch (e) {}
if (S.source === 'mic' && (micPolicyBlocked() || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia))
  showNotice('mic', framed ? MIC_FRAMED : micMessage({ name: window.isSecureContext === false ? 'Insecure' : 'Unsupported' }), 'Use demo sound', useDemoAction);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutChanged, () => {});
requestAnimationFrame(t => { lastF = t; frame(t); });
window.__mt = { session: session, sim: sim, rocket: rocket, city: city, dash: dash, A: A, S: S, V: V, start: start, stop: stop };
})();
