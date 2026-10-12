// Every word the player sees has a translation in each language (src/lang.js), and every translation is still used.
// The words are found where the page writes them: the text and labels in src/template.html (the debug tools stay in English),
// the English given to tr() and trn() in src/, and the tables of words the app looks up (TABLES). Exits 1 if any is missing.
const fs = require('fs'), path = require('path'), vm = require('vm');
const MT = require('../src/core.js'); require('../src/lang.js');
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const used = new Map();   // English -> where it was found
const add = (s, where, any) => { if ((any ? s : /[A-Za-z]/.test(s)) && !used.has(s)) used.set(s, where); };   // the page's text counts if it has a letter in it

// the page's own words: text between tags and the aria-label and title of each element, outside scripts, styles, icons and what is marked translate="no"
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D', times: '\u00D7', minus: '\u2212', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', Prime: '\u2033', lsaquo: '\u2039', rsaquo: '\u203A', nbsp: '\u00A0' };
const decode = s => s.replace(/&(\w+);/g, (m, k) => ENT[k] != null ? ENT[k] : m).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
let body = src('template.html'); body = body.slice(body.indexOf('<body'));
body = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '')
;
for (let m; (m = /<(\w+)[^>]*\stranslate="no"[^>]*>/.exec(body));) {   // an element left in English (the debug tools) or filled in by the app: to its own end tag
  const tag = m[1], re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'g'); re.lastIndex = m.index + m[0].length; let depth = 1, e;
  while (depth && (e = re.exec(body))) depth += e[1] ? -1 : 1;
  body = body.slice(0, m.index) + body.slice(e ? e.index + e[0].length : body.length);
}
for (const m of body.matchAll(/>([^<]+)</g)) add(decode(m[1]).trim(), 'template.html');
for (const m of body.matchAll(/\s(?:aria-label|title)="([^"]*)"/g)) add(decode(m[1]).trim(), 'template.html');

// the English given to tr() and trn(): the strings in their arguments, leaving out the {blanks} object and comparisons (x === 'paused')
function scan(code, file) {
  for (const m of code.matchAll(/(?<![\w$])trn?\(/g)) {
    let i = m.index + m[0].length, depth = 1, brace = 0;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '\'' || ch === '"') {
        let j = i + 1, s = ''; while (code[j] !== ch) { if (code[j] === '\\') { s += code.slice(j, j + 2); j += 2; } else s += code[j++]; }
        const before = code.slice(Math.max(0, i - 5), i), after = code.slice(j + 1, j + 6);
        if (!brace && !/[=!]==?\s*$/.test(before) && !/^\s*[=!]==/.test(after)) add(JSON.parse('"' + s.replace(/\\'/g, '\'').replace(/"/g, '\\"') + '"'), file, true);
        i = j + 1; continue;
      }
      if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === '{') brace++; else if (ch === '}') brace--;
      i++;
    }
  }
}
for (const f of ['core.js', 'app.js', 'rocket.js', 'city.js', 'dash.js', 'race.js', 'fireworks.js', 'fireworks3d.js']) scan(src(f), f);

// the tables of words the app looks up by key; each gives the strings that are words (not ids)
const TABLES = { 'app.js': { EVENT_TEXT: Object.values, NEXT: t => t.map(x => x[1]), CITY_TEXT: Object.values, GOAL_HINT: Object.values, THEME_LINE: Object.values, SKIN_NAMES: t => t,
  VIZ: t => t.map(x => x[1]), LANG_ABOUT: Object.values, CREDITS: t => t.flatMap(([h, rows]) => [h].concat(rows.map(r => r[0]))) }, 'core.js': { ORDINALS: t => t } };
let bad = 0;
for (const [file, tables] of Object.entries(TABLES)) {
  const code = src(file);
  for (const [name, pick] of Object.entries(tables)) {
    const at = code.search(new RegExp('(?:const |, )' + name + ' = ')); if (at < 0) { console.log('FAIL table ' + name + ' not found in ' + file); bad++; continue; }
    let i = code.indexOf('=', at) + 1; while (code[i] === ' ') i++;
    const open = code[i], close = open === '[' ? ']' : '}'; let depth = 0, j = i;
    for (; j < code.length; j++) { if (code[j] === '\'') { j++; while (code[j] !== '\'') j += code[j] === '\\' ? 2 : 1; continue; } if (code[j] === open) depth++; else if (code[j] === close && --depth === 0) break; }
    for (const s of pick(vm.runInNewContext('(' + code.slice(i, j + 1) + ')'))) add(s, file + ' ' + name);
  }
}

const langs = MT.LANGS.map(l => l[0]).filter(id => id !== 'en');
for (const id of langs) {
  const words = require('../src/lang.js').words[id];
  const missing = [...used.keys()].filter(k => !(k in words));
  const unused = Object.keys(words).filter(k => !used.has(k));
  for (const k of missing) console.log('FAIL ' + id + ' has no words for "' + k + '" (' + used.get(k) + ')');
  for (const k of unused) console.log('FAIL ' + id + ' has words for "' + k + '", which nothing uses now');
  bad += missing.length + unused.length;
  if (!missing.length && !unused.length) console.log('ok   ' + id + ': all ' + used.size + ' words translated');
}
process.exit(bad ? 1 : 0);
