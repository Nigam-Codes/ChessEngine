/**
 * clock.js — chess clocks for Blitz mode.
 *
 * Pure functions only. The component owns the ticking; everything about *what
 * the rules are* lives here so it can be tested without a browser.
 *
 * Time is always tracked as "milliseconds remaining", recomputed from real
 * timestamps rather than decremented on a timer. A setInterval that fires late
 * — and it will, especially in a background tab — must not hand the player
 * back time they actually spent.
 */

import { WHITE, BLACK, opposite } from "./engine.js";

/** The presets offered in Blitz mode. `base` and `inc` are in seconds. */
export const TIME_CONTROLS = [
  { id: "1+0", label: "1+0 Bullet", base: 60, inc: 0 },
  { id: "3+0", label: "3+0 Blitz", base: 180, inc: 0 },
  { id: "3+2", label: "3+2 Blitz", base: 180, inc: 2 },
  { id: "5+0", label: "5+0 Blitz", base: 300, inc: 0 },
  { id: "10+0", label: "10+0 Rapid", base: 600, inc: 0 },
];

export const DEFAULT_CONTROL = "3+2";

export function findControl(id) {
  return TIME_CONTROLS.find((c) => c.id === id) || TIME_CONTROLS[2];
}

/** Fresh clocks for a time control, in milliseconds. */
export function createClocks(control) {
  const c = typeof control === "string" ? findControl(control) : control;
  return { w: c.base * 1000, b: c.base * 1000, inc: c.inc * 1000 };
}

/** Subtract elapsed time from the side on move, never going below zero. */
export function tick(clocks, color, elapsedMs) {
  const next = { ...clocks };
  next[color] = Math.max(0, clocks[color] - elapsedMs);
  return next;
}

/** Add the increment after a completed move (Fischer style: added on move). */
export function addIncrement(clocks, color) {
  return { ...clocks, [color]: clocks[color] + (clocks.inc || 0) };
}

/**
 * "3:04", or tenths once under ten seconds — the point at which players start
 * watching the clock instead of the board.
 */
export function formatClock(ms) {
  const safe = Math.max(0, ms);
  if (safe < 10000) return (safe / 1000).toFixed(1);
  const total = Math.ceil(safe / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Can `color` still deliver checkmate with the material it has left?
 *
 * This matters on the flag: FIDE gives a draw rather than a win when the
 * player who still has time couldn't possibly mate. A lone king, or a king
 * with a single minor piece, cannot force mate.
 */
export function canMate(board, color) {
  let minors = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece[0] !== color) continue;
      const type = piece[1];
      if (type === "p" || type === "r" || type === "q") return true;
      if (type === "n" || type === "b") minors++;
    }
  }
  return minors >= 2;
}

/**
 * What happens when `flagged` runs out of time: the opponent wins, unless
 * they have too little material to mate, in which case it is a draw.
 */
export function flagResult(board, flagged) {
  const winner = opposite(flagged);
  return canMate(board, winner)
    ? { outcome: "flagged", winner }
    : { outcome: "flagged-draw", winner: null };
}

/**
 * How deep the engine may search given the time on *its* clock.
 *
 * Without this the engine happily spends twelve seconds at depth 6 and loses
 * a three-minute game on time — which is neither realistic nor a good
 * opponent. It budgets roughly a twentieth of its remaining time per move and
 * picks the deepest search that fits, measured from this engine's own timings.
 */
export function depthForTime(msLeft, maxDepth = 6) {
  const budget = msLeft / 20;
  let depth;
  if (budget < 120) depth = 1;
  else if (budget < 400) depth = 2;
  else if (budget < 1200) depth = 3;
  else if (budget < 4000) depth = 4;
  else if (budget < 15000) depth = 5;
  else depth = 6;
  return Math.max(1, Math.min(depth, maxDepth));
}

/**
 * Split a game's moves by how much time was on the clock, so the review can
 * answer the question Blitz mode exists to ask: does your play fall apart
 * under pressure? `entries` are { loss, msLeft } for one player's moves.
 */
export const PRESSURE_THRESHOLD_MS = 30000;

export function pressureSplit(entries, thresholdMs = PRESSURE_THRESHOLD_MS) {
  const calm = entries.filter((e) => e.msLeft != null && e.msLeft >= thresholdMs);
  const rushed = entries.filter((e) => e.msLeft != null && e.msLeft < thresholdMs);
  const avg = (list) =>
    list.length ? list.reduce((sum, e) => sum + Math.max(0, e.loss), 0) / list.length : null;
  const accuracy = (a) => (a == null ? null : Math.max(0, Math.min(100, Math.round(100 - a / 6))));
  return {
    calm: { moves: calm.length, accuracy: accuracy(avg(calm)) },
    rushed: { moves: rushed.length, accuracy: accuracy(avg(rushed)) },
  };
}
