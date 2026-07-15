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

  const reply = bestMove(msg.board, msg.color, msg.depth);
  self.postMessage({ type: "move", reply, coach });
};
