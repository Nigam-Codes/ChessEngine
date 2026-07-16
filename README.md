# Chess Engine Lab

Pick a side and play a small, readable chess engine — and watch it think.
Choose White or Black (the board flips and the engine opens when you take
Black), or switch to **Learn mode** for hands-on tactic drills.
After every engine move a telemetry panel shows the position evaluation,
how many positions were examined, how many branches alpha-beta pruning
skipped, and the engine's top three candidate moves with their scores, so
you can compare your instinct against its ranking.

Built with React + Vite. The engine itself (`src/engine.js`) is plain
JavaScript with no dependencies, written to be readable as a teaching
reference.

## Running it

```bash
npm install
npm run dev        # start the dev server
npm test           # run the engine sanity tests
npm run build      # production build (output in dist/)
npm run preview    # serve the production build locally
```

Pushing to `main` deploys automatically to GitHub Pages via
`.github/workflows/deploy.yml`. The workflow enables the Pages site
itself on the first run; if that fails in your fork, flip
**Settings → Pages → Source: GitHub Actions** once manually. The Vite
config uses `base: "./"` so the build works from a project-site subpath.

## Teacher mode

Flip the **Teacher mode** switch under the board to turn the lab into a
tutor:

- **Move grading** — after each of your moves, the coach analyzes the
  position you moved in and grades your choice against the engine's best
  (Best move! / Good / Inaccuracy / Mistake / Blunder), showing both
  scores so you can see exactly how much a mistake cost.
- **Threat warnings** — after every engine reply, the coach scans the
  board for hanging pieces, forks, and pins against you, explains each in
  plain language, and marks the squares in red.
- **Hint button** — stuck? Ask the coach for a suggested move; it's
  highlighted on the board in green with its score.
- **Tactic arrows** — threats, hints, and the engine's last move are
  drawn as directional arrows on the board (red = threat against you,
  green = resource for you, blue = explanation), so you see not just
  *which* squares matter but *which way* the tactic points. The lesson
  diagrams use the same arrows to show how each pattern works.
- **Chess school** — eleven short lessons with annotated diagrams
  covering the basics behind the tactics: piece values, center control,
  development, hanging pieces, forks, pins, skewers, discovered attacks,
  back-rank mates, counting attackers vs defenders, and the five ways to
  defend a threat.

The coaching logic lives in `src/coach.js` — small, readable functions
(`hangingPieces`, `findForks`, `findPins`, `classifyMove`) built on the
same move generator the engine uses.

## Learn mode

The **Learn** tab holds "select and play" tutorials: real positions where
you must find and play the tactic yourself. Each drill walks you through
a line step by step — knight fork, attacking a pinned piece, skewer,
discovered attack, and back-rank mate on the offensive side; saving an
attacked piece and refusing a poisoned pawn on the defensive side. Wrong
tries get explained (tempting traps get *specific* explanations), the
Hint button draws the answer as a green arrow, and scripted replies keep
the lesson on rails. Drills live in `src/drills.js`, and
`tests/drills.test.js` replays every one against the engine so the
scripted moves can never drift out of legality.

## Habit tracker

The **Habit tracker** panel watches how you actually play and keeps
score across games (stored in your browser's localStorage):

- **Habits to break** — leaving pieces hanging, ignoring threats,
  bringing the queen out early, shuffling the same piece in the opening,
  and graded mistakes/blunders.
- **Habits to build** — developing minor pieces early, answering
  threats, and matching the engine's top move.

Each row shows this game's count and your all-time total, and the panel
highlights the habit that most needs work with concrete advice. Most
habits are detected from the board alone; the graded ones need Teacher
mode's analysis. Undone moves still count — the habit happened! The
detection logic is in `src/habits.js`.

## How the engine works

The board is an 8×8 array of strings like `"wp"` (white pawn), `"bk"`
(black king), or `""` (empty). For simplicity there is no en passant or
castling, and pawns auto-promote to a queen. Everything else — including
full check/checkmate/stalemate detection — is implemented.

### 1. Move generation

`generateMoves` produces every *pseudo-legal* move (each piece's movement
pattern). `legalMoves` then filters out moves that would leave the mover's
own king in check, by playing each move, asking `isSquareAttacked` about
the king's square, and taking the move back. `isSquareAttacked` looks
*outward from a square* along pawn/knight/king/sliding attack patterns,
which is much cheaper than generating all enemy replies.

### 2. Evaluation

`evaluate(board)` returns a single number in centipawns (100 = one pawn)
from White's perspective: positive is good for White. It sums:

- **Material** — pawn 100, knight 320, bishop 330, rook 500, queen 900.
- **Piece-square tables** — a small bonus or penalty per square, so the
  engine knows *where* pieces belong, not just what they're worth:
  knights love the center, advanced pawns gain value, the king prefers a
  corner. Black uses the same tables mirrored vertically.

### 3. Minimax with alpha-beta pruning

`search` plays out every line to a fixed depth assuming both sides choose
their best move: White picks the maximum score, Black the minimum
(minimax). Alpha-beta pruning makes this affordable: `alpha` tracks the
best score White is already guaranteed and `beta` the best for Black, and
as soon as a branch is proven irrelevant to best play (`alpha >= beta`)
its remaining siblings are skipped. Trying **captures first** (ordered by
"most valuable victim, least valuable attacker") makes those cutoffs
happen much earlier. The search counts every node it examines and every
branch it prunes — those are the numbers in the telemetry panel.

### 4. Quiescence search

Stopping abruptly at depth 0 causes the *horizon effect*: the engine plays
queen-takes-pawn on the last ply and never sees the recapture just beyond
its horizon. So at depth 0, `quiescence` keeps searching **capture moves
only** until the position is quiet, then trusts the static evaluation. The
side to move may also "stand pat" — decline all captures and keep the
current score — since capturing is never mandatory. This is what lets the
engine search 5–6 plies without blundering pieces at the edge of its
sight.

### 5. Choosing a move

`bestMove(board, color, depth)` searches every root move with a full
window so each candidate gets an exact score, then returns the best move,
its score, the node/prune counters, and the ranked candidate list the UI
shows in the "Why this move?" panel. The strength slider simply changes
the search depth (1–6): each extra ply makes the engine noticeably
stronger and slower. The search runs in a Web Worker so the page never
freezes while it thinks.

## Tests

`npm test` runs `tests/engine.test.js`, which checks that:

1. both sides have exactly 20 legal moves in the starting position,
2. Fool's Mate (1. f3 e5 2. g4 Qh4#) is detected as checkmate, and
3. quiescence search stops the engine from grabbing a defended pawn at
   the search horizon.
