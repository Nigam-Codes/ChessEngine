/**
 * engine.js — a small, readable chess engine.
 *
 * The board is an 8×8 array of strings. Row 0 is rank 8 (Black's back rank),
 * row 7 is rank 1 (White's back rank). Each square holds "" (empty) or a
 * two-character piece code: color ("w"/"b") + type ("p n b r q k"),
 * e.g. "wp" = white pawn, "bk" = black king.
 *
 * Simplifications (deliberate, to keep the code teachable):
 *   - no en passant, no castling
 *   - pawns auto-promote to a queen
 *
 * The interesting parts, in reading order:
 *   1. Move generation  — generateMoves / legalMoves / isSquareAttacked
 *   2. Evaluation       — evaluate (material + piece-square tables)
 *   3. Search           — search (minimax + alpha-beta), quiescence
 *   4. bestMove         — the top-level entry point the UI calls
 */

export const WHITE = "w";
export const BLACK = "b";

export function opposite(color) {
  return color === WHITE ? BLACK : WHITE;
}

/** The standard starting position. */
export function initialBoard() {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  const board = [];
  board.push(back.map((t) => "b" + t));
  board.push(Array(8).fill("bp"));
  for (let i = 0; i < 4; i++) board.push(Array(8).fill(""));
  board.push(Array(8).fill("wp"));
  board.push(back.map((t) => "w" + t));
  return board;
}

/** Deep-copy a board (handy for the UI, which wants immutable state). */
export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

/* ------------------------------------------------------------------ */
/* 1. Move generation                                                  */
/* ------------------------------------------------------------------ */

export const KNIGHT_JUMPS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
export const KING_STEPS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
export const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

/**
 * A move is a plain object:
 *   { fromR, fromC, toR, toC, piece, captured, promotion }
 * `captured` is the piece code on the target square ("" if none) and
 * `promotion` is the new piece code when a pawn reaches the last rank.
 * Storing both makes moves trivially reversible (see unmakeMove).
 */
function addMove(moves, board, fromR, fromC, toR, toC, promotion = "") {
  moves.push({
    fromR, fromC, toR, toC,
    piece: board[fromR][fromC],
    captured: board[toR][toC],
    promotion,
  });
}

/**
 * Generate all *pseudo-legal* moves for `color`: every move a piece could
 * physically make, ignoring whether it leaves its own king in check.
 * legalMoves() filters those out afterwards.
 */
export function generateMoves(board, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece[0] !== color) continue;
      const type = piece[1];

      if (type === "p") {
        // Pawns are the only piece whose direction depends on color.
        const dir = color === WHITE ? -1 : 1;
        const startRow = color === WHITE ? 6 : 1;
        const lastRow = color === WHITE ? 0 : 7;
        const promo = (row) => (row === lastRow ? color + "q" : "");

        // One square forward (two from the starting rank), never a capture.
        if (onBoard(r + dir, c) && board[r + dir][c] === "") {
          addMove(moves, board, r, c, r + dir, c, promo(r + dir));
          if (r === startRow && board[r + 2 * dir][c] === "") {
            addMove(moves, board, r, c, r + 2 * dir, c);
          }
        }
        // Diagonal captures.
        for (const dc of [-1, 1]) {
          const tr = r + dir, tc = c + dc;
          if (onBoard(tr, tc) && board[tr][tc] && board[tr][tc][0] !== color) {
            addMove(moves, board, r, c, tr, tc, promo(tr));
          }
        }
      } else if (type === "n" || type === "k") {
        const steps = type === "n" ? KNIGHT_JUMPS : KING_STEPS;
        for (const [dr, dc] of steps) {
          const tr = r + dr, tc = c + dc;
          if (onBoard(tr, tc) && (!board[tr][tc] || board[tr][tc][0] !== color)) {
            addMove(moves, board, r, c, tr, tc);
          }
        }
      } else {
        // Sliding pieces: walk each ray until we hit something.
        const dirs =
          type === "b" ? BISHOP_DIRS :
          type === "r" ? ROOK_DIRS :
          [...BISHOP_DIRS, ...ROOK_DIRS]; // queen
        for (const [dr, dc] of dirs) {
          let tr = r + dr, tc = c + dc;
          while (onBoard(tr, tc)) {
            if (board[tr][tc] === "") {
              addMove(moves, board, r, c, tr, tc);
            } else {
              if (board[tr][tc][0] !== color) addMove(moves, board, r, c, tr, tc);
              break; // ray is blocked either way
            }
            tr += dr; tc += dc;
          }
        }
      }
    }
  }
  return moves;
}

/** Apply a move in place. unmakeMove() restores it exactly. */
export function makeMove(board, move) {
  board[move.toR][move.toC] = move.promotion || move.piece;
  board[move.fromR][move.fromC] = "";
}

export function unmakeMove(board, move) {
  board[move.fromR][move.fromC] = move.piece;
  board[move.toR][move.toC] = move.captured;
}

/** Convenience for the UI: returns a *new* board with the move applied. */
export function applyMove(board, move) {
  const next = cloneBoard(board);
  makeMove(next, move);
  return next;
}

/**
 * Is the square (r, c) attacked by any piece of `byColor`?
 * Instead of generating every enemy move, we look *outward from the square*
 * along each attack pattern — much cheaper, and it's called a lot
 * (once per candidate move, to test for check).
 */
export function isSquareAttacked(board, r, c, byColor) {
  // Pawns: a white pawn attacks the two squares diagonally *above* it,
  // so a square is attacked by a white pawn sitting one row below it.
  const pawnRow = byColor === WHITE ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (onBoard(pawnRow, c + dc) && board[pawnRow][c + dc] === byColor + "p") {
      return true;
    }
  }
  // Knights and kings: fixed offsets.
  for (const [dr, dc] of KNIGHT_JUMPS) {
    if (onBoard(r + dr, c + dc) && board[r + dr][c + dc] === byColor + "n") return true;
  }
  for (const [dr, dc] of KING_STEPS) {
    if (onBoard(r + dr, c + dc) && board[r + dr][c + dc] === byColor + "k") return true;
  }
  // Sliders: walk each ray; the first piece we meet decides.
  for (const [dr, dc] of BISHOP_DIRS) {
    let tr = r + dr, tc = c + dc;
    while (onBoard(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p[0] === byColor && (p[1] === "b" || p[1] === "q")) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  for (const [dr, dc] of ROOK_DIRS) {
    let tr = r + dr, tc = c + dc;
    while (onBoard(tr, tc)) {
      const p = board[tr][tc];
      if (p) {
        if (p[0] === byColor && (p[1] === "r" || p[1] === "q")) return true;
        break;
      }
      tr += dr; tc += dc;
    }
  }
  return false;
}

export function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === color + "k") return { r, c };
    }
  }
  return null;
}

export function inCheck(board, color) {
  const king = findKing(board, color);
  if (!king) return false;
  return isSquareAttacked(board, king.r, king.c, opposite(color));
}

/**
 * All *legal* moves for `color`: pseudo-legal moves, minus any that leave
 * the mover's own king in check. We test each one by playing it, asking
 * "is my king attacked now?", and taking it back.
 */
export function legalMoves(board, color) {
  const legal = [];
  for (const move of generateMoves(board, color)) {
    makeMove(board, move);
    if (!inCheck(board, color)) legal.push(move);
    unmakeMove(board, move);
  }
  return legal;
}

/** "playing" | "check" | "checkmate" | "stalemate" for the side to move. */
export function getGameStatus(board, colorToMove) {
  const hasMoves = legalMoves(board, colorToMove).length > 0;
  const check = inCheck(board, colorToMove);
  if (!hasMoves) return check ? "checkmate" : "stalemate";
  return check ? "check" : "playing";
}

/* ------------------------------------------------------------------ */
/* 2. Evaluation                                                       */
/* ------------------------------------------------------------------ */

/** Classic material values in centipawns (1 pawn = 100). */
export const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/**
 * Piece-square tables (Tomasz Michniewski's "simplified evaluation").
 * Each table is 64 bonuses in centipawns, laid out from White's point of
 * view with index 0 = a8. They encode positional common sense: knights
 * love the center, pawns should advance, the king should hide in a corner.
 * For Black the table is mirrored vertically (rank 2 for White = rank 7
 * for Black), so one table serves both colors.
 */
const PST = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

/**
 * Static evaluation of a position, in centipawns, from White's perspective:
 * positive = good for White, negative = good for Black. It is simply
 * material plus the piece-square bonus for every piece on the board.
 */
export function evaluate(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece[1];
      // White reads the table as-is; Black reads it flipped vertically.
      const index = piece[0] === WHITE ? r * 8 + c : (7 - r) * 8 + c;
      const value = PIECE_VALUES[type] + PST[type][index];
      score += piece[0] === WHITE ? value : -value;
    }
  }
  return score;
}

/* ------------------------------------------------------------------ */
/* 3. Search                                                           */
/* ------------------------------------------------------------------ */

/** A score beyond any material total — used to mark checkmate. */
export const MATE_SCORE = 100000;

/**
 * Order moves so the likely-best ones are tried first. Alpha-beta prunes
 * far more when a strong move is examined early, so this simple sort is
 * one of the biggest speedups in the whole engine. Captures are scored
 * with MVV-LVA ("most valuable victim, least valuable attacker"):
 * pawn-takes-queen gets tried long before queen-takes-pawn.
 */
export function orderMoves(moves) {
  const priority = (m) => {
    let p = 0;
    if (m.captured) p += 10 * PIECE_VALUES[m.captured[1]] - PIECE_VALUES[m.piece[1]];
    if (m.promotion) p += PIECE_VALUES.q;
    return p;
  };
  return moves
    .map((m) => [priority(m), m])
    .sort((a, b) => b[0] - a[0])
    .map(([, m]) => m);
}

/**
 * Quiescence search — the fix for the "horizon effect".
 *
 * If we evaluated the position the instant depth hits 0, the engine would
 * happily play QxP one ply before the search ends and never see the pawn
 * was defended. So instead of stopping, we keep searching *captures only*
 * until the position is quiet, and only then trust the static evaluation.
 *
 * "Stand pat": the side to move may also decline all captures and accept
 * the current evaluation — capturing is never mandatory in chess, so a
 * bad capture shouldn't drag the score down.
 */
export function quiescence(board, alpha, beta, color, stats) {
  stats.nodes++;

  const standPat = evaluate(board);
  if (color === WHITE) {
    if (standPat >= beta) return standPat; // already too good: opponent avoids this line
    if (standPat > alpha) alpha = standPat;
  } else {
    if (standPat <= alpha) return standPat;
    if (standPat < beta) beta = standPat;
  }

  // Only captures matter here, so filter *before* the (expensive) legality
  // check instead of legality-checking every quiet move we'd throw away.
  const legalCaptures = [];
  for (const move of generateMoves(board, color)) {
    if (!move.captured) continue;
    makeMove(board, move);
    if (!inCheck(board, color)) legalCaptures.push(move);
    unmakeMove(board, move);
  }
  const captures = orderMoves(legalCaptures);
  for (let i = 0; i < captures.length; i++) {
    const move = captures[i];
    makeMove(board, move);
    const score = quiescence(board, alpha, beta, opposite(color), stats);
    unmakeMove(board, move);

    if (color === WHITE) {
      if (score > alpha) alpha = score;
    } else {
      if (score < beta) beta = score;
    }
    if (alpha >= beta) {
      stats.pruned += captures.length - i - 1;
      break;
    }
  }
  return color === WHITE ? alpha : beta;
}

/**
 * Minimax search with alpha-beta pruning.
 *
 * Minimax: White picks the move with the *maximum* score, assuming Black
 * will then pick the move with the *minimum* score, and so on down to
 * `depth` plies, where quiescence() takes over.
 *
 * Alpha-beta: `alpha` is the best score White is already guaranteed
 * elsewhere, `beta` the best Black is guaranteed. The moment a branch's
 * score proves it can never be reached by best play (alpha >= beta), we
 * stop examining its remaining siblings — same answer, far fewer nodes.
 *
 * `stats` accumulates { nodes, pruned } across the whole search.
 * Returns the score of the position, from White's perspective.
 */
export function search(board, depth, alpha, beta, color, stats) {
  if (depth === 0) return quiescence(board, alpha, beta, color, stats);
  stats.nodes++;

  const moves = orderMoves(legalMoves(board, color));
  if (moves.length === 0) {
    if (inCheck(board, color)) {
      // Checkmate. Adding `depth` makes nearer mates score higher, so the
      // engine finishes a won game instead of shuffling forever.
      return color === WHITE ? -(MATE_SCORE + depth) : MATE_SCORE + depth;
    }
    return 0; // stalemate
  }

  if (color === WHITE) {
    let best = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      makeMove(board, moves[i]);
      const score = search(board, depth - 1, alpha, beta, BLACK, stats);
      unmakeMove(board, moves[i]);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        stats.pruned += moves.length - i - 1; // siblings we never had to look at
        break;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < moves.length; i++) {
      makeMove(board, moves[i]);
      const score = search(board, depth - 1, alpha, beta, WHITE, stats);
      unmakeMove(board, moves[i]);
      if (score < best) best = score;
      if (score < beta) beta = score;
      if (alpha >= beta) {
        stats.pruned += moves.length - i - 1;
        break;
      }
    }
    return best;
  }
}

/* ------------------------------------------------------------------ */
/* 4. Top-level entry point                                            */
/* ------------------------------------------------------------------ */

/**
 * Pick the best move for `color`, searching `depth` plies ahead.
 *
 * Each root move is searched with a full (-∞, +∞) window rather than a
 * shared narrowing one. That costs some pruning at the root, but it means
 * every candidate gets an *exact* score — which is what lets the UI show
 * an honest "top three moves" ranking instead of one exact score and a
 * pile of bounds.
 *
 * Returns:
 *   {
 *     move,        // the chosen move (null if the game is over)
 *     score,       // its score in centipawns, from White's perspective
 *     stats,       // { nodes, pruned } for the whole search
 *     depth,       // the depth that was searched
 *     candidates,  // ranked [{ move, score }], best first (top 5)
 *     allMoves,    // the full ranked list (used by teacher mode to grade
 *                  // whatever move the player actually chose)
 *   }
 */
export function bestMove(board, color, depth) {
  const stats = { nodes: 0, pruned: 0 };
  const moves = orderMoves(legalMoves(board, color));

  const scored = [];
  for (const move of moves) {
    makeMove(board, move);
    const score = search(board, depth - 1, -Infinity, Infinity, opposite(color), stats);
    unmakeMove(board, move);
    scored.push({ move, score });
  }

  // Best first: highest score for White, lowest for Black.
  scored.sort((a, b) => (color === WHITE ? b.score - a.score : a.score - b.score));

  return {
    move: scored.length ? scored[0].move : null,
    score: scored.length ? scored[0].score : 0,
    stats,
    depth,
    candidates: scored.slice(0, 5),
    allMoves: scored,
  };
}

/* ------------------------------------------------------------------ */
/* Small helpers for the UI                                            */
/* ------------------------------------------------------------------ */

export function squareName(r, c) {
  return "abcdefgh"[c] + (8 - r);
}

/** Compact human-readable notation, e.g. "Nf3", "exd5", "e8=Q". */
export function moveToString(move) {
  const type = move.piece[1];
  const capture = move.captured ? "x" : "";
  const target = squareName(move.toR, move.toC);
  if (type === "p") {
    const file = capture ? "abcdefgh"[move.fromC] : "";
    const promo = move.promotion ? "=Q" : "";
    return file + capture + target + promo;
  }
  return type.toUpperCase() + squareName(move.fromR, move.fromC) + capture + target;
}
