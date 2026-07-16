/**
 * engineWorker.js — runs engine searches off the main thread so the UI
 * stays responsive while the engine thinks.
 *
 * Messages in:
 *   { type: "move", board, color, depth, coach? }
 *     coach (teacher mode): { board, color, depth, played } — the position
 *     *before* the player's move, so their choice can be graded against
 *     the engine's best in that same position.
 *   { type: "hint", board, color, depth }
 *
 * Messages out:
 *   { type: "move", reply, coach? }   coach: { played, best, bestScore, playedScore }
 *   { type: "hint", result }
 */
import { bestMove } from "./engine.js";

const sameMove = (a, b) =>
  a.fromR === b.fromR && a.fromC === b.fromC && a.toR === b.toR && a.toC === b.toC;

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === "hint") {
    self.postMessage({ type: "hint", result: bestMove(msg.board, msg.color, msg.depth) });
    return;
  }

  let coach = null;
  if (msg.coach) {
    const analysis = bestMove(msg.coach.board, msg.coach.color, msg.coach.depth);
    const played = analysis.allMoves.find((m) => sameMove(m.move, msg.coach.played));
    coach = {
      played: msg.coach.played,
      best: analysis.move,
      bestScore: analysis.score,
      playedScore: played ? played.score : null,
    };
  }

  let reply = bestMove(msg.board, msg.color, msg.depth);

  // Human-like fallibility: at low strength settings, sometimes play a
  // near-best candidate instead of the top choice (msg.fuzz = probability).
  // Real beginners don't just search shallower — they pick plausible-but-
  // imperfect moves, and this simulates that.
  if (msg.fuzz && reply.candidates.length > 1 && Math.random() < msg.fuzz) {
    const best = reply.candidates[0].score;
    const near = reply.candidates.filter((c) => Math.abs(c.score - best) <= 150);
    const pool = near.length > 1 ? near : reply.candidates.slice(0, 2);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    reply = { ...reply, move: pick.move, score: pick.score };
  }

  self.postMessage({ type: "move", reply, coach });
};
