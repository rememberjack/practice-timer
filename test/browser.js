// Swipes the built page in a real browser: a finger and a mouse change the theme, a scroll does not, and nothing throws. Then the theme
// modules: each installed theme starts and keeps to the interface, a page with only the base theme works, and a theme from another folder
// written for English only (test/fixtures/themes/sample) is driven through its hooks and leaves the swipe in French.
// No dependencies: it drives Chrome or Chromium over the DevTools protocol. Without a browser it is skipped, except under CI.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn, execFileSync } = require('child_process');
const nodePath = path, DIST = path.join(__dirname, '..', 'dist'), VARIANTS = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-variants-'));
/* pages built with other sets of themes, served under /v/<name>/ */
function variant(name, args) { execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build.js'), '--out', path.join(VARIANTS, name)].concat(args), { stdio: 'ignore' }); }

function findBrowser() {
  for (const p of [process.env.CHROME_PATH, '/opt/pw-browsers/chromium']) if (p && fs.existsSync(p)) return p;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch (e) {}
  }
  return null;
}
const browser = findBrowser();
if (!browser || typeof WebSocket === 'undefined') {
  const why = !browser ? 'no Chrome or Chromium found (set CHROME_PATH)' : 'this Node has no WebSocket (Node 22 or later)';
  console.log((process.env.CI ? 'FAIL ' : 'skip ') + 'browser swipe check: ' + why);
  process.exit(process.env.CI ? 1 : 0);
}

let bad = 0; const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]), v = /^\/v\/(\w+)\//.exec(url), dir = v ? path.join(VARIANTS, v[1]) : DIST;
  const file = path.join(dir, /\/$/.test(url) ? 'index.html' : path.basename(url));
  if (!fs.existsSync(file)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', file.endsWith('.html') ? 'text/html' : 'application/octet-stream'); res.end(fs.readFileSync(file));
});

async function main() {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-browser-'));
  const chrome = spawn(browser, ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const wsUrl = await new Promise((resolve, reject) => {   // Chrome prints its DevTools address once it is listening
      let err = ''; const t = setTimeout(() => reject(new Error('Chrome did not start: ' + err.slice(-400))), 20000);
      chrome.stderr.on('data', d => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); resolve(m[1]); } });
      chrome.on('exit', c => reject(new Error('Chrome exited (' + c + '): ' + err.slice(-400))));
    });
    await run(wsUrl);
  } finally { chrome.kill(); server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(VARIANTS, { recursive: true, force: true }); } catch (e) {} }
}

async function run(wsUrl) {
  const ws = new WebSocket(wsUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let next = 0; const waiting = new Map(), errors = [];
  ws.onmessage = m => { const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.reject(new Error(d.error.message)) : w.resolve(d.result); }
    else if (d.method === 'Runtime.exceptionThrown') { const x = d.params.exceptionDetails; errors.push((x.exception && x.exception.description || x.text).split('\n')[0]); } };
  const send = (method, params, sessionId) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {}, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (m, p) => send(m, p, sessionId);
  const js = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(expr + ': ' + r.exceptionDetails.text); return r.result.value; };
  await cmd('Runtime.enable'); await cmd('Page.enable'); await cmd('Network.enable');
  await cmd('Network.setBlockedURLs', { urls: ['*cdnjs.cloudflare.com*'] });   // three.js: City falls back without it, and the check needs no network
  await cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cmd('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 100 && !(await js('document.readyState === "complete" && !!document.getElementById("homeGo")')); i++) await sleep(100);

  const ta = id => js('getComputedStyle(document.getElementById("' + id + '")).touchAction');   // a double tap never zooms: every element is manipulation (pans and pinch) or narrower
  const tas = [await ta('homeGo'), await ta('btnSettings'), await ta('home'), await ta('stage'), await ta('btnPause')];
  check(tas.join(' ') === 'manipulation manipulation manipulation pan-y manipulation', 'a double tap does not zoom: buttons and the Home Screen take manipulation, the scene keeps pan-y (' + tas.join(', ') + ')');
  await js('document.getElementById("homeGo").click()');   // start a session (a fake microphone), which puts the themes on screen
  for (let i = 0; i < 50 && !(await js('document.getElementById("home").hidden')); i++) await sleep(100);
  check(await js('document.getElementById("home").hidden'), 'Start playing leaves the Home Screen');
  const skin = () => js('document.getElementById("app").dataset.skin');
  const box = await js('(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()');
  const y = Math.round(box.y + box.h * 0.6), right = Math.round(box.x + box.w * 0.85), left = Math.round(box.x + box.w * 0.15);
  const path = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, k) => [Math.round(x0 + (x1 - x0) * (k + 1) / n), Math.round(y0 + (y1 - y0) * (k + 1) / n)]);
  const touch = async (x0, y0, x1, y1) => {
    await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (const [x, yy] of path(x0, y0, x1, y1, 12)) { await cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: yy }] }); await sleep(16); }
    await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(450);
  };
  const mouse = async (x0, y0, x1, y1, outY) => {   // outY: then on down out of the scene before letting go
    await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
    const pts = path(x0, y0, x1, y1, 12).concat(outY == null ? [] : path(x1, y1, x1, outY, 6)), [ex, ey] = pts[pts.length - 1];
    for (const [x, yy] of pts) { await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: yy, button: 'left', buttons: 1 }); await sleep(16); }
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ex, y: ey, button: 'left', buttons: 0, clickCount: 1 }); await sleep(450);
  };

  check(await skin() === 'classic', 'starts on Classic');
  await touch(right, y, left, y); check(await skin() === 'rocket', 'a finger swiping left moves to Rocket (got ' + await skin() + ')');
  await touch(right, y, left, y); check(await skin() === 'city', 'another swipe left moves to City (got ' + await skin() + ')');
  await touch(left, y, right, y); check(await skin() === 'rocket', 'a finger swiping right goes back to Rocket (got ' + await skin() + ')');
  await touch(right - 20, y, right - 60, y); check(await skin() === 'rocket', 'a short slow drag goes back to where it was (got ' + await skin() + ')');
  await touch(Math.round(box.x + box.w / 2), y, Math.round(box.x + box.w / 2) + 6, y - 200); check(await skin() === 'rocket', 'dragging up does not change the theme (got ' + await skin() + ')');
  await mouse(left, y, right, y); check(await skin() === 'classic', 'a mouse drag right goes back to Classic (got ' + await skin() + ')');
  await mouse(right, y, left, y); check(await skin() === 'rocket', 'a mouse drag left moves to Rocket (got ' + await skin() + ')');
  await mouse(right, y, left, y, Math.round(box.y + box.h + 30)); check(await skin() === 'city', 'a mouse drag let go below the scene still moves (got ' + await skin() + ')');
  const tx = await js('getComputedStyle(document.getElementById("track")).transform');
  check(/matrix\(1, 0, 0, 1, -?[\d.]+, 0\)/.test(tx) && Math.abs(parseFloat(tx.split(',')[4]) + 2 * box.w) < 2, 'the track lands on City after the swipe (' + tx + ')');
  await touch(right, y, left, y); await touch(right, y, left, y); check(await skin() === 'race', 'two more swipes left reach Grand Prix (got ' + await skin() + ')');
  await sleep(1500);   // let the race scene draw for a while
  check(await js('(() => { const c = document.getElementById("raceCv"); return c.width > 0 && c.height > 0; })()'), 'the Grand Prix scene has a canvas to draw on');
  await touch(right, y, left, y); check(await skin() === 'fireworks', 'one more swipe left reaches Fireworks (got ' + await skin() + ')');
  await sleep(1500);   // let the fireworks draw for a while
  check(await js('(() => { const c = document.querySelector("#pFire canvas:not([hidden])"); return !!c && c.width > 0 && c.height > 0; })()'), 'the Fireworks scene has a canvas to draw on (3D, or flat when three.js cannot load)');
  await touch(right, y, left, y); check(await skin() === 'invaders', 'one more swipe left reaches Invaders, the last theme (got ' + await skin() + ')');
  await touch(right, y, left, y); check(await skin() === 'invaders', 'a swipe past the last theme stays on it (got ' + await skin() + ')');
  await sleep(500);
  check(await js('(() => { const c = document.getElementById("ivCv"); return c.width > 0 && c.height > 0; })()'), 'the Invaders scene has a canvas to draw on');
  // Settings, Language: the words change at once, during a session too, and back again
  const words = () => js('[document.getElementById("btnPause").textContent, document.getElementById("btnResume").textContent, document.querySelector("#setMain .lab").textContent, document.getElementById("fHint").textContent, document.documentElement.lang].join(" | ")');
  const pickLang = async i => { await js('document.querySelectorAll("#langList .lrow")[' + i + '].click()'); await sleep(300); };
  await js('document.getElementById("btnSettings").click(); document.getElementById("openLang").click()'); await sleep(200);
  await pickLang(1); const english = await words(); await pickLang(3); const french = await words(); await pickLang(2); const chinese = await words(); await pickLang(1);
  check(/^Pause \| Resume \| Practice goal \| .+ \| en$/.test(english) && /^Pause \| Reprendre \| Objectif de pratique \| .+ \| fr$/.test(french) && /^暂停 \| 继续 \| 练习目标 \| .+ \| zh-CN$/.test(chinese) && await words() === english,
    'choosing a language changes the words at once, and English brings them back (' + [english, french, chinese].join(' / ') + ')');
  await pickLang(0); await js('document.getElementById("setClose").click()');   // back to Automatic
  check(!errors.length, 'no errors on the page' + (errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join('; ') : ''));

  // ---------- the theme modules ----------
  const installed = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '..', 'src', 'themes', 'themes.json'), 'utf8'));
  const started = await js('JSON.stringify({ ids: window.__mt.themes.map(t => t.id), errors: window.__mt.errors, bad: window.__mt.themes.map(t => MT.checkInstance(t.inst)).flat(), bar: document.querySelectorAll("#skinBar button").length })');
  const st = JSON.parse(started);
  check(st.ids.join() === installed.join() && !st.errors.length && !st.bad.length && st.bar === installed.length, 'every installed theme started, in order, and keeps to the interface (' + st.ids.join(' ') + (st.errors.length ? '; ' + st.errors.join('; ') : '') + (st.bad.length ? '; ' + st.bad.join('; ') : '') + ')');
  const load = async url => {   // a fresh page: nothing saved from before
    await cmd('Page.navigate', { url: url }); for (let i = 0; i < 100 && !(await js('document.readyState === "complete" && !!document.getElementById("homeGo")')); i++) await sleep(100);
    await js('localStorage.clear(); sessionStorage.clear()'); await cmd('Page.reload'); await sleep(300);
    for (let i = 0; i < 100 && !(await js('document.readyState === "complete" && !!window.__mt')); i++) await sleep(100);
  };
  const base = 'http://127.0.0.1:' + server.address().port;
  variant('base', ['--themes', installed[0]]);
  variant('sample', ['--theme-dir', nodePath.join(__dirname, 'fixtures', 'themes'), '--themes', installed[0] + ',sample']);
  // only the base theme: the page works with every other theme taken out
  errors.length = 0; await load(base + '/v/base/');
  await js('document.getElementById("homeGo").click()'); await sleep(600); await touch(right, y, left, y);
  check(await skin() === installed[0] && await js('document.querySelectorAll("#skinBar button").length') === 1 && !errors.length, 'a page with only the base theme: it starts, a swipe stays on it, and nothing throws' + (errors.length ? ' (' + errors[0] + ')' : ''));
  // a theme from another folder, written for English only
  errors.length = 0; await load(base + '/v/sample/');
  await js('document.getElementById("btnSettings").click(); document.getElementById("openLang").click()'); await sleep(200); await pickLang(1); await js('document.getElementById("setClose").click()');
  await js('document.getElementById("homeGo").click()'); await sleep(600); await touch(right, y, left, y); await sleep(600);
  const calls = JSON.parse(await js('document.getElementById("pSample").dataset.calls || "{}"'));
  check(await skin() === 'sample' && ['reset:start', 'show', 'tick', 'frame', 'paint', 'resize'].every(k => calls[k] > 0) && /\d\d:\d\d/.test(await js('document.getElementById("smPlay").textContent')),
    'a theme from another folder is swiped to and driven through its hooks (' + Object.keys(calls).map(k => k + ' ' + calls[k]).join(', ') + ')');
  await js('document.getElementById("btnSettings").click(); document.getElementById("openLang").click()'); await sleep(200); await pickLang(3);
  await js('document.getElementById("openThemes") || 0'); await js('document.getElementById("setBack").click(); document.getElementById("openThemes").click()'); await sleep(200);
  const fr = JSON.parse(await js('JSON.stringify({ skin: document.getElementById("app").dataset.skin, bar: document.querySelectorAll("#skinBar button")[1].hidden, row: document.querySelector("#themeList li[data-theme=sample] .tx span").textContent, sw: document.querySelector("#themeList li[data-theme=sample] input").disabled, on: document.querySelector("#themeList li[data-theme=sample] input").checked })'));
  await js('document.getElementById("setClose").click()'); await sleep(300); await touch(right, y, left, y);
  check(fr.skin === installed[0] && fr.bar && fr.sw && fr.on && /langue/.test(fr.row) && await skin() === installed[0],
    'in French the English-only theme leaves the swipe and the theme bar, and Settings, Themes says why, its switch kept on (' + JSON.stringify(fr) + ')');
  await js('document.getElementById("btnSettings").click(); document.getElementById("openLang").click()'); await sleep(200); await pickLang(1); await js('document.getElementById("setClose").click()'); await sleep(300);
  await touch(right, y, left, y);
  check(await skin() === 'sample' && !(await js('document.querySelectorAll("#skinBar button")[1].hidden')), 'back in English it can be swiped to again');
  await js('document.dispatchEvent(new Event("visibilitychange"))'); await js('window.dispatchEvent(new Event("pagehide"))');   // the session so far is kept
  const kept = await js('JSON.stringify((JSON.parse(localStorage.getItem("musicTimer.live") || "null") || {}).themes || null)');
  check(kept === '{"sample":{"notes":1}}', 'what the theme keeps goes with the session, under its id (' + kept + ')');
  await js('document.getElementById("btnStop").click()'); await sleep(200); await js('document.getElementById("endYes").click()'); await sleep(300);
  check(JSON.parse(await js('document.getElementById("pSample").dataset.calls')).stopped === 1, 'ending the session tells the theme (stopped)');
  check(!errors.length, 'no errors on the pages with other themes' + (errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join('; ') : ''));
  ws.close();
}

main().then(() => process.exit(bad ? 1 : 0), e => { console.log('FAIL browser swipe check: ' + e.message); process.exit(1); });
