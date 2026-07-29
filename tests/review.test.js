/**
 * Post-game review tests. Run with: npm test
 */
import assert from "node:assert/strict";
import { initialBoard, applyMove } from "../src/engine.js";
import { summarize, topMistakes, habitReport, criticalMoments } from "../src/review.js";
import { loadHabitStats, emptyStats } from "../src/habits.js";
import { WHITE, BLACK } from "../src/engine.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const grade = (ply, color, loss) => ({
  ply, color, loss,
  playedStr: "Xx1", bestStr: "Yy2", playedScore: 0, bestScore: loss,
});

/** Build an 8×8 board from { e4: "wp", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [sq, piece] of Object.entries(pieces)) {
    board[8 - Number(sq[1])][sq.charCodeAt(0) - 97] = piece;
  }
  return board;
}

function mv(board, from, to) {
  const fromR = 8 - Number(from[1]), fromC = from.charCodeAt(0) - 97;
  const toR = 8 - Number(to[1]), toC = to.charCodeAt(0) - 97;
  return {
    fromR, fromC, toR, toC,
    piece: board[fromR][fromC], captured: board[toR][toC], promotion: "",
  };
}

test("summarize buckets moves at the documented thresholds", () => {
  const grades = [
    grade(0, WHITE, 0),    // best
    grade(2, WHITE, 20),   // best (boundary)
    grade(4, WHITE, 21),   // good
    grade(6, WHITE, 60),   // good (boundary)
    grade(8, WHITE, 61),   // inaccuracy
    grade(10, WHITE, 150), // inaccuracy (boundary)
    grade(12, WHITE, 151), // mistake
    grade(14, WHITE, 400), // mistake (boundary)
    grade(16, WHITE, 401), // blunder
  ];
  const { counts, graded } = summarize(grades);
  assert.equal(graded, 9);
  assert.deepEqual(counts, {
    best: 2, good: 2, inaccuracy: 2, mistake: 2, blunder: 1,
  });
});

test("summarize keeps each colour's moves separate", () => {
  const grades = [
    grade(0, WHITE, 0), grade(1, BLACK, 800),
    grade(2, WHITE, 10), grade(3, BLACK, 700),
  ];
  const white = summarize(grades, WHITE);
  const black = summarize(grades, BLACK);
  assert.equal(white.graded, 2);
  assert.equal(black.graded, 2);
  assert.equal(white.counts.best, 2);
  assert.equal(white.counts.blunder, 0);
  assert.equal(black.counts.blunder, 2, "Black's blunders must not leak into White");
  assert.ok(white.accuracy > black.accuracy);
});

test("a flawless game scores 100% and an empty one reports nothing", () => {
  assert.equal(summarize([grade(0, WHITE, 0), grade(2, WHITE, 0)]).accuracy, 100);
  const empty = summarize([]);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.avgLoss, null);
  assert.equal(empty.graded, 0);
});

test("topMistakes ranks by cost, skips good moves, and honours the cap", () => {
  const grades = [
    grade(0, WHITE, 10), grade(2, WHITE, 900),
    grade(4, WHITE, 200), grade(6, WHITE, 450), grade(8, BLACK, 999),
  ];
  const worst = topMistakes(grades, WHITE, 2);
  assert.equal(worst.length, 2);
  assert.deepEqual(worst.map((m) => m.loss), [900, 450]);
  assert.equal(worst[0].verdict, "Blunder");
  assert.equal(worst[0].moveNumber, 2, "ply 2 is White's move 2");
  // The 10-centipawn move is not a "mistake" and Black's is another colour.
  assert.ok(worst.every((m) => m.loss > 60));
  assert.equal(topMistakes(grades, BLACK).length, 1);
});

test("habitReport replays a colour's plies and never writes to storage", () => {
  // Black leaves a bishop where a rook can take it for free.
  const board = pos({ d4: "bb", d8: "wr", h8: "bk", e1: "wk" });
  const blackMove = mv(board, "h8", "h7"); // ignores the threat
  const plyLog = [
    { board: initialBoard(), played: mv(initialBoard(), "e2", "e4"), color: WHITE },
    { board, played: blackMove, color: BLACK },
  ];

  const before = loadHabitStats();
  const rep = habitReport(plyLog, BLACK);
  assert.ok(rep.counts["ignored-threat"], `expected ignored-threat, got ${JSON.stringify(rep.counts)}`);
  assert.ok(rep.lessons.some((l) => l.id === "ignored-threat"));
  assert.ok(rep.lessons[0].advice, "lessons carry their coaching advice");

  // White's report must not contain Black's habits.
  const whiteRep = habitReport(plyLog, WHITE);
  assert.ok(!whiteRep.counts["ignored-threat"]);

  // Reviewing is read-only: the personal profile is untouched.
  assert.deepEqual(loadHabitStats(), before);
  assert.deepEqual(before, emptyStats(), "no storage in node, so stats stay empty");
});

test("criticalMoments finds the sharpest swings, largest first", () => {
  // Swings by ply: +10, -410, +10, +590.
  const evals = [0, 10, -400, -390, 200];
  const critical = criticalMoments(evals);
  assert.equal(critical.length, 2, "only the two big swings qualify");
  assert.equal(critical[0].ply, 4, "the +590 swing is the sharpest");
  assert.equal(critical[1].ply, 2);
  // The two +10 moves are below the 150 threshold.
  assert.ok(critical.every((c) => Math.abs(c.delta) >= 150));
});

console.log(`\n${passed} tests passed.`);
