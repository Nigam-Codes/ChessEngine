/**
 * Draw-rule tests. Run with: npm test
 *
 * The interesting cases are the near-misses: positions that look like a
 * repetition but are not, and material that looks dead but is not.
 */
import assert from "node:assert/strict";
import {
  positionKey,
  insufficientMaterial,
  isFiftyMove,
  repetitionCount,
  outcomeFor,
  FIFTY_MOVE_PLIES,
} from "../src/rules.js";
import {
  initialBoard,
  initialContext,
  nextContext,
  applyMove,
  legalMoves,
  EMPTY_CONTEXT,
  WHITE,
  BLACK,
} from "../src/engine.js";

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
const at = (name) => [8 - Number(name[1]), name.charCodeAt(0) - 97];

/** Play a named move, threading board + context + the ply log along with it. */
function step(state, from, to) {
  const [fr, fc] = at(from);
  const [tr, tc] = at(to);
  const move = legalMoves(state.board, state.turn, state.ctx).find(
    (m) => m.fromR === fr && m.fromC === fc && m.toR === tr && m.toC === tc
  );
  assert.ok(move, `${from}${to} is not legal for ${state.turn}`);
  return {
    board: applyMove(state.board, move),
    turn: state.turn === WHITE ? BLACK : WHITE,
    ctx: nextContext(state.ctx, move),
    plyLog: [...state.plyLog, { board: state.board, color: state.turn, ctx: state.ctx }],
  };
}

/* ---------------- Threefold repetition ---------------- */

test("knights out and back three times is a repetition", () => {
  let state = { board: initialBoard(), turn: WHITE, ctx: initialContext(), plyLog: [] };
  assert.equal(repetitionCount(state.plyLog, state.board, state.turn, state.ctx), 1);

  // Both sides shuffle a knight out and back. Each full cycle returns the
  // position with White to move, so it occurs on ply 0, 8 and 16.
  for (let cycle = 0; cycle < 2; cycle++) {
    state = step(state, "g1", "f3");
    state = step(state, "g8", "f6");
    state = step(state, "f3", "g1");
    state = step(state, "f6", "g8");
  }
  assert.equal(
    repetitionCount(state.plyLog, state.board, state.turn, state.ctx),
    3,
    "the starting position has now occurred three times"
  );
  assert.equal(outcomeFor(state), "repetition");
});

test("the same board with different castling rights is NOT a repetition", () => {
  // This is the case a naive board-only hash gets wrong. Identical pieces,
  // identical side to move — but in one the rooks have moved and back, so
  // castling is gone and the positions are not the same at all.
  const board = pos({ e1: "wk", h1: "wr", e8: "bk", h8: "br" });
  const withRights = { rights: { wk: true, wq: false, bk: true, bq: false }, ep: null, half: 0 };
  const without = { rights: { wk: false, wq: false, bk: false, bq: false }, ep: null, half: 0 };
  assert.notEqual(
    positionKey(board, WHITE, withRights),
    positionKey(board, WHITE, without),
    "castling rights must be part of the key"
  );

  // Nor is it the same position with the other side to move.
  assert.notEqual(positionKey(board, WHITE, withRights), positionKey(board, BLACK, withRights));

  // Nor with an en-passant square available.
  const ep = { ...without, ep: { r: 2, c: 4 } };
  assert.notEqual(positionKey(board, WHITE, without), positionKey(board, WHITE, ep));
});

test("the halfmove clock is not part of the position", () => {
  // A position repeats whether or not the fifty-move counter happens to match.
  const board = pos({ e1: "wk", e8: "bk" });
  const a = { rights: EMPTY_CONTEXT.rights, ep: null, half: 3 };
  const b = { rights: EMPTY_CONTEXT.rights, ep: null, half: 40 };
  assert.equal(positionKey(board, WHITE, a), positionKey(board, WHITE, b));
});

/* ---------------- Fifty-move rule ---------------- */

test("the halfmove clock counts quiet moves and resets on pawns and captures", () => {
  let ctx = initialContext();
  assert.equal(ctx.half, 0);

  const board = initialBoard();
  const knight = legalMoves(board, WHITE, ctx).find(
    (m) => m.piece === "wn" && m.toR === 5 && m.toC === 5
  );
  ctx = nextContext(ctx, knight);
  assert.equal(ctx.half, 1, "a quiet move advances the clock");
  ctx = nextContext(ctx, knight);
  assert.equal(ctx.half, 2);

  // Any pawn move resets it, even a quiet one.
  const pawn = legalMoves(board, WHITE, ctx).find((m) => m.piece === "wp");
  assert.equal(nextContext(ctx, pawn).half, 0, "a pawn move resets the clock");

  // So does a capture.
  const capture = { fromR: 7, fromC: 6, toR: 5, toC: 5, piece: "wn", captured: "bp", promotion: "" };
  assert.equal(nextContext(ctx, capture).half, 0, "a capture resets the clock");
});

test("a hundred quiet plies is a draw, ninety-nine is not", () => {
  const board = pos({ e1: "wk", a1: "wr", e8: "bk", h8: "br" });
  const almost = { rights: EMPTY_CONTEXT.rights, ep: null, half: FIFTY_MOVE_PLIES - 1 };
  const there = { rights: EMPTY_CONTEXT.rights, ep: null, half: FIFTY_MOVE_PLIES };
  assert.equal(isFiftyMove(almost), false);
  assert.equal(isFiftyMove(there), true);
  assert.equal(outcomeFor({ board, turn: WHITE, ctx: almost }), "playing");
  assert.equal(outcomeFor({ board, turn: WHITE, ctx: there }), "fifty-move");
});

test("a context built before the clock existed still works", () => {
  // Backwards compatibility: hand-made { rights, ep } objects are all over the
  // lesson and drill code and must not start reporting a fifty-move draw.
  assert.equal(isFiftyMove({ rights: EMPTY_CONTEXT.rights, ep: null }), false);
  assert.equal(isFiftyMove(undefined), false);
});

/* ---------------- Insufficient material ---------------- */

test("dead material is recognised", () => {
  assert.equal(insufficientMaterial(pos({ e1: "wk", e8: "bk" })), true, "K vs K");
  assert.equal(insufficientMaterial(pos({ e1: "wk", c1: "wb", e8: "bk" })), true, "K+B vs K");
  assert.equal(insufficientMaterial(pos({ e1: "wk", g1: "wn", e8: "bk" })), true, "K+N vs K");

  // Same-coloured bishops: neither can ever touch the other colour.
  // c1 and f8 are both dark squares.
  assert.equal(
    insufficientMaterial(pos({ e1: "wk", c1: "wb", e8: "bk", f8: "bb" })),
    true,
    "K+B vs K+B on the same colour"
  );
});

test("material that can still mate is not called dead", () => {
  assert.equal(insufficientMaterial(pos({ e1: "wk", a2: "wp", e8: "bk" })), false, "a pawn promotes");
  assert.equal(insufficientMaterial(pos({ e1: "wk", a1: "wr", e8: "bk" })), false, "K+R mates");
  assert.equal(insufficientMaterial(pos({ e1: "wk", d1: "wq", e8: "bk" })), false, "K+Q mates");

  // Opposite-coloured bishops can mate — c1 is dark, f8 is dark, so use c8.
  assert.equal(
    insufficientMaterial(pos({ e1: "wk", c1: "wb", e8: "bk", c8: "bb" })),
    false,
    "bishops on opposite colours"
  );
  // Bishop and knight, and two knights: mate cannot be forced, but it can be
  // reached, so FIDE does not call these dead and neither do we.
  assert.equal(insufficientMaterial(pos({ e1: "wk", c1: "wb", g1: "wn", e8: "bk" })), false, "K+B+N");
  assert.equal(insufficientMaterial(pos({ e1: "wk", b1: "wn", g1: "wn", e8: "bk" })), false, "K+N+N");
  assert.equal(insufficientMaterial(pos({ e1: "wk", g1: "wn", e8: "bk", b8: "bn" })), false, "K+N vs K+N");
});

/* ---------------- Precedence ---------------- */

test("being mated outranks every drawing rule", () => {
  // Black is mated, and the position is also bare of mating material for
  // Black and has a stale halfmove clock. Mate still wins.
  const board = pos({ a8: "bk", a1: "wr", b1: "wr", e5: "wk" });
  const ctx = { rights: EMPTY_CONTEXT.rights, ep: null, half: 200 };
  assert.equal(outcomeFor({ board, turn: BLACK, ctx }), "checkmate");
});

test("a live game reports normally", () => {
  const state = { board: initialBoard(), turn: WHITE, ctx: initialContext(), plyLog: [] };
  assert.equal(outcomeFor(state), "playing");
});

console.log(`\n${passed} tests passed.`);
