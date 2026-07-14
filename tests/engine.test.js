/**
 * Quick engine sanity tests. Run with: npm test
 */
import assert from "node:assert/strict";
import {
  initialBoard,
  legalMoves,
  applyMove,
  getGameStatus,
  bestMove,
  search,
  evaluate,
  squareName,
  WHITE,
  BLACK,
} from "../src/engine.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* 1. Both sides have exactly 20 legal moves in the opening position
      (16 pawn moves + 4 knight moves). */
test("initial position: 20 legal moves for each side", () => {
  const board = initialBoard();
  assert.equal(legalMoves(board, WHITE).length, 20);
  assert.equal(legalMoves(board, BLACK).length, 20);
});

/* 2. Fool's Mate: 1. f3 e5 2. g4 Qh4# — White is checkmated. */
test("Fool's Mate is detected as checkmate", () => {
  let board = initialBoard();
  const play = (fromR, fromC, toR, toC, color) => {
    const move = legalMoves(board, color).find(
      (m) => m.fromR === fromR && m.fromC === fromC && m.toR === toR && m.toC === toC
    );
    assert.ok(move, `move from (${fromR},${fromC}) to (${toR},${toC}) should be legal`);
    board = applyMove(board, move);
  };
  play(6, 5, 5, 5, WHITE); // 1. f3
  play(1, 4, 3, 4, BLACK); // 1... e5
  play(6, 6, 4, 6, WHITE); // 2. g4
  play(0, 3, 4, 7, BLACK); // 2... Qh4#
  assert.equal(getGameStatus(board, WHITE), "checkmate");
});

/* 3. Quiescence search prevents a horizon blunder.
      White queen on d1 can grab the pawn on d5 — but d5 is defended by the
      pawn on e6. A depth-1 search that evaluated immediately at the horizon
      would see "+1 pawn" and take it; quiescence keeps searching captures,
      sees ...exd5 winning the queen, and avoids the blunder. */
test("quiescence search avoids capturing a defended pawn", () => {
  const E = "";
  const board = [
    [E, E, E, E, E, E, E, "bk"],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, "bp", E, E, E],
    [E, E, E, "bp", E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, "wq", E, E, E, "wk"],
  ];

  const result = bestMove(board, WHITE, 1);

  // The chosen move must not be Qxd5 (to row 3, col 3).
  const to = squareName(result.move.toR, result.move.toC);
  assert.notEqual(to, "d5", "engine should not grab the defended d5 pawn");

  // Sanity: the search actually counted work.
  assert.ok(result.stats.nodes > 0, "node counter should be > 0");

  // Verify quiescence directly: play Qxd5 and search with zero remaining
  // depth. A bare static evaluation would say White is up a pawn's worth of
  // material; quiescence must see ...exd5 winning the queen and report the
  // position as lost for White.
  const qxd5 = legalMoves(board, WHITE).find((m) => m.toR === 3 && m.toC === 3);
  assert.ok(qxd5, "Qxd5 should be a legal move in the test position");
  const after = applyMove(board, qxd5);
  assert.ok(evaluate(after) > 500, "static eval alone thinks Qxd5 wins material");
  const qScore = search(after, 0, -Infinity, Infinity, BLACK, { nodes: 0, pruned: 0 });
  assert.ok(
    qScore < -50,
    `quiescence should see the queen falls after Qxd5, got ${qScore}`
  );
});

console.log(`\n${passed} tests passed.`);
