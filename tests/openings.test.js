/**
 * Opening-name tests. Run with: npm test
 */
import assert from "node:assert/strict";
import { openingFor, openingForMoves, movesToPath, OPENINGS } from "../src/openings.js";
import { THEMES, DEFAULT_THEME, isTheme, loadTheme } from "../src/themes.js";
import { initialBoard, legalMoves, applyMove, initialContext, nextContext, WHITE, BLACK } from "../src/engine.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Play a line by square names, returning the moves as plyLog stores them. */
function line(...pairs) {
  let board = initialBoard();
  let ctx = initialContext();
  let turn = WHITE;
  const played = [];
  for (const pair of pairs) {
    const [from, to] = [pair.slice(0, 2), pair.slice(2, 4)];
    const fr = 8 - Number(from[1]);
    const fc = from.charCodeAt(0) - 97;
    const tr = 8 - Number(to[1]);
    const tc = to.charCodeAt(0) - 97;
    const move = legalMoves(board, turn, ctx).find(
      (m) => m.fromR === fr && m.fromC === fc && m.toR === tr && m.toC === tc
    );
    assert.ok(move, `${pair} is not legal`);
    played.push(move);
    board = applyMove(board, move);
    ctx = nextContext(ctx, move);
    turn = turn === WHITE ? BLACK : WHITE;
  }
  return played;
}

test("moves become the coordinate path the table is keyed on", () => {
  assert.equal(movesToPath(line("e2e4", "e7e5", "g1f3")), "e2e4 e7e5 g1f3");
});

test("the Italian is named, and the longest prefix wins", () => {
  // Every one of these also matches shorter lines in the table; the most
  // specific must win, or every game would be called "King's Pawn Opening".
  assert.equal(openingForMoves(line("e2e4")).name, "King's Pawn Opening");
  assert.equal(openingForMoves(line("e2e4", "e7e5", "g1f3")).name, "King's Knight Opening");
  assert.equal(
    openingForMoves(line("e2e4", "e7e5", "g1f3", "b8c6", "f1c4")).name,
    "Italian Game"
  );
  assert.equal(
    openingForMoves(line("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5")).name,
    "Italian Game: Giuoco Piano"
  );
});

test("the name survives moves the table has never heard of", () => {
  // Once a game leaves the book it keeps the last name it earned, rather than
  // losing it — which is how every chess site behaves.
  const moves = line("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "d2d3", "d7d6");
  assert.equal(openingForMoves(moves).name, "Italian Game: Giuoco Piano");
});

test("an unknown line is named nothing rather than guessed at", () => {
  assert.equal(openingFor("a2a3"), null, "1. a3 is not in this subset");
  assert.equal(openingFor(""), null);
  // And a line that merely *contains* a known sequence without starting with
  // it must not match: prefixes, not substrings.
  assert.equal(openingFor("h2h4 e2e4"), null);
});

test("both major first moves and the flank openings are covered", () => {
  assert.equal(openingForMoves(line("d2d4")).name, "Queen's Pawn Opening");
  assert.equal(openingForMoves(line("d2d4", "d7d5", "c2c4")).name, "Queen's Gambit");
  assert.equal(openingForMoves(line("c2c4")).name, "English Opening");
  assert.equal(openingForMoves(line("g1f3")).name, "Réti Opening");
  assert.equal(openingForMoves(line("e2e4", "c7c5")).name, "Sicilian Defence");
});

test("every line in the table is a real, legal sequence of moves", () => {
  // A typo in a coordinate would silently create an opening that can never be
  // reached, so play each one out.
  for (const opening of OPENINGS) {
    const pairs = opening.line.split(" ");
    assert.doesNotThrow(() => line(...pairs), `${opening.name} (${opening.line})`);
  }
});

test("no two lines collide", () => {
  const seen = new Set();
  for (const o of OPENINGS) {
    assert.ok(!seen.has(o.line), `duplicate line for ${o.name}`);
    seen.add(o.line);
  }
});

/* ---------------- Themes ---------------- */

test("themes are a closed set with a safe default", () => {
  assert.ok(THEMES.length >= 2);
  assert.ok(isTheme(DEFAULT_THEME));
  assert.equal(isTheme("chartreuse"), false);
  assert.equal(isTheme(null), false);
  // With no localStorage (as in Node) the default is returned, not a crash.
  assert.equal(loadTheme(), DEFAULT_THEME);
});

console.log(`\n${passed} tests passed.`);
