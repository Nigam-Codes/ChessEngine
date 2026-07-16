# AI Chess Coach — Gap Analysis & Roadmap

This document compares the "ultimate AI Chess Coach" specification against the
current build, records what was just added, and flags every item that needs a
product/design decision before it should be built. Review the **Decisions
needed** section and mark your choices.

---

## 1. Where the current build stands

### Already built (before this round)

| Spec item | Status |
|---|---|
| Play as White or Black | ✅ side picker, board auto-flips, engine opens as White |
| Unlimited Undo | ✅ full move-pair undo with state restore |
| Coach Mode (teacher mode) | ✅ move grading vs engine best, threat warnings, arrows |
| Tactical patterns taught | ✅ 18 drills/lessons: pins, forks, skewers, discovered attacks, double attacks, removing the defender, back-rank, smothered mate, counting, poisoned pawn |
| Move arrows | ✅ threat (red) / hint (green) / engine move (blue), lessons annotated |
| Evaluation bar | ✅ |
| Habit tracker | ✅ blunder frequency, hanging pieces, ignored threats, early queen, development — per-game + lifetime (localStorage) |
| Mobile support, dark UI | ✅ responsive, reduced-motion aware, iOS glyph fix |
| Difficulty levels | ✅ 6 levels (depth 1–6) |
| Engine off the main thread | ✅ Web Worker |
| Testing strategy | ✅ 30+ unit tests; drills machine-verified against the engine; headless-browser smoke test |
| Deployment | ✅ GitHub Pages CI/CD |

### Added this round

| Spec item | What was built |
|---|---|
| Flip board anytime | "Flip board" button (independent of side choice) |
| Blindfold Mode | Toggle hides pieces; board stays playable from the move list |
| Hint levels 1–4 | Ladder: ① general idea → ② which piece → ③ candidate moves → ④ best move + arrow. Never reveals more than asked. |
| Socratic teaching | Coach panel now asks context-aware questions ("What is your opponent threatening?", "Which piece is least active?") instead of only telling |
| Human-like mistakes | Levels 1–2 no longer just search shallow: the engine sometimes plays a near-best candidate (60% / 30% of moves), simulating plausible human error |
| Opening Trainer (seed) | Guided drills: Italian Game, Queen's Gambit — each move explained with the *idea*, not just the move |
| Endgame Trainer (seed) | Guided drills: king-and-pawn escort, the square rule, Philidor draw, rook mate |
| Post Game Review (v1) | Accuracy % (from graded moves), best/good/inaccuracy/mistake/blunder counts, evaluation graph, top-3 critical moments |
| Learn-mode categories | Drill browser filters: Offense / Defense / Opening / Endgame |

---

## 2. Feasible next, no decisions needed

Ordered by learning value ÷ effort. Say "go" and these can be built on the
current architecture:

1. **Blunder guard** — before committing a move that loses ≥3 pawns (quick
   depth-2 check), ask "Are you sure?" with a takeback. (Spec: "warn about
   blunders before they happen.")
2. **More tactic drills** — deflection, decoy, overloading, zwischenzug,
   interference, clearance, X-ray, Greek Gift, windmill, perpetual check,
   quiet moves, sacrifices. The drill engine supports all of them; each is
   ~30 lines of verified data.
3. **More openings** — Ruy Lopez, Sicilian, French, Caro-Kann, London as
   guided drills; common traps (Fried Liver, Légal's mate) as trap drills.
4. **More endgames** — Lucena bridge, opposition duel, wrong-bishop draw,
   two-rook ladder mate, Q vs P promotion races.
5. **Missed-tactic exercises** — when the coach flags a blunder, save the
   position as a personal puzzle and replay it from the review screen.
   (Spec: "exercises generated from mistakes.")
6. **Accuracy trend + weekly summary** — the habit tracker already persists;
   add per-game accuracy history and a simple trend chart.
7. **Achievements & streaks** — localStorage: puzzle streaks, no-blunder
   games, drill completions, daily activity.

## 3. Decisions needed from you

Each of these changes the product's shape or its architecture. Current state
noted; pick a direction and the work can be scheduled.

| # | Topic | The decision | Notes |
|---|---|---|---|
| D1 | **Stockfish vs. custom engine** | Swap the teaching engine for stockfish.wasm, keep the custom minimax, or run both (Stockfish for analysis, custom for teaching)? | Stockfish gives GM strength + accurate analysis, but the current engine is the *teaching artifact* — readable, explainable, and its telemetry panels are the app's identity. Both-at-once is the spec's intent ("Stockfish as the analysis engine") and is feasible (~1.5 MB wasm, still client-only). **Recommended: both.** |
| D2 | **Accounts & data** | Stay 100% local (localStorage), or add a backend (accounts, database, sync)? | Everything in the spec's analytics/goals/reports sections is buildable locally, but data dies with the browser. A backend means auth, hosting costs, and a database schema — a different project category. **Recommended: local-first now, export/import JSON as a bridge.** |
| D3 | **Rated mode & rating numbers** | Implement a local Elo estimate (vs. engine levels), or integrate with a real rating ecosystem? | A local rating is easy and motivating but not comparable to FIDE/chess.com. Goals like "Reach 1200" need *some* rating definition. |
| D4 | **Time controls** | Add clocks (bullet→classical)? Needs pause/resume, flagging, and a decision on whether the engine's think time counts. | Straightforward UI work; decide if losing on time is wanted in a *learning* app. |
| D5 | **10 difficulty levels** | Expand 6 → 10 named levels (Beginner → Super GM → Max)? | Above depth 6 the custom engine gets slow; levels 7–10 realistically require D1 (Stockfish). Depth alone won't reach GM strength. |
| D6 | **Puzzle source** | Generate puzzles from the engine (slow, limited themes), bundle a public-domain puzzle set (e.g. lichess CC0 database excerpt), or both? | "Unlimited adaptive puzzles" needs a large tagged corpus; the lichess puzzle DB is the standard answer and is licence-friendly. |
| D7 | **Spaced repetition** | Full SM-2 style scheduler for openings/motifs, or lightweight "review again in N days" queues? | Affects data model for every trainer. |
| D8 | **Analytics scope** | Which charts first: rating history, accuracy trend, mistakes by phase/piece/opening, blunders over time, weakness radar? | All buildable locally once per-game records (D2) are kept; picking 3–4 avoids dashboard sprawl. |
| D9 | **Animations** | CSS-only move animations (light), or a full animated tactic-replay system? | Spec asks for animated tactics; current app is static + arrows. Reduced-motion must stay respected. |
| D10 | **Opening name detection** | Bundle an ECO openings book (name shown in review + "book move" hints)? ~50–200 KB data. | Also unlocks "mistakes by opening" analytics. |
| D11 | **Blindfold input** | Keep click-the-hidden-board, or add algebraic text input ("Nf3") for true blindfold training? | Text input is the classic training tool but needs a move parser. |
| D12 | **Momentum graph, brilliancy detection** | Define them: momentum = eval swings per move window? "Brilliant" = only-move sacrifices? | These need agreed definitions before they can be honest metrics. |

## 4. Explicitly out of scope until decided

Multi-player, server-side game storage, real-time coaching chat (LLM
integration), voice, opening repertoire *builder* (vs. the trainer),
tournament/calendar features, and native apps. None are blocked technically;
all are D2-dependent or separate products.

## 5. Suggested build order (after your review)

1. Blunder guard + missed-tactic exercises (closes the teaching loop)
2. D1 decision → Stockfish analysis lane + levels 7–10
3. Tactic/opening/endgame drill expansion (§2 items 2–4)
4. Per-game records + accuracy trend + achievements (§2 items 6–7)
5. D6/D7 → adaptive puzzle trainer with spaced repetition
6. D8 → analytics dashboard; D10 → opening names in review
