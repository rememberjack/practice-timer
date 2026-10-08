# Music Timer

Practice timer that only runs while an instrument is heard. One page; the City theme fetches three.js from cdnjs when it is first opened.

## Deploy automatically (GitHub Pages)

One time:

    ./scripts/setup.sh            # needs git and the GitHub CLI (gh)

That creates the repository, turns on Pages, and pushes. From then on:

    git add -A && git commit -m "Change" && git push

Each push to `main` runs the tests, builds `dist/index.html`, and publishes it at
`https://<your-username>.github.io/music-timer/`. If the tests fail nothing is published. Pull requests run the
tests without publishing. Open that address on your phone and use Share > Add to Home Screen.

The microphone works there because the page is served over https and is the top-level page.

## Day to day

    npm test          detection, timer and rocket tests (about 10 seconds)
    npm run build     writes dist/index.html
    npm run check     checks the built page
    npm run serve     builds and serves it locally; the mic works on localhost

The page shows its version (commit and date) at the bottom of Settings, so you can tell which build you are on.

## Other hosts

`dist/` is plain static files, so any static host works: Cloudflare Pages (`npx wrangler pages deploy dist`),
Netlify (`npx netlify deploy --dir dist --prod`), or your own server. For your own domain on GitHub Pages, build with
`CNAME=timer.example.com npm run build` and set the domain under Settings > Pages.

## Layout

    src/template.html   page, styles and markup
    src/core.js         detector, session timer, rocket flight model (tested)
    src/rocket.js       rocket scene renderer
    src/city.js         city defence theme (three.js, loaded from cdnjs the first time the theme is shown)
    src/dash.js         dash theme renderer (the course itself is modelled and tested in core.js)
    src/app.js          app logic
    scripts/build.js    joins them into one file
