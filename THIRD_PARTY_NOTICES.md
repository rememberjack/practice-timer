# Third-party notices and dependency inventory

This file lists everything in Music Timer that was not written for it: code, data, fonts, images and services. For each one it
records where it comes from, its license, whether it ships to players, and what the license asks of us. It also records where
the project's own non-code assets came from.

Music Timer itself is MIT licensed, copyright (c) 2026 Jack Chen ([LICENSE](LICENSE)).

Keep this file up to date in the same pull request as any change that adds, removes, upgrades or changes how a third-party
dependency or asset is used (see "Things that are easy to break" in [CLAUDE.md](CLAUDE.md)).

Last reviewed: 2026-10-13, against `main` at commit 1c4b0bd; icon and City origins confirmed by the owner the same day.

## Summary

| What | Version | License | How it reaches the player | Notice we must keep |
| --- | --- | --- | --- | --- |
| [three.js](#threejs) | r128 (0.128.0) | MIT | Loaded at run time from cdnjs by City and Fireworks; not in our files | None while loaded from cdnjs (its own copy carries the notice); add one if it is ever bundled |
| [Matter.js](#matterjs) | 0.19.0 | MIT | Loaded at run time from cdnjs by Tumble; not in our files | None while loaded from cdnjs (its own copy carries the notice); add one if it is ever bundled |
| [wheel-gestures test data](#wheel-gestures-trackpad-traces) | fixtures as of 2026-10 | MIT | Inlined in `src/core.js`, so it ships in `dist/index.html` | Yes: the MIT notice above `WHEEL_TRACES` in `src/core.js` |
| [Inter](#fonts) | Google Fonts | SIL OFL 1.1 | Loaded at run time from Google Fonts | None (Google serves the fonts with their license) |
| [Silkscreen](#fonts) | Google Fonts | SIL OFL 1.1 | Loaded at run time from Google Fonts | None |
| [Barlow Condensed](#fonts) | Google Fonts | SIL OFL 1.1 | Loaded at run time from Google Fonts | None |
| [Fraunces](#fonts) | Google Fonts | SIL OFL 1.1 | Loaded at run time from Google Fonts | None |
| [Fredoka](#fonts) | Google Fonts | SIL OFL 1.1 | Loaded at run time from Google Fonts | None |
| [ESLint and its dependencies](#development-dependencies) | see below | MIT, Apache-2.0, BSD, ISC, BlueOak | Development only; never shipped | None (not distributed) |
| [Build, test and deploy tools](#build-test-and-deploy-tools) | see below | various | Development and CI only; never shipped | None (not distributed) |

The built page (`dist/index.html` and the icons copied next to it) contains no third-party code. The only third-party material
inside it is the wheel-gestures test data, with its notice.

## Shipped in the page

### wheel-gestures trackpad traces

- What: wheel events recorded on real trackpads and a Magic Mouse, used by the trackpad swipe tests (`WHEEL_TRACES` in
  `src/core.js`). The tests also run in the page from the debug tools, so the data ships in the built page.
- Source: [xiel/wheel-gestures](https://github.com/xiel/wheel-gestures), `src/test/fixtures`. Added in commit 048b860
  (2026-10-09, "Let quick trackpad swipes each change the theme").
- License: MIT. Copyright (c) 2020 Felix Leupold.
- Required notice: the copyright line and the full MIT permission notice. It sits in the comment directly above `WHEEL_TRACES`
  in `src/core.js`, and the build copies the source as is, so it is in `dist/index.html` too. Do not remove or shorten it. If
  the build ever minifies, keep that comment (for example as a `/*!` comment).

## Loaded at run time from other servers

These are fetched by the player's browser from third-party servers. Our files do not contain them, so we do not redistribute
them; the servers deliver each one with its own license. They are listed so we know what the page depends on, and so the right
notice goes in if one is ever bundled or self-hosted.

### three.js

- Used by: City (`src/themes/city/view.js`) and Fireworks (`src/themes/fireworks/view.js`, `view3d.js`), loaded the first time either theme
  is shown.
- URL: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js` (the same URL in both files).
- Upstream: [mrdoob/three.js](https://github.com/mrdoob/three.js), npm package `three@0.128.0`.
- License: MIT. "Copyright © 2010-2021 three.js authors" (`LICENSE`); the minified file starts with
  `@license Copyright 2010-2021 Three.js Authors, SPDX-License-Identifier: MIT`.
- If it is ever bundled into the page or served from this site, add the three.js copyright and MIT notice to the page and to
  this file.
- Tests serve the same version from `npm pack three@0.128.0` because cdnjs is not reachable from cloud sessions (CLAUDE.md,
  Testing).

### Matter.js

- Used by: Tumble (`src/themes/tumble/theme.js` loads it the first time the theme is shown; `pile.js` drives it), to tumble the blocks.
  Until it has loaded, or when it cannot, the theme stacks its blocks plainly (`StackPile` in its `sim.js`).
- URL: `https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js`.
- Upstream: [liabru/matter-js](https://github.com/liabru/matter-js), npm package `matter-js@0.19.0`.
- License: MIT. "Copyright (c) Liam Brummitt and contributors" (`LICENSE`); the minified file starts with
  `matter-js 0.19.0 by @liabru`, `Licensed under the MIT license`.
- If it is ever bundled into the page or served from this site, add the Matter.js copyright and MIT notice to the page and to
  this file.
- `npm run ci` does not need it: in the browser check the theme runs on its plain pile when cdnjs is out of reach. Screenshots
  during development serve it from `npm pack matter-js@0.19.0`.

### Fonts

Loaded from Google Fonts by the one stylesheet link in `src/template.html` (`fonts.googleapis.com`, files from
`fonts.gstatic.com`). The build writes the families into it: Inter and Silkscreen for the page, and those each installed theme
names in its `fonts` (Barlow Condensed for Grand Prix, Fraunces for Fireworks, Press Start 2P for Invaders, Fredoka for Tumble), so a font goes when its theme does. All six are under the SIL Open Font License 1.1, which allows use in any page; the license only adds
conditions when the font files themselves are redistributed or changed.

| Font | Used for | Copyright | Upstream |
| --- | --- | --- | --- |
| Inter | Classic and most read-outs (`--sans`) | Copyright 2020 The Inter Project Authors | https://github.com/rsms/inter |
| Silkscreen | Rocket and City pixel lettering (`--pixel`) | Copyright 2001 The Silkscreen Project Authors | https://github.com/googlefonts/silkscreen |
| Barlow Condensed | Grand Prix (`--cond`) | Copyright 2017 The Barlow Project Authors | https://github.com/jpt/barlow |
| Fraunces | Fireworks (`--serif`) | Copyright 2018 The Fraunces Project Authors | https://github.com/undercasetype/Fraunces |
| Press Start 2P | Invaders, its read-outs, buttons and scene lettering (`--arcade`) | Copyright 2012 The Press Start 2P Project Authors (cody@zone38.net), with Reserved Font Name "Press Start 2P" | https://github.com/google/fonts/tree/main/ofl/pressstart2p |
| Fredoka | Tumble, its read-outs, buttons and the names on the blocks (`--toy`) | Copyright 2020 The Fredoka Project Authors | https://github.com/hafontia-zz/Fredoka |

If the fonts are ever self-hosted (for example to work offline), copy each font's `OFL.txt` alongside the files and keep the
font names unchanged, or rename them if the files are modified (OFL Reserved Font Name rules).

## Development dependencies

`package.json` lists three development dependencies, for the linter only. They are installed by `npm install` / `npm ci`, run
on the developer's machine and in CI, and are never copied into `dist/`.

| Package | Version | License |
| --- | --- | --- |
| eslint | 10.12.0 | MIT |
| @eslint/js | 10.0.1 | MIT |
| globals | 17.13.0 | MIT |

`package-lock.json` pins 79 packages in all (these three and what they depend on): 55 MIT, 12 Apache-2.0, 6 BSD-2-Clause,
4 ISC, 1 BSD-3-Clause (esquery) and 1 BlueOak-1.0.0 (minimatch). All are permissive and none ships to players.

<details>
<summary>Every locked package</summary>

| Package | Version | License |
| --- | --- | --- |
| @cacheable/memory | 2.2.0 | MIT |
| @cacheable/utils | 2.5.0 | MIT |
| @eslint-community/eslint-utils | 4.10.1 | MIT |
| @eslint-community/eslint-utils › eslint-visitor-keys | 3.4.3 | Apache-2.0 |
| @eslint-community/regexpp | 4.12.2 | MIT |
| @eslint/config-array | 0.23.5 | Apache-2.0 |
| @eslint/config-helpers | 0.7.0 | Apache-2.0 |
| @eslint/core | 1.2.1 | Apache-2.0 |
| @eslint/js | 10.0.1 | MIT |
| @eslint/object-schema | 3.0.5 | Apache-2.0 |
| @eslint/plugin-kit | 0.7.3 | Apache-2.0 |
| @humanfs/core | 0.19.2 | Apache-2.0 |
| @humanfs/node | 0.16.8 | Apache-2.0 |
| @humanfs/types | 0.15.0 | Apache-2.0 |
| @humanwhocodes/module-importer | 1.0.1 | Apache-2.0 |
| @humanwhocodes/retry | 0.4.3 | Apache-2.0 |
| @keyv/bigmap | 1.3.1 | MIT |
| @keyv/serialize | 1.1.1 | MIT |
| @types/esrecurse | 4.3.1 | MIT |
| @types/estree | 1.0.9 | MIT |
| @types/json-schema | 7.0.15 | MIT |
| acorn | 8.19.0 | MIT |
| acorn-jsx | 5.3.2 | MIT |
| ajv | 6.15.0 | MIT |
| balanced-match | 4.0.4 | MIT |
| brace-expansion | 5.0.12 | MIT |
| cacheable | 2.5.0 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 4.4.3 | MIT |
| deep-is | 0.1.4 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| eslint | 10.12.0 | MIT |
| eslint-scope | 9.1.2 | BSD-2-Clause |
| eslint-visitor-keys | 5.0.1 | Apache-2.0 |
| espree | 11.2.0 | BSD-2-Clause |
| esquery | 1.7.0 | BSD-3-Clause |
| esrecurse | 4.3.0 | BSD-2-Clause |
| estraverse | 5.3.0 | BSD-2-Clause |
| esutils | 2.0.3 | BSD-2-Clause |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stable-stringify | 2.1.0 | MIT |
| fast-levenshtein | 2.0.6 | MIT |
| file-entry-cache | 11.1.5 | MIT |
| find-up | 5.0.0 | MIT |
| flat-cache | 6.1.23 | MIT |
| flatted | 3.4.4 | ISC |
| glob-parent | 6.0.2 | ISC |
| globals | 17.13.0 | MIT |
| hashery | 1.5.1 | MIT |
| hookified | 1.15.1 | MIT |
| ignore | 5.3.2 | MIT |
| imurmurhash | 0.1.4 | MIT |
| is-extglob | 2.1.1 | MIT |
| is-glob | 4.0.3 | MIT |
| isexe | 2.0.0 | ISC |
| json-schema-traverse | 0.4.1 | MIT |
| json-stable-stringify-without-jsonify | 1.0.1 | MIT |
| keyv | 5.6.0 | MIT |
| levn | 0.4.1 | MIT |
| locate-path | 6.0.0 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| ms | 2.1.3 | MIT |
| natural-compare | 1.4.0 | MIT |
| optionator | 0.9.4 | MIT |
| p-limit | 3.1.0 | MIT |
| p-locate | 5.0.0 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| prelude-ls | 1.2.1 | MIT |
| punycode | 2.3.1 | MIT |
| qified | 0.10.1 | MIT |
| qified › hookified | 2.2.0 | MIT |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| type-check | 0.4.0 | MIT |
| uri-js | 4.4.1 | BSD-2-Clause |
| which | 2.0.2 | ISC |
| word-wrap | 1.2.5 | MIT |
| yocto-queue | 0.1.0 | MIT |

</details>

To refresh this table and the counts after `package-lock.json` changes:

    node -e "const p=require('./package-lock.json').packages;for(const k of Object.keys(p).sort())if(k)console.log('| '+k.split('/node_modules/').join(' › ').replace('node_modules/','')+' | '+p[k].version+' | '+p[k].license+' |')"

## Build, test and deploy tools

Not in `package.json`, never shipped, listed so the toolchain is known.

| Tool | Version | License | Where |
| --- | --- | --- | --- |
| Node.js | 20.19+ / 22.13+ (CI: 22) | MIT (plus bundled third-party licenses) | Runs the build, tests and linter |
| actions/checkout | v4 | MIT | `.github/workflows/deploy.yml` |
| actions/setup-node | v4 | MIT | `.github/workflows/deploy.yml` |
| actions/upload-pages-artifact | v3 | MIT | `.github/workflows/deploy.yml` |
| actions/deploy-pages | v4 | MIT | `.github/workflows/deploy.yml` |
| serve (Vercel) | latest, via `npx --yes serve` | MIT | `npm run serve` only |
| Chromium / Google Chrome | whatever the machine has | BSD-3-Clause and others / Google terms | `test/browser.js` drives it over the DevTools protocol; nothing is installed |
| Playwright | preinstalled in cloud sessions | Apache-2.0 | Screenshots during development; not used by `npm run ci` |
| three (npm) | 0.128.0 | MIT | `npm pack` for testing City and Fireworks offline; not committed (`package/` is in `.gitignore`) |
| matter-js (npm) | 0.19.0 | MIT | `npm pack` for screenshots of Tumble offline; not committed |

## Provenance of the project's own non-code assets

| Asset | Where | Origin | Status |
| --- | --- | --- | --- |
| Music Timer icon (stopwatch and note): `app-icon.png` (84 px, inlined in the page), `favicon.ico`, `favicon.png`, `apple-touch-icon.png`, `icon.png` (512 px) | `src/assets/` | Generated by ChatGPT (OpenAI) from the repository owner's prompt, then committed in 704ced9 (2026-10-09, "Add the Music Timer icon"). The files carry no metadata naming an author or tool. | Ours to use: OpenAI's [Terms of Use](https://openai.com/policies/terms-of-use/) assign to the user whatever rights OpenAI has in the output. An image made by AI may have little or no copyright protection in some countries (the US among them), so others could copy it; that does not limit our own use. |
| Theme and interface icons (`#ico-classic`, `#ico-rocket`, `#ico-city`, `#ico-dash`, `#ico-race`, `#ico-fireworks`, `#ico-invaders`, `#ico-tumble`, `#ico-next`, `#ico-back`, `#ico-trophy`, `#ico-lock`) | `<symbol>`s: each theme's in its `src/themes/<id>/icon.svg`, the rest in `src/template.html` | Hand-written SVG paths, made in this repository by Claude (from 1d5fe67, 2026-10-08, and the commits that added each theme). Not taken from an icon set. | Original, MIT with the project |
| Sunburst before Claude's name in the credits (`#ico-claude`) | `src/template.html` | Drawn in this repository after Claude's mark, not copied from the official logo (19d500b, 2026-10-12). | Original drawing, but it evokes Anthropic's Claude mark: see Trademarks |
| Theme scenes (Rocket, City, Dash, Grand Prix, Fireworks, Invaders, Tumble, Classic) | `src/*.js` | Drawn in code at run time (canvas, three.js geometry and canvas textures, Matter.js bodies); no image, texture or model files. | Original |
| Invaders' pixel sprites (invaders, mystery ship, cannon, shield, bombs) | `src/themes/invaders/sprites.js` | One-bit pixel grids drawn for the project by Claude (2026-10-16) in the manner of 1978 arcade games; not copied from any game. `#ico-invaders` is made from one of them. | Original, MIT with the project |
| Sounds | `src/core.js` | The demo sound and the test sounds are synthesised in code (instrument models "checked against recordings", but no recording is included). The page plays no sound files. | Original |
| Words and translations | `src/core.js`, `src/app.js`, `src/lang.js` | Written for the project (English, with Chinese and French translations). | Original |
| Session timeline drawing | `docs/practice-session-timeline.svg` | Hand-written SVG made in this repository (bd4c8c8, 2026-10-12). | Original |

### Design inspirations

These shaped a theme's idea; no code or art was taken from them.

- City is "after 'Block City Defense'" (`src/themes/city/`, at first `src/city.js`, since the first commit 9d6ffc0). Block City Defense is not an existing
  game: it is the name Claude gave the idea when it wrote the City theme from the owner's prompt (a web search on 2026-10-13
  found no game by that name). Nothing was taken from anywhere.
- Dash is "in the spirit of rhythm platformers, with its own original shapes and colours" (`src/themes/dash/view.js`).
- Invaders is in the manner of the 1978 arcade invader games (a marching fleet, shields, a mystery ship, black and white under red and green
  film): the genre's look and rules, with its own sprites and no code or art taken from any game.
- Grand Prix draws its road segment by segment "the way the old arcade racers did it" (`src/themes/race/view.js`): a technique, not copied
  code.
- Tumble is a crate of children's wooden alphabet blocks (a toy, not a product): its blocks, crate and colours are drawn in code.

### Trademarks

- "Claude" and the Claude mark belong to Anthropic. The credits name Claude for its work on the app, and `#ico-claude` is an
  original drawing that resembles the mark; keep it as an attribution next to Claude's name, not as the app's own branding.
- "Grand Prix", "Rocket", "City", "Dash", "Fireworks", "Invaders" and "Tumble" are used as plain descriptive words. "Space Invaders" is a trademark
  of Taito; the theme does not use that name.

## Open items

- three.js and Matter.js are loaded from cdnjs without a Subresource Integrity hash (`integrity` attribute), so the page trusts whatever
  those URLs serve. Consider adding one (the r128 and 0.19.0 files never change).
- `npm run serve` runs the latest `serve` from npm each time (`npx --yes serve`); consider pinning a version.
- Loading three.js and Matter.js from cdnjs and the fonts from Google Fonts sends the player's IP address to those services. Not a license
  matter, but worth knowing for any privacy statement.

## Keeping this file up to date

Update this file in the same pull request whenever:

- a dependency in `package.json` is added, removed or upgraded, or `package-lock.json` changes (refresh the locked-package
  table and counts with the command above);
- the page starts or stops loading something from another server (a script, font, stylesheet, image or API), or a version or
  URL changes;
- third-party code or data is copied into `src/` or `test/` (record the source, license, copyright and the notice it needs,
  and keep that notice next to the copy);
- an image, icon, sound, font or other non-code asset is added or replaced (record who made it, or which tool, and on what
  terms);
- a GitHub Action or other build, test or deploy tool is added or changes version.

Then update "Last reviewed" at the top.
