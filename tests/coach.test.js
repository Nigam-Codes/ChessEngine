/**
 * Teacher-mode coach tests. Run with: npm test
 */
import assert from "node:assert/strict";
import { WHITE, BLACK } from "../src/engine.js";
import {
  hangingPieces,
  findForks,
  findPins,
  classifyMove,
  threatReport,
} from "../src/coach.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Build an 8×8 board from { e4: "wp", ... } (same helper as lessons.js). */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [sq, piece] of Object.entries(pieces)) {
    board[8 - Number(sq[1])][sq.charCodeAt(0) - 97] = piece;
  }
  return board;
}

test("hanging piece: undefended bishop attacked by a rook is flagged", () => {
  const board = pos({ d4: "wb", d8: "br", h8: "bk", e1: "wk" });
  const hanging = hangingPieces(board, WHITE);
  assert.equal(hanging.length, 1);
  assert.equal(hanging[0].piece, "wb");
  assert.equal(hanging[0].reason, "undefended");
});

test("hanging piece: defended queen attacked by a pawn is still flagged", () => {
  // Queen on d4 defended by the rook on d1, but the pawn on c5 attacks it.
  const board = pos({ d4: "wq", d1: "wr", c5: "bp", h8: "bk", h1: "wk" });
  const hanging = hangingPieces(board, WHITE);
  assert.equal(hanging.length, 1);
  assert.equal(hanging[0].piece, "wq");
  assert.equal(hanging[0].reason, "cheaper-attacker");
});

test("fork: knight attacking king and rook is detected", () => {
  const board = pos({ c7: "wn", a8: "bk", e8: "br", g1: "wk" });
  const forks = findForks(board, WHITE);
  assert.equal(forks.length, 1);
  assert.equal(forks[0].piece, "wn");
  assert.equal(forks[0].targets.length, 2);
});

test("pin: knight in front of its king on a bishop's diagonal is pinned", () => {
  const board = pos({ g4: "bb", f3: "wn", e2: "wk", g8: "bk" });
  const pins = findPins(board, WHITE);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].piece, "wn");
  assert.equal(pins[0].by.piece, "bb");
});

test("classifyMove grades by centipawn loss", () => {
  assert.equal(classifyMove(50, 50).verdict, "Excellent");
  assert.equal(classifyMove(50, 10).verdict, "Good move");
  assert.equal(classifyMove(50, -50).verdict, "Inaccuracy");
  assert.equal(classifyMove(50, -250).verdict, "Mistake");
  assert.equal(classifyMove(50, -500).verdict, "Blunder");
});

test("threatReport bundles warnings with squares to highlight", () => {
  const board = pos({ d4: "wb", d8: "br", h8: "bk", e1: "wk" });
  const report = threatReport(board);
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /bishop on d4/);
  assert.deepEqual(report.squares, [{ r: 4, c: 3 }]);
});

test("a quiet position produces no warnings", () => {
  const report = threatReport(pos({ e1: "wk", e8: "bk", e2: "wp", e7: "bp" }));
  assert.equal(report.warnings.length, 0);
});

console.log(`\n${passed} tests passed.`);
