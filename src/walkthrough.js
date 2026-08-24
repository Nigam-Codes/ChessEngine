/**
 * walkthrough.js — a guided, move-by-move post-mortem of a finished game.
 *
 * The design rule here is that nothing is invented. Every sentence traces back
 * to something already computed: the review's centipawn loss per ply, and the
 * same `threatReport` the live coach uses to describe a position. Where the
 * engine can't say *why* a move was bad in tactical terms, the walkthrough
 * says exactly that instead of inventing a reason — a plausible-sounding wrong
 * explanation is worse for a learner than an honest "this one is positional".
 *
 * "If needed" is load-bearing: a game where nothing went wrong produces no
 * steps at all, and the UI says so, rather than padding a walkthrough with
 * moves that were fine.
 */

import { applyMove, inCheck, opposite, squareName, WHITE } from "./engine.js";
import { threatReport, verdictForLoss, PIECE_NAMES } from "./coach.js";

/** Buckets worth stopping on. "good" and "best" moves teach nothing here. */
const WORTH_STOPPING = new Set(["inaccuracy", "mistake", "blunder"]);

const pawns = (cp) => (Math.abs(cp) / 100).toFixed(1);

/**
 * Describe what a move *does*, in the position it is played in. Used for the
 * move that was better, so the advice is concrete rather than "play Nc3".
 */
function describeMove(board, move, mover) {
  if (!move) return null;
  if (move.castle) return "castles the king into safety";
  const after = applyMove(board, move);
  if (inCheck(after, opposite(mover))) {
    return move.captured
      ? `takes the ${PIECE_NAMES[move.captured[1]]} on ${squareName(move.toR, move.toC)} with check`
      : "gives check, which forces the reply";
  }
  if (move.captured) {
    return `wins the ${PIECE_NAMES[move.captured[1]]} on ${squareName(move.toR, move.toC)}`;
  }
  if (move.promotion) return "promotes the pawn";
  const home = mover === WHITE ? 7 : 0;
  if (move.fromR === home && (move.piece[1] === "n" || move.piece[1] === "b")) {
    return "brings a new piece into the game";
  }
  return `moves the ${PIECE_NAMES[move.piece[1]]} to ${squareName(move.toR, move.toC)}`;
}

/**
 * Build the steps.
 *
 * `grades` is the review output (one entry per graded ply). `color` limits the
 * walkthrough to one player's mistakes, which is what you want against the
 * engine; pass null in hot-seat to walk the whole game.
 */
export function buildWalkthrough({
  plyLog = [],
  grades = null,
  evalHistory = [],
  color = null,
  max = 8,
}) {
  if (!grades || grades.length === 0) return [];

  const mine = color ? grades.filter((g) => g.color === color) : grades;
  const notable = mine
    .filter((g) => WORTH_STOPPING.has(verdictForLoss(g.loss).bucket))
    .sort((a, b) => b.loss - a.loss)
    .slice(0, max)
    // Back into game order: a walkthrough that jumps about is not a story.
    .sort((a, b) => a.ply - b.ply);

  return notable.map((g) => step(g, plyLog, evalHistory));
}

function step(grade, plyLog, evalHistory) {
  const ply = plyLog[grade.ply];
  const { verdict, bucket } = verdictForLoss(grade.loss);
  const moveNumber = Math.floor(grade.ply / 2) + 1;
  const mover = grade.color;

  const base = {
    ply: grade.ply,
    moveNumber,
    color: mover,
    moveStr: grade.playedStr,
    bestStr: grade.bestStr,
    verdict,
    bucket,
    loss: grade.loss,
    headline: `Move ${moveNumber}${mover === WHITE ? "" : "…"} — ${verdict}`,
    points: [],
    arrows: [],
  };

  // Without the position we can still report the grade, just not explain it.
  if (!ply) {
    base.points.push(`${grade.playedStr} gave up ${pawns(grade.loss)} pawns.`);
    return base;
  }

  const before = ply.board;
  const after = applyMove(before, ply.played);

  // What is wrong with the position the move produced. These come from the
  // same detector the live coach uses, so the wording matches what you were
  // told during the game.
  const threats = threatReport(after, mover);
  base.points.push(...threats.warnings.slice(0, 2));

  if (threats.warnings.length === 0) {
    base.points.push(
      `Nothing is hanging — this one is positional. The engine simply rates its own move ${pawns(grade.loss)} pawns better.`
    );
  } else {
    base.points.push(`That cost about ${pawns(grade.loss)} pawns.`);
  }

  // The move that was better, and what it actually does.
  const best = grade.best;
  if (best) {
    const does = describeMove(before, best, mover);
    base.points.push(`Better was ${grade.bestStr} — it ${does}.`);
    base.arrows.push({ from: [best.fromR, best.fromC], to: [best.toR, best.toC], color: "green" });
  } else if (grade.bestStr) {
    base.points.push(`Better was ${grade.bestStr}.`);
  }

  base.arrows.push({
    from: [ply.played.fromR, ply.played.fromC],
    to: [ply.played.toR, ply.played.toC],
    color: "red",
  });

  // The swing, when the review recorded one either side of this ply.
  const swing = evalHistory[grade.ply] != null && evalHistory[grade.ply - 1] != null
    ? evalHistory[grade.ply] - evalHistory[grade.ply - 1]
    : null;
  if (swing != null && Math.abs(swing) >= 150) {
    base.swing = swing;
  }

  return base;
}
