/**
 * Premove tests. Run with: npm test
 *
 * The two cases that matter are the ones ordinary move generation gets wrong
 * on purpose — a pawn capture onto an empty square, and a move onto a square
 * your own piece is standing on — plus the discard that keeps a stale premove
 * from being forced through.
 */
import assert from "node:assert/strict";
import { premoveSquares, resolvePremove, squareKey } from "../src/premove.js";
import { initialBoard, initialContext, EMPTY_CONTEXT, WHITE, BLACK, moveToString } from "../src/engine.js";

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
const at = (name) => ({ r: 8 - Number(name[1]), c: name.charCodeAt(0) - 97 });
const has = (set, name) => set.has(squareKey(at(name).r, at(name).c));

test("a pawn may be premoved onto an empty diagonal — the recapture case", () => {
  // The single most common premove in blitz: they take on f6, you take back.
  // Right now f6 holds *your own knight*, and g5 is empty, and neither may
  // stop the premove being aimed there.
  const board = pos({ e1: "wk", g5: "wp", f6: "wn", e8: "bk" });
  const squares = premoveSquares(board, at("g5"));
  assert.ok(has(squares, "f6"), "aiming at your own piece is the recapture");
  assert.ok(has(squares, "h6"), "and at an empty diagonal square");
  assert.ok(has(squares, "g6"), "the push is still there");
});

test("a pawn on its starting rank still offers the double step", () => {
  const squares = premoveSquares(initialBoard(), at("e2"));
  assert.ok(has(squares, "e3"));
  assert.ok(has(squares, "e4"));
  // And both diagonals, even though nothing is on them.
  assert.ok(has(squares, "d3"));
  assert.ok(has(squares, "f3"));
});

test("sliders run to the edge — a blocker may be gone by then", () => {
  // The rook is hemmed in right now, but the pawn in front of it might be
  // captured, so the whole file stays available to aim at.
  const board = pos({ e1: "wk", a1: "wr", a2: "wp", e8: "bk" });
  const squares = premoveSquares(board, at("a1"));
  assert.ok(has(squares, "a2"), "the blocking square itself");
  assert.ok(has(squares, "a8"), "and everything beyond it");
  assert.ok(has(squares, "h1"), "along the rank too");
  assert.ok(!has(squares, "b2"), "but a rook still does not move diagonally");
});

test("a king offers its steps and both castling squares", () => {
  const squares = premoveSquares(initialBoard(), at("e1"));
  assert.ok(has(squares, "g1"), "short castling");
  assert.ok(has(squares, "c1"), "long castling");
  assert.ok(has(squares, "d1"));
  assert.ok(!has(squares, "e3"), "but not two squares up the board");
});

test("an empty square offers nothing", () => {
  assert.equal(premoveSquares(initialBoard(), at("e4")).size, 0);
});

test("a premove is played when the position allows it", () => {
  const board = initialBoard();
  const move = resolvePremove(board, WHITE, initialContext(), { from: at("d2"), to: at("d4") });
  assert.ok(move, "d2-d4 is legal from the start");
  assert.equal(moveToString(move), "d4");
});

test("a premove the opponent made illegal is dropped, not forced", () => {
  // exd5 was queued betting on ...d5. Black played something else, so there
  // is nothing on d5 and the move simply does not exist.
  const board = pos({ e1: "wk", e4: "wp", e8: "bk", b8: "bn" });
  assert.equal(resolvePremove(board, WHITE, EMPTY_CONTEXT, { from: at("e4"), to: at("d5") }), null);

  // The same bet, but this time it came off.
  const arrived = pos({ e1: "wk", e4: "wp", d5: "bp", e8: "bk" });
  const move = resolvePremove(arrived, WHITE, EMPTY_CONTEXT, { from: at("e4"), to: at("d5") });
  assert.equal(moveToString(move), "exd5");
});

test("a premove that would leave your king in check is dropped", () => {
  // The bishop is pinned against the king by the rook, so stepping aside is
  // geometrically fine and legally impossible.
  const board = pos({ e1: "wk", e2: "wb", e8: "br" });
  assert.ok(has(premoveSquares(board, at("e2")), "d3"), "geometry offers it");
  assert.equal(
    resolvePremove(board, WHITE, EMPTY_CONTEXT, { from: at("e2"), to: at("d3") }),
    null,
    "legality does not"
  );
});

test("a premoted pawn queens rather than stopping to ask", () => {
  const board = pos({ e1: "wk", b7: "wp", e8: "bk" });
  const move = resolvePremove(board, WHITE, EMPTY_CONTEXT, { from: at("b7"), to: at("b8") });
  assert.equal(move.promotion, "wq", "a premove cannot pop a picker, so it queens");
});

test("nothing queued resolves to nothing", () => {
  assert.equal(resolvePremove(initialBoard(), WHITE, initialContext(), null), null);
});

console.log(`\n${passed} tests passed.`);
