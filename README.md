# Music Timer

A practice timer that only runs while an instrument is heard. It listens through the microphone, counts the time
you are actually playing, and pauses itself in the silences. Four themes show your progress: Classic, Rocket, City
and Dash. Swipe or use the arrow keys to change theme. Each theme has its own icon, and the row of icons under
the scene shows which one you are on; tap an icon to jump to that theme.

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

The page is a single self-contained file; the City theme fetches three.js from cdnjs the first time it is shown.
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
    src/core.js         detector, session timer, rocket flight model, dash course (tested)
    src/rocket.js       rocket theme renderer
    src/city.js         city defence theme (three.js, loaded from cdnjs the first time the theme is shown)
    src/dash.js         dash theme renderer
    src/app.js          app logic
    scripts/build.js    joins them into one file
    test/run.js         unit tests
    test/smoke.js       checks the built page
