# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Music Timer: a practice timer that only counts time while an instrument is heard through the microphone, with four
themes (Classic, Rocket, City, Dash). It ships as one self-contained HTML page on GitHub Pages:
https://rememberjack.github.io/practice-timer/. The project is written entirely by Claude, from plain-language requests.

## Commands

Node 20+, no dependencies to install.

    npm test          all unit tests (src/core.js), at 44.1 and 48 kHz; about 10 s
    npm run build     joins src/ into dist/index.html (dist/ is not committed)
    npm run check     smoke-checks the built page (parses, required element ids, size < 600 KB)
    npm run ci        all three; this is what GitHub Actions runs, so run it before every push
    npm run serve     build and serve locally (the microphone works on localhost)

Run only some tests by filtering on the test name:

    node -e "const MT=require('./src/core.js'); for (const t of MT.detectionTests(44100)) if (/Rocket/.test(t.name)) { const r=t.run(); console.log((r.pass?'PASS ':'FAIL ')+r.name+' | '+r.got) }"

## How the page is put together

- `scripts/build.js` substitutes `src/core.js` into `/*__CORE__*/` and `rocket.js`, `city.js`, `dash.js`, `app.js`
  (concatenated, in that order) into `/*__APP__*/` in `src/template.html`, and the build id into `__BUILD__`. The
  build fails if any source contains `</script`. It also embeds `src/assets/app-icon.png` into `__APP_ICON__` (the
  header icon) and copies the favicons and home-screen icons from `src/assets/` next to the page.
- `src/core.js` is pure logic with no DOM, loaded in Node by the tests and exposed as `window.MT` in the page: the
  FFT and `MusicDetector` (music vs. not-music, pitch and instrument), the synthetic test clips (`CLIPS`), `Session`
  (play / active / total time, and the whole session as runs of playing, quiet and paused), `sessionReport` (the figures in the
  session summary), `sessionRecord` and `practiceStats` (the practice log: saved sessions, streak, week, calendar), `RocketSim`, `DashSim`, `OnsetTracker` and `WheelSwipe` (trackpad swipes). Anything
  that decides behaviour belongs here, with a test.
- The tests live in `core.js` too: `DETECTION_CASES` plus the `list.push(...)` entries in `detectionTests()`. A new
  test is a new entry there; `test/run.js` only runs the list. The same list runs in the page from Settings
  (`btnTests`), so a test must also work in the browser.
- `rocket.js`, `city.js` and `dash.js` are renderers only (`makeRocketView`, `makeCityView`, `makeDashView`); they
  read the sims from the core and draw. City is three.js r128, loaded from cdnjs the first time the theme is shown.
- `src/app.js` is one IIFE that wires everything together. Two loops run: `tick()` on a 46 ms interval advances the
  session and sims from the microphone (or demo clip), and `frame()` on requestAnimationFrame paints. Settings are
  stored in localStorage under `musicTimer.settings`; `DEF.v` is the schema version used for migrations. Finished sessions
  are kept in localStorage under `musicTimer.log` (a record per session with its report, `v: 1`, no audio), newest last.
- `window.claude` (room, downloads) and the "framed" checks are for running inside a Claude artifact view, where
  the microphone is unavailable and other devices can follow a session. On GitHub Pages they are absent and
  everything falls back to plain browser APIs.

## Themes

- The four themes are panels on one sliding `#track` in `SKINS` order; swipes, trackpad and arrow keys call
  `setSkin()`. Only the theme on screen is drawn, plus the one a swipe is revealing (`visible(i)` in `app.js`). Keep
  it that way: drawing hidden themes made swipes lag on phones.
- A trackpad swipe arrives as horizontal wheel events, and momentum keeps them coming for a second or two after the
  fingers lift, so a quick next swipe starts with no pause between. `WheelSwipe` tells a new swipe from momentum; its
  tests replay wheel events recorded on real Macs and a Windows laptop (`WHEEL_TRACES`).
- `#stage` has `touch-action:pan-y` so a sideways touch swipe reaches the page, but a scroll area inside it does not
  inherit that: give every scroller in a theme its own `touch-action:pan-y pinch-zoom` (as `.classic` has), or
  Android Chrome takes the swipe for itself and cancels it.
- Rocket, City and Dash share the "pixel" chrome (`data-chrome="pixel"`) and must keep the same vertical spacing
  around the scene (controls bar, demo bar, notice) at every screen size. If one theme's padding differs, every swipe
  resizes all the scenes (City refits its camera and reallocates its WebGL buffer) and the page jumps. Check the
  scene height (`#stage`) in each theme after changing theme CSS.
- On a tablet (a screen at least 700 x 600 px; the "tablet layout" block in `template.html`) all four themes share one frame:
  the page edge `--edge`, the title row, demo bar, theme bar and buttons at the same heights, and read-outs on top with the
  picture below. Rocket, City and Dash use one read-out card with the same size and grid (a strip in landscape), and their
  event banners sit under it via `--hud-b`. Change the three together. Phones keep their own layout.
- Engine power is practice efficiency. The rocket lifts off once it holds `LIFTOFF` (50%) for 3 s, and falls if it
  drops below 50% before reaching space.

## Testing in the browser

Phone behaviour matters most; the app is mainly used on an iPhone (including Arc Search, where microphone access is
granted per app in iOS Settings). In cloud sessions, Playwright with Chromium is installed globally
(`require($(npm root -g)/playwright)`, with device profiles such as `devices['iPhone 13']`). cdnjs is not reachable
from the cloud sandbox, so to test the City theme, fetch three.js with `npm pack three@0.128.0` and serve
`package/build/three.min.js` through `page.route('**/three.min.js', ...)`. Headless Chromium has no GPU, so its frame
times say nothing about a phone; measure what the code does (draw calls, resizes, layout sizes) instead.

## Workflow

- Start each branch from a fresh `origin/main` (`git fetch origin main`); the local `main` is often stale because
  several sessions work on this repository in parallel.
- One pull request per requested change. Pushes to `main` deploy to the live site once the tests pass.
- Commit messages explain what changed and why in plain language, and end with trailers naming the model and the
  effort level used, for example `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` and
  `Claude-Effort: high`.
- User-facing text is plain, complete sentences; on iOS, point microphone problems to the Settings app.
