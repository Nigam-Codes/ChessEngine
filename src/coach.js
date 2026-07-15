/**
 * coach.js — teacher-mode helpers built on top of the engine.
 *
 * Nothing here affects how the engine plays; these functions read a
 * position and produce human explanations for it:
 *   - classifyMove   — grade the player's move against the engine's best
 *   - hangingPieces  — pieces that can simply be taken
 *   - findForks      — one piece attacking two or more valuable targets
 *   - findPins       — pieces frozen against their own king
 *   - threatReport   — the above bundled into readable warnings for White
 */

import {
  WHITE,
  BLACK,
  opposite,
  findKing,
  generateMoves,
  squareName,
  PIECE_VALUES,
  KNIGHT_JUMPS,
  KING_STEPS,
  BISHOP_DIRS,
  ROOK_DIRS,
} from "./engine.js";

export const PIECE_NAMES = {
  p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king",
};

const onBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

/**
 * Every piece of `byColor` that attacks (or defends) the square (r, c).
 * Same outward-scanning idea as the engine's isSquareAttacked, but it
 * collects all of them instead of stopping at the first.
 */
export function attackers(board, r, c, byColor) {
  const found = [];
  const pawnRow = byColor === WHITE ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (onBoard(pawnRow, c + dc) && board[pawnRow][c + dc] === byColor + "p") {
      found.push({ r: pawnRow, c: c + dc, piece: byColor + "p" });
    }
  }
  for (const [dr, dc] of KNIGHT_JUMPS) {
    if (onBoard(r + dr, c + dc) && board[r + dr][c + dc] === byColor + "n") {
      found.push({ r: r + dr, c: c + dc, piece: byColor + "n" });
    }
  }
  for (const [dr, dc] of KING_STEPS) {
    if (onBoard(r + dr, c + dc) && board[r + dr][c + dc] === byColor + "k") {
      found.push({ r: r + dr, c: c + dc, piece: byColor + "k" });
    }
  }
  const scanRays = (dirs, sliderTypes) => {
    for (const [dr, dc] of dirs) {
      let tr = r + dr, tc = c + dc;
      while (onBoard(tr, tc)) {
        const p = board[tr][tc];
        if (p) {
          if (p[0] === byColor && sliderTypes.includes(p[1])) {
            found.push({ r: tr, c: tc, piece: p });
          }
          break;
        }
        tr += dr; tc += dc;
      }
    }
  };
  scanRays(BISHOP_DIRS, ["b", "q"]);
  scanRays(ROOK_DIRS, ["r", "q"]);
  return found;
}

/**
 * Pieces of `color` that are "hanging": the opponent attacks them and
 * either nothing defends them, or the cheapest attacker is worth less
 * than the piece (a pawn attacking your queen means the queen must move,
 * defended or not).
 */
export function hangingPieces(board, color) {
  const enemy = opposite(color);
  const hanging = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece[0] !== color || piece[1] === "k") continue;
      const attack = attackers(board, r, c, enemy);
      if (attack.length === 0) continue;
      const defense = attackers(board, r, c, color);
      const cheapest = Math.min(...attack.map((a) => PIECE_VALUES[a.piece[1]]));
      if (defense.length === 0) {
        hanging.push({ r, c, piece, reason: "undefended" });
      } else if (cheapest < PIECE_VALUES[piece[1]]) {
        hanging.push({ r, c, piece, reason: "cheaper-attacker" });
      }
    }
  }
  return hanging;
}

/**
 * Forks by `byColor`: a single piece attacking two or more targets that
 * each matter (a king, a more valuable piece, or an undefended piece).
 */
export function findForks(board, byColor) {
  const targetsByAttacker = new Map();
  for (const move of generateMoves(board, byColor)) {
    if (!move.captured) continue;
    const attackerValue = PIECE_VALUES[move.piece[1]];
    const victimValue = PIECE_VALUES[move.captured[1]];
    const victimDefended =
      attackers(board, move.toR, move.toC, opposite(byColor)).length > 0;
    const matters =
      move.captured[1] === "k" || victimValue > attackerValue || !victimDefended;
    if (!matters) continue;
    const key = `${move.fromR},${move.fromC}`;
    if (!targetsByAttacker.has(key)) {
      targetsByAttacker.set(key, {
        r: move.fromR, c: move.fromC, piece: move.piece, targets: [],
      });
    }
    targetsByAttacker.get(key).targets.push({
      r: move.toR, c: move.toC, piece: move.captured,
    });
  }
  return [...targetsByAttacker.values()].filter((f) => f.targets.length >= 2);
}

/**
 * Pieces of `color` pinned to their own king: from the king, walk each
 * ray; if the first piece met is friendly and the next one beyond it is
 * an enemy slider moving on that line, the friendly piece cannot move.
 */
export function findPins(board, color) {
  const king = findKing(board, color);
  if (!king) return [];
  const pins = [];
  const scan = (dirs, sliderTypes) => {
    for (const [dr, dc] of dirs) {
      let r = king.r + dr, c = king.c + dc;
      let shield = null;
      while (onBoard(r, c)) {
        const p = board[r][c];
        if (p) {
          if (!shield) {
            if (p[0] !== color) break;
            shield = { r, c, piece: p };
          } else {
            if (p[0] !== color && sliderTypes.includes(p[1])) {
              pins.push({ ...shield, by: { r, c, piece: p } });
            }
            break;
          }
        }
        r += dr; c += dc;
      }
    }
  };
  scan(BISHOP_DIRS, ["b", "q"]);
  scan(ROOK_DIRS, ["r", "q"]);
  return pins;
}

/**
 * Grade the player's move by how many centipawns it gave up compared to
 * the engine's best move in the same position (both scored exactly, by
 * the same search).
 */
export function classifyMove(bestScore, playedScore) {
  const loss = bestScore - playedScore;
  if (loss <= 20) return { verdict: "Excellent", tone: "good", loss };
  if (loss <= 60) return { verdict: "Good move", tone: "good", loss };
  if (loss <= 150) return { verdict: "Inaccuracy", tone: "warn", loss };
  if (loss <= 400) return { verdict: "Mistake", tone: "bad", loss };
  return { verdict: "Blunder", tone: "bad", loss };
}

const pieceLabel = (piece) => PIECE_NAMES[piece[1]];

/**
 * Everything White should worry about right now, as readable warnings
 * plus the squares to highlight on the board.
 */
export function threatReport(board) {
  const warnings = [];
  const squares = [];

  for (const h of hangingPieces(board, WHITE)) {
    squares.push({ r: h.r, c: h.c });
    warnings.push(
      h.reason === "undefended"
        ? `Your ${pieceLabel(h.piece)} on ${squareName(h.r, h.c)} is attacked and nothing defends it.`
        : `Your ${pieceLabel(h.piece)} on ${squareName(h.r, h.c)} is attacked by something cheaper — move it or lose material.`
    );
  }

  for (const f of findForks(board, BLACK)) {
    squares.push({ r: f.r, c: f.c });
    const targets = f.targets
      .map((t) => `${pieceLabel(t.piece)} on ${squareName(t.r, t.c)}`)
      .join(" and ");
    warnings.push(
      `Fork! The ${pieceLabel(f.piece)} on ${squareName(f.r, f.c)} attacks your ${targets} at the same time.`
    );
  }

  for (const p of findPins(board, WHITE)) {
    squares.push({ r: p.r, c: p.c });
    warnings.push(
      `Your ${pieceLabel(p.piece)} on ${squareName(p.r, p.c)} is pinned to your king by the ${pieceLabel(p.by.piece)} on ${squareName(p.by.r, p.by.c)} — it can't move.`
    );
  }

  return { warnings, squares };
}
