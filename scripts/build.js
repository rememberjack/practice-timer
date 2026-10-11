// Builds dist/index.html: one self-contained file from src/. No dependencies.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
/* the version is a plain number: how many changes have been merged into main (each push to main adds one), so the live page
   counts up 56, 57, 58... It needs the whole history; a shallow clone would count wrong, so CI stops there rather than ship a wrong number */
const git = c => cp.execSync('git ' + c, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
let build = 'dev';
try {
  if (git('rev-parse --is-shallow-repository') === 'true') { if (process.env.CI) throw new Error('shallow clone: check out with fetch-depth: 0 to number the version'); }
  else build = git('rev-list --count --first-parent HEAD');
} catch (e) { if (process.env.CI) throw e; }
const parts = { core: src('core.js'), rocket: src('rocket.js'), city: src('city.js'), dash: src('dash.js'), app: src('app.js') };
for (const n in parts) if (/<\/script/i.test(parts[n])) throw new Error('"</script" found in ' + n + '.js; it would end the inline script early');
const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'src/assets/app-icon.png')).toString('base64');
const out = src('template.html').replace('__BUILD__', build).replace('__APP_ICON__', () => icon).replace('/*__CORE__*/', () => parts.core).replace('/*__APP__*/', () => parts.rocket + '\n' + parts.city + '\n' + parts.dash + '\n' + parts.app);
const dist = path.join(root, 'dist'); fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), out);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
for (const name of ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'icon.png'])
  fs.copyFileSync(path.join(root, 'src/assets', name), path.join(dist, name));
if (process.env.CNAME) fs.writeFileSync(path.join(dist, 'CNAME'), process.env.CNAME + '\n');   // optional custom domain
console.log('built dist/index.html, ' + (out.length / 1024).toFixed(0) + ' KB, version ' + build);
