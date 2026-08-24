# Browser tests

Headless-Chromium checks for behaviour the unit tests cannot reach: pointer
handling, animation, canvas export, and anything that only exists once React
has rendered.

They live here, in the repository, rather than in a scratch directory — an
earlier set was kept outside version control and was lost when the working
environment was reclaimed. Anything worth running twice is worth committing.

## The suites

| Suite | Covers |
| --- | --- |
| `core` | the paths every feature shares — run this after touching anything central |
| `learn` | drills, their feedback, hints, and the category filter |
| `feel` | sound (via an AudioContext spy), the piece slide, dragging, mute |
| `sketch` | arrow legality, chaining, highlights, draw mode |
| `castling` | castling both ways, en passant, and the flip animation |
| `hotseat` | two players at one keyboard, auto-flip, per-colour reports |
| `random` | generated midgame and endgame starts, and their difficulty |
| `blitz` | clocks, increment, time pressure, flagging |
| `promotion` | the promotion picker, capture tray, resign / draw, result card |
| `history` | stepping back through a game, and review grades on the board |
| `draws` | threefold repetition, and that the engine's plies are logged |
| `premove` | queueing, firing, cancelling, and discarding a premove |
| `themes` | board colour schemes and live opening names |
| `sharecard` | the exportable PNG — signature, size, and that it is not blank |
| `walkthrough` | the guided teacher-mode post-mortem |

## Running

```sh
npm run build && npm run preview &   # serves on :4173
npm run test:browser
```

Chromium is expected at `/opt/pw-browsers/chromium` (the path this project's
container provides). Override with `CHROMIUM_PATH` if yours differs.
