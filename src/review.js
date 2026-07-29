/**
 * review.js — post-game analysis, per colour.
 *
 * Pure functions only: they take a list of graded plies (produced by the
 * worker's batch "review" pass) and turn them into the numbers and words the
 * report shows. Nothing here touches the DOM or localStorage, which is what
 * lets the 2-player coach report run without polluting the personal habit
 * profile.
 *
 * A "grade" is one ply as returned by the worker:
 *   { ply, color, loss, playedStr, bestStr, playedScore, bestScore }
 * where `loss` is centipawns given up, already from the mover's perspective.
 */

import { applyMove } from "./engine.js";
import { verdictForLoss } from "./coach.js";
import { HABITS, analyzeMove } from "./habits.js";

const EMPTY_COUNTS = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };

/**
 * Headline numbers for one colour: how many moves of each quality, the average
 * centipawn loss, and an accuracy percentage.
 *
 * Accuracy is a readable restatement of average loss, not a new measurement:
 * a perfect game is 100%, and every ~6 centipawns of average loss costs a
 * point. Pass color = null to summarize every grade (the vs-engine case,
 * where only one side is ever graded).
 */
export function summarize(grades, color = null) {
  const mine = color ? grades.filter((g) => g.color === color) : grades;
  const counts = { ...EMPTY_COUNTS };
  let totalLoss = 0;
  for (const g of mine) {
    counts[verdictForLoss(g.loss).bucket]++;
    totalLoss += Math.max(0, g.loss); // a "better than best" score is noise, not credit
  }
  const graded = mine.length;
  const avgLoss = graded ? totalLoss / graded : null;
  const accuracy =
    avgLoss == null ? null : Math.max(0, Math.min(100, Math.round(100 - avgLoss / 6)));
  return { counts, avgLoss, accuracy, graded };
}

/**
 * The moves that actually cost something, worst first — the heart of the
 * report. Anything graded "Good move" or better is left out: a review that
 * lists nine fine moves buries the one that lost the game.
 */
export function topMistakes(grades, color = null, n = 3) {
  return (color ? grades.filter((g) => g.color === color) : grades)
    .filter((g) => g.loss > 60)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, n)
    .map((g) => ({ ...g, ...verdictForLoss(g.loss), moveNumber: Math.floor(g.ply / 2) + 1 }));
}

/**
 * Behavioural patterns for one colour, replayed through the live habit
 * detector. `plyLog` entries are { board, played, color } captured before each
 * move was applied — the same shape the worker's review pass consumes — so
 * each ply can be re-examined exactly as it happened.
 *
 * Deliberately read-only: this never calls saveHabitStats, so reviewing a
 * hot-seat game leaves your personal lifetime stats untouched.
 */
export function habitReport(plyLog, color) {
  const counts = {};
  const previousMoves = [];
  for (const ply of plyLog) {
    if (ply.color !== color) continue;
    const events = analyzeMove({
      prevBoard: ply.board,
      nextBoard: applyMove(ply.board, ply.played),
      move: ply.played,
      moveNumber: previousMoves.length + 1,
      previousMoves,
      color,
    });
    for (const id of events) counts[id] = (counts[id] || 0) + 1;
    previousMoves.push(ply.played);
  }
  // Lessons are the habits worth breaking, most frequent first.
  const lessons = HABITS.filter((h) => h.kind === "avoid" && counts[h.id])
    .map((h) => ({ ...h, count: counts[h.id] }))
    .sort((a, b) => b.count - a.count);
  const strengths = HABITS.filter((h) => h.kind === "build" && counts[h.id])
    .map((h) => ({ ...h, count: counts[h.id] }))
    .sort((a, b) => b.count - a.count);
  return { counts, lessons, strengths };
}

/**
 * Where the evaluation moved most sharply — the moments a game turned.
 * `evalHistory` is the static evaluation after each ply, in centipawns.
 */
export function criticalMoments(evalHistory, n = 3) {
  const swings = [];
  for (let i = 1; i < evalHistory.length; i++) {
    swings.push({ ply: i, delta: evalHistory[i] - evalHistory[i - 1] });
  }
  return swings
    .filter((s) => Math.abs(s.delta) >= 150)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, n);
}
