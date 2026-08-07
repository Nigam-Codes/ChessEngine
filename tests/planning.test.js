/**
 * Sketch-arrow legality tests. Run with: npm test
 */
import assert from "node:assert/strict";
import {
  initialBoard,
  initialContext,
  EMPTY_CONTEXT,
  squareName,
  WHITE,
} from "../src/engine.js";
import { simulatePlan, drawTargets, targetsForDrag, squareKey } from "../src/planning.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** "e4" → { r, c }. */
const sq = (s) => ({ r: 8 - Number(s[1]), c: s.charCodeAt(0) - 97 });
/** An arrow between two named squares. */
const arrow = (from, to) => {
  const a = sq(from), b = sq(to);
  return { from: [a.r, a.c], to: [b.r, b.c], color: "yellow" };
};
/** A Set of "r-c" keys back into sorted square names, for readable asserts. */
const names = (set) =>
  [...set]
    .map((k) => {
      const [r, c] = k.split("-").map(Number);
      return squareName(r, c);
    })
    .sort();

/** Build an 8×8 board from { e1: "wk", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [s, piece] of Object.entries(pieces)) {
    board[8 - Number(s[1])][s.charCodeAt(0) - 97] = piece;
  }
  return board;
}

test("a knight can only be drawn moving in an L", () => {
  const board = initialBoard();
  const targets = drawTargets(board, initialContext(), sq("g1"));
  assert.deepEqual(names(targets), ["f3", "h3"], "the only two L-moves from g1");
  // The squares a careless drag would reach are all refused.
  for (const bad of ["g3", "g2", "e3", "f1", "h1", "g5"]) {
    assert.ok(!targets.has(squareKey(sq(bad).r, sq(bad).c)), `${bad} must not be drawable`);
  }
});

test("blocked pieces offer nothing; empty squares stay freeform", () => {
  const board = initialBoard();
  const ctx = initialContext();
  // The opening bishop is hemmed in by its own pawns.
  assert.equal(drawTargets(board, ctx, sq("c1")).size, 0, "a blocked bishop has no moves");
  // An empty square returns null, which the UI reads as "draw anything".
  assert.equal(drawTargets(board, ctx, sq("e4")), null);
  // Off-board coordinates are refused rather than throwing.
  assert.equal(drawTargets(board, ctx, { r: -1, c: 0 }), null);
});

test("pins are respected — the payoff of reusing legalMoves", () => {
  // The knight on e2 is pinned to its king on e1 by the rook on e8.
  const board = pos({ e1: "wk", e2: "wn", e8: "br", a8: "bk" });
  assert.equal(
    drawTargets(board, EMPTY_CONTEXT, sq("e2")).size,
    0,
    "a pinned knight has no legal L at all, so none may be drawn"
  );
  // Unpin it and the L-moves reappear.
  const free = pos({ e1: "wk", e2: "wn", a8: "bk" });
  assert.ok(drawTargets(free, EMPTY_CONTEXT, sq("e2")).size > 0);
});

test("the opponent's pieces can be drawn too, using their own legal moves", () => {
  const board = initialBoard();
  const targets = drawTargets(board, initialContext(), sq("b8"));
  assert.deepEqual(names(targets), ["a6", "c6"], "Black's knight, mapped for threat-spotting");
});

test("arrows chain: a drawn move becomes the starting point of the next", () => {
  const board = initialBoard();
  const ctx = initialContext();
  // Before anything is drawn, f3 is an empty square — freeform.
  assert.equal(targetsForDrag(board, ctx, [], sq("f3")), null);

  // Draw Nf3, and now the knight is *on* f3 for planning purposes.
  const plan = [arrow("g1", "f3")];
  const targets = targetsForDrag(board, ctx, plan, sq("f3"));
  assert.ok(targets, "f3 now holds a piece in the plan");
  const reachable = names(targets);
  for (const expected of ["g5", "e5", "d4", "h4", "g1"]) {
    assert.ok(reachable.includes(expected), `Ng5-style follow-up ${expected} should chain`);
  }
  // And the square it came from is empty again in the simulation.
  assert.equal(targetsForDrag(board, ctx, plan, sq("g1")), null);
});

test("freeform arrows are annotations, never replayed as moves", () => {
  const board = initialBoard();
  const ctx = initialContext();
  // An arrow across empty squares marks an idea; it must not move anything.
  const doodle = [arrow("e4", "e5"), arrow("d4", "d5")];
  const after = simulatePlan(board, ctx, doodle);
  assert.deepEqual(after.board, board, "annotations leave the position untouched");

  // A mix: one real move plus two doodles still applies only the move.
  const mixed = simulatePlan(board, ctx, [arrow("e4", "e5"), arrow("g1", "f3")]);
  assert.equal(mixed.board[5][5], "wn", "the knight reached f3");
  assert.equal(mixed.board[7][6], "", "g1 was vacated");
});

test("simulatePlan threads the context, so chained castling works", () => {
  const board = pos({ e1: "wk", h1: "wr", e8: "bk" });
  const ctx = initialContext();
  // O-O is drawable as a king move two squares over.
  const targets = drawTargets(board, ctx, sq("e1"));
  assert.ok(targets.has(squareKey(sq("g1").r, sq("g1").c)), "castling should be drawable");

  // Replaying it moves the rook too, and gives up the rights.
  const after = simulatePlan(board, ctx, [arrow("e1", "g1")]);
  assert.equal(after.board[7][6], "wk");
  assert.equal(after.board[7][5], "wr", "the rook follows in the simulated plan");
  assert.equal(after.ctx.rights.wk, false, "rights are spent in the plan too");
});

test("an arrow that is no longer playable is skipped, not crashed on", () => {
  const board = initialBoard();
  const ctx = initialContext();
  // g1→f3 twice: the second has no piece on g1 any more, so it is ignored.
  const after = simulatePlan(board, ctx, [arrow("g1", "f3"), arrow("g1", "f3")]);
  assert.equal(after.board[5][5], "wn");
  // An impossible arrow (bishop teleport) is simply not applied.
  const bogus = simulatePlan(board, ctx, [arrow("c1", "h6")]);
  assert.deepEqual(bogus.board, board);
});

console.log(`\n${passed} tests passed.`);
