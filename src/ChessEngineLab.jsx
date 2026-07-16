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
  inCheck,
} from "./engine.js";
import LearnMode from "./LearnMode.jsx";
import { classifyMove, threatReport, PIECE_NAMES } from "./coach.js";
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
// Beginners don't just search shallower — they also pick imperfect moves.
// Probability the engine plays a near-best candidate instead of the best.
const FUZZ_BY_DEPTH = [0, 0.6, 0.3, 0, 0, 0, 0];

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
  const [hint, setHint] = useState(null); // full analysis backing the hint ladder
  const [hintLevel, setHintLevel] = useState(0); // 0 = hidden … 4 = best move
  const [hintLoading, setHintLoading] = useState(false);
  const [lessonIndex, setLessonIndex] = useState(0);
  // Board display options.
  const [flipped, setFlipped] = useState(false);
  const [blindfold, setBlindfold] = useState(false);
  // User-drawn annotations (chess.com style): right-click-drag an arrow,
  // right-click a square to highlight it, left-click to clear everything.
  // The ✏️ Draw toggle lets touch screens draw with a plain drag.
  const [userArrows, setUserArrows] = useState([]); // board coords
  const [userHighlights, setUserHighlights] = useState([]); // "r-c" keys
  const [previewArrow, setPreviewArrow] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const drawStartRef = useRef(null);
  const boardElRef = useRef(null);
  // Game record for the post-game review.
  const [evalHistory, setEvalHistory] = useState([]); // static eval after each ply
  const [gradeLog, setGradeLog] = useState([]); // { moveStr, loss } per graded move
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
        setHint(msg.result.move ? msg.result : null);
        setHintLevel(msg.result.move ? 1 : 0);
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
          setGradeLog((g) => [...g, { moveStr: moveToString(msg.coach.played), loss }]);
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
      setEvalHistory((h) => [...h, evaluate(next)]);
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
    if (drawMode) return; // clicks draw, they don't move pieces
    // Any left click wipes the sketch, like on chess.com.
    if (userArrows.length || userHighlights.length) {
      setUserArrows([]);
      setUserHighlights([]);
    }
    if (thinking || gameOver || turn !== playerColor) return;

    const move = targets.find((m) => m.toR === r && m.toC === c);
    if (move) {
      setPast((p) => [
        ...p,
        {
          board, lastMove, telemetry, status, history, coachReport, threats,
          evalHistory, gradeLog,
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
      setHintLevel(0);
      setCoachReport(null);
      setThreats(null);
      setEvalHistory((h) => [...h, evaluate(next)]);
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
        fuzz: FUZZ_BY_DEPTH[depthRef.current] || 0,
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

  // The hint ladder: first press fetches the analysis and shows a general
  // idea; each further press reveals more (piece → candidates → best move),
  // so you can take just as much help as you need.
  const requestHint = () => {
    if (thinking || hintLoading || gameOver || turn !== playerColor) return;
    if (hint) {
      setHintLevel((l) => Math.min(4, l + 1));
      return;
    }
    setHintLoading(true);
    workerRef.current.postMessage({
      type: "hint",
      board,
      color: playerColor,
      depth: coachDepth,
    });
  };

  // Level-1 hint: a Socratic nudge derived from what the best move *does*,
  // without revealing it.
  const hintIdea = useMemo(() => {
    if (!hint || !hint.move) return "";
    const best = hint.move;
    if (best.captured) return "There's a capture worth calculating — count attackers and defenders first.";
    const after = applyMove(board, best);
    if (inCheck(after, engineColor)) return "Look at forcing moves — checks first, always.";
    if (threats && threats.warnings.length > 0) return "Something of yours is under fire — deal with the threat.";
    const homeRow = playerColor === WHITE ? 7 : 0;
    if (best.fromR === homeRow && (best.piece[1] === "n" || best.piece[1] === "b")) {
      return "Your development isn't finished — bring a new piece into the game.";
    }
    return "No tactics here — find your worst-placed piece and give it a better square.";
  }, [hint, board, threats, playerColor, engineColor]);

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
    setEvalHistory(prev.evalHistory);
    setGradeLog(prev.gradeLog);
    setHint(null);
    setHintLevel(0);
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
    setHintLevel(0);
    setHintLoading(false);
    setPast([]);
    setGameCounts({});
    setEvalHistory([]);
    setGradeLog([]);
    setUserArrows([]);
    setUserHighlights([]);
    setPreviewArrow(null);
    drawStartRef.current = null;
    yourMovesRef.current = [];
    if (color === BLACK) {
      // You chose Black, so the engine opens the game as White.
      setThinking(true);
      worker.postMessage({
        type: "move",
        board: fresh,
        color: WHITE,
        depth: depthRef.current,
        fuzz: FUZZ_BY_DEPTH[depthRef.current] || 0,
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
  // Board orientation: your side at the bottom, unless manually flipped.
  const orientBlack = (playerColor === BLACK) !== flipped;

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
    // The hint arrow is the top of the ladder — only level 4 reveals it.
    if (hint && hintLevel === 4) {
      arrows.push({
        from: [hint.move.fromR, hint.move.fromC],
        to: [hint.move.toR, hint.move.toC],
        color: "green",
      });
    }
    return arrows;
  }, [teacherMode, lastMove, threats, hint, hintLevel, engineColor]);

  // Everything drawn on the board — coach arrows, your sketched arrows, and
  // the drag preview — flipped together to match the display orientation.
  const allArrows = useMemo(() => {
    const arrows = [...boardArrows, ...userArrows];
    if (previewArrow) arrows.push(previewArrow);
    if (!orientBlack) return arrows;
    return arrows.map((a) => ({
      ...a,
      from: [7 - a.from[0], 7 - a.from[1]],
      to: [7 - a.to[0], 7 - a.to[1]],
    }));
  }, [boardArrows, userArrows, previewArrow, orientBlack]);

  /** The board square under a pointer event, in board coordinates. */
  const squareAt = (clientX, clientY) => {
    const el = boardElRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const dc = Math.floor(((clientX - rect.left) / rect.width) * 8);
    const dr = Math.floor(((clientY - rect.top) / rect.height) * 8);
    if (dr < 0 || dr > 7 || dc < 0 || dc > 7) return null;
    return { r: orientBlack ? 7 - dr : dr, c: orientBlack ? 7 - dc : dc };
  };

  // Sketch color: plain drag = yellow; hold Shift for red, Alt for blue,
  // Ctrl/Cmd for green.
  const sketchColor = (e) =>
    e.shiftKey ? "red" : e.altKey ? "blue" : e.ctrlKey || e.metaKey ? "green" : "yellow";

  const onBoardPointerDown = (e) => {
    const drawing = e.button === 2 || (drawMode && (e.button === 0 || e.pointerType === "touch"));
    if (!drawing) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    drawStartRef.current = { sq, color: sketchColor(e) };
    boardElRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onBoardPointerMove = (e) => {
    const start = drawStartRef.current;
    if (!start) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq || (sq.r === start.sq.r && sq.c === start.sq.c)) {
      setPreviewArrow(null);
      return;
    }
    setPreviewArrow({ from: [start.sq.r, start.sq.c], to: [sq.r, sq.c], color: start.color });
  };

  const onBoardPointerUp = (e) => {
    const start = drawStartRef.current;
    if (!start) return;
    drawStartRef.current = null;
    setPreviewArrow(null);
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (sq.r === start.sq.r && sq.c === start.sq.c) {
      // A drag that stays on one square toggles a highlight ring.
      const key = `${sq.r}-${sq.c}`;
      setUserHighlights((h) =>
        h.includes(key) ? h.filter((k) => k !== key) : [...h, key]
      );
      return;
    }
    const same = (a) =>
      a.from[0] === start.sq.r && a.from[1] === start.sq.c &&
      a.to[0] === sq.r && a.to[1] === sq.c;
    setUserArrows((arr) => {
      const existing = arr.find(same);
      // Redrawing an identical arrow erases it; a new color replaces it.
      if (existing && existing.color === start.color) return arr.filter((a) => !same(a));
      return [
        ...arr.filter((a) => !same(a)),
        { from: [start.sq.r, start.sq.c], to: [sq.r, sq.c], color: start.color },
      ];
    });
  };

  // A Socratic prompt for the coach panel — a question, not an answer.
  const socratic = useMemo(() => {
    if (threats && threats.warnings.length > 0) {
      return "What is your opponent threatening right now?";
    }
    if (lastMove) return "What changed after that last move — which squares opened up?";
    return "Which of your pieces is least active, and can you improve it?";
  }, [threats, lastMove]);

  // Post-game review: verdict counts, accuracy, and the biggest swings.
  const review = useMemo(() => {
    if (!gameOver) return null;
    const counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    let totalLoss = 0;
    for (const g of gradeLog) {
      totalLoss += Math.max(0, g.loss);
      if (g.loss <= 20) counts.best++;
      else if (g.loss <= 60) counts.good++;
      else if (g.loss <= 150) counts.inaccuracy++;
      else if (g.loss <= 400) counts.mistake++;
      else counts.blunder++;
    }
    const avgLoss = gradeLog.length ? totalLoss / gradeLog.length : null;
    const accuracy =
      avgLoss == null ? null : Math.max(0, Math.min(100, Math.round(100 - avgLoss / 6)));
    // Critical moments: the largest eval swings between consecutive plies.
    const swings = [];
    for (let i = 1; i < evalHistory.length; i++) {
      const delta = evalHistory[i] - evalHistory[i - 1];
      swings.push({ ply: i, delta });
    }
    const critical = swings
      .filter((s) => Math.abs(s.delta) >= 150)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
    return { counts, accuracy, critical, graded: gradeLog.length };
  }, [gameOver, gradeLog, evalHistory]);

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
            ref={boardElRef}
            className={"board" + (blindfold ? " blindfold" : "") + (drawMode ? " drawing" : "")}
            role="grid"
            aria-label={`Board, you play ${playerColor === WHITE ? "White" : "Black"}`}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={onBoardPointerDown}
            onPointerMove={onBoardPointerMove}
            onPointerUp={onBoardPointerUp}
          >
            {Array.from({ length: 8 }, (_, dr) =>
              Array.from({ length: 8 }, (_, dc) => {
                // Display coordinates follow the orientation; game logic never flips.
                const r = orientBlack ? 7 - dr : dr;
                const c = orientBlack ? 7 - dc : dc;
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
                  userHighlights.includes(`${r}-${c}`) ? "user-hl" : "",
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
            <ArrowLayer arrows={allArrows} />
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
            <button className="reset" onClick={() => setFlipped((f) => !f)} title="Rotate the board 180°">
              Flip board
            </button>
            <button
              className={"reset" + (drawMode ? " draw-active" : "")}
              onClick={() => setDrawMode((d) => !d)}
              aria-pressed={drawMode}
              title="Sketch plans: drag to draw arrows, tap a square to highlight it. Right-click-drag always draws, even with this off. Shift = red, Alt = blue, Ctrl = green. Left click clears."
            >
              ✏️ Draw
            </button>
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
            <label className="teacher-toggle" title="Hide the pieces and play from the move list — the classic visualization exercise">
              <input
                type="checkbox"
                checked={blindfold}
                onChange={(e) => setBlindfold(e.target.checked)}
              />
              <span>Blindfold</span>
            </label>
          </div>
        </section>

        <aside className="panel-column">
          {review && (
            <section className="panel panel-review" aria-label="Game review">
              <h2>Game review</h2>
              <p className="review-result">
                {statusText(status, turn, false, playerColor)}
              </p>
              {review.accuracy != null ? (
                <p>
                  Your accuracy: <strong>{review.accuracy}%</strong>{" "}
                  <span className="muted small">({review.graded} graded moves)</span>
                </p>
              ) : (
                <p className="muted small">
                  Play with Teacher mode on to get accuracy and move grades in the review.
                </p>
              )}
              {review.graded > 0 && (
                <p className="review-counts">
                  <span className="rc rc-good">{review.counts.best} best</span>
                  <span className="rc rc-good">{review.counts.good} good</span>
                  <span className="rc rc-warn">{review.counts.inaccuracy} inaccuracies</span>
                  <span className="rc rc-bad">{review.counts.mistake} mistakes</span>
                  <span className="rc rc-bad">{review.counts.blunder} blunders</span>
                </p>
              )}
              {evalHistory.length > 1 && (
                <svg className="eval-graph" viewBox="0 0 300 80" preserveAspectRatio="none"
                     aria-label="Evaluation over the game">
                  <line x1="0" y1="40" x2="300" y2="40" stroke="#4a5266" strokeWidth="1" strokeDasharray="4 4" />
                  <polyline
                    fill="none"
                    stroke="#6ea8fe"
                    strokeWidth="2"
                    points={evalHistory
                      .map((cp, i) => {
                        const x = (i / (evalHistory.length - 1)) * 300;
                        const y = 40 - Math.max(-38, Math.min(38, cp / 13));
                        return `${x.toFixed(1)},${y.toFixed(1)}`;
                      })
                      .join(" ")}
                  />
                </svg>
              )}
              {review.critical.length > 0 && (
                <>
                  <h3 className="review-h3">Critical moments</h3>
                  <ul className="review-critical">
                    {review.critical.map((s) => (
                      <li key={s.ply}>
                        Move {Math.floor(s.ply / 2) + 1}
                        {s.ply % 2 === 0 ? "" : "…"} ({history[s.ply] || "—"}):{" "}
                        {s.delta > 0 ? "+" : ""}{(s.delta / 100).toFixed(1)} swing
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="muted small">
                Undo steps back into the game; New game starts fresh.
              </p>
            </section>
          )}

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
              {!gameOver && turn === playerColor && !thinking && (
                <p className="socratic">Coach asks: {socratic}</p>
              )}
              <div className="hint-row">
                <button
                  className="reset"
                  onClick={requestHint}
                  disabled={thinking || hintLoading || gameOver || turn !== playerColor || hintLevel >= 4}
                >
                  {hintLoading ? "Analyzing…" : hint ? `More help (${hintLevel}/4)` : "Hint"}
                </button>
              </div>
              {hint && hintLevel >= 1 && (
                <ol className="hint-ladder">
                  <li><strong>Idea:</strong> {hintIdea}</li>
                  {hintLevel >= 2 && (
                    <li><strong>Piece:</strong> look at your {PIECE_NAMES[hint.move.piece[1]]}.</li>
                  )}
                  {hintLevel >= 3 && (
                    <li>
                      <strong>Candidates:</strong>{" "}
                      {hint.candidates.slice(0, 3).map((c) => moveToString(c.move)).join(", ")}
                    </li>
                  )}
                  {hintLevel >= 4 && (
                    <li>
                      <strong>Best:</strong> {moveToString(hint.move)} ({formatScore(hint.score)})
                      — drawn on the board.
                    </li>
                  )}
                </ol>
              )}
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
