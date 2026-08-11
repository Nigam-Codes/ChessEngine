/**
 * Material tests. Run with: npm test
 *
 * The point of deriving captures from the board is that it stays right in
 * situations a running tally would get wrong — promotion, and positions that
 * never came from the opening. Those are what these tests aim at.
 */
import assert from "node:assert/strict";
import {
  capturedFrom,
  materialBalance,
  drawVerdict,
  MATERIAL_POINTS,
} from "../src/material.js";
import { initialBoard, applyMove, legalMoves, WHITE, BLACK, EMPTY_CONTEXT } from "../src/engine.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const E = "";
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(E));
  for (const [sq, piece] of Object.entries(pieces)) {
    board[8 - Number(sq[1])][sq.charCodeAt(0) - 97] = piece;
  }
  return board;
}

test("nothing is captured at the start, and nobody is ahead", () => {
  const { w, b, advantage } = capturedFrom(initialBoard());
  assert.deepEqual(w, []);
  assert.deepEqual(b, []);
  assert.equal(advantage, 0);
  assert.equal(materialBalance(initialBoard()), 0);
});

test("a rook for a bishop reads as +2 to the side holding the rook", () => {
  // White is a rook up and a bishop down: 5 - 3 = +2, the way a player counts.
  const board = pos({
    e1: "wk", a1: "wr", h1: "wr",
    e8: "bk", a8: "br",
    c1: "wb", // White kept one bishop; Black kept both
    c8: "bb", f8: "bb",
  });
  const { w, b, advantage } = capturedFrom(board);
  assert.equal(advantage, 2);
  // White's tray holds the Black rook it took; Black's holds the White bishop.
  assert.ok(w.includes("r"), "White shows the rook it won");
  assert.ok(b.includes("b"), "Black shows the bishop it won");
});

test("the tray is ordered cheapest first, the way a capture strip reads", () => {
  const board = pos({ e1: "wk", e8: "bk", d8: "bq" });
  // Black is missing everything except the queen.
  const { b: blackTook } = capturedFrom(board);
  const values = blackTook.map((t) => MATERIAL_POINTS[t]);
  assert.deepEqual(values, [...values].sort((x, y) => x - y), "values never decrease");
});

test("promotion keeps the advantage honest even though the tray flatters", () => {
  // Walk a pawn in and promote it to a queen.
  const board = pos({ e1: "wk", b7: "wp", e8: "bk" });
  const before = capturedFrom(board).advantage;
  const promo = legalMoves(board, WHITE, EMPTY_CONTEXT).find((m) => m.promotion === "wq");
  const after = capturedFrom(applyMove(board, promo));

  // A pawn became a queen: +1 turns into +9, a swing of 8. Nothing was taken.
  assert.equal(after.advantage - before, 8, "the score follows the pieces on the board");
  // The tray, on the other hand, now counts that pawn among Black's captures,
  // because from the board's point of view it simply isn't there any more.
  // This is the documented trade-off, and the advantage above is unaffected.
  assert.equal(
    after.b.filter((t) => t === "p").length,
    8,
    "all eight White pawns read as missing — seven never placed, one promoted"
  );
  assert.equal(after.b.filter((t) => t === "q").length, 0, "and White's queen is not missing");
});

test("a generated endgame reports who is up, not nonsense", () => {
  // No history at all: just two kings and a extra rook for Black.
  const board = pos({ e1: "wk", e8: "bk", a8: "br", d4: "wp" });
  const { advantage } = capturedFrom(board);
  assert.equal(advantage, 1 - 5, "White has a pawn, Black a rook");
  assert.equal(materialBalance(board), 100 - 500, "and the engine agrees in centipawns");
});

test("the engine and the display disagree about a knight, on purpose", () => {
  // A bishop for a knight is level to a player and a tenth of a pawn to the
  // engine. Both are correct; they answer different questions.
  const board = pos({ e1: "wk", e8: "bk", c1: "wb", g8: "bn" });
  assert.equal(capturedFrom(board).advantage, 0, "3 vs 3 to the eye");
  assert.equal(materialBalance(board), 10, "330 vs 320 to the search");
});

/* ---------------- Draw offers ---------------- */

test("the engine shakes hands on a dead-level position", () => {
  const verdict = drawVerdict(initialBoard(), BLACK);
  assert.equal(verdict.accept, true, "nothing has happened yet — there is nothing to play for");
  assert.match(verdict.reason, /accepts/);
});

test("the engine refuses when it is up material, and says why", () => {
  // Engine (Black) is a whole rook up. No amount of positional awkwardness
  // should talk it into a draw.
  const board = pos({ e1: "wk", e8: "bk", a8: "br" });
  const verdict = drawVerdict(board, BLACK);
  assert.equal(verdict.accept, false);
  assert.match(verdict.reason, /up material/, "the refusal names the reason");
});

test("a losing engine accepts gratefully", () => {
  // Engine (Black) is a queen down. Level-or-worse is enough to accept.
  const board = pos({ e1: "wk", d1: "wq", e8: "bk" });
  assert.equal(drawVerdict(board, BLACK).accept, true);
});

test("both sides of the offer are judged from the same evaluation", () => {
  // The identical position, mirrored: whoever is a rook up refuses, and the
  // side a rook down accepts. Proves the sign flip, which is easy to get wrong.
  const board = pos({ e1: "wk", e8: "bk", a1: "wr" });
  assert.equal(drawVerdict(board, WHITE).accept, false, "White is up a rook");
  assert.equal(drawVerdict(board, BLACK).accept, true, "Black is down one");
});

console.log(`\n${passed} tests passed.`);
