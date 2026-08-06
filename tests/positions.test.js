/**
 * Random-position generator tests. Run with: npm test
 *
 * The generator scatters pieces and retries until the engine accepts the
 * result, so the meaningful test is a fuzz: generate hundreds of positions and
 * assert every single one is legal and playable.
 */
import assert from "node:assert/strict";
import {
  WHITE,
  BLACK,
  opposite,
  legalMoves,
  getGameStatus,
  inCheck,
  findKing,
  evaluate,
  EMPTY_CONTEXT,
} from "../src/engine.js";
import {
  makeRng,
  generateEndgame,
  generateMidgame,
  generatePosition,
  isPlayable,
  ENDGAME_TEMPLATES,
  DIFFICULTIES,
} from "../src/positions.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Everything a position handed to a player must satisfy. */
function assertPlayable(p, where) {
  const { board, turn, ctx } = p;
  const wk = findKing(board, WHITE);
  const bk = findKing(board, BLACK);
  assert.ok(wk && bk, `${where}: both kings must be on the board`);
  assert.ok(
    Math.max(Math.abs(wk.r - bk.r), Math.abs(wk.c - bk.c)) >= 2,
    `${where}: kings must not be adjacent`
  );
  for (let c = 0; c < 8; c++) {
    assert.notEqual(board[0][c][1], "p", `${where}: pawn on the 8th rank`);
    assert.notEqual(board[7][c][1], "p", `${where}: pawn on the 1st rank`);
  }
  assert.ok(
    !inCheck(board, opposite(turn)),
    `${where}: the side not to move must not be in check`
  );
  assert.equal(getGameStatus(board, turn, ctx), "playing", `${where}: game already over`);
  assert.ok(legalMoves(board, turn, ctx).length > 0, `${where}: no legal moves`);
  assert.ok(p.label && p.target, `${where}: needs a label and a target`);
}

test("fuzz: 300 generated endgames are all legal and playable", () => {
  const rng = makeRng(20260729);
  for (let i = 0; i < 300; i++) {
    const difficulty = DIFFICULTIES[i % DIFFICULTIES.length];
    const playerColor = i % 2 === 0 ? WHITE : BLACK;
    const p = generateEndgame(rng, { difficulty, playerColor });
    assertPlayable(p, `endgame #${i} (${difficulty}, ${playerColor})`);
    assert.equal(p.turn, playerColor, "the player should always be to move");
  }
});

test("fuzz: generated endgames stay sparse and use the templates", () => {
  const rng = makeRng(7);
  const labels = new Set();
  for (let i = 0; i < 120; i++) {
    const p = generateEndgame(rng, { difficulty: "balanced" });
    labels.add(p.label);
    const pieces = p.board.flat().filter(Boolean).length;
    assert.ok(pieces >= 2 && pieces <= 8, `endgame should be sparse, got ${pieces} pieces`);
  }
  // Sampling should reach a good spread of templates, not just one.
  assert.ok(labels.size >= 4, `expected varied endgames, saw ${labels.size} kinds`);
  const known = new Set(ENDGAME_TEMPLATES.map((t) => t.label));
  for (const l of labels) assert.ok(known.has(l), `unexpected label: ${l}`);
});

test("the same seed reproduces a position; different seeds do not", () => {
  const a = generateEndgame(makeRng(42), { difficulty: "balanced" });
  const b = generateEndgame(makeRng(42), { difficulty: "balanced" });
  assert.deepEqual(a.board, b.board, "same seed must give the same position");

  // Across many seeds we should see plenty of distinct positions.
  const seen = new Set();
  for (let s = 0; s < 40; s++) {
    seen.add(JSON.stringify(generateEndgame(makeRng(s), { difficulty: "balanced" }).board));
  }
  assert.ok(seen.size > 30, `expected variety across seeds, got ${seen.size}/40`);
});

test("difficulty bands actually hold, from the player's point of view", () => {
  const rng = makeRng(99);
  for (let i = 0; i < 60; i++) {
    const playerColor = i % 2 === 0 ? WHITE : BLACK;
    const edge = (p) => (playerColor === WHITE ? evaluate(p.board) : -evaluate(p.board));

    const win = generateEndgame(rng, { difficulty: "convert", playerColor });
    assert.ok(edge(win) > 0, `"convert" must favour the player, got ${edge(win)}`);

    const lose = generateEndgame(rng, { difficulty: "defend", playerColor });
    assert.ok(edge(lose) < 0, `"defend" must favour the opponent, got ${edge(lose)}`);

    const even = generateEndgame(rng, { difficulty: "balanced", playerColor });
    assert.ok(Math.abs(edge(even)) <= 120, `"balanced" should be near equal, got ${edge(even)}`);
  }
});

test("isPlayable rejects the positions it should", () => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  board[7][4] = "wk";
  board[7][5] = "bk"; // adjacent kings
  assert.equal(isPlayable(board, WHITE), false, "adjacent kings");

  const missing = Array.from({ length: 8 }, () => Array(8).fill(""));
  missing[7][4] = "wk";
  assert.equal(isPlayable(missing, WHITE), false, "missing black king");

  const promoted = Array.from({ length: 8 }, () => Array(8).fill(""));
  promoted[7][4] = "wk";
  promoted[0][0] = "bk";
  promoted[0][7] = "wp"; // pawn on the 8th rank
  assert.equal(isPlayable(promoted, WHITE), false, "pawn on the last rank");

  // Black to move, but White is in check — White would have moved into it.
  const bad = Array.from({ length: 8 }, () => Array(8).fill(""));
  bad[7][4] = "wk";
  bad[0][4] = "bk";
  bad[1][4] = "br";
  assert.equal(isPlayable(bad, BLACK), false, "side not to move is in check");
});

test("midgames come from real play, not scattered pieces", () => {
  const p = generateMidgame(makeRng(2024), { plies: 12, depth: 1 });
  assertPlayable(p, "midgame");
  const pieces = p.board.flat().filter(Boolean).length;
  assert.ok(pieces >= 24, `a 12-ply middlegame should still be full, got ${pieces}`);
  // Both kings, and the position must be reachable — pawns still on real ranks.
  assert.ok(findKing(p.board, WHITE) && findKing(p.board, BLACK));
  assert.equal(p.turn, WHITE);
  // Castling rights are tracked through the opening rather than invented.
  assert.equal(typeof p.ctx.rights.wk, "boolean");
});

test("generatePosition dispatches on phase", () => {
  const end = generatePosition({ phase: "endgame", difficulty: "balanced", playerColor: WHITE, seed: 5 });
  assert.equal(end.phase, "endgame");
  assertPlayable(end, "dispatch endgame");

  const mid = generatePosition({ phase: "midgame", difficulty: "balanced", playerColor: WHITE, seed: 5 });
  assert.equal(mid.phase, "midgame");
  assertPlayable(mid, "dispatch midgame");
});

console.log(`\n${passed} tests passed.`);
