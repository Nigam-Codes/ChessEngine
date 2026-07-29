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
import { bestMove, moveToString } from "./engine.js";
import { lossFor } from "./coach.js";

const sameMove = (a, b) =>
  a.fromR === b.fromR && a.fromC === b.fromC && a.toR === b.toR && a.toC === b.toC;

/**
 * Score one played move against the best move in the same position.
 * Shared by live coaching and the batch review so both grade identically.
 */
function gradePly(board, color, played, depth, ctx) {
  const analysis = bestMove(board, color, depth, ctx);
  const match = analysis.allMoves.find((m) => sameMove(m.move, played));
  return {
    played,
    best: analysis.move,
    bestScore: analysis.score,
    playedScore: match ? match.score : null,
  };
}

self.onmessage = (event) => {
  const msg = event.data;

  if (msg.type === "hint") {
    self.postMessage({
      type: "hint",
      result: bestMove(msg.board, msg.color, msg.depth, msg.ctx),
    });
    return;
  }

  // Batch post-game analysis: grade every ply, reporting progress as it goes
  // so a long game can show a progress bar instead of freezing silently.
  if (msg.type === "review") {
    const grades = [];
    msg.plies.forEach((ply, i) => {
      const g = gradePly(ply.board, ply.color, ply.played, msg.depth, ply.ctx);
      if (g.playedScore != null && g.best) {
        grades.push({
          ply: i,
          color: ply.color,
          loss: lossFor(g.bestScore, g.playedScore, ply.color),
          playedStr: moveToString(ply.played),
          bestStr: moveToString(g.best),
          playedScore: g.playedScore,
          bestScore: g.bestScore,
        });
      }
      self.postMessage({ type: "review-progress", done: i + 1, total: msg.plies.length });
    });
    self.postMessage({ type: "review-done", grades });
    return;
  }

  let coach = null;
  if (msg.coach) {
    coach = gradePly(
      msg.coach.board, msg.coach.color, msg.coach.played, msg.coach.depth, msg.coach.ctx
    );
  }

  let reply = bestMove(msg.board, msg.color, msg.depth, msg.ctx);

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
