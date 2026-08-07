# Chess Engine Lab

Pick a side and play a small, readable chess engine — and watch it think.
Choose White or Black (the board flips and the engine opens when you take
Black), flip the board anytime, try blindfold mode, and get a post-game
review with accuracy, move grades, and an evaluation graph. Castle by clicking your king two squares over — or just click the rook.
Plan your ideas chess.com-style: right-click-drag (or the ✏️ Draw toggle on
touch screens) sketches arrows on the board, dragging within one square
highlights it, Shift/Alt/Ctrl pick red/blue/green, and a left click wipes
the sketch. **Sketched arrows have to be legal chess** — see below. Flipping
the board animates. Switch to
**Learn mode** for hands-on drills across tactics, openings, and endgames.
At low strength levels the engine also makes human-like mistakes instead of
just searching shallower. See `PLAN.md` for the full roadmap toward the
AI-coach feature set.
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
- **Hint ladder** — four levels of help: a general idea, then which piece,
  then candidate moves, and only at level four the best move (drawn on the
  board in green). The coach also asks Socratic questions ("What is your
  opponent threatening?") instead of only telling.
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

## Drawing arrows that are actually chess

Most boards let you drag an arrow anywhere, so you can draw a knight moving in
a straight line. In an app that grades your moves and names your bad habits,
that quietly teaches the wrong thing — so an arrow starting on a piece may only
end where that piece could legally go. Press a knight and you get dots on its
two L-squares and nowhere else.

Because the destinations come from the engine's own `legalMoves`, arrows
inherit every rule for free: castling, en passant, promotion — and pins. A
pinned knight offers no destinations at all, because it genuinely has none.

Two behaviours fall out of one rule. Arrows are replayed in draw order against
a scratch board; an arrow whose from-square holds a piece is applied as a move,
and one starting on an empty square is left alone as an annotation. So:

- **Freeform still works.** Drag from an empty square to mark an idea, a
  target, or a pawn-storm direction — no piece there, nothing to constrain.
- **Arrows chain.** Draw `Nf3`, then drag from f3 and you get the knight's
  moves *from there*, so you can sketch `Nf3 → Ng5` a move ahead. Nothing has
  to check whose turn it is, because a plan legitimately holds two moves by the
  same side, or a move and its reply.

You can draw the opponent's moves too, which is most of what arrows are for
while thinking. The logic is in `src/planning.js`, unit-tested in
`tests/planning.test.js`.

## Practice from a random position

Most games are lost in the middlegame and endgame, but you can only reach
those by playing twenty moves of opening first. The **Start from** control
fixes that: pick *Random midgame* or *Random endgame*, choose whether you want
an equal game, a win to convert, or a loss to defend, and hit New game. A
banner names what you're practising — *"Rook and pawn vs rook — you're winning,
convert it"*. It works in 2-player hot-seat too, so two people can drill rook
endings together.

The two phases are generated differently, because scattering pieces works for
one and not the other:

- **Endgames** are built procedurally from material templates (K+P vs K, rook
  endings, opposite-coloured bishops…) written as a *strong* and a *weak* side,
  which is what lets the same table hand you either side. Positions are then
  validated by the engine itself — kings not adjacent, nobody left in check,
  game not already over — and rejected and retried until one passes.
- **Middlegames** come from letting the engine play a short semi-random opening
  against itself. Twenty pieces dropped at random make a position no real game
  could reach; sixteen plies of actual play make one worth thinking about.

Generation lives in `src/positions.js`, is seeded (so a seed reproduces a
position exactly), and is fuzz-tested in `tests/positions.test.js` — hundreds
of generated positions, each asserted legal and playable.

## 2-player mode

The **👥 2 Players** tab turns the app into a shared board for two people on
one device. The board auto-flips after each move so whoever is on move sees
their own pieces at the bottom (toggle it off for a screen sitting flat
between you), undo takes back a single ply, and the engine never runs — it
stays idle until you ask for the review.

Because the habit tracker is a personal profile, it is **paused** during
2-player games: your opponent's blunders never land in your lifetime stats.
Live coaching is off too, so nothing interrupts the game.

Instead, all the coaching arrives at the end. Press **Coach the game** and the
worker grades every ply, then builds a separate report for each colour:

- accuracy, and a breakdown of best / good / inaccuracy / mistake / blunder;
- the three moves that cost the most, each spelled out — *"Move 14: you played
  Qxd5, better was Nf3 (−3.2)"*;
- the habits that showed up in that player's moves, with the advice for each,
  so both players leave with something specific to work on.

## Learn mode

The **Learn** tab holds "select and play" tutorials: real positions where
you must find and play the tactic yourself. Each drill walks you through
a line step by step. **Offense**: knight fork, pawn fork, attacking a
pinned piece, skewer, discovered attack, the queen's double attack,
removing the defender, back-rank mate, the smothered mate, the Greek Gift
sacrifice, and en passant as a weapon. **Defense**: saving an attacked
piece, making luft, refusing a poisoned pawn, and the three cases where
castling is illegal. **Strategy**: opposite-side castling pawn storms, and
connecting the rooks. **Opening**: the Italian Game, the Queen's Gambit,
castling for king safety, and the en-passant rule. **Endgame**: pawn
escorting, the square rule, the Philidor draw, and the rook mate. Wrong
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
(black king), or `""` (empty). Pawns auto-promote to a queen; everything
else is here, including full check/checkmate/stalemate detection,
**castling**, and **en passant**.

Those last two need state a board can't express — has the king moved? did
a pawn *just* double-step? — so they travel in a small **context** object
alongside the board:

```js
{ rights: { wk, wq, bk, bq }, ep: { r, c } | null }
```

Every move-generating function takes it as an optional trailing argument
that defaults to "neither rule available", which is why lesson diagrams and
constructed puzzle positions behave exactly as they always did. `nextContext`
returns a fresh context after each move, so the search recurses without any
unwind logic.

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
  knights love the center, advanced pawns gain value. Black uses the same
  tables mirrored vertically.
- **Tapered evaluation** — a king wants opposite things in the opening and
  the endgame: hidden on g1 while the queens are on, marching to the centre
  once they're off. So there are two sets of tables, blended by how much
  material is left. Without this the engine shuffles its king in the corner
  while your pawn queens — it is the difference between an opponent that can
  play an endgame and one that can't.

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
