// Checks the built page without a browser: it parses, has the elements the app needs, and fits a sensible size.
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
let bad = 0; const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check(scripts.length === 2, 'two inline scripts');
scripts.forEach((s, i) => { try { new vm.Script(s); check(true, 'script ' + (i + 1) + ' parses'); } catch (e) { check(false, 'script ' + (i + 1) + ' parses: ' + e.message); } });
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
check(new Set(ids).size === ids.length, 'element ids are unique');
for (const id of ['app', 'stage', 'track', 'btnStart', 'btnPause', 'btnResume', 'btnStop', 'dlgSettings', 'dlgCredits', 'roll', 'rollIn', 'dlgSummary', 'dlgLog', 'dlgEnd', 'dlgAsk', 'award', 'ver', 'skinBar', 'homeLink', 'dbgThemes', 'ico-lock'])
  check(ids.includes(id), 'has #' + id);
// each installed theme: its panel and its icon (test/themes.js checks the rest of each theme's files)
const T = require('../scripts/themes.js');
for (const t of T.themeDirs([])) { const def = T.loadTheme(t.dir); check(ids.includes(def.panel) && ids.includes('ico-' + t.id), 'has the ' + t.id + ' theme: #' + def.panel + ' and #ico-' + t.id); }
check(!html.includes('__BUILD__') && !html.includes('__FONTS__') && !/\/\*__\w+__\*\/|<!--__\w+__-->/.test(html), 'no placeholders left');
check(/<meta name="build" content="(\d+|dev)">/.test(html), 'the version is a plain number');
check(!html.includes('__APP_ICON__') && /<img src="data:image\/png;base64,[^"]+" alt=""/.test(html), 'header icon is embedded');
for (const [name, size] of [['favicon.png', 32], ['apple-touch-icon.png', 180], ['icon.png', 512]]) {
  const file = path.join(__dirname, '..', 'dist', name);
  const png = fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0);
  check(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.readUInt32BE(16) === size && png.readUInt32BE(20) === size, name + ' is built at ' + size + 'px');
}
for (const name of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png'])
  check(html.includes('href="' + name + '"') && fs.existsSync(path.join(__dirname, '..', 'dist', name)), 'page links to built ' + name);
check(/<meta name="viewport"[^>]*viewport-fit=cover/.test(html), 'viewport tag');
check(html.includes('cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'), 'City and Fireworks load three.js r128 from cdnjs');
// a tripwire against the page growing unnoticed, not a hard limit: this is the raw file (comments and the icon included); GitHub Pages sends it
// compressed, about a third of this. Main was 525 KB, the Fireworks theme took it to about 608 KB, the Chinese and French words to about 696 KB
// and the Fireworks musical symbols to about 704 KB
check(html.length < 900 * 1024, 'size under 900 KB (' + Math.round(html.length / 1024) + ' KB)');
process.exit(bad ? 1 : 0);
