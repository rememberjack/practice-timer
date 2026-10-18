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
- The rocket's path (`PATH` and `TIMING` in `src/themes/rocket/sim.js`) is drawn to scale (a 100 m rocket, the Moon 384,400 km away, Moon orbit
  110 km up), so the altitude read-out is what is drawn. It has three stages under the capsule, like the Saturn V, each dropped at Apollo 11's time
  (`STEPS`, `stageAt`; `STAGE1`-`STAGE3` in its `view.js`, 32 sprite rows in all as before). Up to Earth orbit it keeps Apollo 11's timing and heights (`CLIMB`): upright past the tower,
  pitched over to about 68° from upright by stage 1 separation (2:43, 67 km), the edge of space at 3:25, stage 2 separation at 9:09 (186 km), level in Earth orbit (191 km) at 11:50. At 7:00 the ISS passes overhead, 420 km up and faster than the climbing
  rocket, so it comes from behind and pulls ahead while the view widens to take it in, Earth's ground kept in view at the foot of
  the scene; the view stays that wide through Earth orbit, the ISS a few hundred km ahead and drifting back once the rocket is the
  faster. Through the burn for the Moon the view holds still (the ISS keeping its height on screen) as the rocket climbs toward it; just after (14:01) the
  rocket passes about 70 km under it and leaves it behind, the view widening to keep both, and it goes on round Earth (on the coast's sped-up clock, `RocketSim.issAt`),
  a speck once too small to draw, until Earth slips out of view (`ISS`; a banner and a countdown for the pass at 7:00). The ISS picture is its own small layer
  over the canvas (`issLayer` in its `view.js`), placed to the phone's own pixel, so it glides rather than stepping a whole (large) canvas pixel at a time. Stage 1 drops back
  into the air, glows and burns up before it reaches the ground (`HOT`, `embers` in its `view.js`). Then a minute's coast and a minute's burn for the Moon (`PHASES`; banners "Earth orbit reached" and "Off to the Moon!"), stage 3 separation at 14:29 (27 minutes
  after the burn on the coast's sped-up clock, as on Apollo 11), and a
  Kepler orbit round Earth whose three days are sped up about 275 times, so Moon orbit comes at 30:00; once within the Moon's reach (`SOI`) its pull
  speeds the rocket up again, and Moon orbit starts at the speed it arrives with and eases down. The coast has its moments, at their real times or
  places (`COAST`), shown in the scene with no words except halfway, which has a banner and a countdown: passing the GPS satellites' height (14:47) and the weather and TV satellites' ring (15:04),
  each a faint ring round Earth with its satellites as specks moving along it, the same way round as the rocket and the ISS and at their real speeds on the
  coast's sped-up clock (`SHELLS` in its `view.js`, `RocketSim.realAt`; none ever flies close by), a slow roll in
  the sunshine (16:08, the close-up capsule turning smoothly, easing in and out, `DETAILS`, `rollAt`), halfway to the Moon (19:17), Apollo 11's one course correction (19:55, thruster
  puffs) and into the Moon's pull (25:56); and four times the view pulls back slowly (8 s out, 10 s held, 8 s back) to show the whole way (`MAPS`:
  Earth, the path flown in gold and still to fly in grey, the rocket and the Moon). The Moon is where that orbit reaches its distance,
  met on a tangent, and the rocket goes round it clockwise. The camera (`camera` in its `view.js`) turns with the rocket so away from Earth is up the
  screen at the rocket: the horizon stays level as it pitches over; nearing the Moon the view turns until it flies level over the Moon, and on the way it
  never points down the screen. In Moon orbit the view holds still, the Moon in the middle, and the rocket goes round it, its icon lifted just clear of the
  ground and the dotted orbit drawn at that height. It frames the climb (the
  rocket drawn smaller and smaller as it climbs, the ground a thinner and thinner strip), then, after the burn, Earth and the rocket until Earth slips out
  of view below, then (until 5 minutes before Moon orbit) the rocket alone, zoomed in on the capsule (drawn in finer detail close up: `DETAIL` in its `view.js`), with a few faint streaks of light rushing past (now and then one in front of it) and the still starfield
  giving way to one that drifts past in short trails, all following the rocket's speed (they slow and stop when the playing does), then the rocket and the Moon.
- The Moon landing (`LAND`, `DESCENT` in `src/themes/rocket/sim.js`), Apollo 11's sped up: after 5 minutes of playing in Moon orbit the lunar module
  undocks as the module crosses the DOI point on the far side (its spin steadied first; banner "Lunar module away"), burns, and coasts half an orbit down to
  15 km over the near side (60 s, its pace easing from the orbit's to the descent's), then the powered descent, Apollo 11's 12.5 minutes in 3.5 (`braking`,
  `approach`, `final`): "Powered descent" at 15.2 km, braking almost on its back, pitching over at high gate (2.3 km, "Looking for a landing spot"), a hover
  below low gate (150 m) and touchdown 480 km on, 23.5° past the point under Earth as Tranquility Base is ("Touchdown on the Moon!", at about 39:40).
  The descent moves on only while music is heard ("Keep playing to land"); the command module keeps circling. From Moon orbit on the height read-out is
  above the Moon (110 km; the pads' height in the descent, `altKm`). The view (`wR`, `wD` in its `view.js`) turns to the module's own up and closes in so that
  its height above the ground as drawn stays half the picture, to a close-up of it touching down (`S_LAND`); the Moon's ground is drawn in cross-section
  close up (`relief`: craters at every size that shows, fading in and out with the zoom, flat round the site; `REG`, `MROCK`), the pale flame of the
  descent engine follows the playing, the blast raises dust below 30 m, and Earth hangs small in the black sky toward where it really is. Flights on
  the way down or landed carry on (`save`, `rocketAt`; the debug tools can start one on the Moon), and a following device lands too. The lunar
  module rides inside stage 3: as the stage falls away at 14:29 it is left behind the capsule, which turns round, docks nose to top and turns again
  to fly on module first (`td`, `flip`, `turn` in its `view.js`), so it shows docked through the coast (in the close-up too, rolling with the capsule:
  `LM_DETAILS`, `detailLM`) and in Moon orbit, and at the undocking it simply lets go. The last 30 m of the descent are nearly straight down
  (about 0.7 m/s down and under 1 m/s sideways at touchdown, as Apollo 11's), and for the last seconds the view holds still on the landing site
  (`wS`) and the module comes in and settles into it.
- "Start a new flight" puts the rocket back on the pad: the New flight button at the end of the Rocket read-outs while it is
  off the pad, or the link after "Playing with Rocket" on the Home Screen. Both ask first. The time is kept in
  `musicTimer.newFlight`, and `rocketCarry` skips sessions that had ended by then. Play time, the goal and the trophy stay.
- The Rocket flight plan (`#rPlan`) is a pixel rail down the right of the scene: Earth at the foot, the Moon at the top, and stage 1, stage 2, Earth orbit (a ring
  round the rail) and stage 3 between, each at its share of the flight's time (`RocketSim.plan`, `PLAN_STOPS`). It fills in gold at an even pace as the rocket climbs and drops back in a fall. It is a
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
- Fireworks (`FireworkSim` in `src/themes/fireworks/sim.js`, drawn by its `view.js`): while the music plays, shells go up and wait in the sky as glowing embers,
  and each note sets one off, in the note's colour (the twelve notes are twelve colours, `fwHue`): the shell nearest the note's height, so low notes
  burst the low ones and high notes the high ones. The last minute of playing is shown as Intensity (Power in the other themes): it sets how many
  go up (`FW.PACE`, at least `FW.FLOOR` a second; up to `FW.AIRMAX` + `FW.AIRPER` x Intensity waiting), so the higher it is the more shells are in the
  sky at once, and the size and kinds of the bursts. A shell goes up as soon as the music starts; a note can set off one nearly at the top of
  its climb (`FW.READY`), never one still down among the roofs; a note with none ready makes the next burst bigger. A shell no note sets off for
  `FW.WAIT` s fades and falls; a pause holds them; stopping lets them all fall. Only playing sends shells up. It makes no sound. The bursts are kept
  small beside the town's houses (`sizeR` in both views); the finale's trophy is the largest.
  Now and then (about one shell in twenty, at most one every 6 s, `FW.SYMBOL`) a shell bursts into a musical symbol in its note's colour: notes, a clef,
  a sharp or a flat (`fwSymbolShape`, `FW_SYMBOLS`); it opens, holds the shape a moment, then falls, like the finale's trophy.
  The goal sets off a grand finale once, ending in a shell that bursts into a gold trophy (`fwTrophyShape`); on Fireworks the trophy card waits
  for the finale to end (its `holdAward` hook, then `host.award()` at `finaleEnd`; `goalReached`, `awardWait` in `src/app.js`). The finale only plays while the theme is on screen: reached on another theme,
  the card shows there at once and the finale waits; leaving Fireworks mid-finale shows the card then.
  The scene is a harbour town at night under a low moon (hillside houses, a lighthouse, a Ferris wheel, boats, the moon's path on the water). It is
  drawn in 3D (`view3d.js`, three.js r128 like City: a level camera with a shifted lens, so the town stands straight under the read-outs);
  `view.js` loads three.js when the theme is shown and draws a flat version of the same waterfront until then, or if it cannot load.
  Its look is its own, not Dash's: Fraunces serif (`--serif`), lantern amber and cream, square corners, hairlines (`.fw-hud`, the Finale bar a fuse).
- Invaders (`InvaderSim` in `src/themes/invaders/sim.js`, drawn by its `view.js`) is in the manner of the 1978 arcade invader games, with its own sprites
  (`sprites.js`; the name "Space Invaders" is not used): 55 invaders march over four shields and the laser cannon shoots them down, wave after wave.
  It runs on session time (the ticks bank it, the frames play it out). Only playing moves it on: while music is heard the fleet marches and the cannon
  charges its shots at a rate set by the last minute of playing, shown as Charge (Power in the other themes; `INV.RATE`, `INV.RATE_PW`; a note just started fires a charged shot at once), so a wave
  falls in about 2.5 minutes at 80%. The shields stop the cannon's shots as well as the bombs, each wearing a hole (from below or above), so the
  cannon goes a little out of its way to fire up a clear lane (`INV.LANE`, `clear`). In a quiet moment the invaders wait; they never come below just above the shields (`INV.FLOOR`) and bombs cannot
  harm the cannon, so nothing is lost. Its scene is white on black under red and green film (a `multiply` fill). Its look is the cabinet's, not
  Rocket's: Press Start 2P (`--arcade`), and on phones the read-outs are the cabinet's score line (SCORE, the play time, HI-SCORE), with the wave
  and the invaders left drawn under the ground line. Each session keeps its score
  (`keep`), and the Hi-score is the best in the practice log (`hiScore`).
- Tumble (`TumbleSim` in `src/themes/tumble/sim.js`, drawn by its `view.js`) drops every note played into a wooden crate as a toy block, and the
  blocks pile up into a wall. A block is one note: its colour is the note (twelve colours round the circle of fifths, `tuColour`, so the notes of
  one key are a family of colours and a wrong note stands out), its name is on its face (in the page's language: do, ré, mi in French), its width is
  how long the note was held (`TU.QUANT`: a unit a quarter second, up to `TU.MAXU` 8; a longer note drops planks in a row) and it falls in where the
  pitch is, low notes on the left and high on the right (`pitchX`: the crate is three octaves wide, `TU.SPAN`, centred on the middle of the first
  `TU.CENTRE_N` notes played, so a violin's wall and a cello's both stand in the middle; a note outside lands at the edge). Only playing drops blocks: nothing while
  quiet, paused or stopped. The microphone hears one note at a time, so chords are chord outlines: three or four notes of one chord played in a
  row (`TU.CHORD_GAP`, `TU.CHORD_NOTE`; `chordOf`) are glued into one plank (`glue`: the blocks leave the pile and a plank of their faces, in the order
  played and in one gold frame, drops in just over where they were; a following device is told the plank's parts), name the chord on a banner (G, Em, D7, never a suspended chord: A, B, E in
  a tune is not an Asus2; a fourth note can grow a named triad into a seventh, regluing the plank); they are not counted, as the microphone cannot hear a chord struck
  together; the blocks themselves are never held back for it. The
  read-outs show Blocks, Blocks/min (the blocks dropped over the last minute of playing, `rate`; there is no Power figure, as nothing in the
  scene follows it) and Efficiency. The pile is the record of the session: the
  practice goal is a gold line the wall reaches at the goal (placed by `perMin`, from the blocks' area); reaching it drops a trophy block, and the
  trophy card waits for it to land (`holdAward`, then `host.award()`). Past walls are pencilled on the crate like heights on a doorframe
  (`wallMarks`, from the heights each session keeps, set by the `restore` hook): "Last time" and "Tallest", a dashed line across the crate with a
  mark on the right-hand wall, so today's wall is seen growing past them. Nothing is ever lost: a shorter wall leaves the marks as they were. The view follows the top of the pile
  as the wall grows; a finger dragged up or down the crate (its canvas has `touch-action:none`; sideways swipes still reach the page) looks
  back through the layers, and the view follows again a moment later. Blocks tumble under Matter.js 0.19.0 (`pile.js`, `makePhysicsPile`),
  loaded from cdnjs when the theme is first shown and taking over at the next session; until then, or when it cannot load, `StackPile` in
  `sim.js` stacks them plainly (and is what the tests run against): both have the same shape (live blocks in block units, y up from the
  floor, and settled ones). Resting blocks deep under the surface are frozen and, once below what is on screen, settled: out of the engine
  (a plate under the live blocks) and drawn once into strips of canvas (`CHU` in its `view.js`), so a long session stays cheap. A following
  device gets the blocks lately dropped by id (`share`, `follow`) and tumbles them itself. Each session keeps its blocks, how
  often each note was played and the wall's height (`keep`). Its look is a crate of toy blocks on a slate table: Fredoka (`--toy`) on the read-outs, buttons and
  the blocks' faces, amber wood for the buttons, each with a bevel under it.
- The Home Screen (`#home`) shows when the app opens and after a finished session's summary is closed; its words come
  from `homeCopy` in `src/core.js`. No theme scene is drawn while it covers them. Its greeting, headline and line are picked from
  playful words for young players (`HOME_HELLO`, `HOME_WORDS`), new each time it shows; they must fit an iPhone SE without wrapping more.
  Its theme chips (`#homeThemes`, `.hm-chips`) keep to one row that fits the screen: 44 px each while there is room, all narrowed alike when
  there is not, so a new theme never pushes the last chip off the edge.
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
  three.js r128 from cdnjs, and Tumble Matter.js 0.19.0.
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
- Themes move on at the session's ticks (every 46 ms) and draw at the screen's frame rate: something drawn from tick-time state moves in steps.
  Rocket draws each frame between the last two ticks (`between` in its `view.js`, a tick behind) and leaves the sim as the ticks have it.
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
reachable from the sandbox, so for themes that use three.js serve it from `npm pack three@0.128.0` via `page.route` (and Matter.js for Tumble
from `npm pack matter-js@0.19.0`; without it the theme runs on its plain pile).

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
