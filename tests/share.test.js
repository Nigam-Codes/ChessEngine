/**
 * Share-card tests. Run with: npm test
 *
 * Only the model is tested — everything that could be *wrong* about the card
 * lives there. The drawing is deliberately not asserted: there is no canvas in
 * Node, and "did it paint the right pixels" is not a question a unit test
 * answers usefully. The browser suite proves a real PNG comes out.
 */
import assert from "node:assert/strict";
import { winProbability, cardModel, CARD_WIDTH, CARD_HEIGHT } from "../src/share.js";
import { initialBoard, initialContext, WHITE, BLACK } from "../src/engine.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/* ---------------- Win probability ---------------- */

test("a level position is a coin flip, and the curve is symmetric", () => {
  assert.equal(winProbability(0), 0.5);
  // Equal and opposite evaluations must sum to a whole game.
  for (const cp of [50, 200, 700, 3000]) {
    assert.ok(
      Math.abs(winProbability(cp) + winProbability(-cp) - 1) < 1e-9,
      `${cp} is not symmetric`
    );
  }
});

test("the curve rises with the evaluation and saturates", () => {
  const points = [-2000, -800, -300, -100, 0, 100, 300, 800, 2000].map(winProbability);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i] > points[i - 1], "win probability must never go down as eval rises");
  }
  assert.ok(winProbability(3000) > 0.99, "a decisive position reads as decisive");
  assert.ok(winProbability(-3000) < 0.01);
  // And it is bounded, which is the whole reason for using it over centipawns.
  assert.ok(winProbability(100000) <= 1);
  assert.ok(winProbability(-100000) >= 0);
});

test("a pawn up is a real edge but not a won game", () => {
  const p = winProbability(100);
  assert.ok(p > 0.55 && p < 0.75, `a pawn should read as an edge, got ${p}`);
});

test("nonsense evaluations do not produce a nonsense curve", () => {
  assert.equal(winProbability(NaN), 0.5);
  assert.equal(winProbability(undefined), 0.5);
});

/* ---------------- The model ---------------- */

const result = { headline: "You win", how: "by checkmate", winner: WHITE };

/** A ply log entry — only the fields the model actually reads. */
const ply = (color) => ({
  board: initialBoard(),
  played: { fromR: 6, fromC: 4, toR: 4, toC: 4, piece: color + "p", captured: "", promotion: "" },
  color,
  ctx: initialContext(),
});

test("the model carries the result, the opening and the move count", () => {
  const model = cardModel({
    result,
    evalHistory: [0, 30, -10],
    plyLog: [ply(WHITE), ply(BLACK), ply(WHITE)],
    opening: { name: "Italian Game", eco: "C50" },
  });
  assert.equal(model.headline, "You win");
  assert.equal(model.how, "by checkmate");
  assert.equal(model.opening, "Italian Game (C50)");
  assert.equal(model.moves, 2, "three plies is two moves");
  assert.equal(model.curve.length, 3);
  assert.equal(model.curve[0], 0.5, "a level start is the middle of the graph");
});

test("without a review there is no accuracy, and the advice says why", () => {
  const model = cardModel({ result, evalHistory: [0], plyLog: [ply(WHITE)] });
  assert.equal(model.accuracy, null);
  assert.match(model.advice, /Teacher mode/, "the card explains how to get grades");
});

test("with a review the decisive move is the biggest loss, not the biggest swing", () => {
  const grades = [
    { ply: 0, color: WHITE, loss: 10, playedStr: "e4", bestStr: "e4" },
    { ply: 2, color: WHITE, loss: 620, playedStr: "Nxe5", bestStr: "Nc3" },
    { ply: 4, color: WHITE, loss: 90, playedStr: "h3", bestStr: "d4" },
  ];
  const model = cardModel({
    result,
    grades,
    evalHistory: [0, 20, -600, -580, -600],
    plyLog: [ply(WHITE), ply(BLACK), ply(WHITE), ply(BLACK), ply(WHITE)],
  });
  assert.equal(model.decisive.move, "Nxe5");
  assert.equal(model.decisive.better, "Nc3", "the card names the move that was better");
  assert.equal(model.decisive.moveNumber, 2);
  assert.equal(model.decisive.verdict, "Blunder");
  assert.equal(typeof model.accuracy, "number");
  assert.match(model.advice, /blunder/, "the advice names the worst habit found");
});

test("a clean game is not given an invented mistake", () => {
  // Every move near-best: the card must say so rather than promoting the
  // least-good move to "the move it turned on".
  const grades = [
    { ply: 0, color: WHITE, loss: 5, playedStr: "e4", bestStr: "e4" },
    { ply: 2, color: WHITE, loss: 12, playedStr: "Nf3", bestStr: "Nf3" },
  ];
  const model = cardModel({ result, grades, evalHistory: [0, 10, 5], plyLog: [ply(WHITE)] });
  assert.equal(model.decisive, null);
  assert.match(model.advice, /No blunders/);
});

test("without a review the decisive move falls back to the evaluation swing", () => {
  // No grades, so no search was run — the biggest jump in the eval is the best
  // available answer, and it costs nothing to compute.
  const model = cardModel({
    result,
    evalHistory: [0, 20, -700],
    plyLog: [ply(WHITE), ply(BLACK)],
  });
  assert.ok(model.decisive, "a large swing is still worth naming");
  assert.equal(model.decisive.verdict, "Turning point");
  assert.equal(model.decisive.better, null, "with no analysis it cannot claim a better move");
});

test("a game with nothing to say produces a card, not a crash", () => {
  const model = cardModel({});
  assert.equal(model.headline, "Game over");
  assert.deepEqual(model.curve, []);
  assert.equal(model.decisive, null);
  assert.equal(model.moves, 0);
  assert.ok(model.advice.length > 0);
});

test("accuracy is yours against the engine and the whole game in hot-seat", () => {
  const grades = [
    { ply: 0, color: WHITE, loss: 0, playedStr: "e4", bestStr: "e4" },
    { ply: 1, color: BLACK, loss: 800, playedStr: "f6", bestStr: "e5" },
  ];
  const mine = cardModel({ result, grades, playerColor: WHITE, vsHuman: false });
  const both = cardModel({ result, grades, playerColor: WHITE, vsHuman: true });
  assert.ok(
    mine.accuracy > both.accuracy,
    "your own flawless play should not be dragged down by the opponent's blunder"
  );
});

test("the card is the standard social preview size", () => {
  assert.equal(CARD_WIDTH / CARD_HEIGHT > 1.8, true);
  assert.equal(CARD_WIDTH, 1200);
  assert.equal(CARD_HEIGHT, 630);
});

console.log(`\n${passed} tests passed.`);
