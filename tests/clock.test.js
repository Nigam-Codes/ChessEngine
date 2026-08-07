/**
 * Blitz clock tests. Run with: npm test
 */
import assert from "node:assert/strict";
import { WHITE, BLACK } from "../src/engine.js";
import {
  TIME_CONTROLS,
  findControl,
  createClocks,
  tick,
  addIncrement,
  formatClock,
  canMate,
  flagResult,
  depthForTime,
  pressureSplit,
} from "../src/clock.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Build an 8×8 board from { e1: "wk", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [s, piece] of Object.entries(pieces)) {
    board[8 - Number(s[1])][s.charCodeAt(0) - 97] = piece;
  }
  return board;
}

test("clocks start level and count down only for the side on move", () => {
  const clocks = createClocks("3+2");
  assert.equal(clocks.w, 180000);
  assert.equal(clocks.b, 180000);
  assert.equal(clocks.inc, 2000);

  const after = tick(clocks, WHITE, 5000);
  assert.equal(after.w, 175000, "White spent five seconds");
  assert.equal(after.b, 180000, "Black's clock must not move");
});

test("a clock never goes negative", () => {
  const clocks = createClocks({ base: 1, inc: 0 });
  const flagged = tick(clocks, WHITE, 99999);
  assert.equal(flagged.w, 0, "time runs out at zero, not below");
});

test("the increment is added after the move", () => {
  const clocks = addIncrement(tick(createClocks("3+2"), WHITE, 5000), WHITE);
  assert.equal(clocks.w, 177000, "5s spent, 2s back");
  // A control without increment gives nothing back.
  const noInc = addIncrement(tick(createClocks("3+0"), WHITE, 5000), WHITE);
  assert.equal(noInc.w, 175000);
});

test("the display switches to tenths under ten seconds", () => {
  assert.equal(formatClock(180000), "3:00");
  assert.equal(formatClock(65000), "1:05");
  assert.equal(formatClock(10000), "0:10");
  assert.equal(formatClock(9900), "9.9", "tenths once it gets tense");
  assert.equal(formatClock(400), "0.4");
  assert.equal(formatClock(0), "0.0");
  assert.equal(formatClock(-500), "0.0", "never shows negative time");
});

test("flagging gives a draw when the winner could never mate", () => {
  // King and rook can mate — flagging loses.
  const withRook = pos({ e1: "wk", a1: "wr", e8: "bk" });
  assert.equal(canMate(withRook, WHITE), true);
  assert.deepEqual(flagResult(withRook, BLACK), { outcome: "flagged", winner: WHITE });

  // A lone king cannot, so the flag is only a draw.
  const bare = pos({ e1: "wk", e8: "bk" });
  assert.equal(canMate(bare, WHITE), false);
  assert.deepEqual(flagResult(bare, BLACK), { outcome: "flagged-draw", winner: null });

  // Nor can king and a single minor.
  assert.equal(canMate(pos({ e1: "wk", c1: "wb", e8: "bk" }), WHITE), false);
  assert.equal(canMate(pos({ e1: "wk", b1: "wn", e8: "bk" }), WHITE), false);
  // Two minors can, and a single pawn can (it promotes).
  assert.equal(canMate(pos({ e1: "wk", c1: "wb", f1: "wb", e8: "bk" }), WHITE), true);
  assert.equal(canMate(pos({ e1: "wk", a2: "wp", e8: "bk" }), WHITE), true);
});

test("the engine picks a depth it can actually afford", () => {
  // Plenty of time: full strength.
  assert.equal(depthForTime(600000, 6), 6);
  // Three minutes still allows a deep search.
  assert.ok(depthForTime(180000, 6) >= 4);
  // Down to the last seconds it must move almost instantly, or it flags.
  assert.ok(depthForTime(3000, 6) <= 2, "must go shallow when short of time");
  assert.equal(depthForTime(200, 6), 1);
  // It never exceeds the strength the player selected.
  assert.equal(depthForTime(600000, 2), 2, "the slider is still a ceiling");
  assert.ok(depthForTime(0, 6) >= 1, "always returns a legal depth");
});

test("the review can separate calm moves from rushed ones", () => {
  const entries = [
    { loss: 0, msLeft: 120000 },
    { loss: 30, msLeft: 90000 },
    { loss: 600, msLeft: 8000 },
    { loss: 400, msLeft: 3000 },
  ];
  const { calm, rushed } = pressureSplit(entries);
  assert.equal(calm.moves, 2);
  assert.equal(rushed.moves, 2);
  assert.ok(calm.accuracy > rushed.accuracy, "blunders under pressure should show");

  // Missing clock data (a game played without a clock) simply yields nothing.
  const none = pressureSplit([{ loss: 10 }, { loss: 20 }]);
  assert.equal(none.calm.moves, 0);
  assert.equal(none.rushed.moves, 0);
  assert.equal(none.calm.accuracy, null);
});

test("every preset is well formed", () => {
  for (const c of TIME_CONTROLS) {
    assert.ok(c.base > 0 && c.inc >= 0, `${c.id} needs a sane base and increment`);
    assert.equal(findControl(c.id).id, c.id);
  }
  assert.ok(findControl("nonsense"), "an unknown id falls back rather than crashing");
});

console.log(`\n${passed} tests passed.`);
