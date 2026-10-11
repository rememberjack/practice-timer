// Swipes the built page in a real browser: a finger and a mouse change the theme, a scroll does not, and nothing throws.
// No dependencies: it drives Chrome or Chromium over the DevTools protocol. Without a browser it is skipped, except under CI.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), { spawn, execFileSync } = require('child_process');
const DIST = path.join(__dirname, '..', 'dist');

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
  const file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : path.basename(req.url.split('?')[0]));
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
  } finally { chrome.kill(); server.close(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
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
  check(!errors.length, 'no errors on the page' + (errors.length ? ': ' + [...new Set(errors)].slice(0, 3).join('; ') : ''));
  ws.close();
}

main().then(() => process.exit(bad ? 1 : 0), e => { console.log('FAIL browser swipe check: ' + e.message); process.exit(1); });
