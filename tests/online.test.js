/**
 * Online-protocol tests. Run with: npm test
 *
 * No network here — the protocol is pure on purpose. The cases that matter are
 * the hostile and the flaky: a peer sending an illegal move, a malformed
 * message, the same move twice after a reconnect, and two devices whose move
 * lists have drifted apart.
 */
import assert from "node:assert/strict";
import {
  makeRoomCode,
  formatCode,
  peerIdFor,
  shareLink,
  parseJoin,
  encodeMove,
  moveToUci,
  uciToWire,
  moveFromWire,
  isValidMessage,
  classifyIncoming,
  resolveSync,
  CODE_LENGTH,
  PUBLIC_URL,
} from "../src/online.js";
import {
  initialBoard,
  initialContext,
  legalMoves,
  applyMove,
  nextContext,
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

/* ---------------- Codes and links ---------------- */

test("room codes are the right length and never use look-alike characters", () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 500; i++) {
    const code = makeRoomCode(rng);
    assert.equal(code.length, CODE_LENGTH);
    assert.ok(!/[01oli]/.test(code), `${code} contains an ambiguous character`);
  }
});

test("a link round-trips back to its code, however it is pasted", () => {
  const code = "k7m2qx9p";
  const link = shareLink(code);
  assert.equal(link, PUBLIC_URL + "#join=k7m2qx9p");
  assert.equal(parseJoin(link), code, "the whole link");
  assert.equal(parseJoin(formatCode(code)), code, "the displayed code with its dash");
  assert.equal(parseJoin("  K7M2-QX9P "), code, "shouted, with spaces");
  assert.equal(parseJoin("https://example.com/app/?x=1#join=K7M2QX9P"), code, "another host");
});

test("a share link drops any existing fragment rather than stacking them", () => {
  assert.equal(
    shareLink("k7m2qx9p", "https://x.example/app/#join=oldcode1"),
    "https://x.example/app/#join=k7m2qx9p"
  );
});

test("junk is not mistaken for a code", () => {
  assert.equal(parseJoin(""), null);
  assert.equal(parseJoin("hello"), null);
  assert.equal(parseJoin("k7m2qx9"), null, "one short");
  assert.equal(parseJoin("k7m2qx9pp"), null, "one long");
  assert.equal(parseJoin("k7m2qx0p"), null, "contains a zero");
  assert.equal(parseJoin(null), null);
});

test("peer ids are namespaced so a code can't collide with strangers' ids", () => {
  assert.equal(peerIdFor("k7m2qx9p"), "chess-engine-lab-k7m2qx9p");
});

/* ---------------- Moves ---------------- */

test("an ordinary move round-trips through the wire", () => {
  const board = initialBoard();
  const ctx = initialContext();
  const e4 = legalMoves(board, WHITE, ctx).find((m) => m.toR === 4 && m.toC === 4);
  const wire = encodeMove(e4);
  assert.deepEqual(wire, { from: "e2", to: "e4", promotion: null });
  assert.equal(moveToUci(e4), "e2e4");
  assert.deepEqual(moveFromWire(board, WHITE, ctx, wire), e4);
});

test("castling and promotion survive the trip without special cases", () => {
  const board = pos({ e1: "wk", h1: "wr", b7: "wp", e8: "bk" });
  const ctx = { rights: { wk: true, wq: false, bk: false, bq: false }, ep: null, half: 0 };
  const castle = legalMoves(board, WHITE, ctx).find((m) => m.castle === "K");
  assert.equal(moveToUci(castle), "e1g1");
  assert.equal(moveFromWire(board, WHITE, ctx, uciToWire("e1g1")).castle, "K");

  const knight = moveFromWire(board, WHITE, ctx, uciToWire("b7b8n"));
  assert.equal(knight.promotion, "wn", "the underpromotion is preserved");
  assert.equal(moveToUci(knight), "b7b8n");
});

test("a promotion that doesn't say what it becomes is refused", () => {
  const board = pos({ e1: "wk", b7: "wp", e8: "bk" });
  assert.equal(
    moveFromWire(board, WHITE, EMPTY_CONTEXT, { from: "b7", to: "b8", promotion: null }),
    null,
    "ambiguous: four different moves share these squares"
  );
});

test("a peer cannot make you play an illegal move", () => {
  const board = initialBoard();
  const ctx = initialContext();
  // A knight can't go there, a pawn can't jump three, and it isn't Black's turn.
  assert.equal(moveFromWire(board, WHITE, ctx, uciToWire("g1g3")), null);
  assert.equal(moveFromWire(board, WHITE, ctx, uciToWire("e2e5")), null);
  assert.equal(moveFromWire(board, WHITE, ctx, uciToWire("e7e5")), null, "Black's pawn on White's turn");
  // Nor anything malformed.
  assert.equal(moveFromWire(board, WHITE, ctx, { from: "z9", to: "e4" }), null);
  assert.equal(moveFromWire(board, WHITE, ctx, { from: "e2", to: "e4", promotion: "k" }), null);
  assert.equal(moveFromWire(board, WHITE, ctx, null), null);
});

test("a move that would leave your own king in check is refused", () => {
  // The bishop is pinned: geometrically it can move, legally it cannot.
  const board = pos({ e1: "wk", e2: "wb", e8: "br", a8: "bk" });
  assert.equal(moveFromWire(board, WHITE, EMPTY_CONTEXT, uciToWire("e2d3")), null);
});

test("uci strings are validated, not trusted", () => {
  assert.deepEqual(uciToWire("e2e4"), { from: "e2", to: "e4", promotion: null });
  assert.deepEqual(uciToWire("a7a8q"), { from: "a7", to: "a8", promotion: "q" });
  for (const bad of ["", "e2", "e2e9", "i2e4", "e2e4k", "e2e4qq", 42, null]) {
    assert.equal(uciToWire(bad), null, `${JSON.stringify(bad)} should be rejected`);
  }
});

/* ---------------- Messages ---------------- */

test("well-formed messages are accepted", () => {
  for (const msg of [
    { type: "hello", v: 1, role: "guest" },
    { type: "start", v: 1, game: 0, hostColor: "w" },
    { type: "move", game: 0, ply: 3, move: { from: "e2", to: "e4" } },
    { type: "sync", game: 1, moves: ["e2e4", "e7e5"] },
    { type: "resign", game: 0 },
    { type: "draw-offer", game: 0 },
    { type: "draw-answer", game: 0, accept: false },
    { type: "rematch", game: 0 },
  ]) {
    assert.ok(isValidMessage(msg), JSON.stringify(msg));
  }
});

test("malformed or hostile messages are rejected before anything reads them", () => {
  for (const msg of [
    null,
    "move e2e4",
    { type: "nuke" },
    { type: "move", game: 0, ply: -1, move: { from: "e2", to: "e4" } },
    { type: "move", game: 0, ply: 1.5, move: { from: "e2", to: "e4" } },
    { type: "move", game: 0, ply: 0 },
    { type: "start", v: 1, game: 0, hostColor: "purple" },
    { type: "sync", game: 0, moves: "e2e4" },
    { type: "sync", game: 0, moves: ["e2e4", "<script>"] },
    { type: "sync", game: 0, moves: Array(1001).fill("e2e4") },
    { type: "draw-answer", game: 0, accept: "yes" },
    { type: "hello", v: 1, role: "admin" },
  ]) {
    assert.equal(isValidMessage(msg), false, JSON.stringify(msg)?.slice(0, 60));
  }
});

/* ---------------- Ordering and reconnection ---------------- */

test("a move is applied once, a resent copy is ignored, and a gap is noticed", () => {
  assert.equal(classifyIncoming(4, 4), "apply");
  assert.equal(classifyIncoming(5, 4), "duplicate", "already have it — the resend after a drop");
  assert.equal(classifyIncoming(4, 6), "gap", "we missed one; ask for the full list");
});

test("after a reconnect, the side that is behind catches up", () => {
  const theirs = ["e2e4", "e7e5", "g1f3", "b8c6"];
  const mine = ["e2e4", "e7e5", "g1f3"];
  assert.deepEqual(resolveSync(mine, theirs, { isHost: false }), {
    action: "apply",
    moves: ["b8c6"],
  });
  // From the other side, there is nothing to do but wait for them to catch up.
  assert.deepEqual(resolveSync(theirs, mine, { isHost: true }), { action: "wait" });
  // In step already.
  assert.deepEqual(resolveSync(mine, [...mine], { isHost: true }), { action: "none" });
});

test("if the lists have genuinely forked, the host's game wins", () => {
  const host = ["e2e4", "e7e5"];
  const guest = ["e2e4", "c7c5"];
  assert.deepEqual(resolveSync(guest, host, { isHost: false }), { action: "replace", moves: host });
  assert.deepEqual(resolveSync(host, guest, { isHost: true }), { action: "wait" });
});

test("a whole game survives being replayed from its move list", () => {
  // What a reconnecting device actually does: rebuild the game from the list.
  const moves = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"];
  let board = initialBoard();
  let ctx = initialContext();
  let color = WHITE;
  for (const uci of moves) {
    const move = moveFromWire(board, color, ctx, uciToWire(uci));
    assert.ok(move, `${uci} should be legal here`);
    board = applyMove(board, move);
    ctx = nextContext(ctx, move);
    color = color === WHITE ? BLACK : WHITE;
  }
  assert.equal(board[7][6], "wk", "castled king on g1");
  assert.equal(board[7][5], "wr", "rook alongside it on f1");
});

console.log(`\n${passed} tests passed.`);
