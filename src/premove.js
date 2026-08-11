/**
 * premove.js — queueing a move before it is legal.
 *
 * A premove is aimed at a position that does not exist yet, so ordinary move
 * generation is the wrong tool twice over:
 *
 *   - it won't offer a pawn capture onto an empty square, and that is the
 *     single most common premove in blitz — the opponent takes your knight on
 *     f6 and you have already queued gxf6;
 *   - it won't offer a move onto a square holding one of your own pieces, and
 *     that is the *same* case seen from the other side: f6 is your knight
 *     right up until it is taken.
 *
 * So what a premove offers is geometry: every square the piece could reach on
 * an otherwise empty board. Whether the move is real is settled once, later,
 * against the position the opponent actually produced.
 */

import {
  legalMoves,
  KNIGHT_JUMPS,
  KING_STEPS,
  BISHOP_DIRS,
  ROOK_DIRS,
  WHITE,
  EMPTY_CONTEXT,
} from "./engine.js";

const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const squareKey = (r, c) => `${r}-${c}`;

/**
 * Every square the piece on `from` could reach on an empty board, as a Set of
 * "r-c" keys. Occupancy is ignored entirely — see the note above. Returns an
 * empty Set when the square is empty.
 */
export function premoveSquares(board, from) {
  const piece = board[from.r]?.[from.c];
  const out = new Set();
  if (!piece) return out;
  const [color, type] = [piece[0], piece[1]];
  const add = (r, c) => {
    if (onBoard(r, c) && !(r === from.r && c === from.c)) out.add(squareKey(r, c));
  };

  if (type === "p") {
    const dir = color === WHITE ? -1 : 1;
    const startRow = color === WHITE ? 6 : 1;
    add(from.r + dir, from.c);
    if (from.r === startRow) add(from.r + 2 * dir, from.c);
    // Both diagonals, always — an empty one is the recapture you are betting on.
    add(from.r + dir, from.c - 1);
    add(from.r + dir, from.c + 1);
    return out;
  }

  if (type === "n" || type === "k") {
    for (const [dr, dc] of type === "n" ? KNIGHT_JUMPS : KING_STEPS) {
      add(from.r + dr, from.c + dc);
    }
    // Castling destinations, so a king can be premoved to safety.
    if (type === "k") {
      add(from.r, from.c + 2);
      add(from.r, from.c - 2);
    }
    return out;
  }

  const dirs =
    type === "b" ? BISHOP_DIRS : type === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
  for (const [dr, dc] of dirs) {
    // Rays run to the edge: a blocker may be gone by the time this is played.
    for (let i = 1; i < 8; i++) add(from.r + dr * i, from.c + dc * i);
  }
  return out;
}

/**
 * Turn a queued premove into a real move, or nothing.
 *
 * This is the correctness question the whole feature turns on: the opponent
 * may not have played what you assumed, so the queued from/to is matched
 * against the legal moves of the position that actually arrived, and dropped
 * if it isn't among them.
 *
 * A premove cannot stop to ask what a pawn becomes, so it queens — right
 * nearly always, and the picker is still there for a deliberate promotion.
 */
export function resolvePremove(board, color, ctx = EMPTY_CONTEXT, premove) {
  if (!premove) return null;
  const matches = legalMoves(board, color, ctx).filter(
    (m) =>
      m.fromR === premove.from.r &&
      m.fromC === premove.from.c &&
      m.toR === premove.to.r &&
      m.toC === premove.to.c
  );
  if (matches.length === 0) return null;
  return matches.find((m) => !m.promotion || m.promotion[1] === "q") || matches[0];
}
