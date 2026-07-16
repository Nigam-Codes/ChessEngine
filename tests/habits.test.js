/**
 * Habit-tracker sanity tests. Run with: npm test
 */
import assert from "node:assert/strict";
import { initialBoard, applyMove } from "../src/engine.js";
import {
  analyzeMove,
  gradingEvents,
  loadHabitStats,
  saveHabitStats,
  emptyStats,
} from "../src/habits.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Build an 8×8 board from { e4: "wp", ... }, same shape as lessons.js. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [sqName, piece] of Object.entries(pieces)) {
    board[8 - Number(sqName[1])][sqName.charCodeAt(0) - 97] = piece;
  }
  return board;
}

function mv(board, from, to) {
  const fromR = 8 - Number(from[1]), fromC = from.charCodeAt(0) - 97;
  const toR = 8 - Number(to[1]), toC = to.charCodeAt(0) - 97;
  return {
    fromR, fromC, toR, toC,
    piece: board[fromR][fromC],
    captured: board[toR][toC],
    promotion: "",
  };
}

test("moving a piece onto an attacked square counts as hanging it", () => {
  const board = pos({ a1: "wr", b6: "bp", e1: "wk", e8: "bk" });
  const move = mv(board, "a1", "a5"); // a5 is attacked by the b6 pawn
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 12,
  });
  assert.ok(events.includes("hung-piece"), `expected hung-piece, got ${events}`);
});

test("leaving an attacked piece where it stands counts as ignoring the threat", () => {
  const board = pos({ d4: "wb", d8: "br", h1: "wk", h8: "bk" });
  const move = mv(board, "h1", "g1"); // king shuffles, bishop stays hanging
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 12,
  });
  assert.ok(events.includes("ignored-threat"), `expected ignored-threat, got ${events}`);
});

test("rescuing an attacked piece counts as answering the threat", () => {
  const board = pos({ d4: "wb", d8: "br", h1: "wk", h8: "bk" });
  const move = mv(board, "d4", "b2"); // bishop steps off the rook's file
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 12,
  });
  assert.ok(events.includes("answered-threat"), `expected answered-threat, got ${events}`);
  assert.ok(!events.includes("ignored-threat"));
});

test("an early queen sortie is flagged", () => {
  const board = initialBoard();
  board[6][4] = ""; board[4][4] = "wp"; // 1. e4 already played
  const move = mv(board, "d1", "h5"); // 2. Qh5
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 2,
  });
  assert.ok(events.includes("early-queen"), `expected early-queen, got ${events}`);
});

test("shuffling the same piece in the opening is flagged", () => {
  const board = pos({ f3: "wn", e1: "wk", c1: "wb", b1: "wn", e8: "bk" });
  const earlier = { fromR: 7, fromC: 6, toR: 5, toC: 5, piece: "wn", captured: "", promotion: "" };
  const move = mv(board, "f3", "g5"); // the same knight moves again
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 3,
    previousMoves: [earlier],
  });
  assert.ok(events.includes("piece-shuffle"), `expected piece-shuffle, got ${events}`);
});

test("developing a minor piece off the back rank is a good habit", () => {
  const board = initialBoard();
  const move = mv(board, "b1", "c3"); // 1. Nc3
  const events = analyzeMove({
    prevBoard: board,
    nextBoard: applyMove(board, move),
    move,
    moveNumber: 1,
  });
  assert.deepEqual(events, ["developed-minor"]);
});

test("grading maps to habit events at the right thresholds", () => {
  assert.deepEqual(gradingEvents(0), ["top-move"]);
  assert.deepEqual(gradingEvents(100), []);
  assert.deepEqual(gradingEvents(500), ["big-mistake"]);
  assert.deepEqual(gradingEvents(null), []);
});

test("habit stats survive a save/load round trip", () => {
  const backing = {};
  const fakeStorage = {
    getItem: (k) => (k in backing ? backing[k] : null),
    setItem: (k, v) => { backing[k] = v; },
    removeItem: (k) => { delete backing[k]; },
  };
  assert.deepEqual(loadHabitStats(fakeStorage), emptyStats());
  const stats = { counts: { "hung-piece": 3, "top-move": 5 }, games: 2 };
  saveHabitStats(stats, fakeStorage);
  assert.deepEqual(loadHabitStats(fakeStorage), stats);
});

console.log(`\n${passed} tests passed.`);
