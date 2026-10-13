// Builds dist/index.html: one self-contained file from src/. No dependencies.
// The themes are the modules listed in src/themes/themes.json, in that order (docs/theme-modules.md). Options, for trying a different set:
//   --themes classic,race    install these instead of the list (the first is the base theme)
//   --theme-dir <dir>        also look for theme folders here (after src/themes), for a theme kept outside the app
//   --out <dir>              write the page there instead of dist/
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const arg = name => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
/* the version is a plain number: how many changes have been merged into main (each push to main adds one), so the live page
   counts up 56, 57, 58... It needs the whole history; a shallow clone would count wrong, so CI stops there rather than ship a wrong number */
const git = c => cp.execSync('git ' + c, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
let build = 'dev';
try {
  if (git('rev-parse --is-shallow-repository') === 'true') { if (process.env.CI) throw new Error('shallow clone: check out with fetch-depth: 0 to number the version'); }
  else build = git('rev-list --count --first-parent HEAD');
} catch (e) { if (process.env.CI) throw e; }

/* ---------- the theme modules ---------- */
const THEME_DIRS = [path.join(root, 'src', 'themes')].concat(arg('theme-dir') ? [path.resolve(arg('theme-dir'))] : []);
const installed = arg('themes') ? arg('themes').split(',').filter(Boolean) : JSON.parse(src('themes/themes.json'));
const HOST_FONTS = ['Inter:wght@400;500;600;700;800', 'Silkscreen:wght@400;700'];   // the page's own type, and the pixel chrome's
function readTheme(id) {
  const dir = THEME_DIRS.map(d => path.join(d, id)).find(d => fs.existsSync(path.join(d, 'theme.js')));
  if (!dir) throw new Error('theme ' + id + ': no ' + id + '/theme.js in ' + THEME_DIRS.join(' or '));
  const read = f => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null;
  const js = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();
  const def = require(path.join(dir, 'theme.js'));   // read in Node too, for its fonts (and so a broken module stops the build)
  for (const [f, text] of [['panel.html', read('panel.html')], ['icon.svg', read('icon.svg')]]) if (text == null) throw new Error('theme ' + id + ': no ' + f);
  return { id: id, dir: dir, def: def, css: read('style.css') || '', panel: read('panel.html'), icon: read('icon.svg'), js: js.map(f => [f, read(f)]) };
}
const themes = installed.map(readTheme);
/* each theme folder is a small set of CommonJS files: in the page each file is a function, and require finds the files of the same folder
   ('./view.js') and the core ('../../core.js', which is MT). theme.js is the module; mtTheme installs what it exports (MT.addTheme) */
const LOADER = `function mtTheme(id, files) {
  const MT = self.MT, done = {};
  function load(name) {
    if (done[name]) return done[name].exports;
    if (!files[name]) throw new Error('theme ' + id + ': no ' + name);
    const m = done[name] = { exports: {} }; files[name](m, m.exports, p => p === '../../core.js' ? MT : load(p.replace(/^\\.\\//, '')));
    return m.exports;
  }
  try {
    const def = load('theme.js'), bad = def && def.id !== id ? ['its id is ' + def.id + ', in a folder named ' + id] : MT.addTheme(def);
    if (bad.length) throw new Error(bad.join('; '));
  } catch (e) { (MT.themeErrors = MT.themeErrors || []).push(id + ': ' + e.message); console.error('Music Timer: the ' + id + ' theme was not installed. ' + e.message); }
}`;
const bundle = t => 'mtTheme(' + JSON.stringify(t.id) + ', {\n' + t.js.map(([f, code]) => JSON.stringify(f) + ': function (module, exports, require) {\n' + code + '\n}').join(',\n') + '\n});';
const fonts = [...new Set(HOST_FONTS.concat(...themes.map(t => t.def.fonts || [])))].map(f => 'family=' + f).join('&');

const parts = { core: src('core.js'), lang: src('lang.js'), app: src('app.js') };
for (const t of themes) for (const [f, code] of t.js) parts[t.id + '/' + f] = code;
for (const n in parts) if (/<\/script/i.test(parts[n])) throw new Error('"</script" found in ' + n + '; it would end the inline script early');
for (const t of themes) if (/<\/style/i.test(t.css)) throw new Error('"</style" found in ' + t.id + '/style.css');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'src/assets/app-icon.png')).toString('base64');
const out = src('template.html').replace('__BUILD__', build).replace('__APP_ICON__', () => icon).replace('__FONTS__', () => fonts)
  .replace('/*__THEMES_CSS__*/', () => themes.map(t => '/* ---------- theme: ' + t.id + ' (src/themes/' + t.id + '/style.css) ---------- */\n' + t.css).join('\n'))
  .replace('<!--__ICONS__-->', () => themes.map(t => t.icon.trim()).join('\n  '))
  .replace('<!--__PANELS__-->', () => themes.map(t => t.panel.trim().split('\n').join('\n      ')).join('\n      '))
  .replace('/*__CORE__*/', () => parts.core + '\n' + parts.lang)
  .replace('/*__APP__*/', () => LOADER + '\n' + themes.map(bundle).join('\n') + '\n' + parts.app);
const dist = arg('out') ? path.resolve(arg('out')) : path.join(root, 'dist'); fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), out);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
for (const name of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'icon.png'])
  fs.copyFileSync(path.join(root, 'src/assets', name), path.join(dist, name));
if (process.env.CNAME) fs.writeFileSync(path.join(dist, 'CNAME'), process.env.CNAME + '\n');   // optional custom domain
console.log('built ' + path.relative(root, path.join(dist, 'index.html')) + ', ' + (out.length / 1024).toFixed(0) + ' KB, version ' + build + ', themes ' + themes.map(t => t.id).join(' '));
