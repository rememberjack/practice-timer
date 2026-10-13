# Music Timer

A practice timer that only runs while an instrument is heard. It listens through the microphone, counts the time
you are actually playing, and pauses itself in the silences. Five themes show your progress: Classic, Rocket, City,
Dash and Grand Prix. Swipe or use the arrow keys to change theme. Each theme has its own icon, and the row of icons under
the scene shows which one you are on; tap an icon to jump to that theme.

Every session you finish is saved on your device. The practice log (the calendar button at the top) shows your
streak, this week against your goal, the last 12 weeks, and every session, whose summary you can open again.
Recordings are not kept.

Live at **https://rememberjack.github.io/practice-timer/**. On a phone, open it and use Share > Add to Home Screen.

## How it was made

This project is fully vibe coded. Every line of code, every test and this README were written by
[Claude](https://claude.ai) from plain-language descriptions of what the app should do and how it should feel; the
code was never written or edited by hand.

- The first version, including the build script, tests and GitHub Actions workflow, was written by Claude and
  pushed to this repository with a one-time setup script (since removed).
- Since then, each change has been made in a [Claude Code](https://claude.com/claude-code) session on the web:
  describe a bug or an idea, Claude changes the code, runs the tests and opens a pull request, and the pull
  request is reviewed and merged. The commit messages record what changed and why, and link to the session that
  made it.

## How it is built and deployed

Each push to `main` runs the tests, builds `dist/index.html`, and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). If the tests fail nothing is published. Pull requests run the tests without
publishing.

The page keeps its scripts and header icon embedded in one HTML file; the build also exports browser and
home-screen icons. The City theme fetches three.js from cdnjs the first time it is shown.
The microphone works because the page is served over https. The page shows its version (commit and date) at the
bottom of Settings, so you can tell which build you are on.

## Running it locally

Needs Node 20 or later; there are no dependencies to install.

    npm test          detection, timer and theme tests (about 10 seconds)
    npm run build     writes dist/index.html
    npm run check     checks the built page
    npm run serve     builds and serves it locally; the mic works on localhost

For a custom domain, build with `CNAME=timer.example.com npm run build` and set the domain under Settings > Pages.

## Layout

    src/template.html   page, styles and markup
    src/assets/         Music Timer icon, favicon and iPhone home-screen icon
    src/core.js         detector, session timer, practice log, and the registry of theme modules (tested)
    src/lang.js         the page's words in Chinese and French
    src/app.js          app logic: the host that drives the theme modules
    src/themes/         one folder per theme (Classic, Rocket, City, Dash, Grand Prix, Fireworks): its definition, panel,
                        style, icon, words, logic, drawing and tests; themes.json lists the installed ones, in swipe order.
                        docs/theme-modules.md describes the interface, and how to add or remove a theme
    scripts/build.js    joins them into one file
    test/run.js         unit tests (the core's and each theme's)
    test/themes.js      the theme modules keep to their interface, and can be taken out or added
    test/smoke.js       checks the built page

## License

MIT; see [LICENSE](LICENSE). The trackpad test data in `src/core.js` comes from
[wheel-gestures](https://github.com/xiel/wheel-gestures), also MIT, with its notice kept in place.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every third-party dependency, font and asset with its license.
