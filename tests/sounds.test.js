/**
 * Sound tests. Run with: npm test
 *
 * There is no Web Audio in Node, which is itself the most important thing to
 * test: the module must be importable and every entry point must degrade to a
 * no-op rather than throwing in the middle of a move.
 */
import assert from "node:assert/strict";
import {
  playSound,
  soundForMove,
  SOUND_NAMES,
  setMuted,
  isMuted,
  loadMuted,
} from "../src/sounds.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test("every sound is a no-op without Web Audio, and never throws", () => {
  for (const name of SOUND_NAMES) {
    assert.equal(playSound(name), false, `${name} should report it did not play`);
  }
  assert.equal(playSound("no-such-sound"), false, "an unknown name is ignored");
  assert.equal(playSound(undefined), false);
});

test("the sound set covers every event a move can be", () => {
  for (const expected of ["move", "capture", "castle", "check", "promote", "gameEnd"]) {
    assert.ok(SOUND_NAMES.includes(expected), `missing the "${expected}" sound`);
  }
});

test("soundForMove picks the most significant event", () => {
  const quiet = { piece: "wn" };
  const capture = { piece: "wn", captured: "bp" };
  const castle = { piece: "wk", castle: "K" };
  const promo = { piece: "wp", promotion: "wq" };

  assert.equal(soundForMove(quiet), "move");
  assert.equal(soundForMove(capture), "capture");
  assert.equal(soundForMove(castle), "castle");
  assert.equal(soundForMove(promo), "promote");

  // Check outranks the move itself — it is the thing you need to notice.
  assert.equal(soundForMove(capture, { check: true }), "check");
  // And the end of the game outranks everything.
  assert.equal(soundForMove(capture, { check: true, gameOver: true }), "gameEnd");
  // A promotion that is also a capture still announces the promotion.
  assert.equal(soundForMove({ piece: "wp", captured: "br", promotion: "wq" }), "promote");
});

test("mute is remembered and silences playback", () => {
  assert.equal(isMuted(), false, "sound is on by default");
  setMuted(true);
  assert.equal(isMuted(), true);
  assert.equal(playSound("move"), false, "muted sessions never play");
  setMuted(false);
  assert.equal(isMuted(), false);
  // Reading the preference back is safe with no localStorage (as in Node).
  assert.equal(typeof loadMuted(), "boolean");
});

console.log(`\n${passed} tests passed.`);
