import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WHITE,
  BLACK,
  initialBoard,
  legalMoves,
  applyMove,
  evaluate,
  getGameStatus,
  moveToString,
  squareName,
} from "./engine.js";

const GLYPHS = {
  wk: "♚", wq: "♛", wr: "♜", wb: "♝", wn: "♞", wp: "♟",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

const STRENGTH_LABELS = ["Beginner", "Casual", "Club", "Sharp", "Fierce", "Ruthless"];

function statusText(status, turn, thinking) {
  if (status === "checkmate") {
    return turn === BLACK ? "Checkmate — you win!" : "Checkmate — the engine wins.";
  }
  if (status === "stalemate") return "Stalemate — draw.";
  if (thinking) return "Engine is thinking…";
  if (status === "check") return "Check! Your move.";
  return "Your move.";
}

/** Format centipawns as pawns, e.g. +1.25 / −0.40, with mate detection. */
function formatScore(cp) {
  if (cp == null) return "—";
  if (cp > 90000) return "mate for White";
  if (cp < -90000) return "mate for Black";
  const pawns = cp / 100;
  return (pawns > 0 ? "+" : "") + pawns.toFixed(2);
}

export default function ChessEngineLab() {
  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState(WHITE);
  const [selected, setSelected] = useState(null); // { r, c } or null
  const [lastMove, setLastMove] = useState(null);
  const [history, setHistory] = useState([]); // notation strings, in order
  const [thinking, setThinking] = useState(false);
  const [depth, setDepth] = useState(3);
  const [status, setStatus] = useState("playing");
  const [telemetry, setTelemetry] = useState(null); // last engine search result

  const workerRef = useRef(null);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const boardRef = useRef(board);
  boardRef.current = board;

  const makeWorker = useCallback(() => {
    const worker = new Worker(new URL("./engineWorker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const result = event.data;
      setThinking(false);
      setTelemetry(result);
      if (!result.move) return;
      const next = applyMove(boardRef.current, result.move);
      const newStatus = getGameStatus(next, WHITE);
      setBoard(next);
      setStatus(newStatus);
      setLastMove(result.move);
      setTurn(WHITE);
      setHistory((h) => [
        ...h,
        moveToString(result.move) +
          (newStatus === "checkmate" ? "#" : newStatus === "check" ? "+" : ""),
      ]);
    };
    return worker;
  }, []);

  useEffect(() => {
    workerRef.current = makeWorker();
    return () => workerRef.current?.terminate();
  }, [makeWorker]);

  const startEngine = useCallback((position) => {
    setThinking(true);
    workerRef.current.postMessage({
      board: position,
      color: BLACK,
      depth: depthRef.current,
    });
  }, []);

  // Legal moves for the currently selected piece.
  const targets = useMemo(() => {
    if (!selected) return [];
    return legalMoves(board, WHITE).filter(
      (m) => m.fromR === selected.r && m.fromC === selected.c
    );
  }, [board, selected]);

  const gameOver = status === "checkmate" || status === "stalemate";

  const handleSquareClick = (r, c) => {
    if (thinking || gameOver || turn !== WHITE) return;

    const move = targets.find((m) => m.toR === r && m.toC === c);
    if (move) {
      const next = applyMove(board, move);
      const newStatus = getGameStatus(next, BLACK);
      setBoard(next);
      setSelected(null);
      setLastMove(move);
      setStatus(newStatus);
      setHistory((h) => [
        ...h,
        moveToString(move) +
          (newStatus === "checkmate" ? "#" : newStatus === "check" ? "+" : ""),
      ]);
      if (newStatus === "checkmate" || newStatus === "stalemate") return;
      setTurn(BLACK);
      startEngine(next);
      return;
    }

    const piece = board[r][c];
    if (piece && piece[0] === WHITE) {
      setSelected(selected && selected.r === r && selected.c === c ? null : { r, c });
    } else {
      setSelected(null);
    }
  };

  const reset = () => {
    // A search may be mid-flight; kill the worker so its result never lands.
    workerRef.current?.terminate();
    workerRef.current = makeWorker();
    setBoard(initialBoard());
    setTurn(WHITE);
    setSelected(null);
    setLastMove(null);
    setHistory([]);
    setThinking(false);
    setStatus("playing");
    setTelemetry(null);
  };

  // Static evaluation of the position on the board right now.
  const staticEval = useMemo(() => evaluate(board), [board]);
  // Eval bar: 50% is equal; each pawn of advantage shifts it ~5%.
  const whitePct = Math.max(3, Math.min(97, 50 + staticEval / 20));

  const moveRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({ n: i / 2 + 1, white: history[i], black: history[i + 1] });
    }
    return rows;
  }, [history]);

  return (
    <div className="lab">
      <header className="lab-header">
        <h1>Chess Engine Lab</h1>
        <p className="tagline">
          Play White against a minimax engine — and watch it think.
        </p>
      </header>

      <main className="layout">
        <section className="board-column" aria-label="Chess board">
          <div className={"status" + (status === "check" ? " status-check" : "")}
               role="status" aria-live="polite">
            {statusText(status, turn, thinking)}
            {thinking && <span className="spinner" aria-hidden="true" />}
          </div>

          <div className="board" role="grid" aria-label="Board, you play White">
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
                    onClick={() => handleSquareClick(r, c)}
                    aria-label={
                      squareName(r, c) + (piece ? `, ${piece[0] === "w" ? "white" : "black"} ${piece[1]}` : ", empty")
                    }
                  >
                    {piece && (
                      <span className={"piece " + (piece[0] === "w" ? "white-piece" : "black-piece")}>
                        {GLYPHS[piece]}
                      </span>
                    )}
                    {isTarget && <span className={"dot" + (piece ? " dot-capture" : "")} aria-hidden="true" />}
                    {c === 0 && <span className="coord coord-rank" aria-hidden="true">{8 - r}</span>}
                    {r === 7 && <span className="coord coord-file" aria-hidden="true">{"abcdefgh"[c]}</span>}
                  </button>
                );
              })
            )}
          </div>

          <div className="controls">
            <label className="strength">
              <span>
                Engine strength: <strong>{STRENGTH_LABELS[depth - 1]}</strong>{" "}
                <span className="muted">(depth {depth})</span>
              </span>
              <input
                type="range"
                min="1"
                max="6"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
                aria-label="Engine strength, search depth 1 to 6"
              />
            </label>
            <button className="reset" onClick={reset}>New game</button>
          </div>
        </section>

        <aside className="panel-column">
          <section className="panel" aria-label="Telemetry">
            <h2>Telemetry</h2>
            <div className="eval-bar" aria-label={`Evaluation ${formatScore(staticEval)} pawns`}>
              <div className="eval-white" style={{ width: `${whitePct}%` }} />
            </div>
            <div className="eval-number">
              Position evaluation: <strong>{formatScore(staticEval)}</strong>
              <span className="muted"> pawns (＋ favors White)</span>
            </div>
            <dl className="stats">
              <div>
                <dt>Positions examined</dt>
                <dd>{telemetry ? telemetry.stats.nodes.toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt>Branches pruned</dt>
                <dd>{telemetry ? telemetry.stats.pruned.toLocaleString() : "—"}</dd>
              </div>
              <div>
                <dt>Chosen-line score</dt>
                <dd>{telemetry ? formatScore(telemetry.score) : "—"}</dd>
              </div>
              <div>
                <dt>Depth reached</dt>
                <dd>{telemetry ? `${telemetry.depth} plies + quiescence` : "—"}</dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-label="Why this move">
            <h2>Why this move?</h2>
            {telemetry && telemetry.candidates.length > 0 ? (
              <ol className="candidates">
                {telemetry.candidates.slice(0, 3).map((cand, i) => (
                  <li key={i} className={i === 0 ? "chosen" : ""}>
                    <span className="cand-move">{moveToString(cand.move)}</span>
                    <span className="cand-score">{formatScore(cand.score)}</span>
                    {i === 0 && <span className="cand-tag">played</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">
                After the engine moves, its top three candidate moves and their
                scores appear here. Compare them with what you expected!
              </p>
            )}
          </section>

          <section className="panel" aria-label="Move list">
            <h2>Moves</h2>
            {moveRows.length === 0 ? (
              <p className="muted">No moves yet — you're White, go ahead.</p>
            ) : (
              <table className="move-list">
                <tbody>
                  {moveRows.map((row) => (
                    <tr key={row.n}>
                      <td className="move-num">{row.n}.</td>
                      <td>{row.white}</td>
                      <td>{row.black || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </aside>
      </main>

      <footer className="lab-footer">
        <h2>How the engine thinks</h2>
        <dl className="concepts">
          <div>
            <dt>Evaluation</dt>
            <dd>
              A number for "who's better": material (queen = 9 pawns…) plus
              piece-square tables that reward pieces for standing on good squares.
            </dd>
          </div>
          <div>
            <dt>Minimax</dt>
            <dd>
              The engine assumes both sides play their best reply: it picks the
              move that maximizes its score even after your strongest response.
            </dd>
          </div>
          <div>
            <dt>Alpha-beta pruning</dt>
            <dd>
              Once a line is proven worse than one already found, the rest of its
              branches are skipped — the same answer for a fraction of the work.
              That's the "branches pruned" counter.
            </dd>
          </div>
          <div>
            <dt>Quiescence search</dt>
            <dd>
              At the depth limit the engine keeps checking captures until the
              position is quiet, so it never grabs a defended pawn just because
              the recapture falls beyond its horizon.
            </dd>
          </div>
          <div>
            <dt>Depth</dt>
            <dd>
              How many half-moves the engine looks ahead. Each extra ply makes it
              markedly stronger — and slower. The strength slider is exactly this.
            </dd>
          </div>
        </dl>
      </footer>
    </div>
  );
}
