# CLAUDE.md

Music Timer: a practice timer that only counts time while an instrument is heard through the microphone, with several
swipeable visual themes. It ships as one self-contained HTML page on GitHub Pages:
https://rememberjack.github.io/practice-timer/.

## Purpose

Develop every feature to encourage future instrument practice; that is the primary goal. When choosing what to build
or how it should behave, prefer what makes someone want to pick up their instrument again tomorrow.
Keep it low pressure and encouraging: show what was played (time this week, time all together), never a streak, days
missed or anything that can be lost by skipping a day.

## Commands

Node 20.19+ or 22.13+. `npm install` once, for the linter (ESLint, a dev dependency only: the page itself has none).

    npm run lint      ESLint over src/, scripts/ and test/ (eslint.config.js); catches names that are never declared
    npm test          unit tests (src/core.js and each theme's), every word translated (test/words.js), the theme modules' contract (test/themes.js)
    npm run build     joins src/ into dist/index.html (dist/ is not committed); --themes a,b, --theme-dir <dir> and --out <dir> build other sets
    npm run ci        lint, tests, build, a smoke check of the built page and swipes in a real browser; GitHub Actions runs this
    npm run serve     build and serve locally (the microphone works on localhost)

## Layout

- `scripts/build.js` inlines `src/core.js`, `src/lang.js`, the theme modules and `src/app.js` into `src/template.html`.
- Each theme is a self-contained module in `src/themes/<id>/` (docs/theme-modules.md is the interface): its definition (`theme.js`), its
  panel, style, icon, words, logic (`sim.js`, no DOM), drawing (`view.js`) and tests (`tests.js`). The installed themes are the ids in
  `src/themes/themes.json`, in swipe order; the first (Classic) is the base theme. `src/app.js` (the host) drives them only through their
  hooks and knows no theme by name; the registry and the contract checks (`checkTheme`, `checkInstance`, `addTheme`, `translator`,
  `themesOpen`) are in `src/core.js`. A theme's files are CommonJS (`require('./x.js')`, `require('../../core.js')`), loaded the same in
  the page and in Node (`scripts/themes.js`).
- `src/core.js` is pure logic with no DOM (detection, `Session`, the practice log, swipe handling: `DragSwipe`, `WheelSwipe`, the theme
  registry) and holds the tests, which also run in the page from the debug tools (Sound tests), with each theme's own. Behaviour belongs
  in the core or in a theme's `sim.js`, with a test.
- Finished sessions are saved in localStorage under `musicTimer.log` (no audio); the practice log's figures (week,
  totals, calendar) come from `practiceStats` in `src/core.js`, which also works out a streak that is not shown for now.
- Recordings (Settings, Record the playing; microphone only) are kept apart from the log, in IndexedDB (`musicTimer` database,
  `recordings` store, by the session's id), for the sessions of today and yesterday, by the day they started (`REC_DAYS`, `recordingKept`,
  `recordingsToDrop` in `src/core.js`). The summary plays and saves them, a past session's too while it has one. Each time the Home Screen shows,
  `sweepRecordings` in `src/app.js` deletes the expired ones and those whose session left the log; deleting a session deletes its recording.
  A session cut short (`musicTimer.live`) comes back without one.
- A day can hold several sessions. The calendar, week bars and Home Screen add up the whole day; `dayRecap` and `dayLine` give the
  summary's "Today" block (each session of the day). The practice goal is for one session, so the block does not measure the day against it.
- Each saved session keeps where the rocket got to if it is in space or Moon orbit (`RocketSim.save` in `src/themes/rocket/sim.js`, kept as
  `record.themes.rocket` through the theme's `keep` hook; older records' `record.rocket` is moved there by `upgradeRecord`); the next session
  that day carries on from it (`rocketCarry`, the theme's `restore` hook). Below space, and on a new day, it starts on the pad. Sessions too short
  to save never move the carried flight; demo sound sessions are saved like any other.
- The rocket's path (`PATH` and `TIMING` in `src/themes/rocket/sim.js`): upright past the tower, then a gravity turn, 20° from upright by stage 1 and
  26° (`TILT`) a little above, and from there it keeps that lean to the way up all the way out, on a curve round Earth; the Moon is where that path reaches
  its distance, and the rocket meets the Moon's orbit on a tangent and goes round it clockwise. The camera (`camera` in its `view.js`) turns with the
  rocket so away from Earth is up the screen at the rocket: the horizon stays level, the rocket leans over and then always shows the same 26° lean (in
  Moon orbit too, the Moon below and to its right), and it never points down the screen. It frames the climb, then Earth and the rocket, then (from stage 2 separation until 15 minutes before
  Moon orbit) the rocket alone, zoomed in on the capsule, with streaks of light rushing past (one in four in front of it) and the still starfield
  giving way to one that drifts past in short trails, all following the rocket's speed (they slow and stop when the playing does), then the rocket and the Moon.
- "Start a new flight" puts the rocket back on the pad: the New flight button at the end of the Rocket read-outs while it is
  off the pad, or the link after "Playing with Rocket" on the Home Screen. Both ask first. The time is kept in
  `musicTimer.newFlight`, and `rocketCarry` skips sessions that had ended by then. Play time, the goal and the trophy stay.
- The Rocket flight plan (`#rPlan`) is a pixel rail down the right of the scene: Earth at the foot, the Moon at the top, stage 1, the edge of space
  and stage 2 evenly spaced between (`RocketSim.plan`, four equal legs). It fills in gold as the rocket climbs and drops back in a fall. It is a
  picture only (`aria-hidden`, no words): the line under the read-outs says what comes next.
- Questions asked over a theme (End, and a theme's own through `host.ask`: a new flight) take its look (`themeSheet`, `.ask[data-skin]`, `#dlgAsk`); Settings keeps the Classic look.
- Opening Settings pauses a running session (`pauseForSheet` in `src/app.js`); closing it resumes, unless the session had been
  paused by hand. The practice log opens only from the Home Screen and, like Settings, fills the whole screen (`#dlgLog`).
- Every theme keeps the title row with Settings at the top. During a session Pause (or Resume) is the big button and End the small
  one, and End asks to confirm (`askEnd`, `#dlgEnd`).
- Settings, Themes (its own page in the Settings sheet, `settingsPage` in `src/app.js`) lets the player turn off themes they don't like. A theme
  turned off leaves the swipe, the theme bar and the Home Screen choices, with no padlock (there is nothing to earn back). Classic is always
  on and can't be turned off. A theme that is turned off while chosen (on the Home Screen, or the one on screen during a session) gives way to
  the first one on, Classic. The ids turned off are kept in
  the settings as `themesOff` (`themesOn`, `themeSwitch`, `themeLanding` in `src/core.js`), so a new theme starts on and a removed one is forgotten.
  A theme is written for the languages in its `langs`: in another language it leaves the swipe the same way, and Settings, Themes lists it
  dimmed ("Not in this language yet."), its switch kept, until a language it is written for is chosen (`themesOpen`). Classic has every language.
- Settings, About opens the credits over the whole screen (`#dlgCredits`, over Settings) and rolls them up like the end of a film (`CREDITS`, `rollCredits` in
  `src/app.js`; Claude's name has a sunburst before it, `#ico-claude`; each theme's own `credits`, one name or more, roll under "Theme contributions"); a tap pauses them, holding speeds them up, dragging moves them (down goes back), and with reduced motion they stand still in a box that scrolls.
- Settings fills the whole screen (`#dlgSettings`; on a wide screen its rows keep to a column in the middle) and always has the Classic look; only the goal's hint follows the theme it is opened from (its `goalHint`).
  The rocket's power, the cannons and the Dash speed follow the last minute of playing (`Session.recentEfficiency`); there is no
  setting for it. The Rocket and City bars fill to that as Power, with a tick and a figure for the whole session's Efficiency
  (`host.powerBar`), like a car's instant and trip-average fuel figures; Dash shows both as figures.
- Grand Prix (`RaceSim` in `src/themes/race/sim.js`, drawn by its `view.js`) is a ten-car race on session time. Every car's speed is its player's
  efficiency over the last minute (100% is 300 km/h; yours is `Session.recentEfficiency`), so the car that covers the most distance played
  most of the time, and a higher session efficiency gives a better chance of first place. Only playing makes the car faster: nothing else may.
  The nine rivals are simulated players (`RacePractiser`), the same field for everyone, each with a form for the day; each has its own random
  stream, so a following device races the same field (the seed is shared). The field is tuned so first place comes about half the time at 80%
  efficiency; a test checks the chances rise with efficiency. A pause is a red flag that freezes every car; the pit lane is only a picture
  (the car rejoins at the same distance, with nothing changed), with no crew. The lane is one path (`RaceSim.pitX`): it opens out from the car's
  line, runs past the garages and bends back into the track, and the car keeps to its middle, so it never cuts across the pit lane line. Where it bends
  out is set when the car turns in, so the garages never vanish. On track every car keeps to the racing line (`raceLine`, `RaceSim.lineAt`): wide on the
  way in, the inside tyres on the kerb at the apex, wide on the way out; close bends the other way go apex to apex. A test checks every corner.
  On screen the car brakes for each bend to its corner speed (`raceCorners`, `RaceSim.cornerAt`: the hairpin about 110 km/h) and speeds up
  out of it; that is only the picture, as every car takes the same bends: the race distance, places and laps still come from playing alone. In the race order, a rival who overtakes has their row grow to show their full name for 3 s (`RIVAL_NAMES` in `src/themes/race/theme.js`).
  The race runs until the practice goal; the trophy card names the place.
- Fireworks (`FireworkSim` in `src/themes/fireworks/sim.js`, drawn by its `view.js`) sends up a shell for each note played: its colour is the note (the twelve
  notes are twelve colours, `fwHue`) and its height how high the note is. The last minute of playing is shown as Intensity (Power in the other
  themes): it sets the pace, so the higher it is the more shells are in the sky at once (`FW.PACE`; a held note keeps them going up), and their
  size and kinds. Only playing sends shells up, and fast runs are capped (the extra notes make the next shell bigger). It makes no sound.
  Now and then (about one shell in twenty, at most one every 6 s, `FW.SYMBOL`) a shell bursts into a musical symbol in its note's colour: notes, a clef,
  a sharp or a flat (`fwSymbolShape`, `FW_SYMBOLS`); it opens, holds the shape a moment, then falls, like the finale's trophy.
  The goal sets off a grand finale once, ending in a shell that bursts into a gold trophy (`fwTrophyShape`); on Fireworks the trophy card waits
  for the finale to end (its `holdAward` hook, then `host.award()` at `finaleEnd`; `goalReached`, `awardWait` in `src/app.js`). The finale only plays while the theme is on screen: reached on another theme,
  the card shows there at once and the finale waits; leaving Fireworks mid-finale shows the card then.
  The scene is a harbour town at night under a low moon (hillside houses, a lighthouse, a Ferris wheel, boats, the moon's path on the water). It is
  drawn in 3D (`view3d.js`, three.js r128 like City: a level camera with a shifted lens, so the town stands straight under the read-outs);
  `view.js` loads three.js when the theme is shown and draws a flat version of the same waterfront until then, or if it cannot load.
  Its look is its own, not Dash's: Fraunces serif (`--serif`), lantern amber and cream, square corners, hairlines (`.fw-hud`, the Finale bar a fuse).
- The Home Screen (`#home`) shows when the app opens and after a finished session's summary is closed; its words come
  from `homeCopy` in `src/core.js`. No theme scene is drawn while it covers them. Its greeting, headline and line are picked from
  playful words for young players (`HOME_HELLO`, `HOME_WORDS`), new each time it shows; they must fit an iPhone SE without wrapping more.
- Debug tools (for the developer only) are their own sheet (`#dlgDebug`), opened by holding any Settings button for half a
  second, or by opening the page with `?debug` (`?debug=0` turns them off). Once opened, Settings shows a way back to them; that is
  kept in `musicTimer.debug`. The demo sound and the sound tests live there, not in Settings. Their sample data
  (`sampleLog` in `src/core.js`, and each theme's `sampleLog` hook), chosen with two taps, replaces the saved practice log and is then treated as real sessions.
  A theme can add its own tools there (`debugTools`: where the next rocket starts) and a line to the read-out (`debugLine`).
- Languages: English, Simplified Chinese and French, chosen in Settings, Language (its own page, `settingsPage('lang')`; `S.lang`, where '' follows
  the device: `pickLang`). Every word the player sees is written in English and goes through `MT.tr` / `MT.trn` in `src/core.js` (a theme's
  through its own `tr` / `trn`, `MT.translator`); the Chinese and French are in `src/lang.js` (the page's words) and in each theme's `words.js`
  (the words only it shows), keyed by the English, with the same `{blanks}`, and a word with none shows in English ('Start|part': a context after |
  tells apart two uses of one English word). The page's own words in `src/template.html` are swapped by `applyLang` in `src/app.js`; `translate="no"`
  leaves an element alone (the debug tools stay in English, and the figures the app fills in). A new language redraws everything at once
  (`langChanged`), during a session too. French speaks to the player as "tu" and names notes do, ré, mi (`noteText`); Chinese has no space between
  sentences (`MT.both`) and lists with 、. Each language has its own playful Home Screen words, of the same shape as `HOME_EN`.
- A theme's `view.js` only draws; its `theme.js` wires its logic and drawing to the page through the hooks. City and Fireworks load
  three.js r128 from cdnjs.
- `window.claude` and the "framed" checks support running inside a Claude artifact view; on GitHub Pages everything
  falls back to plain browser APIs.
- The version shown in Settings is a plain number: the count of changes merged into `main` (`scripts/build.js`; the deploy checks
  out the whole history for it).
- New versions: between sessions (Home Screen shown, or the app coming back to the screen) the page fetches itself and reloads
  if the live build stamp differs (`newerBuild` in `src/core.js`, `checkVersion` in `src/app.js`); never during a session.
- A session cut short (the app closed or discarded by iOS before End) is not lost: while it runs it is kept in `musicTimer.live`
  (`liveSnapshot`, every 5 s and when the app is hidden), cleared at End, and offered back on the next open (`liveRecord`, `#dlgLost`).
- Time the app could not listen during a session (the phone asleep, the app in the background: a tick of 1.5 s or more) counts like a
  pause (`Session.away`), so it never lowers efficiency or the last minute's power.
- While no name is set, the Home Screen greeting calls the player a fun word instead ("Hi there, rock star", or the greeting's own title: "Ahoy, Captain";
  `HOME_FRIEND`, `friend` from `homeCopy`), and that word is a link that opens Settings at the name field.
- The practice log's week bars and the Home Screen's week dots swipe back through the four weeks before this one (`WEEKS_BACK`, `weekAt`,
  `pastWeekLine` in `src/core.js`; `weekPager`, `renderWeek`, `renderHomeWeek` in `src/app.js`): by finger or mouse (`DragSwipe`), a trackpad,
  or the ‹ › arrows (either side of the log's heading, and of the Home Screen's dots), which fade at either end; the arrow keys too in the log.
  Each opens on this week.
- The practice goal is for one session. The practice log never marks a day as reaching it: the week bars compare days by time
  played, and the calendar shades days by minutes (`LEVEL_MIN` in `src/core.js`). Only a session's trophy is gold.

## Things that are easy to break

- Adding, removing or renaming a theme: only its folder in `src/themes/` and its id in `src/themes/themes.json` (docs/theme-modules.md).
  Nothing else in the app may name a theme: the host knows themes only through the interface, and a theme's style and panel touch no other
  theme (`npm test` checks). Changing the interface (a hook, a host member, a definition key): keep `THEME_KEYS` / `THEME_HOOKS` in
  `src/core.js`, the host in `src/app.js`, docs/theme-modules.md and the tests in step, and raise `THEME_API` for a change that breaks a theme.
  Check the page still fits an iPhone SE.
- Third-party dependencies and assets: `THIRD_PARTY_NOTICES.md` is the inventory of everything not written for the app (npm packages,
  what the page loads from other servers such as three.js and the Google Fonts, copied code or data, GitHub Actions and other tools),
  with each one's version, license and the notice it needs, and the provenance of our own icons, images and sounds. Update it in the
  same pull request whenever any of these is added, removed, upgraded or used differently (including any change to `package-lock.json`),
  and keep a copied item's license notice next to the copy, as the wheel-gestures one above `WHEEL_TRACES` in `src/core.js`.
- Only the theme on screen (and the one a swipe is revealing) is drawn; drawing hidden themes made swipes lag on phones.
- Words the player sees: write them in English through `tr()` or `trn()` (or `MT.word()` in a table, or a table `test/words.js` knows), never joined
  from pieces, and add their Chinese and French to `src/lang.js` if the page shows them, or to the theme's `words.js` if only a theme does (for each
  language in its `langs`); `npm test` names any that are missing or no longer used. French is the longest: check it still fits an iPhone SE.
- Any scroll area inside a theme needs `touch-action:pan-y pinch-zoom`, or Android Chrome cancels sideways swipes.
- Themes sharing the pixel chrome (`data-chrome="pixel"`) must keep the same scene height (`#stage`) at every screen
  size, or swipes make the page jump.
- Opened from an iPhone Home Screen, the page gets a solid black status bar (`apple-mobile-web-app-status-bar-style`).
  With a see-through one, iOS blurs whatever the page draws behind it, which blurred the title.
- Detection must count soft playing with the phone across a room (about -70 dB at the microphone, mostly echo) and fast
  scales (up to 12 notes a second, whose steps can look like a voice's glides), and must not count talking in a room whose
  echo joins the syllables up. The room and scale tests in `DETECTION_CASES` cover these; talking is told apart by how its
  pitch moves (`NOTE` in `src/core.js`), not by its loudness, so raising `minDb` is not the fix for it.

## Testing

The app is mainly used on an iPhone. `test/browser.js` swipes the built page by finger and mouse in headless Chrome over the DevTools
protocol (no dependencies), and drives pages built with other sets of themes (only the base theme; the English-only test theme in
`test/fixtures/themes/sample`); it finds Chromium in cloud sessions and Chrome on GitHub's runner, is skipped locally without one (or set
`CHROME_PATH`) and fails under CI. Playwright with Chromium is installed globally in cloud sessions. cdnjs is not
reachable from the sandbox, so for themes that use three.js serve it from `npm pack three@0.128.0` via `page.route`.

## Workflow

- Several sessions work in parallel: start each branch from a fresh `origin/main`.
- One pull request per requested change; run `npm run ci` before pushing. Pushes to `main` deploy to the live site.
- User-facing text is plain, complete sentences; on iOS, point microphone problems to the Settings app.
- Every UI change (new or changed words, a new control, a layout or style change) must work in every language and fit the screen. Give
  new words their Chinese and French in `src/lang.js` (`npm test` fails without them), then look at each screen it touches in English,
  Chinese and French at iPhone SE sizes (375×667 and 320×568), during a session where it shows one. Playwright screenshots with the
  context's `locale` set (`en-US`, `zh-CN`, `fr-FR`) pick the language through Automatic. French runs longest: shorten its words rather
  than let a line be cut off, wrap more, or push the page into scrolling; Chinese falls back to the phone's own font in the pixel themes.
- Lines here often hold several statements. A `//` comment runs to the end of the line, so when splitting a line, check that no code
  ended up after one; `npm run lint` flags the names this leaves undeclared.
