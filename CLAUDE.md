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
    npm test          unit tests (src/core.js)
    npm run build     joins src/ into dist/index.html (dist/ is not committed)
    npm run ci        lint, tests, build, a smoke check of the built page and swipes in a real browser; GitHub Actions runs this
    npm run serve     build and serve locally (the microphone works on localhost)

## Layout

- `scripts/build.js` inlines `src/core.js`, the theme renderers and `src/app.js` into `src/template.html`.
- `src/core.js` is pure logic with no DOM (detection, `Session`, the theme sims, swipe handling: `DragSwipe`, `WheelSwipe`) and holds the tests,
  which also run in the page from the debug tools (Sound tests). Behaviour belongs here, with a test.
- Finished sessions are saved in localStorage under `musicTimer.log` (no audio); the practice log's figures (week,
  totals, calendar) come from `practiceStats` in `src/core.js`, which also works out a streak that is not shown for now.
- A day can hold several sessions. The calendar, week bars and Home Screen add up the whole day; `dayRecap` and `dayLine` give the
  summary's "Today" block (each session of the day). The practice goal is for one session, so the block does not measure the day against it.
- Each saved session keeps where the rocket got to if it is in space or Moon orbit (`RocketSim.save`); the next session
  that day carries on from it (`rocketCarry`). Below space, and on a new day, it starts on the pad. Sessions too short
  to save never move the carried flight; demo sound sessions are saved like any other.
- "Start a new flight" puts the rocket back on the pad: the New flight button at the end of the Rocket read-outs while it is
  off the pad, or the link after "Playing with Rocket" on the Home Screen. Both ask first. The time is kept in
  `musicTimer.newFlight`, and `rocketCarry` skips sessions that had ended by then. Play time, the goal and the trophy stay.
- Questions asked over a theme (End, a new flight) take its look (`themeSheet`, `.ask[data-skin]`); Settings keeps the Classic look.
- Opening Settings pauses a running session (`pauseForSheet` in `src/app.js`); closing it resumes, unless the session had been
  paused by hand. The practice log opens only from the Home Screen.
- Every theme keeps the title row with Settings at the top. During a session Pause (or Resume) is the big button and End the small
  one, and End asks to confirm (`askEnd`, `#dlgEnd`).
- Settings, Themes (its own page in the Settings sheet, `settingsPage` in `src/app.js`) lets the player turn off themes they don't like. A theme
  turned off leaves the swipe, the theme bar and the Home Screen choices, with no padlock (there is nothing to earn back). One theme always
  stays on, any one; turning off the theme on screen moves to the next one on, during a session too. The ids turned off are kept in
  the settings as `themesOff` (`themesOn`, `themeSwitch`, `themeLanding` in `src/core.js`), so a new theme starts on and a removed one is forgotten.
- Settings always has the Classic look; only the goal's hint follows the theme it is opened from (`GOAL_HINT` in `src/app.js`).
  The rocket's power, the cannons and the Dash speed follow the last minute of playing (`Session.recentEfficiency`); there is no
  setting for it. The Rocket and City bars fill to that as Power, with a tick and a figure for the whole session's Efficiency
  (`powerBar` in `src/app.js`), like a car's instant and trip-average fuel figures; Dash shows both as figures.
- Grand Prix (`RaceSim` in `src/core.js`, drawn by `src/race.js`) is a ten-car race on session time. Every car's speed is its player's
  efficiency over the last minute (100% is 300 km/h; yours is `Session.recentEfficiency`), so the car that covers the most distance played
  most of the time, and a higher session efficiency gives a better chance of first place. Only playing makes the car faster: nothing else may.
  The nine rivals are simulated players (`RacePractiser`), the same field for everyone, each with a form for the day; each has its own random
  stream, so a following device races the same field (the seed is shared). The field is tuned so first place comes about half the time at 80%
  efficiency; a test checks the chances rise with efficiency. A pause is a red flag that freezes every car; the pit lane is only a picture
  (the car rejoins at the same distance, with nothing changed). The race runs until the practice goal; the trophy card names the place.
- Fireworks (`FireworkSim` in `src/core.js`, drawn by `src/fireworks.js`) sends up a shell for each note played: its colour is the note (the twelve
  notes are twelve colours, `fwHue`) and its height how high the note is; the last minute of playing sets the size and the kinds. Only playing sends
  shells up, fast runs are capped (the extra notes make the next shell bigger), and the goal sets off a grand finale once. It makes no sound.
  It is drawn in 3D (`src/fireworks3d.js`, three.js r128 like City: a level camera with a shifted lens, so the skyline stands straight under the
  read-outs); `src/fireworks.js` loads three.js when the theme is shown and draws a flat version until then, or if it cannot load.
- The Home Screen (`#home`) shows when the app opens and after a finished session's summary is closed; its words come
  from `homeCopy` in `src/core.js`. No theme scene is drawn while it covers them. Its greeting, headline and line are picked from
  playful words for young players (`HOME_HELLO`, `HOME_WORDS`), new each time it shows; they must fit an iPhone SE without wrapping more.
- Debug tools (for the developer only) are their own sheet (`#dlgDebug`), opened by holding any Settings button for half a
  second, or by opening the page with `?debug` (`?debug=0` turns them off). Once opened, Settings shows a way back to them; that is
  kept in `musicTimer.debug`. The demo sound and the sound tests live there, not in Settings. Their sample data
  (`sampleLog` in `src/core.js`), chosen with two taps, replaces the saved practice log and is then treated as real sessions.
- Theme renderers in `src/` only draw; `src/app.js` wires everything together. Some themes load three.js r128 from
  cdnjs.
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
- While no name is set, a quiet "Add your name" link follows the Home Screen greeting and opens Settings at the name field.
- The practice goal is for one session. The practice log never marks a day as reaching it: the week bars compare days by time
  played, and the calendar shades days by minutes (`LEVEL_MIN` in `src/core.js`). Only a session's trophy is gold.

## Things that are easy to break

- Adding, removing or renaming a theme: keep Settings, Themes in sync with it. That is its id and name in `SKINS`, `SKIN_NAMES` and `PANELS`,
  its line in `THEME_LINE` (`src/app.js`), its tile colours (`[data-theme="<id>"]` in `src/template.html`), its `#ico-<id>` icon, and the
  theme list in the "Themes: the player turns off" test (`src/core.js`). Check the page still fits an iPhone SE.
- Only the theme on screen (and the one a swipe is revealing) is drawn; drawing hidden themes made swipes lag on phones.
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
protocol (no dependencies); it finds Chromium in cloud sessions and Chrome on GitHub's runner, is skipped locally without one (or set
`CHROME_PATH`) and fails under CI. Playwright with Chromium is installed globally in cloud sessions. cdnjs is not
reachable from the sandbox, so for themes that use three.js serve it from `npm pack three@0.128.0` via `page.route`.

## Workflow

- Several sessions work in parallel: start each branch from a fresh `origin/main`.
- One pull request per requested change; run `npm run ci` before pushing. Pushes to `main` deploy to the live site.
- User-facing text is plain, complete sentences; on iOS, point microphone problems to the Settings app.
- Lines here often hold several statements. A `//` comment runs to the end of the line, so when splitting a line, check that no code
  ended up after one; `npm run lint` flags the names this leaves undeclared.
