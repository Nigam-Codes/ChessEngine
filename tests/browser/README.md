# Browser tests

Headless-Chromium checks for behaviour the unit tests cannot reach: pointer
handling, animation, canvas export, and anything that only exists once React
has rendered.

They live here, in the repository, rather than in a scratch directory — an
earlier set was kept outside version control and was lost when the working
environment was reclaimed. Anything worth running twice is worth committing.

## Running

```sh
npm run build && npm run preview &   # serves on :4173
npm run test:browser
```

Chromium is expected at `/opt/pw-browsers/chromium` (the path this project's
container provides). Override with `CHROMIUM_PATH` if yours differs.
