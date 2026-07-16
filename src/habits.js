/**
 * habits.js — the habit tracker.
 *
 * Watches the moves you actually play and tallies recurring patterns:
 * habits to break (leaving pieces hanging, ignoring threats, early queen
 * raids, shuffling the same piece in the opening, graded blunders) and
 * habits to build (developing quickly, answering threats, matching the
 * engine's top choice). Counts persist in localStorage so progress is
 * visible across games and sessions.
 *
 * Detection is deliberately cheap: everything except the graded habits is
 * derived from the position before and after your move, so it works even
 * with teacher mode off. The graded habits need the coach's search, which
 * only runs in teacher mode.
 */

import { WHITE } from "./engine.js";
import { hangingPieces } from "./coach.js";

export const HABITS = [
  {
    id: "hung-piece",
    kind: "avoid",
    label: "Left a piece hanging",
    advice:
      "Before you let go of a piece, scan once more: after this move, can anything of mine simply be taken?",
  },
  {
    id: "ignored-threat",
    kind: "avoid",
    label: "Ignored a threat",
    advice:
      "When a piece is attacked, deal with it first — move it, defend it, block, or capture the attacker.",
  },
  {
    id: "early-queen",
    kind: "avoid",
    label: "Brought the queen out early",
    advice:
      "Develop knights and bishops before the queen; an early queen gets chased around while your opponent gains time.",
  },
  {
    id: "piece-shuffle",
    kind: "avoid",
    label: "Moved the same piece twice in the opening",
    advice:
      "Every opening move should bring a new piece into the game. Finish development before maneuvering.",
  },
  {
    id: "big-mistake",
    kind: "avoid",
    label: "Mistakes & blunders (graded)",
    advice:
      "Slow down on captures and checks — count attackers and defenders on the target square before you commit.",
    teacherOnly: true,
  },
  {
    id: "developed-minor",
    kind: "build",
    label: "Developed a minor piece early",
  },
  {
    id: "answered-threat",
    kind: "build",
    label: "Answered a threat",
  },
  {
    id: "top-move",
    kind: "build",
    label: "Matched the engine's top move (graded)",
    teacherOnly: true,
  },
];

/** White's minor pieces still on their starting squares. */
const HOME_MINORS = [
  [7, 1, "wn"], [7, 6, "wn"],
  [7, 2, "wb"], [7, 5, "wb"],
];

function minorsAtHome(board) {
  return HOME_MINORS.filter(([r, c, piece]) => board[r][c] === piece).length;
}

/**
 * Detect habit events for one of your moves. `moveNumber` counts *your*
 * moves (1 = your first move); `previousMoves` is the list of your earlier
 * move objects, used to spot the same piece being shuffled around.
 * Returns an array of habit ids (possibly empty).
 */
export function analyzeMove({ prevBoard, nextBoard, move, moveNumber, previousMoves = [] }) {
  const events = [];
  const key = (h) => `${h.r}-${h.c}-${h.piece}`;
  const before = hangingPieces(prevBoard, WHITE);
  const after = hangingPieces(nextBoard, WHITE);
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));

  // A piece is newly hanging after your move: you put it (or left it) there.
  if (after.some((h) => !beforeKeys.has(key(h)))) events.push("hung-piece");

  if (before.length > 0) {
    if (before.some((h) => afterKeys.has(key(h)))) {
      // Something was already hanging and it still is — the threat was ignored.
      events.push("ignored-threat");
    } else if (after.length === 0) {
      events.push("answered-threat");
    }
  }

  if (move.piece === "wq" && moveNumber <= 5 && minorsAtHome(prevBoard) >= 2) {
    events.push("early-queen");
  }

  if (
    moveNumber <= 8 &&
    move.piece[1] !== "p" &&
    move.piece[1] !== "k" &&
    !move.captured &&
    minorsAtHome(prevBoard) >= 1 &&
    previousMoves.some(
      (m) => m.piece === move.piece && m.toR === move.fromR && m.toC === move.fromC
    )
  ) {
    events.push("piece-shuffle");
  }

  if ((move.piece === "wn" || move.piece === "wb") && move.fromR === 7 && moveNumber <= 10) {
    events.push("developed-minor");
  }

  return events;
}

/**
 * Habit events from the coach's grading of a move: `loss` is centipawns
 * given up versus the engine's best move in the same position.
 */
export function gradingEvents(loss) {
  if (loss == null) return [];
  if (loss <= 20) return ["top-move"];
  if (loss > 150) return ["big-mistake"];
  return [];
}

/* ---- Persistence -------------------------------------------------- */

const STORAGE_KEY = "chess-lab-habits-v1";

export function emptyStats() {
  return { counts: {}, games: 0 };
}

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadHabitStats(storage = defaultStorage()) {
  if (!storage) return emptyStats();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyStats();
    const parsed = JSON.parse(raw);
    return { counts: parsed.counts || {}, games: parsed.games || 0 };
  } catch {
    return emptyStats();
  }
}

export function saveHabitStats(stats, storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Storage full or blocked — tracking silently becomes session-only.
  }
}

export function clearHabitStats(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
}
