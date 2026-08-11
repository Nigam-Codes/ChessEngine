/**
 * share.js — turning a finished game into a picture you can keep.
 *
 * Split in two on purpose. `cardModel` is a pure function from what the app
 * already knows to a plain object, so everything that could be *wrong* about
 * the card — which move was decisive, what the curve should look like, what
 * advice to give — is testable in Node. `drawCard` then only paints, which is
 * the part a test could never meaningfully assert anyway.
 *
 * Drawn on a canvas rather than screenshotted, because the app has no
 * dependencies and a DOM-to-image library would be a large thing to add for
 * one feature.
 */

import { verdictForLoss } from "./coach.js";
import { criticalMoments, summarize } from "./review.js";
import { moveToString } from "./engine.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630; // the standard social preview ratio

/**
 * Centipawns to a win probability in 0..1, the standard logistic used for
 * every eval bar you have ever seen.
 *
 * Centipawns are the wrong axis for a picture: a graph that runs to plus
 * thirty-eight pawns is unreadable, and the difference between +8 and +12 is
 * meaningless to a player because both are simply winning. The logistic
 * squashes decisive positions into a flat band near 0 and 1 and spends its
 * resolution where games are actually decided.
 */
export function winProbability(cp) {
  if (!Number.isFinite(cp)) return 0.5;
  return 1 / (1 + Math.pow(10, -cp / 400));
}

const PALETTE = {
  bg: "#14161c",
  panel: "#1d212b",
  text: "#e8eaf0",
  muted: "#9aa1b3",
  accent: "#6ea8fe",
};

/**
 * Everything the card shows, as plain data.
 *
 * `grades` is the per-ply review when there is one; without it the card simply
 * omits accuracy and falls back to the evaluation swing for the decisive move,
 * which needs no analysis at all.
 */
export function cardModel({
  result,
  evalHistory = [],
  plyLog = [],
  grades = null,
  opening = null,
  playerColor = "w",
  vsHuman = false,
}) {
  const curve = evalHistory.map(winProbability);

  return {
    headline: result?.headline || "Game over",
    how: result?.how || "",
    opening: opening ? `${opening.name} (${opening.eco})` : null,
    moves: Math.ceil(plyLog.length / 2),
    curve,
    accuracy: accuracyFor(grades, playerColor, vsHuman),
    decisive: decisiveMove(evalHistory, plyLog, grades),
    advice: adviceFrom(grades, plyLog, playerColor, vsHuman),
  };
}

function accuracyFor(grades, playerColor, vsHuman) {
  if (!grades || grades.length === 0) return null;
  // Against the engine only your own accuracy is interesting; in hot-seat the
  // card belongs to the game rather than to either player.
  const summary = summarize(grades, vsHuman ? null : playerColor);
  return summary.accuracy;
}

/**
 * The move the game turned on.
 *
 * With a review, that is the biggest centipawn loss — the move whose
 * alternative was most clearly better. Without one, fall back to the largest
 * swing in the evaluation, which `criticalMoments` already finds and which
 * needs no search at all.
 */
function decisiveMove(evalHistory, plyLog, grades) {
  if (grades && grades.length) {
    const worst = grades.reduce((a, b) => (b.loss > a.loss ? b : a));
    if (worst.loss > 60) {
      return {
        move: worst.playedStr,
        better: worst.bestStr,
        moveNumber: Math.floor(worst.ply / 2) + 1,
        color: worst.color,
        verdict: verdictForLoss(worst.loss).verdict,
        loss: worst.loss,
      };
    }
    return null; // nobody blundered; saying otherwise would be inventing one
  }

  const [biggest] = criticalMoments(evalHistory, 1);
  if (!biggest) return null;
  const ply = plyLog[biggest.ply - 1];
  if (!ply) return null;
  return {
    move: moveToString(ply.played, ply.board),
    better: null,
    moveNumber: Math.floor((biggest.ply - 1) / 2) + 1,
    color: ply.color,
    verdict: "Turning point",
    loss: Math.abs(biggest.delta),
  };
}

/** One line on what to work on, drawn from the review's worst bucket. */
function adviceFrom(grades, plyLog, playerColor, vsHuman) {
  if (!grades || grades.length === 0) {
    return "Play with Teacher mode on for accuracy and move grades.";
  }
  const mine = vsHuman ? grades : grades.filter((g) => g.color === playerColor);
  if (mine.length === 0) return "Not enough graded moves to judge.";
  const blunders = mine.filter((g) => verdictForLoss(g.loss).bucket === "blunder").length;
  const mistakes = mine.filter((g) => verdictForLoss(g.loss).bucket === "mistake").length;
  if (blunders > 0) {
    return `${blunders} blunder${blunders > 1 ? "s" : ""} — before releasing a piece, ask what can be taken.`;
  }
  if (mistakes > 0) {
    return `${mistakes} mistake${mistakes > 1 ? "s" : ""} — check every forcing reply before you commit.`;
  }
  return "No blunders. Keep hunting for the better square rather than the safe one.";
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Pinned rather than inherited: canvas text uses whatever the system has, and
// a webfont that has not loaded by the time the user clicks would silently
// change the layout.
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

/** Draw the whole card. `ctx` is a 2D context already scaled for the display. */
export function drawCard(ctx, model, { width = CARD_WIDTH, height = CARD_HEIGHT } = {}) {
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, width, height);

  const pad = 56;

  // --- Header -------------------------------------------------------------
  ctx.fillStyle = PALETTE.text;
  ctx.font = font(64, 700);
  ctx.textBaseline = "alphabetic";
  ctx.fillText(model.headline, pad, pad + 56);

  ctx.fillStyle = PALETTE.muted;
  ctx.font = font(28);
  const sub = [model.how, `${model.moves} moves`].filter(Boolean).join("  ·  ");
  ctx.fillText(sub, pad, pad + 100);

  if (model.opening) {
    ctx.fillStyle = PALETTE.accent;
    ctx.font = font(26, 600);
    ctx.fillText(model.opening, pad, pad + 142);
  }

  // Accuracy sits top-right, where a score belongs.
  if (model.accuracy != null) {
    ctx.textAlign = "right";
    ctx.fillStyle = PALETTE.muted;
    ctx.font = font(24);
    ctx.fillText("ACCURACY", width - pad, pad + 30);
    ctx.fillStyle = PALETTE.text;
    ctx.font = font(64, 700);
    ctx.fillText(`${model.accuracy}%`, width - pad, pad + 92);
    ctx.textAlign = "left";
  }

  // --- Win-probability graph ---------------------------------------------
  const gx = pad;
  const gy = 250;
  const gw = width - pad * 2;
  const gh = 200;

  ctx.fillStyle = PALETTE.panel;
  roundRect(ctx, gx, gy, gw, gh, 12);
  ctx.fill();

  // The 50% line: the thing every point on the curve is read against.
  ctx.strokeStyle = "#4a5266";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(gx, gy + gh / 2);
  ctx.lineTo(gx + gw, gy + gh / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const points = model.curve.map((p, i) => ({
    x: gx + (model.curve.length === 1 ? gw / 2 : (i / (model.curve.length - 1)) * gw),
    // 1.0 (White winning) is the top of the box.
    y: gy + gh - p * gh,
  }));

  if (points.length > 1) {
    // Fill under the curve so which side is ahead reads at a glance.
    ctx.beginPath();
    ctx.moveTo(points[0].x, gy + gh);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(points[points.length - 1].x, gy + gh);
    ctx.closePath();
    ctx.fillStyle = "rgba(110, 168, 254, 0.18)";
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  ctx.fillStyle = PALETTE.muted;
  ctx.font = font(20);
  ctx.fillText("White winning", gx + 14, gy + 30);
  ctx.fillText("Black winning", gx + 14, gy + gh - 16);

  // --- Decisive move and advice -------------------------------------------
  let y = gy + gh + 62;
  if (model.decisive) {
    const d = model.decisive;
    ctx.fillStyle = PALETTE.muted;
    ctx.font = font(22, 600);
    ctx.fillText("THE MOVE IT TURNED ON", pad, y);
    ctx.fillStyle = PALETTE.text;
    ctx.font = font(34, 700);
    const who = d.color === "w" ? "" : "…";
    const better = d.better ? `   ·   better was ${d.better}` : "";
    ctx.fillText(`${d.moveNumber}. ${who}${d.move}${better}`, pad, y + 44);
    y += 92;
  }

  ctx.fillStyle = PALETTE.muted;
  ctx.font = font(24);
  ctx.fillText(model.advice, pad, y + 8);

  // --- Footer -------------------------------------------------------------
  ctx.fillStyle = "#5a6684";
  ctx.font = font(20, 600);
  ctx.textAlign = "right";
  ctx.fillText("Chess Engine Lab", width - pad, height - 32);
  ctx.textAlign = "left";
}
