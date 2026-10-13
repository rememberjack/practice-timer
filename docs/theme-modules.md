# Theme modules

Every theme in Music Timer (Classic, Rocket, City, Dash, Grand Prix, Fireworks) is a self-contained module: one folder holding
everything the theme is, from its picture and read-outs to its words and tests. The page knows nothing about any particular theme. It
installs the modules listed in a manifest and drives each one through a small, versioned interface.

This document is that interface. It covers:

- [the folder](#the-folder) and [installing, removing and reordering](#installing-removing-and-reordering) themes;
- [the definition](#the-definition) a module exports;
- [the hooks](#the-hooks) the page calls, and [the host](#the-host) it hands each theme;
- [languages](#languages): a theme declares the languages it is written for;
- [markup, style and icon](#markup-style-and-icon);
- [logic and tests](#logic-and-tests), and [saved data and following](#saved-data-and-following);
- [how the contract is checked](#how-the-contract-is-checked), and [a new theme, step by step](#a-new-theme-step-by-step).

The interface is version 1 (`MT.THEME_API`). The code behind it is the "Theme modules" section of `src/core.js` (the registry and
the checks), the "themes" section of `src/app.js` (the host), `scripts/build.js` and `scripts/themes.js` (the build and the Node loader).

## The folder

```
src/themes/
  themes.json          the installed themes, in swipe order: ["classic", "rocket", "city", "dash", "race", "fireworks"]
  race/
    theme.js           the module: its definition (required)
    panel.html         its panel, one <section class="panel"> (required)
    icon.svg           its icon, one <symbol id="ico-race"> (required)
    style.css          its look (optional, but it must give its Settings tile colours)
    words.js           its words in other languages (by convention; theme.js requires it)
    sim.js             its logic, with no DOM (by convention)
    view.js            its drawing (by convention)
    tests.js           its tests (by convention)
```

Only `theme.js`, `panel.html` and `icon.svg` are required; the rest is how the six built-in themes are laid out, and any split works.
Every `.js` file in the folder is a CommonJS module: it gets `require`, `module` and `exports`, and `require` finds two things only:

- `./other.js`: another file of the same folder;
- `../../core.js`: the core (`MT`), wherever the folder is.

In the page the build gives each file those three names and wraps the folder in a small loader (`mtTheme` in `scripts/build.js`); in
Node, `scripts/themes.js` does the same for the build and the tests. So a theme's files run unchanged in both, and its logic and tests run
in Node without a browser. A theme's files must not touch the page when they are loaded (only from `create`), so that Node can load them.

## Installing, removing and reordering

The installed themes are the ids in `src/themes/themes.json`, in the order they are swiped through. The first is the **base theme**
(Classic): it is always on, it cannot be turned off in Settings, it must be written for every language, and the page lands on it when the
theme on screen goes away.

- **Install** a theme: put its folder in `src/themes/` and add its id to `themes.json` where it should sit in the swipe.
- **Remove** a theme: take its id out of `themes.json` and delete its folder. Nothing else in the app names it: its words, style,
  icon, panel and tests go with the folder. Saved sessions keep what it stored (`themes.<id>`), harmlessly, and its id in the player's
  `themesOff` setting is forgotten. `npm test` fails if a folder in `src/themes/` is not listed, so a half-removed theme is noticed.
- **Reorder**: change the order in `themes.json`.

The build can also try another set without touching the manifest:

```
node scripts/build.js --themes classic,race                          # only these, in this order (the first is the base)
node scripts/build.js --theme-dir ../my-themes --themes classic,mine  # also look for theme folders in ../my-themes
node scripts/build.js --out /tmp/try                                 # write the page somewhere other than dist/
```

`node test/words.js` takes the same `--themes` and `--theme-dir` options. A theme that breaks the interface stops the build with what
is wrong (`MT.checkTheme`); in the page, a theme that fails to install or start is left out with a message in the console and the debug
tools, and the others carry on.

## The definition

`theme.js` exports the definition, a plain object. `MT.checkTheme(def)` lists everything wrong with one, in words; a key it does not know
is an error (a typo, or a newer interface).

| Key | Required | What it is |
| --- | --- | --- |
| `api` | yes | The interface version it is written for: `1`. |
| `id` | yes | 2 to 16 lower-case letters and digits, starting with a letter, the same as its folder's name. It names its icon (`#ico-<id>`), its look (`#app[data-skin="<id>"]`, `[data-theme="<id>"]`), what it saves (`themes.<id>`) and what it shares with a following device. |
| `name` | yes | Its name, in English (translated through its words). |
| `line` | yes | One line in English for Settings, Themes. |
| `goalHint` | no | The practice goal's hint in Settings when Settings is opened from this theme. Without it: "The total play time to reach." |
| `langs` | yes | The languages it is written for: ids from `MT.LANGS` (`'en'`, `'zh'`, `'fr'`), English among them. See [languages](#languages). |
| `words` | no | Its own words, by language: `{ zh: { 'English': '中文' }, fr: { 'English': 'Français' } }`. |
| `panel` | yes | The id of its panel, the `<section>` in `panel.html`. |
| `chrome` | yes | The page around the scene: `'clean'` (Classic's title row, with the app icon and tagline) or `'pixel'` (the compact title row and pixel buttons the scene themes share, which a theme restyles in its `style.css`). |
| `fonts` | no | Google Fonts families it needs, as the css2 URL writes them: `['Barlow+Condensed:ital,wght@0,600;1,800']`. The build adds them to the page's one font link. |
| `tests` | no | Its tests: `[{ name, run }]`, where `run()` returns `{ name, expect, got, pass }`. |
| `create` | yes | `create(host)`: called once when the page starts; returns the instance, an object of [hooks](#the-hooks). |

```js
'use strict';
const MT = require('../../core.js');
const words = require('./words.js');
const { tr } = MT.translator(words);

module.exports = {
  api: 1, id: 'sample', name: 'Sample', line: 'A test theme: a dot that grows as you play.',
  langs: ['en'], words: words, panel: 'pSample', chrome: 'pixel',
  create(host) {
    return {
      paint(v) { host.text(host.$('smPlay'), host.fmt(v.play)); host.text(host.$('smHeard'), host.heardLine(v)); },
    };
  },
};
```

## The hooks

What `create(host)` returns. Every hook is optional; `MT.checkInstance` rejects a name that is not one of these (`MT.THEME_HOOKS`) or a
hook that is not a function. "Each theme" means every installed theme, shown or not; keep the hidden case cheap.

| Hook | Called | With | Returns |
| --- | --- | --- | --- |
| `show()` | when it becomes the chosen theme (also when the page starts on it) | | |
| `hide()` | when another theme is chosen | | |
| `reset(s)` | on each theme when a session starts (`s.why` `'start'`), when following another device starts (`'follow'`), and when following stops (`'local'`) | `s = { why, goal, seed }`; `goal` and `seed` with `'start'` and `'follow'` | |
| `restore(log)` | on each theme between sessions, when what carries over may have changed: the page starting, the practice log changing, the app coming back to the screen on the Home Screen (perhaps a new day) | the practice log, oldest first (read only) | |
| `tick(dt, s)` | on each theme, on session time: every 46 ms while a session runs here; every frame while following | `dt`: seconds of session time (0 for time the app was away); `s = { state, heard, music, recent, play, goal, rdt, away, follow }` | |
| `frame(dt, f)` | on each theme, every animation frame | `dt`: real seconds (at most 0.1); `f = { shown, v }` (`shown`: on screen, or being swiped into view; `v`: the [view](#the-view-v)) | |
| `paint(v)` | after `frame`, only while it is shown | the [view](#the-view-v) | |
| `notes(n)` | on each theme when note starts are heard (or arrive from the device followed) | how many | |
| `stopped(s)` | on each theme when the session ends (End) | `s = { play }` | |
| `goalChanged(goal, play)` | on each theme when the goal is changed in Settings during a session | seconds | |
| `awardLine()` | on the theme on screen when the trophy card shows | | a line for the card, in its words, or `''` |
| `holdAward()` | on the theme on screen when the goal is reached | | `true` to hold the trophy card back; then the theme calls `host.award()` when it is ready (Fireworks: after its finale). It shows anyway if the player moves to another theme |
| `resize()` | on each theme when the layout may have changed, and when a swipe starts | | |
| `langChanged()` | on each theme when the page's language changes | | |
| `share()` | on each theme when the session is shared with following devices (about three times a second) | | a small JSON-able object |
| `follow(data, from)` | on each theme, on a following device, each time the device followed shares | `data`: what that device's same theme shared (`{}` if nothing); `from = { first, state, recent }` | |
| `keep()` | on each theme when the session is saved (at End, and every few seconds while it runs, in case the app is closed) | | a plain object to keep with the session, or `null` |
| `sampleLog(records)` | on each theme when the debug tools load a sample practice log | the sample records, oldest first, to add its own data to (`record.themes[id]`) | |
| `homeLink()` | on the chosen theme when the Home Screen is drawn | | `{ text, run }` for a link after "Playing with <name>", or `null` |
| `debugLine()` | on each theme for the debug read-out (developer only, in English) | | one line |
| `debugTools(el)` | on each theme when the debug sheet is drawn; with `null` when the debug tools are turned off | an empty `.field` element to fill (in English) | |

The order within a frame is: the session's figures are worked out into the view, then each theme's `frame`, then the shown theme's
`paint`. Only the theme on screen (and the one a swipe is revealing) should draw: drawing hidden themes made swipes lag on phones.

### The view (`v`)

The page's figures, from this device's session or from the device being followed. One object, updated in place each frame (`host.view`).

| Field | What it is |
| --- | --- |
| `st` | `'idle'`, `'running'`, `'paused'` or `'stopped'` |
| `play`, `active`, `total` | seconds: played, timed while running, since the start |
| `pauses` | how many pauses |
| `goal` | the practice goal, in seconds |
| `eff` | the session's efficiency, 0..1 |
| `pw` | the last minute of playing (Power, Intensity), 0..1 |
| `music` | the clock is counting now |
| `hold` | counting through a short quiet |
| `label`, `detail` | what is heard, in words |
| `note`, `midi` | the note heard (`'A4'`) and its pitch as a fractional piano key number, or `''` and `null` |
| `inst` | the instrument heard, if known |
| `level` | how loud, 0..1 |
| `minute` | the last minute, a second at a time (`null` while following) |
| `follow`, `followName` | following another device, and its player's name |
| `demo` | the demo sound is on (debug tools) |

## The host

What `create(host)` is given. A theme reaches the page only through it (and `require('../../core.js')`).

| Member | What it is |
| --- | --- |
| `id`, `panel` | its id and its panel element |
| `$(id)` | `document.getElementById` |
| `tr(english, vars)`, `trn(n, one, other, vars)` | its words, then the page's, then the English ([languages](#languages)) |
| `view` | the [view](#the-view-v) object |
| `fmt(seconds)` | `'mm:ss'` or `'h:mm:ss'` |
| `text(el, s)`, `html(el, s)`, `width(el, f)`, `left(el, f)` | write an element's text, HTML, width or left (as a fraction), only when it changed |
| `heardLine(v)` | the line under the read-outs: what is heard while running, else the session's state |
| `goalLeft(v)` | "12:00 left" |
| `powerBar({ fill, tick, power, eff }, v, cls)` | fills a power bar: the fill and Power for the last minute, the tick and Efficiency for the session (`cls` on the fill) |
| `noteText(note)` | a note's name in the page's language (French says do, ré, mi) |
| `drawPixelTrophy(canvas)` | draws the 16 by 16 pixel trophy |
| `locale()` | the locale for numbers in the page's language |
| `reduceMotion` | the player asked for less motion |
| `audio` | `{ bars, det() }`: the 44 level bands (0..1) and the detector, `null` until a session starts (Classic's sound pictures) |
| `shown()`, `current()`, `following()`, `between()` | on screen (or being swiped in); the chosen theme; following another device; no session running here |
| `award()` | shows a trophy card held back by `holdAward` |
| `ask({ title, text, yes, no, home })` | asks a question in its look (in the plain look with `home: true`, from the Home Screen); a promise of `true` for yes |
| `log()` | the practice log (read only) |
| `push()` | shares the session with following devices now |
| `homeChanged()` | draws the Home Screen again, if it is showing (after its `homeLink` changed) |
| `layoutChanged()` | the page measures and resizes again |
| `lastSwipe()` | when a swipe last landed (to tell a tap from the lift of a swipe) |
| `pref(key)`, `pref(key, value)` | reads and writes its own setting, kept with the page's settings (Classic's sound picture) |

## Languages

Every word a theme shows is written in English and goes through its `tr` or `trn`. `MT.translator(words)` gives the same pair the host
does, so the module can translate at load time too (`const { tr, trn } = MT.translator(words)`).

- **Lookup**: its own words for the page's language, then the page's words (`src/lang.js`), then the English. Its own words win
  over the page's. French spacing (a non-breaking space before `! ? : ;`) is applied to its French as to the page's.
- **Which words are whose**: `src/lang.js` holds only the words the page itself shows, plus the read-outs most themes share
  (`MT.COMMON_WORDS`: Play time, Efficiency, Goal, Power, Pauses, Reached), so a theme can show those without words of its own. Any
  other word a theme shows is in its own `words`. Taking a theme out therefore never leaves words behind.
- **Blanks and contexts**: a translation keeps the same `{blanks}`; `'Start|part'` (a context after `|`) tells apart two uses of one
  English word. `trn` picks the plural by the language's rule (French counts 0 as one; Chinese has one form).
- **Tables**: a word written now and shown later (a table of banners) is wrapped in `MT.word('...')`, which returns it unchanged, so
  `npm test` finds it.
- **The panel**: the text, `aria-label` and `title` in `panel.html` are translated with the theme's words when the language changes;
  `translate="no"` leaves an element alone (figures the theme fills in).
- **`langs`**: the languages the theme is written for. A theme may leave some out. In a language it is not written for, the theme is
  not offered: it leaves the swipe, the theme bar and the Home Screen choices (as if turned off, with no padlock), and Settings, Themes
  lists it dimmed with "Not in this language yet.", its switch kept as the player left it. If it was on screen, the page lands on the
  base theme. It comes back as soon as a language it is written for is chosen. The base theme must be written for every language.
- **Checked**: a theme has words for each language in `langs` but English, the same words in each, and none for a language it is not
  written for (`MT.checkTheme`); every word it shows is in its words or the page's, and every word in its words is still shown
  (`npm test`, `test/words.js`).

Each UI change still has to fit an iPhone SE (375×667 and 320×568) in every language it is written for; French runs longest.

## Markup, style and icon

**`panel.html`** is one `<section class="panel" id="<panel>" aria-label="<Name> theme">`, with ids no other part of the page uses and
no scripts. The build puts the panels in the swipe track in manifest order. A scene theme usually has:

- a canvas for its scene;
- a read-out card, `.hud-card`, to share the page's tablet layout (one card of the same size and grid in every theme): `.hc-top` (the
  first row's wrapper), `.hc-play` (play time), `.hc-side` (the goal), `.hc-bar` (its bar row), `.hc-stats` (the row of figures),
  `.hc-heard` (what is heard) and `.hc-next` (the hint). The page measures the card and sets `--hud-b` (its bottom) on the panel, for
  banners placed just under it;
- banners and messages of its own.

**`style.css`** is the theme's look, put into the page after the page's own styles and before its shared phone and tablet layouts. It
must give its tile in Settings, Themes: `[data-theme="<id>"]{--g:#rrggbb; --t:#rrggbb}` (ground and tint). It may restyle:

- the page around its scene, under `#app[data-skin="<id>"]` (the colours `--paper`, `--surface`, `--ink`, `--mute`, `--rule`,
  `--accent`, `--on-accent`; the title row, the buttons, the theme bar's `--tint`, the trophy card);
- the ground around the column on a wide screen: `body:has(> #app[data-skin="<id>"]){background:...}`;
- questions asked over it (`host.ask`, End): `.ask[data-skin="<id>"]`;
- its own panel, by its ids and classes.

It must not name another theme. Where a rule of the shared phone or tablet layout (`#app[data-chrome="pixel"] ...`, `.hud-card ...`)
has the same specificity as the theme's, the shared one comes later and wins: add `[data-chrome="pixel"]`, or the card's class
(`.city-hud.hud-card`), to win. Any scroll area inside a panel needs `touch-action:pan-y pinch-zoom`, or Android Chrome cancels sideways
swipes. Themes with the pixel chrome keep the same scene height (`#stage`) at every screen size, so a swipe never makes the page jump.

**`icon.svg`** is one `<symbol id="ico-<id>" viewBox="0 0 24 24">`, drawn in `currentColor` on the 24-unit grid. It is shown in the
theme bar, Settings and the Home Screen.

## Logic and tests

Keep a theme's behaviour (what happens, and when) in a file with no DOM, `sim.js` by convention, and its drawing in another (`view.js`).
The logic is what the tests check: a theme's `tests` run with the page's own in `npm test` (once, in English) and in the debug tools'
Sound tests. Each test is `{ name, run }`, and `run()` returns `{ name, expect, got, pass }`: what it expected and what it got, in words.

Things a theme draws only while shown (`f.shown`) still have to stay right while hidden: count time in `tick` and `frame`, and draw in
`frame` only when shown. Effects that age only as they are drawn should not be queued while hidden, or they all play at once on coming back.

## Saved data and following

- **Saving**: what `keep()` returns is saved with the session as `record.themes[<id>]` (only a plain object; anything else is dropped),
  and in the snapshot kept while the session runs. `restore(log)` reads it back between sessions: Rocket carries the day's flight on
  from the latest session that day. Records saved before themes kept their own had the rocket as `record.rocket`; `MT.upgradeRecord`
  moves it to `record.themes.rocket` when the log is read.
- **Sample logs** (debug tools): `MT.sampleLog` makes the sessions; each theme's `sampleLog(records)` adds its own data to them.
- **Following** another device: the session shared by one device carries `th: { <id>: share() }`, and the following device's theme gets
  its part in `follow(data, from)`. Keep it small: it is sent about three times a second. A session seed (`reset`'s `seed`) is shared
  too, so a theme can make the same random choices on both devices (Grand Prix's field).

## How the contract is checked

| Where | What |
| --- | --- |
| `MT.checkTheme(def)` (`src/core.js`) | the definition: every key, its type and value, unknown keys, the words against `langs` and `{blanks}` |
| `MT.addTheme(def)` | the definition, a unique id, and the base theme written for every language |
| `MT.checkInstance(inst)` | what `create` returned: only known hooks, each a function |
| core tests (`npm test`, Sound tests) | the checks above against a sound definition and 31 broken ones; the translator; which themes a language offers; what a theme keeps |
| `test/themes.js` (`npm test`) | the manifest; each theme's folder (definition, panel, icon, style, requires, its own tests, nothing of another theme's); the registry; pages built with only the base theme, each theme alone, the reverse order and a theme from another folder; a broken theme stopping the build |
| `test/words.js` (`npm test`) | the page's words and each theme's words, per language it is written for |
| `test/browser.js` (`npm run check`) | in Chromium: every theme starts and keeps to the interface; a page with only the base theme; the English-only test theme driven through its hooks, saved under its id, and leaving the swipe in French |
| `scripts/build.js` | stops on a theme that breaks the interface, is missing a file, is not where it is listed, or is listed twice |
| the page | leaves out a theme that fails to install or start, and says so in the console and the debug tools |

## A new theme, step by step

`test/fixtures/themes/sample/` is a small complete theme to copy: English only, with a panel, a style, an icon, a helper file and a test.

1. Make `src/themes/<id>/` with `theme.js`, `panel.html`, `icon.svg` and `style.css` (start from the sample, or a built-in theme with a
   similar scene).
2. Give it its definition: `name`, `line`, `langs`, `panel`, `chrome`, and `create`.
3. Put its behaviour in a DOM-free file with tests, and its drawing in another; wire them in `create` through the hooks it needs.
4. Write its words in English through `tr`, `trn` and `MT.word`, and give each language in `langs` its translations in `words.js`.
   `npm test` names any that are missing.
5. Add its id to `src/themes/themes.json` where it should sit in the swipe.
6. Run `npm run ci`, then look at it in each language at iPhone SE sizes, during a session.
7. List anything it uses that was not written for it (a library, a font, data) in `THIRD_PARTY_NOTICES.md`.

## Changing the interface

The interface is versioned (`api`). A change that every theme can ignore (a new optional hook or host member, a new field in the view)
keeps the version: add it to `THEME_HOOKS` or the host, to this document and to the tests. A change that breaks a theme written for
version 1 raises `MT.THEME_API`, and every theme's `api` with it once it is updated; `checkTheme` then refuses any theme still written for
the old one, so a theme is never driven through an interface it was not written for.
