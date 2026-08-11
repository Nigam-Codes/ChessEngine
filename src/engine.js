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
/* Game context: the state an 8×8 board can't express                  */
/* ------------------------------------------------------------------ */

/**
 * Two rules depend on history rather than on the current position:
 *
 *   - castling needs to know whether the king or that rook has ever moved;
 *   - en passant needs to know whether a pawn double-stepped *last move*.
 *
 * Both live in a small "context" object that travels alongside the board:
 *   { rights: { wk, wq, bk, bq }, ep: { r, c } | null }
 * where `ep` is the square a capturing pawn would land on.
 *
 * Every function that generates moves takes this as an optional trailing
 * argument. The default is EMPTY_CONTEXT — no castling, no en passant — so
 * constructed positions (lesson diagrams, coach scans, puzzle boards) behave
 * exactly as they did before these rules existed, and only callers that opt in
 * get the extra moves.
 */
export const EMPTY_CONTEXT = Object.freeze({
  rights: Object.freeze({ wk: false, wq: false, bk: false, bq: false }),
  ep: null,
  half: 0,
});

/** Full castling rights and no en-passant target — the game start. */
export function initialContext() {
  return { rights: { wk: true, wq: true, bk: true, bq: true }, ep: null, half: 0 };
}

// Which right a rook sitting on each corner belongs to.
const CORNER_RIGHTS = { "7,0": "wq", "7,7": "wk", "0,0": "bq", "0,7": "bk" };

/**
 * The context *after* `move` is played. Returns a fresh object — contexts are
 * never mutated, so the search can recurse without any unwind logic.
 */
export function nextContext(ctx, move) {
  const rights = { ...ctx.rights };
  const color = move.piece[0];

  // Moving the king gives up both rights forever.
  if (move.piece[1] === "k") {
    rights[color === WHITE ? "wk" : "bk"] = false;
    rights[color === WHITE ? "wq" : "bq"] = false;
  }
  // Moving a rook off its corner gives up that side.
  const from = CORNER_RIGHTS[`${move.fromR},${move.fromC}`];
  if (from && move.piece[1] === "r") rights[from] = false;
  // Capturing a rook *on* its corner does too — the rook never "moved", so
  // this is the case that's easy to forget and quietly allows illegal castling.
  const to = CORNER_RIGHTS[`${move.toR},${move.toC}`];
  if (to && move.captured && move.captured[1] === "r") rights[to] = false;

  // En passant is offered for exactly one move, and only after a double step.
  const doubleStep = move.piece[1] === "p" && Math.abs(move.toR - move.fromR) === 2;
  const ep = doubleStep ? { r: (move.fromR + move.toR) / 2, c: move.fromC } : null;

  // The halfmove clock for the fifty-move rule. Any pawn move or capture is
  // irreversible and resets it; everything else brings the draw a step closer.
  // `?? 0` so contexts built by hand before this existed still work.
  const irreversible = move.piece[1] === "p" || !!move.captured;
  const half = irreversible ? 0 : (ctx.half ?? 0) + 1;

  return { rights, ep, half };
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
 * What a pawn may become on the last rank. A queen is right almost every time,
 * but "almost" is the whole point: underpromoting to a knight is the standard
 * way to deliver a check a queen cannot, and to a rook to avoid stalemating a
 * lone king. Generating all four is what makes those moves findable at all.
 * Queen first so move ordering sees the best candidate early.
 */
export const PROMOTION_PIECES = ["q", "r", "b", "n"];

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
export function generateMoves(board, color, ctx = EMPTY_CONTEXT) {
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
        /**
         * Add a pawn move, expanding it into one move per promotion piece when
         * it lands on the last rank. Everywhere else it is a single move with
         * an empty `promotion`, exactly as before.
         */
        const addPawnMove = (tr, tc) => {
          if (tr !== lastRow) {
            addMove(moves, board, r, c, tr, tc);
            return;
          }
          for (const piece of PROMOTION_PIECES) {
            addMove(moves, board, r, c, tr, tc, color + piece);
          }
        };

        // One square forward (two from the starting rank), never a capture.
        if (onBoard(r + dir, c) && board[r + dir][c] === "") {
          addPawnMove(r + dir, c);
          if (r === startRow && board[r + 2 * dir][c] === "") {
            addMove(moves, board, r, c, r + 2 * dir, c);
          }
        }
        // Diagonal captures.
        for (const dc of [-1, 1]) {
          const tr = r + dir, tc = c + dc;
          if (onBoard(tr, tc) && board[tr][tc] && board[tr][tc][0] !== color) {
            addPawnMove(tr, tc);
          }
          // En passant: the target square is empty, so the captured pawn sits
          // beside us rather than where we land. That's why the move records
          // the victim's real square.
          if (ctx.ep && tr === ctx.ep.r && tc === ctx.ep.c && board[tr][tc] === "") {
            const victim = board[r][tc];
            if (victim && victim[0] !== color && victim[1] === "p") {
              moves.push({
                fromR: r, fromC: c, toR: tr, toC: tc,
                piece, captured: victim, promotion: "",
                epCapture: true, capturedR: r, capturedC: tc,
              });
            }
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

  addCastlingMoves(moves, board, color, ctx);
  return moves;
}

/**
 * Castling — the one move where two pieces travel at once.
 *
 * Three conditions beyond "the right still exists": the squares between king
 * and rook are empty, the king is not currently in check, and it does not pass
 * *through* an attacked square. Landing in check is caught for free by
 * legalMoves(), which filters every move that leaves the king attacked.
 */
function addCastlingMoves(moves, board, color, ctx) {
  const row = color === WHITE ? 7 : 0;
  const king = color + "k";
  const rook = color + "r";
  if (board[row][4] !== king) return; // king not home ⇒ nothing to do

  const enemy = opposite(color);
  const attacked = (c) => isSquareAttacked(board, row, c, enemy);
  // Castling out of check is illegal, so test it once up front.
  if (attacked(4)) return;

  const sides = [
    { right: color === WHITE ? "wk" : "bk", rookC: 7, empty: [5, 6], kingTo: 6, cross: 5, flag: "K" },
    { right: color === WHITE ? "wq" : "bq", rookC: 0, empty: [1, 2, 3], kingTo: 2, cross: 3, flag: "Q" },
  ];

  for (const s of sides) {
    if (!ctx.rights[s.right]) continue;
    if (board[row][s.rookC] !== rook) continue;
    if (s.empty.some((c) => board[row][c] !== "")) continue;
    // The square the king steps over must be safe (b1/b8 may be attacked —
    // only the rook crosses it, and rooks are allowed to be attacked).
    if (attacked(s.cross)) continue;
    moves.push({
      fromR: row, fromC: 4, toR: row, toC: s.kingTo,
      piece: king, captured: "", promotion: "",
      castle: s.flag, rook: { fromC: s.rookC, toC: s.cross },
    });
  }
}

/**
 * Apply a move in place. unmakeMove() restores it exactly — the search relies
 * on that being lossless, so both special moves carry everything needed to
 * reverse them (the rook's squares, or the captured pawn's real square).
 */
export function makeMove(board, move) {
  board[move.toR][move.toC] = move.promotion || move.piece;
  board[move.fromR][move.fromC] = "";
  if (move.castle) {
    board[move.toR][move.rook.toC] = board[move.toR][move.rook.fromC];
    board[move.toR][move.rook.fromC] = "";
  } else if (move.epCapture) {
    // The victim isn't on the square we landed on.
    board[move.capturedR][move.capturedC] = "";
  }
}

export function unmakeMove(board, move) {
  board[move.fromR][move.fromC] = move.piece;
  board[move.toR][move.toC] = move.captured;
  if (move.castle) {
    board[move.toR][move.rook.fromC] = board[move.toR][move.rook.toC];
    board[move.toR][move.rook.toC] = "";
  } else if (move.epCapture) {
    board[move.toR][move.toC] = ""; // we landed on an empty square
    board[move.capturedR][move.capturedC] = move.captured;
  }
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
export function legalMoves(board, color, ctx = EMPTY_CONTEXT) {
  const legal = [];
  for (const move of generateMoves(board, color, ctx)) {
    makeMove(board, move);
    if (!inCheck(board, color)) legal.push(move);
    unmakeMove(board, move);
  }
  return legal;
}

/** "playing" | "check" | "checkmate" | "stalemate" for the side to move. */
export function getGameStatus(board, colorToMove, ctx = EMPTY_CONTEXT) {
  const hasMoves = legalMoves(board, colorToMove, ctx).length > 0;
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
 * Endgame piece-square tables.
 *
 * Two pieces change job completely once the queens come off:
 *
 *   - the KING stops hiding and becomes a fighting piece. The midgame table
 *     above pays +30 for cowering on b1/g1 and −50 for the centre; in an
 *     ending that is exactly backwards, and an engine using it will shuffle
 *     in the corner while the enemy king walks in and eats its pawns.
 *   - PAWNS become the whole game, so advancement is worth far more.
 *
 * Only these two need a second table; a knight or rook wants roughly the same
 * squares in both phases, so they fall through to the midgame set.
 */
const PST_END = {
  k: [
    -50, -30, -30, -30, -30, -30, -30, -50,
    -30, -20, -10, -10, -10, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
    120, 120, 120, 120, 120, 120, 120, 120,
     70,  70,  70,  70,  70,  70,  70,  70,
     40,  40,  40,  40,  40,  40,  40,  40,
     20,  20,  20,  20,  20,  20,  20,  20,
     10,  10,  10,  10,  10,  10,  10,  10,
      5,   5,   5,   5,   5,   5,   5,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
};

// Non-pawn material at the start, per side, used to measure how far into the
// endgame we are: 4 minors + 2 rooks + 1 queen.
const PHASE_MAX = 2 * (PIECE_VALUES.n + PIECE_VALUES.b + PIECE_VALUES.r) + PIECE_VALUES.q;

/**
 * Static evaluation of a position, in centipawns, from White's perspective:
 * positive = good for White, negative = good for Black. Material plus the
 * piece-square bonus for every piece — blended between the midgame and
 * endgame tables by how much material is left ("tapered evaluation"), so the
 * king's idea of a good square changes gradually as pieces come off rather
 * than flipping at some arbitrary move number.
 */
export function evaluate(board) {
  // First pass: material, and how much non-pawn material remains.
  let score = 0;
  let nonPawn = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece[1];
      score += piece[0] === WHITE ? PIECE_VALUES[type] : -PIECE_VALUES[type];
      if (type !== "p" && type !== "k") nonPawn += PIECE_VALUES[type];
    }
  }
  // phase: 1 = opening material, 0 = bare kings and pawns.
  const phase = Math.min(1, nonPawn / (2 * PHASE_MAX));

  // Second pass: positional bonuses, blended for the current phase.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece[1];
      // White reads the table as-is; Black reads it flipped vertically.
      const index = piece[0] === WHITE ? r * 8 + c : (7 - r) * 8 + c;
      const mg = PST[type][index];
      const end = PST_END[type];
      const bonus = end === undefined ? mg : mg * phase + end[index] * (1 - phase);
      score += piece[0] === WHITE ? bonus : -bonus;
    }
  }
  return Math.round(score);
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
    // Score the piece actually promoted to, so a knight promotion isn't
    // searched as though it had won a queen.
    if (m.promotion) p += PIECE_VALUES[m.promotion[1]];
    // Castling is so often right that trying it early pays for itself in extra
    // alpha-beta cutoffs — but it must still rank below any real capture.
    if (m.castle) p += 50;
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
export function quiescence(board, alpha, beta, color, stats, ctx = EMPTY_CONTEXT) {
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
  for (const move of generateMoves(board, color, ctx)) {
    if (!move.captured) continue;
    makeMove(board, move);
    if (!inCheck(board, color)) legalCaptures.push(move);
    unmakeMove(board, move);
  }
  const captures = orderMoves(legalCaptures);
  for (let i = 0; i < captures.length; i++) {
    const move = captures[i];
    makeMove(board, move);
    const score = quiescence(board, alpha, beta, opposite(color), stats, nextContext(ctx, move));
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
export function search(board, depth, alpha, beta, color, stats, ctx = EMPTY_CONTEXT) {
  if (depth === 0) return quiescence(board, alpha, beta, color, stats, ctx);
  stats.nodes++;

  const moves = orderMoves(legalMoves(board, color, ctx));
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
      const score = search(board, depth - 1, alpha, beta, BLACK, stats, nextContext(ctx, moves[i]));
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
      const score = search(board, depth - 1, alpha, beta, WHITE, stats, nextContext(ctx, moves[i]));
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
export function bestMove(board, color, depth, ctx = EMPTY_CONTEXT) {
  const stats = { nodes: 0, pruned: 0 };
  const moves = orderMoves(legalMoves(board, color, ctx));

  const scored = [];
  for (const move of moves) {
    makeMove(board, move);
    const score = search(board, depth - 1, -Infinity, Infinity, opposite(color), stats, nextContext(ctx, move));
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

/**
 * Standard algebraic notation: "Nf3", "exd5", "e8=Q", "Nbd2", "R1a3".
 *
 * `board` is the position the move is played *from*, and it is what makes this
 * short rather than long. A piece name alone is ambiguous whenever two of the
 * same kind can reach the square, and SAN resolves that with the least
 * information that does the job: the file if that distinguishes them, else the
 * rank, else both. Working that out means knowing what else is on the board.
 *
 * Without a board the move is still named, just never disambiguated — fine for
 * a one-off label, wrong for a move list, so pass the position where you have
 * it. Check and mate suffixes are added by the caller, which knows the
 * position *after* the move.
 */
export function moveToString(move, board = null) {
  if (move.castle) return move.castle === "K" ? "O-O" : "O-O-O";
  const type = move.piece[1];
  const capture = move.captured ? "x" : "";
  const target = squareName(move.toR, move.toC);

  if (type === "p") {
    // A pawn is named by the file it came from, but only when it captures.
    const file = capture ? "abcdefgh"[move.fromC] : "";
    const promo = move.promotion ? "=" + move.promotion[1].toUpperCase() : "";
    return file + capture + target + promo;
  }

  return type.toUpperCase() + disambiguate(move, board) + capture + target;
}

/**
 * The smallest hint that says which piece moved: "", a file, a rank, or both.
 * Uses pseudo-legal moves rather than legal ones — the same simplification
 * every notation implementation makes, and it only differs in the rare case
 * where the rival piece is pinned.
 */
function disambiguate(move, board) {
  if (!board) return "";
  const rivals = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] !== move.piece) continue;
      if (r === move.fromR && c === move.fromC) continue;
      if (canReach(board, r, c, move.toR, move.toC)) rivals.push({ r, c });
    }
  }
  if (rivals.length === 0) return "";
  const files = "abcdefgh";
  if (!rivals.some((p) => p.c === move.fromC)) return files[move.fromC];
  if (!rivals.some((p) => p.r === move.fromR)) return String(8 - move.fromR);
  return files[move.fromC] + (8 - move.fromR);
}

/** Could the piece on (r,c) move to (tr,tc) in this position? Pawns excluded. */
function canReach(board, r, c, tr, tc) {
  const piece = board[r][c];
  const type = piece[1];
  if (board[tr][tc] && board[tr][tc][0] === piece[0]) return false;

  if (type === "n" || type === "k") {
    const steps = type === "n" ? KNIGHT_JUMPS : KING_STEPS;
    return steps.some(([dr, dc]) => r + dr === tr && c + dc === tc);
  }
  const dirs =
    type === "b" ? BISHOP_DIRS : type === "r" ? ROOK_DIRS : [...BISHOP_DIRS, ...ROOK_DIRS];
  for (const [dr, dc] of dirs) {
    let cr = r + dr, cc = c + dc;
    while (onBoard(cr, cc)) {
      if (cr === tr && cc === tc) return true;
      if (board[cr][cc]) break; // the ray is blocked short of the target
      cr += dr; cc += dc;
    }
  }
  return false;
}
