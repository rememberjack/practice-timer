// The theme modules keep to their interface (docs/theme-modules.md), and themes can be taken out, put back in another order or added from
// another folder. Checks every installed theme (src/themes/themes.json) and the test theme in test/fixtures/themes, without a browser:
// - the manifest, and each theme's folder: the definition (MT.checkTheme), its panel, icon, style and requires, kept to itself;
// - the registry installs them all, the first (the base theme) written for every language;
// - pages built with other sets of themes (only the base, each theme alone with it, the reverse order, a theme from another folder) are whole;
// - a theme that breaks the interface stops the build, saying why.
// Exits 1 on any failure.
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), cp = require('child_process');
const T = require('../scripts/themes.js'), MT = require('../src/core.js');
const ROOT = T.ROOT, FIXTURES = path.join(__dirname, 'fixtures', 'themes');
let bad = 0; const check = (ok, msg) => { if (!ok) { bad++; console.log('FAIL ' + msg); } else console.log('ok   ' + msg); };

/* ---------- the manifest ---------- */
const manifest = JSON.parse(fs.readFileSync(path.join(T.THEMES, 'themes.json'), 'utf8'));
check(Array.isArray(manifest) && manifest.length > 0 && manifest.every(id => typeof id === 'string'), 'themes.json is a list of theme ids');
check(new Set(manifest).size === manifest.length, 'themes.json lists each theme once');
const folders = fs.readdirSync(T.THEMES).filter(f => fs.statSync(path.join(T.THEMES, f)).isDirectory());
check(folders.every(f => manifest.includes(f)), 'every folder in src/themes is listed in themes.json (or removed)' + (folders.filter(f => !manifest.includes(f)).length ? ': not listed ' + folders.filter(f => !manifest.includes(f)).join(', ') : ''));

/* ---------- each theme's folder ---------- */
const template = fs.readFileSync(path.join(ROOT, 'src', 'template.html'), 'utf8'), templateIds = [...template.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
function checkFolder(t, all) {
  const dir = t.dir, read = f => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8') : null, id = t.id, others = all.filter(x => x !== id);
  let def;
  try { def = T.loadTheme(dir); } catch (e) { check(false, id + ': theme.js loads in Node without a page (' + e.message + ')'); return null; }
  const problems = MT.checkTheme(def);
  check(!problems.length, id + ': the definition keeps to the interface' + (problems.length ? ': ' + problems.join('; ') : ''));
  check(def.id === id, id + ': its id is its folder\'s name');
  // the panel: one section, the one the definition names, with ids the page does not already use
  const panel = read('panel.html') || '', root = /^\s*<section class="panel" id="([^"]+)"[^>]*>[\s\S]*<\/section>\s*$/.exec(panel);
  check(!!root && root[1] === def.panel && (panel.match(/<section\b/g) || []).length === (panel.match(/<\/section>/g) || []).length, id + ': panel.html is one <section class="panel" id="' + def.panel + '">');
  const ids = [...panel.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]), clash = ids.filter(x => templateIds.includes(x));
  check(!clash.length && new Set(ids).size === ids.length, id + ': its panel\'s ids are its own' + (clash.length ? ' (the page has ' + clash.join(', ') + ')' : ''));
  check(!/<script\b|\son\w+="/i.test(panel), id + ': its panel has no scripts (its behaviour is in its modules)');
  // the icon
  const icon = (read('icon.svg') || '').trim();
  check(new RegExp('^<symbol id="ico-' + id + '" viewBox="0 0 24 24">[\\s\\S]*</symbol>$').test(icon) && (icon.match(/<symbol\b/g) || []).length === 1, id + ': icon.svg is one <symbol id="ico-' + id + '"> on the 24-unit grid');
  // the style: its tile, and nothing of another theme's
  const css = read('style.css') || '';
  check(new RegExp('\\[data-theme="' + id + '"\\]\\{--g:#[0-9A-Fa-f]{6}; --t:#[0-9A-Fa-f]{6}\\}').test(css), id + ': style.css gives its tile in Settings, Themes ([data-theme="' + id + '"]{--g; --t})');
  const foreign = others.filter(o => new RegExp('data-(skin|theme)="' + o + '"').test(css + panel));
  check(!/<\/style/i.test(css) && !foreign.length, id + ': its style and panel touch no other theme' + (foreign.length ? ' (' + foreign.join(', ') + ')' : ''));
  // the code: requires only its own files and the core
  const js = fs.readdirSync(dir).filter(f => f.endsWith('.js')), wrong = [];
  for (const f of js) for (const m of read(f).matchAll(/require\(\s*(['"])([^'"]+)\1\s*\)/g)) if (!(m[2] === '../../core.js' || (/^\.\/[\w.-]+\.js$/.test(m[2]) && js.includes(m[2].slice(2))))) wrong.push(f + ': ' + m[2]);
  check(!wrong.length, id + ': its files require only each other and the core' + (wrong.length ? ' (' + wrong.join(', ') + ')' : ''));
  check(!js.some(f => /<\/script/i.test(read(f))), id + ': no "</script" in its code (it would end the page\'s script)');
  // its tests run, and pass
  const failed = (def.tests || []).filter(x => { try { return !MT.inLang('en', x.run).pass; } catch (e) { return true; } }).map(x => x.name);
  check(!failed.length, id + ': its ' + (def.tests || []).length + ' tests pass' + (failed.length ? ' (failed: ' + failed.join('; ') + ')' : ''));
  return def;
}
const installed = T.themeDirs([]), defs = [];
for (const t of installed) { check(!!t.dir, t.id + ': its folder is src/themes/' + t.id); if (t.dir) defs.push(checkFolder(t, manifest)); }
const sample = { id: 'sample', dir: path.join(FIXTURES, 'sample') }, sampleDef = checkFolder(sample, manifest);

/* ---------- the registry installs them all ---------- */
const before = MT.themes().map(d => d.id);
for (const id of before) MT.removeTheme(id);
const added = defs.filter(Boolean).map(d => [d.id, MT.addTheme(d)]);
check(added.every(a => !a[1].length) && MT.themes().map(d => d.id).join() === manifest.join(), 'the registry installs every theme in the order of themes.json' + added.filter(a => a[1].length).map(a => ': ' + a[0] + ' ' + a[1].join('; ')).join(''));
const base = MT.themes()[0];
check(!!base && MT.LANGS.every(l => base.langs.includes(l[0])), 'the base theme (' + (base && base.id) + ') is written for every language');
check(MT.addTheme(sampleDef).length === 0 && MT.themesOpen(MT.themes(), '', 'fr').indexOf('sample') < 0 && MT.themesOpen(MT.themes(), '', 'en').indexOf('sample') >= 0,
  'a theme written for English only is offered in English and not in French');
check(MT.addTheme(sampleDef).length === 1, 'the same theme cannot be installed twice');
MT.removeTheme('sample');

/* ---------- pages built with other sets of themes ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-themes-'));
function build(name, args) {
  const out = path.join(tmp, name), r = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build.js'), '--out', out].concat(args), { encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '').split('\n').find(l => /^\w*Error: /.test(l)) || '', html: r.status === 0 ? fs.readFileSync(path.join(out, 'index.html'), 'utf8') : '' };
}
function whole(name, b, ids) {
  const html = b.html, scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]), all = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const parse = scripts.every(s => { try { new vm.Script(s); return true; } catch (e) { return false; } });
  const panels = [...html.matchAll(/<section class="panel" id="([^"]+)"/g)].map(m => m[1]), icons = [...html.matchAll(/<symbol id="ico-(\w+)"/g)].map(m => m[1]);
  const ok = b.ok && parse && new Set(all).size === all.length && panels.length === ids.length && ids.every(id => icons.includes(id)) && !/__(BUILD|FONTS|APP_ICON)__|\/\*__\w+__\*\/|<!--__\w+__-->/.test(html)
    && ids.every(id => html.includes('mtTheme("' + id + '"')) && ids.every(id => html.includes('src/themes/' + id + '/style.css'));
  check(ok, name + ': builds a whole page with ' + ids.join(', ') + (b.ok ? '' : ' (' + b.err + ')'));
  return html;
}
const only = whole('only the base theme', build('base', ['--themes', manifest[0]]), [manifest[0]]);
check(!/family=Barlow|family=Fraunces/.test(only) && /family=Inter/.test(only), 'only the base theme: the fonts are only the page\'s own');
for (const id of manifest.slice(1)) {
  const html = whole(id + ' alone with the base theme', build('one-' + id, ['--themes', manifest[0] + ',' + id]), [manifest[0], id]);
  const leftover = manifest.filter(o => o !== id && o !== manifest[0] && new RegExp('id="' + defs.find(d => d && d.id === o).panel + '"').test(html));
  check(!leftover.length, id + ' alone: no other theme\'s panel is left in the page');
}
whole('the reverse order', build('reverse', ['--themes', [manifest[0]].concat(manifest.slice(1).reverse()).join(',')]), manifest);
const ext = whole('a theme from another folder', build('sample', ['--theme-dir', FIXTURES, '--themes', manifest[0] + ',sample,' + manifest[manifest.length - 1]]), [manifest[0], 'sample', manifest[manifest.length - 1]]);
check(ext.indexOf('mtTheme("sample"') < ext.indexOf('mtTheme("' + manifest[manifest.length - 1] + '"'), 'a theme from another folder: installed in the order given');

/* ---------- a theme that breaks the interface stops the build ---------- */
function broken(name, change, want) {
  const dir = path.join(tmp, 'broken-' + name), t = path.join(dir, 'sample');
  fs.mkdirSync(t, { recursive: true }); for (const f of fs.readdirSync(sample.dir)) fs.copyFileSync(path.join(sample.dir, f), path.join(t, f));
  change(t); const b = build('out-' + name, ['--theme-dir', dir, '--themes', manifest[0] + ',sample']);
  check(!b.ok && b.err.indexOf(want) >= 0, 'the build stops for ' + name + ' (' + (b.err || 'it built') + ')');
}
const edit = (t, f, a, b) => fs.writeFileSync(path.join(t, f), fs.readFileSync(path.join(t, f), 'utf8').replace(a, b));
broken('a definition with an unknown key', t => edit(t, 'theme.js', "api: 1,", "api: 1, colour: 'red',"), 'unknown key colour');
broken('an id that is not its folder\'s', t => edit(t, 'theme.js', "id: 'sample',", "id: 'other',"), 'its id is other, in a folder named sample');
broken('a newer interface', t => edit(t, 'theme.js', "api: 1,", "api: 2,"), 'api must be the interface version');
broken('words for a language it is not written for', t => fs.writeFileSync(path.join(t, 'words.js'), "module.exports = { fr: { 'Keep playing': 'Continue' } };"), 'words for fr, which is not in langs');
broken('a missing panel', t => fs.unlinkSync(path.join(t, 'panel.html')), 'no panel.html');
{ const b = build('twice', ['--themes', manifest[0] + ',' + manifest[0]]); check(!b.ok && b.err.indexOf('listed twice') >= 0, 'the build stops for a theme listed twice (' + (b.err || 'it built') + ')'); }
{ const b = build('none', ['--themes', 'nosuchtheme']); check(!b.ok && b.err.indexOf('no nosuchtheme/theme.js') >= 0, 'the build stops for a theme that is not there (' + (b.err || 'it built') + ')'); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
