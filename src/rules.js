/**
 * rules.js — the three ways a game ends in a draw without anyone being
 * stalemated: repetition, the fifty-move rule, and dead material.
 *
 * These live outside engine.js on purpose. Two of them are not facts about a
 * position at all: threefold repetition needs the whole game, and the fifty
 * move rule needs a counter carried alongside it. `getGameStatus` answers
 * "what is true of this board", which is what the search and the position
 * generator want; `outcomeFor` below answers "how does this *game* stand",
 * which is what the player wants. Keeping them separate also keeps the import
 * arrow pointing one way — rules.js knows about engine.js and never the
 * reverse.
 */

import { getGameStatus, EMPTY_CONTEXT } from "./engine.js";

/** How many plies without a pawn move or a capture make a draw. */
export const FIFTY_MOVE_PLIES = 100;

/**
 * A string that is equal for two positions exactly when a player would call
 * them "the same position".
 *
 * The side to move, the castling rights and the en-passant square all have to
 * be in here. Two boards that look identical but differ in what is *legal* are
 * not a repetition, and leaving rights out is the classic way to declare a
 * draw that isn't one.
 */
export function positionKey(board, colorToMove, ctx = EMPTY_CONTEXT) {
  const rights = ctx.rights || EMPTY_CONTEXT.rights;
  const flags =
    (rights.wk ? "K" : "") + (rights.wq ? "Q" : "") +
    (rights.bk ? "k" : "") + (rights.bq ? "q" : "") || "-";
  const ep = ctx.ep ? `${ctx.ep.r}${ctx.ep.c}` : "-";
  // The halfmove clock is deliberately *not* here: a position repeats whether
  // or not the fifty-move counter happens to match.
  return board.map((row) => row.map((sq) => sq || ".").join("")).join("/") +
    ` ${colorToMove} ${flags} ${ep}`;
}

/**
 * Can either side still deliver mate?
 *
 * Anything that promotes or mates on its own — a pawn, rook or queen — settles
 * it immediately. Otherwise mate needs two pieces that between them cover both
 * square colours: any number of bishops all on one colour can never touch the
 * other, and a lone knight cannot force mate either.
 *
 * Deliberately *not* included: king and two knights, and knight-versus-bishop.
 * Mate cannot be forced there, but it can be reached, so FIDE does not call
 * the position dead and neither do we.
 */
export function insufficientMaterial(board) {
  const bishops = [];
  let knights = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece[1];
      if (type === "k") continue;
      if (type === "p" || type === "r" || type === "q") return false;
      if (type === "n") knights++;
      else bishops.push((r + c) % 2); // which colour square it lives on
    }
  }
  if (knights === 0) {
    // Bare kings, or bishops that all share a square colour.
    return bishops.every((sq) => sq === bishops[0]);
  }
  // A single knight and nothing else cannot force mate.
  return knights === 1 && bishops.length === 0;
}

/** Has the halfmove clock reached fifty moves for each side? */
export function isFiftyMove(ctx) {
  return (ctx?.half ?? 0) >= FIFTY_MOVE_PLIES;
}

/**
 * How many times the position now on the board has occurred this game,
 * counting the present one. Three means a draw may be claimed.
 *
 * Derived from plyLog rather than a running tally, for the same reason the
 * capture tray is: plyLog[i] already stores the position before ply i, so
 * this is automatically right after an undo with no bookkeeping to unwind.
 */
export function repetitionCount(plyLog, board, turn, ctx) {
  const key = positionKey(board, turn, ctx);
  let count = 1; // the position on the board right now
  for (const ply of plyLog) {
    if (positionKey(ply.board, ply.color, ply.ctx) === key) count++;
  }
  return count;
}

/**
 * The status of a game in progress: everything `getGameStatus` reports, plus
 * the three draws that need more than a board to see.
 *
 * Checkmate and stalemate come first because they are absolute — a position
 * with no legal moves is over however many times it has occurred.
 */
export function outcomeFor({ board, turn, ctx = EMPTY_CONTEXT, plyLog = [] }) {
  const base = getGameStatus(board, turn, ctx);
  if (base === "checkmate" || base === "stalemate") return base;
  if (insufficientMaterial(board)) return "insufficient";
  if (isFiftyMove(ctx)) return "fifty-move";
  if (repetitionCount(plyLog, board, turn, ctx) >= 3) return "repetition";
  return base; // "check" or "playing"
}

/** Statuses that mean the game is over. */
export const TERMINAL = new Set([
  "checkmate",
  "stalemate",
  "insufficient",
  "fifty-move",
  "repetition",
]);

/** Human wording for each drawn ending, for the status line and result card. */
export const DRAW_REASONS = {
  stalemate: "by stalemate",
  insufficient: "by insufficient material",
  "fifty-move": "by the fifty-move rule",
  repetition: "by threefold repetition",
};
