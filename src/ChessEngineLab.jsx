import React, { useCallback, useMemo, useEffect, useRef, useState } from "react";
import {
  WHITE,
  BLACK,
  opposite,
  initialBoard,
  legalMoves,
  applyMove,
  evaluate,
  getGameStatus,
  moveToString,
  squareName,
} from "./engine.js";
import LearnMode from "./LearnMode.jsx";
import { classifyMove, threatReport } from "./coach.js";
import { LESSONS } from "./lessons.js";
import MiniBoard, { GLYPHS } from "./MiniBoard.jsx";
import ArrowLayer from "./Arrows.jsx";
import {
  HABITS,
  analyzeMove,
  gradingEvents,
  loadHabitStats,
  saveHabitStats,
  clearHabitStats,
  emptyStats,
} from "./habits.js";

const STRENGTH_LABELS = ["Beginner", "Casual", "Club", "Sharp", "Fierce", "Ruthless"];

function statusText(status, turn, thinking, playerColor) {
  if (status === "checkmate") {
    // `turn` is the side that has no moves left.
    return turn !== playerColor ? "Checkmate — you win!" : "Checkmate — the engine wins.";
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
  const [mode, setMode] = useState("play"); // "play" | "learn"
  const [playerColor, setPlayerColor] = useState(WHITE);
  const [board, setBoard] = useState(initialBoard);
  const [turn, setTurn] = useState(WHITE);
  const [selected, setSelected] = useState(null); // { r, c } or null
  const [lastMove, setLastMove] = useState(null);
  const [history, setHistory] = useState([]); // notation strings, in order
  const [thinking, setThinking] = useState(false);
  const [depth, setDepth] = useState(3);
  const [status, setStatus] = useState("playing");
  const [telemetry, setTelemetry] = useState(null); // last engine search result
  // Teacher mode state.
  const [teacherMode, setTeacherMode] = useState(false);
  const [coachReport, setCoachReport] = useState(null); // grading of your last move
  const [threats, setThreats] = useState(null); // dangers after the engine's reply
  const [hint, setHint] = useState(null); // suggested move for you
  const [hintLoading, setHintLoading] = useState(false);
  const [lessonIndex, setLessonIndex] = useState(0);
  // Snapshots taken just before each of your moves, so Undo can rewind a
  // full move pair (your move + the engine's reply) in one click.
  const [past, setPast] = useState([]);
  // Habit tracker: lifetime stats (localStorage) and this game's counts.
  const [habitStats, setHabitStats] = useState(loadHabitStats);
  const [gameCounts, setGameCounts] = useState({});

  const workerRef = useRef(null);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const boardRef = useRef(board);
  boardRef.current = board;
  const playerColorRef = useRef(playerColor);
  playerColorRef.current = playerColor;
  // Your moves so far this game, for opening-habit detection.
  const yourMovesRef = useRef([]);

  const engineColor = opposite(playerColor);

  const recordHabitEvents = useCallback((events) => {
    if (!events || events.length === 0) return;
    setGameCounts((g) => {
      const next = { ...g };
      for (const id of events) next[id] = (next[id] || 0) + 1;
      return next;
    });
    setHabitStats((s) => {
      const next = { ...s, counts: { ...s.counts } };
      for (const id of events) next.counts[id] = (next.counts[id] || 0) + 1;
      saveHabitStats(next);
      return next;
    });
  }, []);

  const recordGameEnd = useCallback(() => {
    setHabitStats((s) => {
      const next = { ...s, games: s.games + 1 };
      saveHabitStats(next);
      return next;
    });
  }, []);

  // Grading quality shouldn't drop with an easy opponent, nor stall the
  // reply at high depths: analyze at depth 3-4 regardless of the slider.
  const coachDepth = Math.min(Math.max(depth, 3), 4);

  const makeWorker = useCallback(() => {
    const worker = new Worker(new URL("./engineWorker.js", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "hint") {
        setHintLoading(false);
        setHint(msg.result.move ? { move: msg.result.move, score: msg.result.score } : null);
        return;
      }
      const result = msg.reply;
      const pc = playerColorRef.current;
      setThinking(false);
      setTelemetry(result);
      if (msg.coach) {
        setCoachReport(msg.coach);
        if (msg.coach.playedScore != null && msg.coach.best) {
          const loss =
            pc === WHITE
              ? msg.coach.bestScore - msg.coach.playedScore
              : msg.coach.playedScore - msg.coach.bestScore;
          recordHabitEvents(gradingEvents(loss));
        }
      }
      if (!result.move) return;
      const next = applyMove(boardRef.current, result.move);
      const newStatus = getGameStatus(next, pc);
      if (newStatus === "checkmate" || newStatus === "stalemate") recordGameEnd();
      setBoard(next);
      setStatus(newStatus);
      setLastMove(result.move);
      setTurn(pc);
      setThreats(threatReport(next, pc));
      setHistory((h) => [
        ...h,
        moveToString(result.move) +
          (newStatus === "checkmate" ? "#" : newStatus === "check" ? "+" : ""),
      ]);
    };
    return worker;
  }, [recordHabitEvents, recordGameEnd]);

  useEffect(() => {
    workerRef.current = makeWorker();
    return () => workerRef.current?.terminate();
  }, [makeWorker]);

  // Legal moves for the currently selected piece.
  const targets = useMemo(() => {
    if (!selected) return [];
    return legalMoves(board, playerColor).filter(
      (m) => m.fromR === selected.r && m.fromC === selected.c
    );
  }, [board, selected, playerColor]);

  const gameOver = status === "checkmate" || status === "stalemate";

  const handleSquareClick = (r, c) => {
    if (thinking || gameOver || turn !== playerColor) return;

    const move = targets.find((m) => m.toR === r && m.toC === c);
    if (move) {
      setPast((p) => [
        ...p,
        {
          board, lastMove, telemetry, status, history, coachReport, threats,
          yourMoves: yourMovesRef.current,
        },
      ]);
      const next = applyMove(board, move);
      const newStatus = getGameStatus(next, engineColor);
      // Habit detection compares the position before and after your move.
      // Undone moves stay counted — the habit still happened.
      recordHabitEvents(
        analyzeMove({
          prevBoard: board,
          nextBoard: next,
          move,
          moveNumber: yourMovesRef.current.length + 1,
          previousMoves: yourMovesRef.current,
          color: playerColor,
        })
      );
      yourMovesRef.current = [...yourMovesRef.current, move];
      setBoard(next);
      setSelected(null);
      setLastMove(move);
      setStatus(newStatus);
      setHint(null);
      setCoachReport(null);
      setThreats(null);
      setHistory((h) => [
        ...h,
        moveToString(move) +
          (newStatus === "checkmate" ? "#" : newStatus === "check" ? "+" : ""),
      ]);
      if (newStatus === "checkmate" || newStatus === "stalemate") {
        recordGameEnd();
        return;
      }
      setTurn(engineColor);
      setThinking(true);
      workerRef.current.postMessage({
        type: "move",
        board: next,
        color: engineColor,
        depth: depthRef.current,
        // In teacher mode, also grade the move just played: analyze the
        // position it was played *in* (the pre-move board).
        coach: teacherMode
          ? { board, color: playerColor, depth: coachDepth, played: move }
          : null,
      });
      return;
    }

    const piece = board[r][c];
    if (piece && piece[0] === playerColor) {
      setSelected(selected && selected.r === r && selected.c === c ? null : { r, c });
    } else {
      setSelected(null);
    }
  };

  const requestHint = () => {
    if (thinking || hintLoading || gameOver || turn !== playerColor) return;
    setHintLoading(true);
    workerRef.current.postMessage({
      type: "hint",
      board,
      color: playerColor,
      depth: coachDepth,
    });
  };

  const undo = () => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    if (thinking) {
      // The engine is still searching a position we're abandoning.
      workerRef.current?.terminate();
      workerRef.current = makeWorker();
    }
    setPast((p) => p.slice(0, -1));
    setBoard(prev.board);
    setLastMove(prev.lastMove);
    setTelemetry(prev.telemetry);
    setStatus(prev.status);
    setHistory(prev.history);
    setCoachReport(prev.coachReport);
    setThreats(prev.threats);
    setHint(null);
    setHintLoading(false);
    setTurn(playerColor);
    setSelected(null);
    setThinking(false);
    yourMovesRef.current = prev.yourMoves;
  };

  /** Start a fresh game with you playing `color`. */
  const newGame = (color) => {
    // A search may be mid-flight; kill the worker so its result never lands.
    workerRef.current?.terminate();
    const worker = makeWorker();
    workerRef.current = worker;
    const fresh = initialBoard();
    setPlayerColor(color);
    playerColorRef.current = color;
    setBoard(fresh);
    boardRef.current = fresh;
    setTurn(WHITE); // chess always starts with White to move
    setSelected(null);
    setLastMove(null);
    setHistory([]);
    setStatus("playing");
    setTelemetry(null);
    setCoachReport(null);
    setThreats(null);
    setHint(null);
    setHintLoading(false);
    setPast([]);
    setGameCounts({});
    yourMovesRef.current = [];
    if (color === BLACK) {
      // You chose Black, so the engine opens the game as White.
      setThinking(true);
      worker.postMessage({
        type: "move",
        board: fresh,
        color: WHITE,
        depth: depthRef.current,
        coach: null,
      });
    } else {
      setThinking(false);
    }
  };

  const reset = () => newGame(playerColor);

  const resetHabits = () => {
    clearHabitStats();
    setHabitStats(emptyStats());
    setGameCounts({});
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

  // Turn the raw coach report into display-ready grading.
  const grading = useMemo(() => {
    if (!coachReport || coachReport.playedScore == null || !coachReport.best) return null;
    const { played, best, bestScore, playedScore } = coachReport;
    const isBest =
      played.fromR === best.fromR && played.fromC === best.fromC &&
      played.toR === best.toR && played.toC === best.toC;
    const graded = isBest
      ? { verdict: "Best move!", tone: "good" }
      : classifyMove(bestScore, playedScore, playerColor);
    return {
      ...graded,
      isBest,
      playedStr: moveToString(played),
      bestStr: moveToString(best),
      playedScore,
      bestScore,
    };
  }, [coachReport, playerColor]);

  const threatSquares = useMemo(() => {
    if (!teacherMode || !threats) return new Set();
    return new Set(threats.squares.map((s) => `${s.r}-${s.c}`));
  }, [teacherMode, threats]);

  const hintSquares = useMemo(() => {
    if (!teacherMode || !hint) return new Set();
    return new Set([
      `${hint.move.fromR}-${hint.move.fromC}`,
      `${hint.move.toR}-${hint.move.toC}`,
    ]);
  }, [teacherMode, hint]);

  // Arrows drawn on the live board in teacher mode: red = threats aimed at
  // you, green = the hint move, blue = the engine's last move.
  const boardArrows = useMemo(() => {
    if (!teacherMode) return [];
    const arrows = [];
    if (lastMove && lastMove.piece[0] === engineColor) {
      arrows.push({
        from: [lastMove.fromR, lastMove.fromC],
        to: [lastMove.toR, lastMove.toC],
        color: "blue",
      });
    }
    if (threats && threats.arrows) arrows.push(...threats.arrows);
    if (hint) {
      arrows.push({
        from: [hint.move.fromR, hint.move.fromC],
        to: [hint.move.toR, hint.move.toC],
        color: "green",
      });
    }
    // When the board is flipped for Black, arrow geometry flips with it.
    if (playerColor === BLACK) {
      return arrows.map((a) => ({
        ...a,
        from: [7 - a.from[0], 7 - a.from[1]],
        to: [7 - a.to[0], 7 - a.to[1]],
      }));
    }
    return arrows;
  }, [teacherMode, lastMove, threats, hint, engineColor, playerColor]);

  // Which bad habit needs the most work, for the "Focus" advice line.
  const worstHabit = useMemo(() => {
    let worst = null;
    for (const h of HABITS) {
      if (h.kind !== "avoid") continue;
      const count = habitStats.counts[h.id] || 0;
      if (count > 0 && (!worst || count > (habitStats.counts[worst.id] || 0))) worst = h;
    }
    return worst;
  }, [habitStats]);

  const lesson = LESSONS[lessonIndex];

  return (
    <div className="lab">
      <header className="lab-header">
        <h1>Chess Engine Lab</h1>
        <p className="tagline">
          Pick a side, play a minimax engine — and watch it think.
        </p>
      </header>

      <div className="mode-tabs" role="tablist" aria-label="Mode">
        <button
          className={"mode-tab" + (mode === "play" ? " active" : "")}
          role="tab"
          aria-selected={mode === "play"}
          onClick={() => setMode("play")}
        >
          ♟ Play
        </button>
        <button
          className={"mode-tab" + (mode === "learn" ? " active" : "")}
          role="tab"
          aria-selected={mode === "learn"}
          onClick={() => setMode("learn")}
        >
          🎓 Learn
        </button>
      </div>

      {mode === "learn" && <LearnMode />}

      {mode === "play" && (
      <>
      <main className="layout">
        <section className="board-column" aria-label="Chess board">
          <div className={"status" + (status === "check" ? " status-check" : "")}
               role="status" aria-live="polite">
            {statusText(status, turn, thinking, playerColor)}
            {thinking && <span className="spinner" aria-hidden="true" />}
          </div>

          <div
            className="board"
            role="grid"
            aria-label={`Board, you play ${playerColor === WHITE ? "White" : "Black"}`}
          >
            {Array.from({ length: 8 }, (_, dr) =>
              Array.from({ length: 8 }, (_, dc) => {
                // Playing Black flips the board so your pieces start at the bottom.
                const r = playerColor === WHITE ? dr : 7 - dr;
                const c = playerColor === WHITE ? dc : 7 - dc;
                const piece = board[r][c];
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
                  threatSquares.has(`${r}-${c}`) ? "threat" : "",
                  hintSquares.has(`${r}-${c}`) ? "hint" : "",
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
                    {dc === 0 && <span className="coord coord-rank" aria-hidden="true">{8 - r}</span>}
                    {dr === 7 && <span className="coord coord-file" aria-hidden="true">{"abcdefgh"[c]}</span>}
                  </button>
                );
              })
            )}
            <ArrowLayer arrows={boardArrows} />
          </div>

          {teacherMode && boardArrows.length > 0 && (
            <p className="arrow-legend">
              Arrows: <span className="lg lg-red">red</span> = threat against you
              {" · "}<span className="lg lg-green">green</span> = hint for you
              {" · "}<span className="lg lg-blue">blue</span> = engine's last move
            </p>
          )}

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
            <button
              className="reset"
              onClick={undo}
              disabled={past.length === 0}
              title="Take back your last move and the engine's reply"
            >
              Undo move
            </button>
            <button className="reset" onClick={reset}>New game</button>
            <div className="side-picker" role="group" aria-label="Choose your side (starts a new game)">
              <span className="muted small">You play</span>
              <button
                className={"chip" + (playerColor === WHITE ? " chip-active" : "")}
                onClick={() => playerColor !== WHITE && newGame(WHITE)}
                aria-pressed={playerColor === WHITE}
                title="Play White (starts a new game)"
              >
                ♔ White
              </button>
              <button
                className={"chip" + (playerColor === BLACK ? " chip-active" : "")}
                onClick={() => playerColor !== BLACK && newGame(BLACK)}
                aria-pressed={playerColor === BLACK}
                title="Play Black (starts a new game)"
              >
                ♚ Black
              </button>
            </div>
            <label className="teacher-toggle">
              <input
                type="checkbox"
                checked={teacherMode}
                onChange={(e) => setTeacherMode(e.target.checked)}
              />
              <span>Teacher mode</span>
            </label>
          </div>
        </section>

        <aside className="panel-column">
          {teacherMode && (
            <section className="panel panel-coach" aria-label="Coach">
              <h2>Coach</h2>
              {grading ? (
                <div className="coach-grade">
                  <span className={`badge badge-${grading.tone}`}>{grading.verdict}</span>
                  <p>
                    You played <strong>{grading.playedStr}</strong>{" "}
                    ({formatScore(grading.playedScore)}).
                    {!grading.isBest && (
                      <>
                        {" "}Coach preferred <strong>{grading.bestStr}</strong>{" "}
                        ({formatScore(grading.bestScore)}).
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <p className="muted">
                  Make a move and I'll grade it against the engine's best choice
                  for you.
                </p>
              )}
              {threats && threats.warnings.length > 0 && (
                <ul className="threat-list">
                  {threats.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {threats && threats.warnings.length === 0 && grading && (
                <p className="muted">No immediate tactics against you. Keep developing.</p>
              )}
              <div className="hint-row">
                <button
                  className="reset"
                  onClick={requestHint}
                  disabled={thinking || hintLoading || gameOver || turn !== WHITE}
                >
                  {hintLoading ? "Analyzing…" : "Hint"}
                </button>
                {hint && (
                  <span className="hint-text">
                    Try <strong>{moveToString(hint.move)}</strong> ({formatScore(hint.score)})
                  </span>
                )}
              </div>
            </section>
          )}

          <section className="panel" aria-label="Habit tracker">
            <h2>Habit tracker</h2>
            <p className="muted small">
              Counted from your moves — this game / all time
              {habitStats.games > 0 && ` · ${habitStats.games} game${habitStats.games === 1 ? "" : "s"} finished`}.
            </p>
            <div className="habit-group">
              <h3>Habits to break</h3>
              <ul className="habit-list">
                {HABITS.filter((h) => h.kind === "avoid").map((h) => (
                  <li key={h.id} className={h.teacherOnly && !teacherMode ? "habit-dim" : ""}>
                    <span>{h.label}</span>
                    <span className="habit-counts">
                      {gameCounts[h.id] || 0} / {habitStats.counts[h.id] || 0}
                    </span>
                  </li>
                ))}
              </ul>
              <h3>Habits to build</h3>
              <ul className="habit-list">
                {HABITS.filter((h) => h.kind === "build").map((h) => (
                  <li key={h.id} className={h.teacherOnly && !teacherMode ? "habit-dim" : ""}>
                    <span>{h.label}</span>
                    <span className="habit-counts">
                      {gameCounts[h.id] || 0} / {habitStats.counts[h.id] || 0}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {worstHabit && (
              <p className="habit-advice">
                <strong>Focus:</strong> {worstHabit.advice}
              </p>
            )}
            {!teacherMode && (
              <p className="muted small">
                Graded habits are only tracked while Teacher mode is on.
              </p>
            )}
            <button className="reset" onClick={resetHabits}>
              Reset stats
            </button>
          </section>

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
              <p className="muted">
                {playerColor === WHITE
                  ? "No moves yet — you're White, go ahead."
                  : "No moves yet — the engine opens as White."}
              </p>
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

      {teacherMode && (
        <section className="school" aria-label="Chess school">
          <h2>Chess school</h2>
          <div className="school-nav" role="tablist" aria-label="Lessons">
            {LESSONS.map((l, i) => (
              <button
                key={l.id}
                className={"chip" + (i === lessonIndex ? " chip-active" : "")}
                onClick={() => setLessonIndex(i)}
                role="tab"
                aria-selected={i === lessonIndex}
              >
                {i + 1}. {l.title}
              </button>
            ))}
          </div>
          <div className="school-lesson">
            <MiniBoard
              position={lesson.position}
              highlights={lesson.highlights}
              arrows={lesson.arrows}
            />
            <div className="school-text">
              <h3>{lesson.title}</h3>
              <p>{lesson.body}</p>
              <div className="school-pager">
                <button
                  className="reset"
                  onClick={() => setLessonIndex((i) => Math.max(0, i - 1))}
                  disabled={lessonIndex === 0}
                >
                  ← Previous
                </button>
                <span className="muted">
                  {lessonIndex + 1} / {LESSONS.length}
                </span>
                <button
                  className="reset"
                  onClick={() => setLessonIndex((i) => Math.min(LESSONS.length - 1, i + 1))}
                  disabled={lessonIndex === LESSONS.length - 1}
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      </>
      )}

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
