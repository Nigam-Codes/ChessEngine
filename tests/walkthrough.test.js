/**
 * Guided-walkthrough tests. Run with: npm test
 *
 * The thing worth protecting here is restraint: the walkthrough must stop only
 * on moves that teach something, must not invent a tactical reason when there
 * isn't one, and must produce nothing at all for a clean game.
 */
import assert from "node:assert/strict";
import { buildWalkthrough } from "../src/walkthrough.js";
import { legalMoves, applyMove, EMPTY_CONTEXT, WHITE, BLACK } from "../src/engine.js";

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
const at = (n) => ({ r: 8 - Number(n[1]), c: n.charCodeAt(0) - 97 });
const find = (board, color, from, to) => {
  const f = at(from), t = at(to);
  return legalMoves(board, color, EMPTY_CONTEXT).find(
    (m) => m.fromR === f.r && m.fromC === f.c && m.toR === t.r && m.toC === t.c
  );
};

/* A position where White can hang a bishop by moving it to an attacked square. */
function hangingSetup() {
  //  White Bc1 can go to h6, where the black pawn on g7 takes it for free.
  const board = pos({ e1: "wk", c1: "wb", d1: "wr", e8: "bk", g7: "bp", a8: "br" });
  const blunder = find(board, WHITE, "c1", "h6");
  const solid = find(board, WHITE, "c1", "e3");
  assert.ok(blunder && solid, "test position must offer both moves");
  return { board, blunder, solid };
}

test("a clean game produces no walkthrough at all", () => {
  const grades = [
    { ply: 0, color: WHITE, loss: 4, playedStr: "e4", bestStr: "e4" },
    { ply: 2, color: WHITE, loss: 18, playedStr: "Nf3", bestStr: "Nf3" },
  ];
  assert.deepEqual(buildWalkthrough({ grades, plyLog: [] }), [], "nothing to teach, so nothing shown");
});

test("no review means no walkthrough, rather than a crash", () => {
  assert.deepEqual(buildWalkthrough({}), []);
  assert.deepEqual(buildWalkthrough({ grades: null, plyLog: [] }), []);
  assert.deepEqual(buildWalkthrough({ grades: [], plyLog: [] }), []);
});

test("it stops on the mistakes and explains what hangs", () => {
  const { board, blunder, solid } = hangingSetup();
  const plyLog = [{ board, played: blunder, color: WHITE, ctx: EMPTY_CONTEXT }];
  const grades = [
    {
      ply: 0, color: WHITE, loss: 520,
      playedStr: "Bh6", bestStr: "Be3", best: solid,
    },
  ];
  const [step] = buildWalkthrough({ grades, plyLog });
  assert.equal(step.bucket, "blunder");
  assert.equal(step.moveNumber, 1);
  assert.match(step.headline, /Blunder/);
  // The explanation must name the piece that is actually hanging, and that
  // sentence comes from the same detector the live coach uses.
  assert.ok(
    step.points.some((p) => /bishop on h6/i.test(p)),
    `expected the hanging bishop to be named, got: ${JSON.stringify(step.points)}`
  );
  assert.ok(step.points.some((p) => /Better was Be3/.test(p)), "it names the better move");
  // Two arrows: what was played, and what should have been.
  assert.equal(step.arrows.length, 2);
  assert.ok(step.arrows.some((a) => a.color === "red"), "the move played");
  assert.ok(step.arrows.some((a) => a.color === "green"), "the move that was better");
});

test("a positional mistake is called positional, not dressed up as a tactic", () => {
  // Nothing hangs after this move; the walkthrough must say so rather than
  // inventing a threat to justify the grade.
  const board = pos({ e1: "wk", g1: "wn", e8: "bk" });
  const played = find(board, WHITE, "g1", "h3"); // knight on the rim
  const better = find(board, WHITE, "g1", "f3");
  const plyLog = [{ board, played, color: WHITE, ctx: EMPTY_CONTEXT }];
  const grades = [
    { ply: 0, color: WHITE, loss: 90, playedStr: "Nh3", bestStr: "Nf3", best: better },
  ];
  const [step] = buildWalkthrough({ grades, plyLog });
  assert.equal(step.bucket, "inaccuracy");
  assert.ok(
    step.points.some((p) => /positional/i.test(p)),
    `expected an honest positional note, got: ${JSON.stringify(step.points)}`
  );
  // Match the *claim* that something is wrong, not the words — the honest
  // sentence above legitimately contains "hanging" in "Nothing is hanging".
  assert.ok(
    step.points.every((p) => !/is attacked|^Fork!|is pinned/i.test(p)),
    `no tactic should be invented, got: ${JSON.stringify(step.points)}`
  );
});

test("steps run in game order even though the worst move is found first", () => {
  const board = pos({ e1: "wk", c1: "wb", e8: "bk", g7: "bp" });
  const played = find(board, WHITE, "c1", "e3");
  const plyLog = Array.from({ length: 9 }, () => ({
    board, played, color: WHITE, ctx: EMPTY_CONTEXT,
  }));
  const grades = [
    { ply: 0, color: WHITE, loss: 200, playedStr: "a", bestStr: "a" },
    { ply: 4, color: WHITE, loss: 900, playedStr: "b", bestStr: "b" },
    { ply: 8, color: WHITE, loss: 300, playedStr: "c", bestStr: "c" },
  ];
  const steps = buildWalkthrough({ grades, plyLog });
  assert.deepEqual(steps.map((s) => s.ply), [0, 4, 8], "a walkthrough is a story, told in order");
});

test("only your own mistakes are walked when a colour is given", () => {
  const grades = [
    { ply: 0, color: WHITE, loss: 300, playedStr: "w", bestStr: "w" },
    { ply: 1, color: BLACK, loss: 900, playedStr: "b", bestStr: "b" },
  ];
  const plyLog = [];
  assert.equal(buildWalkthrough({ grades, plyLog, color: WHITE }).length, 1);
  assert.equal(buildWalkthrough({ grades, plyLog, color: BLACK }).length, 1);
  assert.equal(buildWalkthrough({ grades, plyLog }).length, 2, "no colour walks the whole game");
});

test("a long, bad game is capped rather than becoming a lecture", () => {
  const grades = Array.from({ length: 30 }, (_, i) => ({
    ply: i * 2, color: WHITE, loss: 500 + i, playedStr: "x", bestStr: "y",
  }));
  const steps = buildWalkthrough({ grades, plyLog: [], max: 8 });
  assert.equal(steps.length, 8);
  // And it keeps the *worst* eight, not the first eight.
  assert.ok(Math.min(...steps.map((s) => s.loss)) > 500 + 30 - 9);
});

console.log(`\n${passed} tests passed.`);
