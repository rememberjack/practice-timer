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

Node 20+, no dependencies to install.

    npm test          unit tests (src/core.js)
    npm run build     joins src/ into dist/index.html (dist/ is not committed)
    npm run ci        tests, build and a smoke check of the built page; GitHub Actions runs this
    npm run serve     build and serve locally (the microphone works on localhost)

## Layout

- `scripts/build.js` inlines `src/core.js`, the theme renderers and `src/app.js` into `src/template.html`.
- `src/core.js` is pure logic with no DOM (detection, `Session`, the theme sims, swipe handling) and holds the tests,
  which also run in the page from the debug tools (Sound tests). Behaviour belongs here, with a test.
- Finished sessions are saved in localStorage under `musicTimer.log` (no audio); the practice log's figures (week,
  totals, calendar) come from `practiceStats` in `src/core.js`, which also works out a streak that is not shown for now.
- A day can hold several sessions. The calendar, week bars and Home Screen add up the whole day; `dayRecap` and `dayLine` give the
  summary's "Today" block (each session of the day). The practice goal is for one session, so the block does not measure the day against it.
- Each saved session keeps where the rocket got to if it is in space or Moon orbit (`RocketSim.save`); the next session
  that day carries on from it (`rocketCarry`). Below space, and on a new day, it starts on the pad. Sessions too short
  to save never move the carried flight; demo sound sessions are saved like any other.
- Opening Settings pauses a running session (`pauseForSheet` in `src/app.js`); closing it resumes, unless the session had been
  paused by hand. The practice log opens only from the Home Screen.
- Every theme keeps the title row with Settings at the top. During a session Pause (or Resume) is the big button and End the small
  one, and End asks to confirm (`askEnd`, `#dlgEnd`).
- Settings takes the look and words of the theme it is opened from (`SET_SKIN` in `src/app.js`, `#dlgSettings[data-skin]` in the
  template); Classic has no power setting, as it shows no power.
- The Home Screen (`#home`) shows when the app opens and after a finished session's summary is closed; its words come
  from `homeCopy` in `src/core.js`. No theme scene is drawn while it covers them.
- Debug tools (for the developer only) are their own sheet (`#dlgDebug`), opened by holding any Settings button for half a
  second, or by opening the page with `?debug` (`?debug=0` turns them off). Once opened, Settings shows a way back to them; that is
  kept in `musicTimer.debug`. The demo sound and the sound tests live there, not in Settings. Their sample data
  (`sampleLog` in `src/core.js`), chosen with two taps, replaces the saved practice log and is then treated as real sessions.
- Theme renderers in `src/` only draw; `src/app.js` wires everything together. Some themes load three.js r128 from
  cdnjs.
- `window.claude` and the "framed" checks support running inside a Claude artifact view; on GitHub Pages everything
  falls back to plain browser APIs.
- While no name is set, a quiet "Add your name" link follows the Home Screen greeting and opens Settings at the name field.
- The practice goal is for one session. The practice log never marks a day as reaching it: the week bars compare days by time
  played, and the calendar shades days by minutes (`LEVEL_MIN` in `src/core.js`). Only a session's trophy is gold.

## Things that are easy to break

- Only the theme on screen (and the one a swipe is revealing) is drawn; drawing hidden themes made swipes lag on phones.
- Any scroll area inside a theme needs `touch-action:pan-y pinch-zoom`, or Android Chrome cancels sideways swipes.
- Themes sharing the pixel chrome (`data-chrome="pixel"`) must keep the same scene height (`#stage`) at every screen
  size, or swipes make the page jump.
- Opened from an iPhone Home Screen, the page gets a solid black status bar (`apple-mobile-web-app-status-bar-style`).
  With a see-through one, iOS blurs whatever the page draws behind it, which blurred the title.
- Detection must count soft playing with the phone across a room (about -70 dB at the microphone, mostly echo) and must not
  count talking in a room whose echo joins the syllables up. The room tests in `DETECTION_CASES` cover both; talking is told
  apart by how its pitch moves (`NOTE` in `src/core.js`), not by its loudness, so raising `minDb` is not the fix for it.

## Testing

The app is mainly used on an iPhone. Playwright with Chromium is installed globally in cloud sessions. cdnjs is not
reachable from the sandbox, so for themes that use three.js serve it from `npm pack three@0.128.0` via `page.route`.

## Workflow

- Several sessions work in parallel: start each branch from a fresh `origin/main`.
- One pull request per requested change; run `npm run ci` before pushing. Pushes to `main` deploy to the live site.
- User-facing text is plain, complete sentences; on iOS, point microphone problems to the Settings app.
