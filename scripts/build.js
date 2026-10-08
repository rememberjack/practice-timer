// Builds dist/index.html: one self-contained file from src/. No dependencies.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const root = path.join(__dirname, '..'), src = f => fs.readFileSync(path.join(root, 'src', f), 'utf8');
let sha = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : '';
if (!sha) { try { sha = cp.execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { sha = 'local'; } }
const build = sha + ' ' + new Date().toISOString().slice(0, 10);
const parts = { core: src('core.js'), rocket: src('rocket.js'), city: src('city.js'), dash: src('dash.js'), app: src('app.js') };
for (const n in parts) if (/<\/script/i.test(parts[n])) throw new Error('"</script" found in ' + n + '.js; it would end the inline script early');
const out = src('template.html').replace('__BUILD__', build).replace('/*__CORE__*/', () => parts.core).replace('/*__APP__*/', () => parts.rocket + '\n' + parts.city + '\n' + parts.dash + '\n' + parts.app);
const dist = path.join(root, 'dist'); fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), out);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
if (process.env.CNAME) fs.writeFileSync(path.join(dist, 'CNAME'), process.env.CNAME + '\n');   // optional custom domain
console.log('built dist/index.html, ' + (out.length / 1024).toFixed(0) + ' KB, version ' + build);
