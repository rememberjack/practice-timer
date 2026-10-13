// Finds and loads the theme modules in Node, as the page does (docs/theme-modules.md): used by the build and the tests.
// The themes are the folders listed in src/themes/themes.json, in that order; --themes a,b picks others, and --theme-dir <dir> is also searched
// (after src/themes), for a theme kept outside the app. In the page a theme's require('../../core.js') is the core wherever its folder is;
// here too, so a theme from another folder loads the same.
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..'), CORE = path.join(ROOT, 'src', 'core.js'), THEMES = path.join(ROOT, 'src', 'themes');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  try { return resolve.apply(this, arguments); }
  catch (e) { if (request === '../../core.js' && parent && fs.existsSync(path.join(path.dirname(parent.filename), 'theme.js'))) return CORE; throw e; }
};
const option = (argv, name) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : null; };
/* the installed themes: [{ id, dir }], dir null when no folder has it */
function themeDirs(argv) {
  argv = argv || [];
  const dirs = [THEMES].concat(option(argv, 'theme-dir') ? [path.resolve(option(argv, 'theme-dir'))] : []);
  const ids = option(argv, 'themes') ? option(argv, 'themes').split(',').filter(Boolean) : JSON.parse(fs.readFileSync(path.join(THEMES, 'themes.json'), 'utf8'));
  return ids.map(id => ({ id: id, dir: dirs.map(d => path.join(d, id)).find(d => fs.existsSync(path.join(d, 'theme.js'))) || null }));
}
/* a theme's definition, as its theme.js exports it */
function loadTheme(dir) { return require(path.join(dir, 'theme.js')); }
module.exports = { ROOT, CORE, THEMES, themeDirs, loadTheme, option };
