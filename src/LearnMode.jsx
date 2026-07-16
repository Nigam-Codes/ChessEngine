import React, { useMemo, useState } from "react";
import { WHITE, BLACK, legalMoves, applyMove, cloneBoard, squareName } from "./engine.js";
import { GLYPHS } from "./MiniBoard.jsx";
import ArrowLayer from "./Arrows.jsx";
import { DRILLS } from "./drills.js";

/**
 * Learn mode — "select and play" tutorials. Each drill puts a tactic on a
 * real board: you find and play the key move yourself (you're always
 * White here), a scripted opponent replies, and every step explains what
 * just happened. Wrong tries get feedback instead of a lost game.
 */
export default function LearnMode() {
  const [drillIndex, setDrillIndex] = useState(0);
  const drill = DRILLS[drillIndex];
  const [board, setBoard] = useState(() => cloneBoard(drill.position));
  const [stepIndex, setStepIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [feedback, setFeedback] = useState(null); // { tone: "good" | "bad", text }
  const [hintShown, setHintShown] = useState(false);

  const done = stepIndex >= drill.steps.length;
  const step = done ? null : drill.steps[stepIndex];

  const loadDrill = (i) => {
    setDrillIndex(i);
    setBoard(cloneBoard(DRILLS[i].position));
    setStepIndex(0);
    setSelected(null);
    setLastMove(null);
    setFeedback(null);
    setHintShown(false);
  };

  const targets = useMemo(() => {
    if (!selected || done) return [];
    return legalMoves(board, WHITE).filter(
      (m) => m.fromR === selected.r && m.fromC === selected.c
    );
  }, [board, selected, done]);

  const handleClick = (r, c) => {
    if (done) return;
    const move = targets.find((m) => m.toR === r && m.toC === c);
    if (move) {
      const correct = step.accept.some(
        (a) =>
          a.from[0] === move.fromR && a.from[1] === move.fromC &&
          a.to[0] === move.toR && a.to[1] === move.toC
      );
      if (!correct) {
        const trap = (step.traps || []).find(
          (t) => t.to[0] === move.toR && t.to[1] === move.toC
        );
        setFeedback({
          tone: "bad",
          text: trap
            ? trap.text
            : "Not quite — that lets the chance slip. Look again, or press Hint.",
        });
        setSelected(null);
        return;
      }
      // Correct: play it, then the scripted reply.
      let next = applyMove(board, move);
      let last = move;
      if (step.reply) {
        const reply = legalMoves(next, BLACK).find(
          (m) =>
            m.fromR === step.reply.from[0] && m.fromC === step.reply.from[1] &&
            m.toR === step.reply.to[0] && m.toC === step.reply.to[1]
        );
        if (reply) {
          next = applyMove(next, reply);
          last = reply;
        }
      }
      const isLastStep = stepIndex + 1 >= drill.steps.length;
      setBoard(next);
      setLastMove(last);
      setSelected(null);
      setHintShown(false);
      setStepIndex(stepIndex + 1);
      setFeedback({
        tone: "good",
        text: step.explain + (isLastStep && drill.outro ? ` ${drill.outro}` : ""),
      });
      return;
    }
    const piece = board[r][c];
    if (piece && piece[0] === WHITE) {
      setSelected(selected && selected.r === r && selected.c === c ? null : { r, c });
    } else {
      setSelected(null);
    }
  };

  const arrows =
    hintShown && step && step.hint && step.hint.arrow
      ? [{ ...step.hint.arrow, color: "green" }]
      : [];

  return (
    <section className="learn" aria-label="Learn mode">
      <div className="drill-nav" role="tablist" aria-label="Drills">
        {DRILLS.map((d, i) => (
          <button
            key={d.id}
            className={"chip" + (i === drillIndex ? " chip-active" : "")}
            onClick={() => loadDrill(i)}
            role="tab"
            aria-selected={i === drillIndex}
          >
            {i + 1}. {d.title}
          </button>
        ))}
      </div>

      <div className="learn-layout">
        <div className="board-column">
          <div className="board" role="grid" aria-label="Drill board, you play White">
            {board.map((row, r) =>
              row.map((piece, c) => {
                const dark = (r + c) % 2 === 1;
                const isSelected = selected && selected.r === r && selected.c === c;
                const isTarget = targets.some((m) => m.toR === r && m.toC === c);
                const isLast =
                  lastMove &&
                  ((lastMove.fromR === r && lastMove.fromC === c) ||
                    (lastMove.toR === r && lastMove.toC === c));
                const classes = [
                  "square",
                  dark ? "dark" : "light",
                  isSelected ? "selected" : "",
                  isLast ? "last-move" : "",
                ].join(" ");
                return (
                  <button
                    key={`${r}-${c}`}
                    className={classes}
                    onClick={() => handleClick(r, c)}
                    aria-label={
                      squareName(r, c) +
                      (piece ? `, ${piece[0] === "w" ? "white" : "black"} ${piece[1]}` : ", empty")
                    }
                  >
                    {piece && (
                      <span className={"piece " + (piece[0] === "w" ? "white-piece" : "black-piece")}>
                        {GLYPHS[piece]}
                      </span>
                    )}
                    {isTarget && (
                      <span className={"dot" + (piece ? " dot-capture" : "")} aria-hidden="true" />
                    )}
                    {c === 0 && <span className="coord coord-rank" aria-hidden="true">{8 - r}</span>}
                    {r === 7 && <span className="coord coord-file" aria-hidden="true">{"abcdefgh"[c]}</span>}
                  </button>
                );
              })
            )}
            <ArrowLayer arrows={arrows} />
          </div>
        </div>

        <aside className="panel-column">
          <section className="panel" aria-label="Drill instructions">
            <h2>
              {drill.title}{" "}
              <span className={"drill-tag " + (drill.tactic === "Offense" ? "tag-offense" : "tag-defense")}>
                {drill.tactic}
              </span>
            </h2>
            <p className="muted">{drill.intro}</p>

            {!done && (
              <p className="drill-task">
                <strong>Step {stepIndex + 1} of {drill.steps.length}:</strong> {step.task}
              </p>
            )}
            {done && (
              <p className="drill-task drill-done" role="status">
                ✔ Drill complete!
                {drillIndex < DRILLS.length - 1 && " Try the next one."}
              </p>
            )}

            {feedback && (
              <p
                className={"drill-feedback " + (feedback.tone === "good" ? "feedback-good" : "feedback-bad")}
                role="status"
                aria-live="polite"
              >
                {feedback.text}
              </p>
            )}
            {hintShown && step && step.hint && (
              <p className="drill-feedback feedback-hint">{step.hint.text}</p>
            )}

            <div className="drill-buttons">
              <button className="reset" onClick={() => setHintShown(true)} disabled={done || hintShown}>
                Hint
              </button>
              <button className="reset" onClick={() => loadDrill(drillIndex)}>
                Restart drill
              </button>
              <button
                className="reset"
                onClick={() => loadDrill(drillIndex + 1)}
                disabled={drillIndex >= DRILLS.length - 1}
              >
                Next drill →
              </button>
            </div>
          </section>

          <section className="panel" aria-label="How Learn mode works">
            <h2>How this works</h2>
            <p className="muted small">
              You play White in every drill. Click a piece, then a highlighted
              square, and try to find the tactic yourself. Wrong tries are
              explained, not punished — and the Hint button draws the answer
              as a green arrow.
            </p>
          </section>
        </aside>
      </div>
    </section>
  );
}
