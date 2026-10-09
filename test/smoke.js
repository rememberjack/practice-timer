// Checks the built page without a browser: it parses, has the elements the app needs, and fits a sensible size.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
let bad = 0; const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check(scripts.length === 2, 'two inline scripts');
scripts.forEach((s, i) => { try { new vm.Script(s); check(true, 'script ' + (i + 1) + ' parses'); } catch (e) { check(false, 'script ' + (i + 1) + ' parses: ' + e.message); } });
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
check(new Set(ids).size === ids.length, 'element ids are unique');
for (const id of ['app', 'btnStart', 'btnPause', 'btnResume', 'btnStop', 'cClock', 'vizBox', 'rk', 'hud', 'dlgSettings', 'dlgSummary', 'award', 'ver', 'pCity', 'cityCv', 'cityHud', 'yPlay', 'pDash', 'dashCv', 'dashHud', 'dPlay', 'skinBar', 'ico-classic', 'ico-rocket', 'ico-city', 'ico-dash', 'ico-lock'])
  check(ids.includes(id), 'has #' + id);
check(!html.includes('__BUILD__') && !html.includes('/*__CORE__*/') && !html.includes('/*__APP__*/'), 'no placeholders left');
check(!html.includes('__APP_ICON__') && /<img src="data:image\/png;base64,[^"]+" alt=""/.test(html), 'header icon is embedded');
for (const [name, size] of [['favicon.png', 32], ['apple-touch-icon.png', 180], ['icon.png', 512]]) {
  const file = path.join(__dirname, '..', 'dist', name);
  const png = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  check(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size, name + ' is built at ' + size + 'px');
}
for (const name of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png'])
  check(html.includes('href="' + name + '"') && fs.existsSync(path.join(__dirname, '..', 'dist', name)), 'page links to built ' + name);
check(/<meta name="viewport"[^>]*viewport-fit=cover/.test(html), 'viewport tag');
check(html.includes('cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'), 'City theme loads three.js r128 from cdnjs');
check(html.length < 600 * 1024, 'size under 600 KB (' + Math.round(html.length / 1024) + ' KB)');
process.exit(bad ? 1 : 0);
