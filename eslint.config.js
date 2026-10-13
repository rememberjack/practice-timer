// ESLint's recommended rules, mainly for names used but never declared (no-undef). The page's own src/ files are joined into one page
// (core, lang, the themes, app), so app.js is told about MT. Each theme folder (src/themes/<id>/) is a set of CommonJS files: the build gives
// each file require, module and exports, and require finds the files of the same folder and the core (docs/theme-modules.md).
const js = require('@eslint/js'), globals = require('globals');
module.exports = [
  js.configs.recommended,
  { rules: { 'no-empty': ['error', { allowEmptyCatch: true }], 'no-unused-vars': ['error', { caughtErrors: 'none' }] } },   // `catch (e) {}` is how this code ignores what it can do without
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, THREE: 'readonly', module: 'readonly' } } },
  { files: ['src/lang.js'], languageOptions: { globals: { require: 'readonly' } } },   // in Node (the tests) it finds core.js itself
  { files: ['src/app.js'], languageOptions: { globals: { MT: 'readonly' } } },
  { files: ['src/themes/**/*.js', 'test/fixtures/themes/**/*.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.browser, THREE: 'readonly', require: 'readonly', module: 'writable', exports: 'writable' } } },
  { files: ['scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node } },
];
