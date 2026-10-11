// ESLint's recommended rules, mainly for names used but never declared (no-undef). The src/ files are joined into one page in
// order (core, rocket, city, dash, app), so app.js is told about the names the files before it define.
const js = require('@eslint/js'), globals = require('globals');
module.exports = [
  js.configs.recommended,
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': ['error', { caughtErrors: 'none' }] } },   // `catch (e) {}` is how this code ignores what it can do without
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, THREE: 'readonly', module: 'readonly' } } },
  { files: ['src/app.js'], languageOptions: { globals: { MT: 'readonly', makeRocketView: 'readonly', makeCityView: 'readonly', makeDashView: 'readonly' } } },
  { files: ['scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node } },
];
