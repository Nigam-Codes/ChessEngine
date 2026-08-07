/**
 * planning.js — keeps sketched arrows to legal chess.
 *
 * Draw mode used to let you drag an arrow between any two squares, which meant
 * you could draw a knight moving in a straight line or a pinned piece walking
 * away. In an app that grades your moves everywhere else, that quietly teaches
 * the wrong thing. So an arrow that starts on a piece may only end where that
 * piece could legally go.
 *
 * Arrows also *chain*: draw Nf3, then drag from f3 and you get the knight's
 * moves from there. One rule gives that, freeform annotation, and both
 * colours at once:
 *
 *   replay the arrows in draw order against a scratch board; an arrow whose
 *   from-square holds a piece is applied as a move, and one whose from-square
 *   is empty is left alone as an annotation.
 *
 * A freeform arrow starts on an empty square, so it is never applied. A chained
 * arrow starts on a square that an earlier arrow filled, so it is. And nothing
 * needs to check whose turn it is, because a plan legitimately holds two moves
 * by the same side, or a move and its reply.
 */

import {
  cloneBoard,
  generateMoves,
  legalMoves,
  applyMove,
  nextContext,
  EMPTY_CONTEXT,
} from "./engine.js";

/** Key for a square, matching the "r-c" form the board component already uses. */
export const squareKey = (r, c) => `${r}-${c}`;

const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

/**
 * Find the move an arrow describes, or null if it isn't one the rules allow.
 * Uses the engine's own generator, so an arrow can never be replayed as
 * something a piece couldn't actually do.
 */
function moveForArrow(board, ctx, arrow) {
  const [fromR, fromC] = arrow.from;
  const [toR, toC] = arrow.to;
  if (!onBoard(fromR, fromC) || !onBoard(toR, toC)) return null;
  const piece = board[fromR][fromC];
  if (!piece) return null; // an annotation, not a move
  return (
    generateMoves(board, piece[0], ctx).find(
      (m) => m.fromR === fromR && m.fromC === fromC && m.toR === toR && m.toC === toC
    ) || null
  );
}

/**
 * Replay `arrows` (in draw order) to get the position the plan describes.
 * Returns a fresh board and context; the inputs are untouched.
 */
export function simulatePlan(board, ctx = EMPTY_CONTEXT, arrows = []) {
  let next = cloneBoard(board);
  let nextCtx = ctx;
  for (const arrow of arrows) {
    const move = moveForArrow(next, nextCtx, arrow);
    if (!move) continue; // annotation, or no longer playable — skip it
    next = applyMove(next, move);
    nextCtx = nextContext(nextCtx, move);
  }
  return { board: next, ctx: nextCtx };
}

/**
 * Where an arrow starting on (r, c) may end.
 *
 * Returns a Set of "r-c" keys for a square holding a piece, or **null** for an
 * empty square, which the caller reads as "draw anything from here" so marking
 * a square or a general idea still works.
 *
 * Legality comes from the engine's own `legalMoves`, so arrows inherit
 * castling, en passant, promotion — and pins, which is the real payoff: a
 * pinned knight offers no L-shaped destinations at all, because it genuinely
 * has none.
 */
export function drawTargets(board, ctx = EMPTY_CONTEXT, { r, c } = {}) {
  if (!onBoard(r, c)) return null;
  const piece = board[r][c];
  if (!piece) return null; // freeform
  const keys = new Set();
  for (const move of legalMoves(board, piece[0], ctx)) {
    if (move.fromR === r && move.fromC === c) keys.add(squareKey(move.toR, move.toC));
  }
  return keys;
}

/**
 * The one call the UI needs on pointer-down: replay the arrows drawn so far,
 * then report where this drag is allowed to end.
 */
export function targetsForDrag(board, ctx, arrows, square) {
  const plan = simulatePlan(board, ctx, arrows);
  return drawTargets(plan.board, plan.ctx, square);
}
