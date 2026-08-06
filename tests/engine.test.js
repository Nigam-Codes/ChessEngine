/**
 * Quick engine sanity tests. Run with: npm test
 */
import assert from "node:assert/strict";
import {
  initialBoard,
  legalMoves,
  applyMove,
  cloneBoard,
  makeMove,
  unmakeMove,
  getGameStatus,
  bestMove,
  search,
  evaluate,
  squareName,
  moveToString,
  initialContext,
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

/* 1. Both sides have exactly 20 legal moves in the opening position
      (16 pawn moves + 4 knight moves). */
test("initial position: 20 legal moves for each side", () => {
  const board = initialBoard();
  assert.equal(legalMoves(board, WHITE).length, 20);
  assert.equal(legalMoves(board, BLACK).length, 20);
});

/* 2. Fool's Mate: 1. f3 e5 2. g4 Qh4# — White is checkmated. */
test("Fool's Mate is detected as checkmate", () => {
  let board = initialBoard();
  const play = (fromR, fromC, toR, toC, color) => {
    const move = legalMoves(board, color).find(
      (m) => m.fromR === fromR && m.fromC === fromC && m.toR === toR && m.toC === toC
    );
    assert.ok(move, `move from (${fromR},${fromC}) to (${toR},${toC}) should be legal`);
    board = applyMove(board, move);
  };
  play(6, 5, 5, 5, WHITE); // 1. f3
  play(1, 4, 3, 4, BLACK); // 1... e5
  play(6, 6, 4, 6, WHITE); // 2. g4
  play(0, 3, 4, 7, BLACK); // 2... Qh4#
  assert.equal(getGameStatus(board, WHITE), "checkmate");
});

/* 3. Quiescence search prevents a horizon blunder.
      White queen on d1 can grab the pawn on d5 — but d5 is defended by the
      pawn on e6. A depth-1 search that evaluated immediately at the horizon
      would see "+1 pawn" and take it; quiescence keeps searching captures,
      sees ...exd5 winning the queen, and avoids the blunder. */
test("quiescence search avoids capturing a defended pawn", () => {
  const E = "";
  const board = [
    [E, E, E, E, E, E, E, "bk"],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, "bp", E, E, E],
    [E, E, E, "bp", E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, E, E, E, E, E],
    [E, E, E, "wq", E, E, E, "wk"],
  ];

  const result = bestMove(board, WHITE, 1);

  // The chosen move must not be Qxd5 (to row 3, col 3).
  const to = squareName(result.move.toR, result.move.toC);
  assert.notEqual(to, "d5", "engine should not grab the defended d5 pawn");

  // Sanity: the search actually counted work.
  assert.ok(result.stats.nodes > 0, "node counter should be > 0");

  // Verify quiescence directly: play Qxd5 and search with zero remaining
  // depth. A bare static evaluation would say White is up a pawn's worth of
  // material; quiescence must see ...exd5 winning the queen and report the
  // position as lost for White.
  const qxd5 = legalMoves(board, WHITE).find((m) => m.toR === 3 && m.toC === 3);
  assert.ok(qxd5, "Qxd5 should be a legal move in the test position");
  const after = applyMove(board, qxd5);
  assert.ok(evaluate(after) > 500, "static eval alone thinks Qxd5 wins material");
  const qScore = search(after, 0, -Infinity, Infinity, BLACK, { nodes: 0, pruned: 0 });
  assert.ok(
    qScore < -50,
    `quiescence should see the queen falls after Qxd5, got ${qScore}`
  );
});

/* ---------------- Castling ---------------- */

const E = "";
/** Build an 8×8 board from { e1: "wk", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(E));
  for (const [sq, piece] of Object.entries(pieces)) {
    board[8 - Number(sq[1])][sq.charCodeAt(0) - 97] = piece;
  }
  return board;
}
const castles = (board, color, ctx) =>
  legalMoves(board, color, ctx).filter((m) => m.castle).map((m) => m.castle);

test("both castles are legal from a cleared back rank, and move the rook", () => {
  const board = pos({ e1: "wk", a1: "wr", h1: "wr", e8: "bk" });
  const ctx = initialContext();
  assert.deepEqual(castles(board, WHITE, ctx).sort(), ["K", "Q"]);

  const short = legalMoves(board, WHITE, ctx).find((m) => m.castle === "K");
  const afterShort = applyMove(board, short);
  assert.equal(afterShort[7][6], "wk", "king lands on g1");
  assert.equal(afterShort[7][5], "wr", "rook lands on f1");
  assert.equal(afterShort[7][7], E, "h1 is vacated");
  assert.equal(moveToString(short), "O-O");

  const long = legalMoves(board, WHITE, ctx).find((m) => m.castle === "Q");
  const afterLong = applyMove(board, long);
  assert.equal(afterLong[7][2], "wk", "king lands on c1");
  assert.equal(afterLong[7][3], "wr", "rook lands on d1");
  assert.equal(afterLong[7][0], E, "a1 is vacated");
  assert.equal(moveToString(long), "O-O-O");
});

test("castling needs the right: the default context offers none", () => {
  const board = pos({ e1: "wk", a1: "wr", h1: "wr", e8: "bk" });
  assert.deepEqual(castles(board, WHITE, EMPTY_CONTEXT), []);
  // ...which is what keeps every pre-existing caller behaving as before.
  assert.deepEqual(legalMoves(board, WHITE).filter((m) => m.castle), []);
});

test("rights are lost by moving the king, moving a rook, or losing a rook", () => {
  const board = pos({ e1: "wk", a1: "wr", h1: "wr", e8: "bk" });
  const ctx = initialContext();

  const kingStep = legalMoves(board, WHITE, ctx).find(
    (m) => m.piece === "wk" && m.toC === 5 && !m.castle
  );
  const afterKing = nextContext(ctx, kingStep);
  assert.equal(afterKing.rights.wk, false);
  assert.equal(afterKing.rights.wq, false, "a king move forfeits both sides");

  const rookUp = legalMoves(board, WHITE, ctx).find(
    (m) => m.fromR === 7 && m.fromC === 7 && m.toR === 6
  );
  const afterRook = nextContext(ctx, rookUp);
  assert.equal(afterRook.rights.wk, false, "the h1 rook moved");
  assert.equal(afterRook.rights.wq, true, "the a1 rook did not");

  // The subtle one: the rook never moves — it is captured on its own square.
  const withRaider = pos({ e1: "wk", a1: "wr", h1: "wr", e8: "bk", h8: "br" });
  const grab = legalMoves(withRaider, BLACK, initialContext()).find(
    (m) => m.toR === 7 && m.toC === 7
  );
  assert.ok(grab, "Rxh1 should be available");
  assert.equal(nextContext(initialContext(), grab).rights.wk, false,
    "capturing the h1 rook must clear White's kingside right");
});

test("castling is illegal out of, through, or into check — and when blocked", () => {
  const ctx = initialContext();

  // Out of check: a rook on e8 checks the king down the e-file.
  const inCheck = pos({ e1: "wk", h1: "wr", a1: "wr", e8: "br", a8: "bk" });
  assert.deepEqual(castles(inCheck, WHITE, ctx), [], "cannot castle out of check");

  // Through check: f1 is attacked, so the king may not cross it.
  const through = pos({ e1: "wk", h1: "wr", f8: "br", a8: "bk" });
  assert.deepEqual(castles(through, WHITE, ctx), [], "cannot castle through an attacked square");

  // Into check: g1 is attacked.
  const into = pos({ e1: "wk", h1: "wr", g8: "br", a8: "bk" });
  assert.deepEqual(castles(into, WHITE, ctx), [], "cannot castle into check");

  // Blocked by a friendly piece.
  const blocked = pos({ e1: "wk", h1: "wr", g1: "wn", e8: "bk" });
  assert.deepEqual(castles(blocked, WHITE, ctx), [], "cannot castle through a piece");

  // Queenside is special: b1 may be attacked, because only the rook crosses it.
  const bFile = pos({ e1: "wk", a1: "wr", b8: "br", h8: "bk" });
  assert.deepEqual(castles(bFile, WHITE, ctx), ["Q"], "b1 under attack still allows O-O-O");
});

/* ---------------- En passant ---------------- */

test("en passant captures the pawn on its real square, and only immediately", () => {
  // Black pawn on d7, white pawn on e5: after ...d5, exd6 e.p. is available.
  const board = pos({ e5: "wp", d7: "bp", e1: "wk", e8: "bk" });
  const doubleStep = legalMoves(board, BLACK, initialContext()).find(
    (m) => m.fromC === 3 && m.toR === 3
  );
  assert.ok(doubleStep, "...d5 should be legal");

  const after = applyMove(board, doubleStep);
  const ctx = nextContext(initialContext(), doubleStep);
  assert.deepEqual(ctx.ep, { r: 2, c: 3 }, "the ep target is d6, behind the pawn");

  const ep = legalMoves(after, WHITE, ctx).find((m) => m.epCapture);
  assert.ok(ep, "exd6 e.p. should be offered");
  const captured = applyMove(after, ep);
  assert.equal(captured[2][3], "wp", "the white pawn lands on d6");
  assert.equal(captured[3][3], E, "the black pawn is removed from d5, not d6");
  assert.equal(captured[3][4], E, "e5 is vacated");

  // The chance expires: after any other move the ep target is gone.
  const quiet = legalMoves(after, WHITE, ctx).find((m) => m.piece === "wk");
  assert.equal(nextContext(ctx, quiet).ep, null);
  assert.deepEqual(
    legalMoves(after, WHITE, nextContext(ctx, quiet)).filter((m) => m.epCapture), [],
    "en passant is available for exactly one move"
  );
});

test("unmakeMove restores castling and en passant exactly", () => {
  // The search makes and unmakes millions of moves in place; if either special
  // move leaked, the board would silently corrupt mid-search.
  const check = (board, color, ctx, pick) => {
    const before = cloneBoard(board);
    const move = legalMoves(board, color, ctx).find(pick);
    assert.ok(move, "expected the special move to be generated");
    makeMove(board, move);
    assert.notDeepEqual(board, before, "the move should change something");
    unmakeMove(board, move);
    assert.deepEqual(board, before, "unmake must restore the position exactly");
  };

  check(pos({ e1: "wk", h1: "wr", e8: "bk" }), WHITE, initialContext(), (m) => m.castle === "K");
  check(pos({ e1: "wk", a1: "wr", e8: "bk" }), WHITE, initialContext(), (m) => m.castle === "Q");
  check(
    pos({ e5: "wp", d5: "bp", e1: "wk", e8: "bk" }),
    WHITE,
    { rights: initialContext().rights, ep: { r: 2, c: 3 } },
    (m) => m.epCapture
  );
});

test("castling reaches the search: the engine sees and scores it", () => {
  // A normal Italian-game position where White is ready to castle short.
  let board = initialBoard();
  let ctx = initialContext();
  const play = (from, to, color) => {
    const [fc, fr] = [from.charCodeAt(0) - 97, 8 - Number(from[1])];
    const [tc, tr] = [to.charCodeAt(0) - 97, 8 - Number(to[1])];
    const move = legalMoves(board, color, ctx).find(
      (m) => m.fromR === fr && m.fromC === fc && m.toR === tr && m.toC === tc
    );
    assert.ok(move, `${from}${to} should be legal`);
    board = applyMove(board, move);
    ctx = nextContext(ctx, move);
  };
  play("e2", "e4", WHITE); play("e7", "e5", BLACK);
  play("g1", "f3", WHITE); play("b8", "c6", BLACK);
  play("f1", "c4", WHITE); play("g8", "f6", BLACK);

  assert.ok(
    legalMoves(board, WHITE, ctx).some((m) => m.castle === "K"),
    "O-O should be available after Nf3 and Bc4"
  );
  // The search must score it like any other move, not choke on the rook hop.
  const result = bestMove(board, WHITE, 2, ctx);
  const castleCandidate = result.allMoves.find((m) => m.move.castle === "K");
  assert.ok(castleCandidate, "O-O must appear among the searched candidates");
  assert.equal(typeof castleCandidate.score, "number");
  assert.ok(Number.isFinite(castleCandidate.score), "castling must get a real score");
});

/* ---------------- Tapered evaluation ---------------- */

test("the king's best square flips between the opening and the endgame", () => {
  // Bare king and pawn: the king is a fighting piece and belongs in the middle.
  const cornerEnd = pos({ a1: "wk", d4: "wp", h8: "bk" });
  const centreEnd = pos({ e4: "wk", d4: "wp", h8: "bk" });
  assert.ok(
    evaluate(centreEnd) > evaluate(cornerEnd),
    `in an endgame a central king must score higher (centre ${evaluate(centreEnd)} vs corner ${evaluate(cornerEnd)})`
  );

  // Full opening material: now the king wants to be tucked away, not marching.
  // Clear g1 and e1 in the shared base so the two variants differ *only* by
  // where the king stands — otherwise this compares material, not placement.
  const base = initialBoard();
  base[7][4] = ""; // king leaves e1
  base[7][6] = ""; // knight out of the way of g1
  const tucked = cloneBoard(base);
  tucked[7][6] = "wk"; // king on g1, as if castled
  const exposed = cloneBoard(base);
  exposed[4][4] = "wk"; // king wandering to e4
  assert.ok(
    evaluate(tucked) > evaluate(exposed),
    `with a full board the sheltered king must score higher (g1 ${evaluate(tucked)} vs e4 ${evaluate(exposed)})`
  );
});

test("tapered evaluation still counts material first", () => {
  // Whatever the phase does to piece-square bonuses, a queen is a queen.
  const withQueen = pos({ e1: "wk", d1: "wq", e8: "bk" });
  const without = pos({ e1: "wk", e8: "bk" });
  assert.ok(evaluate(withQueen) - evaluate(without) > 800, "a queen must be worth ~9 pawns");
  // A symmetric position evaluates to dead level in any phase.
  assert.equal(evaluate(pos({ e1: "wk", e8: "bk" })), 0);
  assert.equal(evaluate(initialBoard()), 0);
});

console.log(`\n${passed} tests passed.`);
