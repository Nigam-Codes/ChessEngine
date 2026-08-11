/**
 * material.js — who has taken what, and who is ahead.
 *
 * Deliberately *derived* from the board rather than tracked as the game goes.
 * A running tally would need a hook in every path that changes the position,
 * and this app has several: your move, the engine's reply, undo, a drill being
 * loaded, a random midgame or endgame being generated. Counting the pieces
 * that are actually there is one line of truth instead of six, and it is
 * automatically right after any of them.
 */

import { PIECE_VALUES, WHITE, evaluate } from "./engine.js";

/**
 * How many of each piece a side starts with. Used only to work out what is
 * *missing*; the advantage below never consults it.
 */
const STARTING = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/** Display order, cheapest first — the order a capture tray reads in. */
const ORDER = ["p", "n", "b", "r", "q"];

/**
 * Points as a chess player counts them, not as the engine does. The engine
 * separates a bishop (330) from a knight (320) because that tenth of a pawn
 * genuinely steers the search, but nobody wants to read "+170" above the
 * board. A tray says +2.
 */
export const MATERIAL_POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** Every piece of one colour on the board, as bare type letters. */
function typesOf(board, color) {
  const types = [];
  for (const row of board) {
    for (const square of row) {
      if (square && square[0] === color && square[1] !== "k") types.push(square[1]);
    }
  }
  return types;
}

/**
 * What each side has captured, and by how much White leads.
 *
 *   { w: ["p", "p", "n"],   // Black pieces White has taken — shown by White
 *     b: ["p"],             // White pieces Black has taken — shown by Black
 *     advantage: 3 }        // in pawns; positive means White is ahead
 *
 * Two honest caveats, both matching how chess.com renders it:
 *
 *   - a *promoted* pawn shows up in the opponent's tray, because from the
 *     board's point of view that pawn is simply no longer there. The
 *     advantage is unaffected — it is computed from what is on the board, not
 *     from the trays — so the number stays right even when the icons flatter
 *     one side;
 *   - a position that never came from the opening (a drill, a generated
 *     endgame) shows everything missing from a full set as "captured". That
 *     is the only sensible reading of a position with no history, and it
 *     still tells you the thing that matters: who is up material.
 */
export function capturedFrom(board) {
  const counts = { w: {}, b: {} };
  const points = { w: 0, b: 0 };

  for (const color of ["w", "b"]) {
    for (const type of typesOf(board, color)) {
      counts[color][type] = (counts[color][type] || 0) + 1;
      points[color] += MATERIAL_POINTS[type];
    }
  }

  // What is missing from each side is what the *other* side displays.
  const missing = (color) => {
    const taken = [];
    for (const type of ORDER) {
      const gone = STARTING[type] - (counts[color][type] || 0);
      for (let i = 0; i < gone; i++) taken.push(type);
    }
    return taken;
  };

  return {
    w: missing("b"), // White shows the Black pieces it has taken
    b: missing("w"),
    advantage: points.w - points.b,
  };
}

/**
 * The engine's own view of the same question, in centipawns. Kept beside the
 * display version so it is obvious they answer different questions: this one
 * is for logic ("is the engine really level enough to accept a draw?"), the
 * one above is for the eye.
 */
export function materialBalance(board) {
  let score = 0;
  for (const color of ["w", "b"]) {
    for (const type of typesOf(board, color)) {
      score += (color === "w" ? 1 : -1) * PIECE_VALUES[type];
    }
  }
  return score;
}

/**
 * How level a position has to look before the engine shakes hands. Half a
 * pawn: close enough that neither side is playing for a win, and honest about
 * what the search actually reports rather than being politely agreeable.
 */
export const DRAW_WINDOW = 50;

/**
 * Should `engineColor` accept a draw here, and what does it say?
 *
 * Pure, so both answers are testable without a browser — and the refusal is
 * written to teach. Being told "I'm up material and still playing for the win"
 * is worth more to a learner than a silent no, because the lesson is that a
 * draw offer is a claim about the position, not a request.
 *
 * Two conditions, and both must hold: the *evaluation* has to be level or
 * worse for the engine, and it must not be ahead on material. The second
 * catches the case where a big material lead is temporarily masked by the
 * piece-square terms — an engine a rook up should never be talked into a draw
 * by an awkward-looking king.
 */
export function drawVerdict(board, engineColor) {
  const sign = engineColor === WHITE ? 1 : -1;
  const score = sign * evaluate(board);
  const material = sign * materialBalance(board);
  if (score <= DRAW_WINDOW && material <= 0) {
    return { accept: true, reason: "The engine accepts — there's nothing left to play for." };
  }
  const pawns = (score / 100).toFixed(1);
  return {
    accept: false,
    reason:
      material > 0
        ? `The engine declines — it's up material and still playing for the win. (It rates the position ${pawns} pawns its way.)`
        : `The engine declines — it likes its position by about ${pawns} pawns. Equalise first, then ask again.`,
  };
}
