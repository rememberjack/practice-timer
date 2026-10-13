// Every word the player sees has a translation in each language, and every translation is still used.
// - The page's own words (src/lang.js): the text and labels in src/template.html (the debug tools stay in English), the English given to
//   tr(), trn() and word() in src/core.js and src/app.js, and the tables of words app.js looks up (TABLES). lang.js holds only words the page
//   itself uses, so taking a theme out never leaves words behind.
// - Each installed theme's words (its words.js, docs/theme-modules.md): what it shows (tr, trn and word() in its .js files, the text of its
//   panel.html, its name, line and goalHint), in each language it is written for (langs), from its own words or the page's. A theme has no
//   words for a language it is not written for, and none it no longer uses.
// Exits 1 if anything is missing. Run with --themes a,b or --theme-dir <dir> to check another set (as the build takes them).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = f => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', minus: '−', ndash: '–', mdash: '—', hellip: '…', Prime: '″', lsaquo: '‹', rsaquo: '›', nbsp: ' ' };
const decode = s => s.replace(/&(\w+);/g, (m, k) => ENT[k] != null ? ENT[k] : m).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
/* the words in a piece of markup: text between tags and the aria-label and title of each element, outside scripts, styles, icons and what is marked translate="no" */
function scanHtml(body, add) {
  body = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (let m; (m = /<(\w+)[^>]*\stranslate="no"[^>]*>/.exec(body));) {   // an element left in English (the debug tools) or filled in by the app: to its own end tag
    const tag = m[1], re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g'); re.lastIndex = m.index + m[0].length; let depth = 1, e;
    while (depth && (e = re.exec(body))) depth += e[1] ? -1 : 1;
    body = body.slice(0, m.index) + body.slice(e ? e.index + e[0].length : body.length);
  }
  for (const m of body.matchAll(/>([^<]+)</g)) { const s = decode(m[1]).trim(); if (/[A-Za-z]/.test(s)) add(s); }
  for (const m of body.matchAll(/\s(?:aria-label|title)="([^"]*)"/g)) { const s = decode(m[1]).trim(); if (/[A-Za-z]/.test(s)) add(s); }
}
/* the English given to tr(), trn() and word(): the strings in their arguments, leaving out the {blanks} object and comparisons (x === 'paused') */
function scanCode(code, add) {
  for (const m of code.matchAll(/(?<![\w$])(?:trn?|word|W)\(/g)) {
    let i = m.index + m[0].length, depth = 1, brace = 0;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '\'' || ch === '"') {
        let j = i + 1, s = ''; while (code[j] !== ch) { if (code[j] === '\\') { s += code.slice(j, j + 2); j += 2; } else s += code[j++]; }
        const before = code.slice(Math.max(0, i - 5), i), after = code.slice(j + 1, j + 6);
        if (!brace && !/[=!]==?\s*$/.test(before) && !/^\s*[=!]==/.test(after)) add(JSON.parse('"' + s.replace(/\\'/g, '\'').replace(/"/g, '\\"') + '"'));
        i = j + 1; continue;
      }
      if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === '{') brace++; else if (ch === '}') brace--;
      i++;
    }
  }
}
/* the tables of words app.js and core.js look up by key; each gives the strings that are words (not ids) */
const TABLES = { 'app.js': { LANG_ABOUT: Object.values, CREDITS: t => t.flatMap(([h, rows]) => [h].concat(rows.map(r => r[0]))) }, 'core.js': { ORDINALS: t => t } };
function scanTables(file, add, bad) {
  const code = src(file);
  for (const [name, pick] of Object.entries(TABLES[file] || {})) {
    const at = code.search(new RegExp('(?:const |, )' + name + ' = ')); if (at < 0) { bad('table ' + name + ' not found in ' + file); continue; }
    let i = code.indexOf('=', at) + 1; while (code[i] === ' ') i++;
    const open = code[i], close = open === '[' ? ']' : '}'; let depth = 0, j = i;
    for (; j < code.length; j++) { if (code[j] === '\'') { j++; while (code[j] !== '\'') j += code[j] === '\\' ? 2 : 1; continue; } if (code[j] === open) depth++; else if (code[j] === close && --depth === 0) break; }
    for (const s of pick(vm.runInNewContext('(' + code.slice(i, j + 1) + ')'))) add(s);
  }
}
/* the words the page itself shows: English -> where */
function hostWords(bad) {
  const used = new Map(), adder = where => s => { if (!used.has(s)) used.set(s, where); };
  let body = src('template.html'); body = body.slice(body.indexOf('<body'));
  scanHtml(body, adder('template.html'));
  for (const f of ['core.js', 'app.js']) { scanCode(src(f), adder(f)); scanTables(f, adder(f + ' table'), bad); }
  return used;
}
/* the folder of each installed theme, as the build finds it */
function themeDirs(argv) {
  const arg = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
  const dirs = [path.join(ROOT, 'src', 'themes')].concat(arg('theme-dir') ? [path.resolve(arg('theme-dir'))] : []);
  const ids = arg('themes') ? arg('themes').split(',') : JSON.parse(src('themes/themes.json'));
  return ids.map(id => ({ id: id, dir: dirs.map(d => path.join(d, id)).find(d => fs.existsSync(path.join(d, 'theme.js'))) }));
}
/* the words a theme shows: English -> where */
function themeWords(t) {
  const used = new Map(), adder = where => s => { if (!used.has(s)) used.set(s, where); }, def = require(path.join(t.dir, 'theme.js'));
  for (const f of fs.readdirSync(t.dir).filter(f => f.endsWith('.js') && f !== 'words.js')) scanCode(fs.readFileSync(path.join(t.dir, f), 'utf8'), adder(t.id + '/' + f));
  if (fs.existsSync(path.join(t.dir, 'panel.html'))) scanHtml(fs.readFileSync(path.join(t.dir, 'panel.html'), 'utf8'), adder(t.id + '/panel.html'));
  for (const k of ['name', 'line', 'goalHint']) if (def[k]) adder(t.id + ' ' + k)(def[k]);
  return { def: def, used: used };
}
module.exports = { scanHtml, scanCode, hostWords, themeWords, themeDirs };

if (require.main === module) {
  const MT = require('../src/core.js'), page = require('../src/lang.js').words;
  let n = 0; const fail = msg => { n++; console.log('FAIL ' + msg); };
  const host = hostWords(fail), langs = MT.LANGS.map(l => l[0]).filter(id => id !== 'en');
  for (const id of langs) {
    const words = page[id], missing = [...host.keys()].filter(k => !(k in words)), unused = Object.keys(words).filter(k => !host.has(k));
    for (const k of missing) fail(id + ' has no words for "' + k + '" (' + host.get(k) + ')');
    for (const k of unused) fail(id + ' has words for "' + k + '" in src/lang.js, which the page itself no longer uses' + (n < 4 ? ' (a word only a theme shows goes in that theme\'s words.js)' : ''));
    if (!missing.length && !unused.length) console.log('ok   ' + id + ': all ' + host.size + ' of the page\'s words translated');
  }
  for (const t of themeDirs(process.argv)) {
    if (!t.dir) { fail('theme ' + t.id + ' not found'); continue; }
    const { def, used } = themeWords(t), own = def.words || {}, before = n;
    for (const id of def.langs.filter(l => l !== 'en')) {
      const mine = own[id] || {};
      for (const [k, where] of used) if (!(k in mine) && !(k in page[id])) fail(t.id + ' has no ' + id + ' words for "' + k + '" (' + where + ')');
      for (const k of Object.keys(mine)) {
        if (!used.has(k)) fail(t.id + ' has ' + id + ' words for "' + k + '", which it no longer uses');
        else if (page[id][k] === mine[k]) fail(t.id + ' repeats the page\'s ' + id + ' words for "' + k + '": the page\'s are used without it');
      }
    }
    if (n === before) console.log('ok   ' + t.id + ': ' + used.size + ' words, in ' + def.langs.join(', ') + ' (' + Object.keys(own[def.langs.find(l => l !== 'en')] || {}).length + ' of its own)');
  }
  process.exit(n ? 1 : 0);
}
