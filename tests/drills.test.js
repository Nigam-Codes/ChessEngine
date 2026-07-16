/**
 * Drill sanity tests: replay every Learn-mode drill against the engine to
 * prove each accepted move, trap, and scripted reply is actually legal.
 * Run with: npm test
 */
import assert from "node:assert/strict";
import { cloneBoard, legalMoves, applyMove, getGameStatus, WHITE, BLACK } from "../src/engine.js";
import { DRILLS } from "../src/drills.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const findMove = (moves, target) =>
  moves.find(
    (m) =>
      m.fromR === target.from[0] && m.fromC === target.from[1] &&
      m.toR === target.to[0] && m.toC === target.to[1]
  );

for (const drill of DRILLS) {
  test(`drill "${drill.id}": every scripted move is legal`, () => {
    let board = cloneBoard(drill.position);
    for (const [i, step] of drill.steps.entries()) {
      const whiteMoves = legalMoves(board, WHITE);
      // Every accepted answer must be playable in this position.
      for (const acc of step.accept) {
        assert.ok(
          findMove(whiteMoves, acc),
          `step ${i + 1}: accepted move ${JSON.stringify(acc)} is not legal`
        );
      }
      // Every trap must be reachable, or its feedback can never trigger.
      for (const trap of step.traps || []) {
        assert.ok(
          whiteMoves.some((m) => m.toR === trap.to[0] && m.toC === trap.to[1]),
          `step ${i + 1}: trap square is unreachable`
        );
      }
      // Advance the line: primary answer, then the scripted reply.
      board = applyMove(board, findMove(whiteMoves, step.accept[0]));
      if (step.reply) {
        const reply = findMove(legalMoves(board, BLACK), step.reply);
        assert.ok(reply, `step ${i + 1}: scripted reply is not legal`);
        board = applyMove(board, reply);
      }
    }
  });
}

for (const drill of DRILLS.filter((d) => d.endsInMate)) {
  test(`drill "${drill.id}" ends in checkmate`, () => {
    let board = cloneBoard(drill.position);
    for (const step of drill.steps) {
      board = applyMove(board, findMove(legalMoves(board, WHITE), step.accept[0]));
      if (step.reply) board = applyMove(board, findMove(legalMoves(board, BLACK), step.reply));
    }
    assert.equal(getGameStatus(board, BLACK), "checkmate");
  });
}

console.log(`\n${passed} tests passed.`);
