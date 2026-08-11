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
  initialContext,
  nextContext,
} from "./engine.js";
import LearnMode from "./LearnMode.jsx";
import { classifyMove, threatReport, verdictForLoss, PIECE_NAMES } from "./coach.js";
import { summarize, topMistakes, habitReport, criticalMoments } from "./review.js";
import { targetsForDrag, squareKey } from "./planning.js";
import { playSound, soundForMove, loadMuted, setMuted, isMuted } from "./sounds.js";
import { capturedFrom, drawVerdict } from "./material.js";
import { outcomeFor, TERMINAL, DRAW_REASONS } from "./rules.js";
import { premoveSquares, resolvePremove } from "./premove.js";
import { openingForMoves } from "./openings.js";
import { THEMES, loadTheme, applyTheme } from "./themes.js";
import {
  TIME_CONTROLS,
  DEFAULT_CONTROL,
  findControl,
  createClocks,
  tick,
  addIncrement,
  formatClock,
  flagResult,
  depthForTime,
  pressureSplit,
  PRESSURE_THRESHOLD_MS,
} from "./clock.js";
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

const COLOR_NAME = { w: "White", b: "Black" };
// chess.com-style move marks. The buckets come from verdictForLoss in
// coach.js, so these are a rendering of the existing grades, not a new scale.
const GRADE_MARKS = {
  best: "★",
  good: "✓",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};
const PROMOTION_NAMES = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" };
// Half the flip: squash shut, swap sides, open again. Matches --flip-ms in the
// stylesheet — keep the two in step.
const FLIP_MS = 160;

function statusText(status, turn, thinking, playerColor, vsHuman, flagged, ended) {
  // Resignation and agreement aren't facts about the position — nothing on the
  // board says the game stopped — so they're carried separately and read first.
  if (ended) {
    if (ended.outcome === "agreed") return "Draw agreed.";
    if (vsHuman) {
      return `${COLOR_NAME[opposite(ended.winner)]} resigned — ${COLOR_NAME[ended.winner]} wins.`;
    }
    return ended.winner === playerColor
      ? "The engine resigned — you win!"
      : "You resigned. The engine wins.";
  }
  if (flagged) {
    if (flagged.outcome === "flagged-draw") {
      return "Out of time — but the win needs material. Draw.";
    }
    if (vsHuman) return `${COLOR_NAME[turn]} flagged — ${COLOR_NAME[flagged.winner]} wins on time!`;
    return flagged.winner === playerColor
      ? "The engine flagged — you win on time!"
      : "Out of time — you lose on time.";
  }
  // `turn` is the side to move — and when the game is over, the side that has
  // no moves left, i.e. the loser.
  if (status === "checkmate") {
    if (vsHuman) return `Checkmate — ${COLOR_NAME[opposite(turn)]} wins!`;
    return turn !== playerColor ? "Checkmate — you win!" : "Checkmate — the engine wins.";
  }
  if (status === "stalemate") return "Stalemate — draw.";
  if (status === "insufficient") return "Draw — neither side has enough material to mate.";
  if (status === "fifty-move") return "Draw — fifty moves with no pawn move or capture.";
  if (status === "repetition") return "Draw — the same position three times.";
  if (thinking) return "Engine is thinking…";
  if (vsHuman) {
    return status === "check"
      ? `Check! ${COLOR_NAME[turn]} to move.`
      : `${COLOR_NAME[turn]} to move.`;
  }
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
  const [opponent, setOpponent] = useState("engine"); // "engine" | "human"
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
  // Hot-seat: rotate the board so the side to move sees their own pieces.
  const [autoFlip, setAutoFlip] = useState(true);
  // Where a new game starts from: the opening, or a generated practice position.
  // Blitz: clocks in milliseconds, plus the moment the running clock last
  // started. Time is always recomputed from real timestamps, never decremented
  // by the interval, so a late or throttled tick can't gift back spent time.
  const [timed, setTimed] = useState(false);
  const [controlId, setControlId] = useState(DEFAULT_CONTROL);
  const [clocks, setClocks] = useState(() => createClocks(DEFAULT_CONTROL));
  const [flagged, setFlagged] = useState(null); // { outcome, winner }
  // Endings that aren't on the board: resignation and an agreed draw. Kept
  // apart from `status` so getGameStatus stays a pure function of the position.
  const [ended, setEnded] = useState(null); // { outcome, winner }
  const [drawOffer, setDrawOffer] = useState(null); // hot-seat: { from }
  const [drawReply, setDrawReply] = useState(null); // what the engine said back
  // A pawn is on the last rank and the player has to say what it becomes:
  // { r, c, moves } — four moves that differ only in `promotion`.
  const [promotionChoice, setPromotionChoice] = useState(null);
  // The result card over the board. Opens itself when the game ends and can be
  // dismissed, because the final position is usually the thing you want to see.
  const [cardOpen, setCardOpen] = useState(false);
  // Stepping back through the game. Counted in plies *already played*, so
  // `viewPly` is an index into plyLog and `null` means "watching the live
  // game" — distinct from "happen to be on the last ply", so a new move
  // doesn't strand you in history.
  const [viewPly, setViewPly] = useState(null);
  // A move queued while the engine is still thinking, played the instant it
  // becomes your turn — how blitz actually feels. { from: {r,c}, to: {r,c} }.
  const [premove, setPremove] = useState(null);
  const turnStartRef = useRef(null);
  const [startMode, setStartMode] = useState("standard"); // standard|midgame|endgame
  const [startDifficulty, setStartDifficulty] = useState("balanced");
  const [scenario, setScenario] = useState(null); // { label, target } when random
  const [settingUp, setSettingUp] = useState(false);
  // Every ply of this game, captured before the move was applied. This is the
  // input for the post-game coach report (and, later, PGN export).
  const [plyLog, setPlyLog] = useState([]);
  // Castling rights + en-passant target: the rules state a board can't hold.
  const [ctx, setCtx] = useState(initialContext);
  const [reviewGrades, setReviewGrades] = useState(null);
  const [reviewProgress, setReviewProgress] = useState(null);
  const [reviewColor, setReviewColor] = useState(WHITE); // which report is shown
  // User-drawn annotations (chess.com style): right-click-drag an arrow,
  // right-click a square to highlight it, left-click to clear everything.
  // The ✏️ Draw toggle lets touch screens draw with a plain drag.
  const [userArrows, setUserArrows] = useState([]); // board coords
  const [userHighlights, setUserHighlights] = useState([]); // "r-c" keys
  const [previewArrow, setPreviewArrow] = useState(null);
  // Where the in-progress sketch may end: a Set of "r-c" keys, or null when
  // the drag began on an empty square and so is freeform.
  const [drawDests, setDrawDests] = useState(null);
  const [muted, setMutedState] = useState(loadMuted);
  const [boardTheme, setBoardTheme] = useState(loadTheme);
  // The piece that just moved, rendered one frame at its *old* offset so CSS
  // can slide it home. Cleared as soon as the transition starts.
  const [slide, setSlide] = useState(null);
  // A piece being dragged: { from, piece, x, y } in client coordinates.
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
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
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const plyLogRef = useRef(plyLog);
  plyLogRef.current = plyLog;
  const timedRef = useRef(timed);
  timedRef.current = timed;
  // Your moves so far this game, for opening-habit detection.
  const yourMovesRef = useRef([]);

  const engineColor = opposite(playerColor);
  const vsHuman = opponent === "human";
  // The side the person at the keyboard may move right now. Against the engine
  // that's always your colour; in hot-seat it's simply whoever is on move.
  const controlledColor = vsHuman ? turn : playerColor;

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

  /**
   * Everything that happens *around* a move landing: the sound it makes and
   * the slide from its old square. Shared so your moves and the engine's
   * behave identically.
   */
  const announceMove = useCallback((move, { check = false, over = false } = {}) => {
    playSound(soundForMove(move, { check, gameOver: over }));
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !move) return;
    // Render the piece one frame at its old offset, then drop the offset so
    // CSS transitions it home — a reverse FLIP, no piece identity required.
    setSlide({
      fromR: move.fromR, fromC: move.fromC, toR: move.toR, toC: move.toC,
      rook: move.castle ? { fromC: move.rook.fromC, toC: move.rook.toC } : null,
      phase: "start",
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setSlide((sl) => (sl ? { ...sl, phase: "end" } : null)))
    );
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
      if (msg.type === "generate-done") {
        const p = msg.position;
        setSettingUp(false);
        setBoard(p.board);
        boardRef.current = p.board;
        setCtx(p.ctx);
        ctxRef.current = p.ctx;
        setTurn(p.turn);
        setScenario({ label: p.label, target: p.target });
        setPlyLog([]);
        setStatus(outcomeFor({ board: p.board, turn: p.turn, ctx: p.ctx, plyLog: [] }));
        return;
      }
      if (msg.type === "review-progress") {
        setReviewProgress({ done: msg.done, total: msg.total });
        return;
      }
      if (msg.type === "review-done") {
        setReviewProgress(null);
        setReviewGrades(msg.grades);
        return;
      }
      const result = msg.reply;
      const pc = playerColorRef.current;
      setThinking(false);
      // The engine pays for its own thinking out of its own clock.
      if (timedRef.current && turnStartRef.current != null) {
        const spent = Date.now() - turnStartRef.current;
        const engine = opposite(pc);
        setClocks((c) => addIncrement(tick(c, engine, spent), engine));
        turnStartRef.current = Date.now();
      }
      setTelemetry(result);
      setViewPly(null); // the engine moved; the live game is the thing to show
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
      const afterCtx = nextContext(ctxRef.current, result.move);
      setCtx(afterCtx);
      // The engine's reply is a ply of this game like any other. It has to be
      // logged: without it plyLog holds only half the game, which would make
      // repetition undetectable and the move-list rewind skip every reply.
      const log = [
        ...plyLogRef.current,
        {
          board: boardRef.current,
          played: result.move,
          color: opposite(pc),
          ctx: ctxRef.current,
          msLeft: null,
        },
      ];
      setPlyLog(log);
      const newStatus = outcomeFor({ board: next, turn: pc, ctx: afterCtx, plyLog: log });
      const over = TERMINAL.has(newStatus);
      if (over) recordGameEnd();
      setBoard(next);
      setStatus(newStatus);
      setLastMove(result.move);
      announceMove(result.move, { check: newStatus === "check", over });
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
  }, [recordHabitEvents, recordGameEnd, announceMove]);

  useEffect(() => {
    workerRef.current = makeWorker();
    return () => workerRef.current?.terminate();
  }, [makeWorker]);

  // Legal moves for the currently selected piece.
  const targets = useMemo(() => {
    if (!selected) return [];
    return legalMoves(board, controlledColor, ctx).filter(
      (m) => m.fromR === selected.r && m.fromC === selected.c
    );
  }, [board, selected, controlledColor, ctx]);

  // Where a premove may be aimed: geometry, not legality. See premove.js for
  // why ordinary move generation is the wrong tool here.
  const premoveTargets = useMemo(
    () => (selected ? premoveSquares(board, selected) : new Set()),
    [board, selected]
  );

  const gameOver = TERMINAL.has(status) || !!flagged || !!ended;

  /* ---------------- Stepping through the game ---------------- */

  // plyLog[i].board is the position *before* ply i, so plyLog[i] is exactly
  // "after i plies" — which makes viewPly both a ply count and an index.
  const viewingHistory = viewPly !== null && viewPly < plyLog.length;
  const shownBoard = viewingHistory ? plyLog[viewPly].board : board;
  // The move that produced the position on screen, so the from/to highlight
  // follows you back through the game.
  const shownLastMove = viewingHistory
    ? viewPly > 0
      ? plyLog[viewPly - 1].played
      : null
    : lastMove;

  const goToPly = useCallback(
    (n) => {
      const total = plyLog.length;
      const clamped = Math.max(0, Math.min(total, n));
      setViewPly(clamped >= total ? null : clamped);
      setSelected(null);
      setPromotionChoice(null);
    },
    [plyLog.length]
  );

  // ←/→ walk the game, Home/End jump to the ends. Ignored while typing, and
  // while the picker is up — Escape owns that.
  useEffect(() => {
    const onKey = (e) => {
      if (promotionChoice) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const current = viewPly === null ? plyLog.length : viewPly;
      if (e.key === "ArrowLeft") goToPly(current - 1);
      else if (e.key === "ArrowRight") goToPly(current + 1);
      else if (e.key === "Home") goToPly(0);
      else if (e.key === "End") goToPly(plyLog.length);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToPly, viewPly, plyLog.length, promotionChoice]);

  /**
   * Grades from the post-game review, keyed by the ply they belong to. The
   * review already computes a centipawn loss per ply; running it through the
   * same verdictForLoss the live coach uses means a move can never be a
   * "Mistake" on the board and an "Inaccuracy" in the panel.
   */
  const gradeByPly = useMemo(() => {
    if (!reviewGrades) return null;
    const map = new Map();
    for (const g of reviewGrades) map.set(g.ply, { ...verdictForLoss(g.loss), ...g });
    return map;
  }, [reviewGrades]);

  // The badge to draw on the board: the grade of the move that just landed,
  // sitting on the square it landed on.
  const shownBadge = useMemo(() => {
    if (!gradeByPly) return null;
    const played = viewingHistory ? viewPly : plyLog.length;
    if (played === 0) return null;
    const grade = gradeByPly.get(played - 1);
    if (!grade) return null;
    const move = plyLog[played - 1].played;
    return { r: move.toR, c: move.toC, bucket: grade.bucket, verdict: grade.verdict };
  }, [gradeByPly, viewingHistory, viewPly, plyLog]);

  // What each side has taken, and who is up. Derived from the board, so it is
  // right after an undo or a generated position without any bookkeeping — and
  // it follows you back through the game for free.
  const captured = useMemo(() => capturedFrom(shownBoard), [shownBoard]);

  // The result card opens itself the moment the game ends, and closes on a new
  // game. Dismissing it doesn't touch `gameOver`, so it stays closed.
  useEffect(() => {
    setCardOpen(gameOver);
  }, [gameOver]);

  // A counter purely to re-render the clock display; the times themselves are
  // always derived from timestamps, never from how often this fires.
  const [clockNow, setClockNow] = useState(0);
  useEffect(() => {
    if (!timed || gameOver || settingUp) return;
    const id = setInterval(() => setClockNow((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [timed, gameOver, settingUp]);

  /** Time left for a colour right now, counting the move in progress. */
  const liveClock = (color) => {
    const committed = clocks[color];
    if (!timed || gameOver || color !== turn || turnStartRef.current == null) return committed;
    return Math.max(0, committed - (Date.now() - turnStartRef.current));
  };

  // Flag the moment a clock empties. Whether that is a win or a draw depends
  // on whether the opponent has enough material to mate.
  useEffect(() => {
    if (!timed || gameOver || turnStartRef.current == null) return;
    if (liveClock(turn) <= 0) {
      setFlagged(flagResult(board, turn));
      setThinking(false);
    }
  });

  /**
   * Commit a move that has already been chosen. Split out from the click
   * handler so the promotion picker can play the move the player picked
   * without duplicating any of this — there is still exactly one move path.
   */
  const playMove = (move) => {
    setViewPly(null); // playing on always snaps back to the live game
    setPremove(null);
    setPromotionChoice(null);
    setDrawOffer(null);
    setDrawReply(null);
    setPast((p) => [
      ...p,
      {
        board, lastMove, telemetry, status, history, coachReport, threats,
        evalHistory, gradeLog, turn, ctx,
        yourMoves: yourMovesRef.current,
      },
    ]);
    const next = applyMove(board, move);
    const afterCtx = nextContext(ctx, move);
    setCtx(afterCtx);
    // Record the ply for the post-game report, capturing the position it was
    // played in so the review can grade it exactly as it happened. The status
    // is worked out *after*, because repetition is a fact about the whole log.
    const msLeftAtMove = timed ? liveClock(turn) : null;
    const log = [...plyLog, { board, played: move, color: turn, ctx, msLeft: msLeftAtMove }];
    setPlyLog(log);
    const newStatus = outcomeFor({ board: next, turn: opposite(turn), ctx: afterCtx, plyLog: log });
    // Charge the mover for the time they just used, then hand over the clock.
    if (timed && turnStartRef.current != null) {
      const spent = Date.now() - turnStartRef.current;
      setClocks((c) => addIncrement(tick(c, turn, spent), turn));
      turnStartRef.current = Date.now();
    }
    // Habit tracking is a personal profile — pause it in hot-seat so an
    // opponent's blunders never land in your lifetime stats.
    if (!vsHuman) {
      // Habit detection compares the position before and after your move.
      // Undone moves stay counted — the habit still happened.
      recordHabitEvents(
        analyzeMove({
          prevBoard: board,
          nextBoard: next,
          move,
          // From a random midgame/endgame there is no opening to judge, so
          // push past the opening windows in analyzeMove rather than
          // reporting "brought the queen out early" on move 30.
          moveNumber: yourMovesRef.current.length + 1 + (scenario ? 50 : 0),
          previousMoves: yourMovesRef.current,
          color: playerColor,
        })
      );
      yourMovesRef.current = [...yourMovesRef.current, move];
    }
    setBoard(next);
    setSelected(null);
    setLastMove(move);
    announceMove(move, { check: newStatus === "check", over: TERMINAL.has(newStatus) });
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
    // Hand the turn over first, even when the game just ended: `turn` always
    // means "side to move", so on checkmate it names the player who has no
    // reply — which is what the status line reads to announce the winner.
    setTurn(opposite(turn));
    if (TERMINAL.has(newStatus)) {
      if (!vsHuman) recordGameEnd();
      return;
    }
    // Hot-seat: the other player is sitting right here, so there is nobody to
    // search for — the worker stays idle until the post-game review.
    if (vsHuman) return;
    setThinking(true);
    workerRef.current.postMessage({
      type: "move",
      board: next,
      color: engineColor,
      depth: timed
        ? depthForTime(clocks[engineColor], depthRef.current)
        : depthRef.current,
      ctx: afterCtx,
      fuzz: FUZZ_BY_DEPTH[depthRef.current] || 0,
      // In teacher mode, also grade the move just played: analyze the
      // position it was played *in* (the pre-move board).
      coach: teacherMode
        ? { board, color: playerColor, depth: coachDepth, played: move, ctx }
        : null,
    });
  };

  // True while the engine is searching and the next click should be banked
  // rather than played.
  const queueingPremove =
    thinking && !vsHuman && !gameOver && !settingUp && turn !== controlledColor;

  /**
   * Release a queued premove the moment it is your turn again.
   *
   * This runs as an effect rather than at the end of the worker's callback
   * because playMove reads the current board, context and ply log from the
   * render it was created in — inside the callback those are all still the
   * pre-reply values. Waiting a render means it sees the position the engine
   * actually produced, which is the whole correctness question here.
   */
  useEffect(() => {
    if (!premove || thinking || gameOver || settingUp || turn !== controlledColor) return;
    const move = resolvePremove(board, turn, ctx, premove);
    setPremove(null);
    if (!move) {
      // The engine didn't play what you assumed. Say so rather than guessing.
      playSound("illegal");
      return;
    }
    playMove(move);
    // playMove is rebuilt every render; depending on it here would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premove, thinking, gameOver, settingUp, turn, controlledColor, board, ctx]);

  const handleSquareClick = (r, c) => {
    if (drawMode) return; // clicks draw, they don't move pieces
    // Any left click wipes the sketch, like on chess.com.
    if (userArrows.length || userHighlights.length) {
      setUserArrows([]);
      setUserHighlights([]);
    }
    // While the promotion picker is up it owns the next click: the pawn is
    // still on the seventh and the move hasn't happened yet, so anything else
    // would be acting on a position the player is mid-way through leaving.
    if (promotionChoice) {
      setPromotionChoice(null);
      return;
    }
    // A rewound board is a record, not a game. Clicking it returns to the
    // live position rather than doing nothing, which is what you want after
    // stepping back to check something.
    if (viewingHistory) {
      goToPly(plyLog.length);
      return;
    }
    // Premove: while the engine is searching, a click queues a move instead of
    // playing one. Only against the engine — in hot-seat the other player is
    // sitting right here and there is no wait to fill.
    if (queueingPremove) {
      if (selected && premoveTargets.has(`${r}-${c}`)) {
        setPremove({ from: { ...selected }, to: { r, c } });
        setSelected(null);
        return;
      }
      // Anything else re-aims: picking a different piece, or clicking away,
      // drops whatever was queued rather than leaving a stale move armed.
      setPremove(null);
      const own = board[r][c];
      setSelected(
        own && own[0] === controlledColor && !(selected?.r === r && selected?.c === c)
          ? { r, c }
          : null
      );
      return;
    }
    if (thinking || gameOver || turn !== controlledColor) return;

    // Promotions arrive as four moves to the same square that differ only in
    // what the pawn becomes, so the player has to say which — everything else
    // matches exactly one move.
    const matches = targets.filter((m) => m.toR === r && m.toC === c);
    if (matches.length > 1) {
      setSelected(null);
      setPromotionChoice({ r, c, moves: matches });
      return;
    }
    // Castling can be entered two ways: click the king two squares over (the
    // move already appears as a normal target), or click your own rook — which
    // is easier to hit on a phone than c1 next to b1.
    const move =
      matches[0] || targets.find((m) => m.castle && m.toR === r && m.rook.fromC === c);
    if (move) {
      playMove(move);
      return;
    }

    const piece = board[r][c];
    if (piece && piece[0] === controlledColor) {
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
      ctx,
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
    // Vs the engine a snapshot covers a full move pair, so the turn always
    // comes back to you. In hot-seat every ply is snapshotted, so hand the
    // turn back to whoever played the move being taken back.
    setTurn(vsHuman ? prev.turn : playerColor);
    setCtx(prev.ctx);
    setPlyLog((p) => p.slice(0, -1));
    setReviewGrades(null);
    setSelected(null);
    setThinking(false);
    // Taking a move back resumes a game that resignation or agreement had
    // stopped, so those endings have to go with it.
    setEnded(null);
    setDrawOffer(null);
    setDrawReply(null);
    setPromotionChoice(null);
    setViewPly(null);
    setPremove(null);
    yourMovesRef.current = prev.yourMoves;
  };

  /**
   * Start a fresh game with you playing `color`. `nextOpponent` is passed
   * explicitly when switching modes, because the `opponent` state hasn't
   * re-rendered yet at that point.
   */
  const newGame = (color, nextOpponent = opponent, nextTimed = timed) => {
    const humanOpponent = nextOpponent === "human";
    setOpponent(nextOpponent);
    setTimed(nextTimed);
    timedRef.current = nextTimed;
    // A search may be mid-flight; kill the worker so its result never lands.
    workerRef.current?.terminate();
    const worker = makeWorker();
    workerRef.current = worker;
    const fresh = initialBoard();
    const freshCtx = initialContext();
    setCtx(freshCtx);
    ctxRef.current = freshCtx;
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
    setClocks(createClocks(controlId));
    setFlagged(null);
    setEnded(null);
    setDrawOffer(null);
    setDrawReply(null);
    setPromotionChoice(null);
    setViewPly(null);
    setPremove(null);
    turnStartRef.current = nextTimed ? Date.now() : null;
    setPlyLog([]);
    setReviewGrades(null);
    setReviewProgress(null);
    setReviewColor(WHITE);
    drawStartRef.current = null;
    yourMovesRef.current = [];
    // A random practice position replaces the opening. The generator runs in
    // the worker (the midgame one plays a short opening against itself), so the
    // board arrives via generate-done rather than synchronously here.
    if (startMode !== "standard") {
      setScenario(null);
      setSettingUp(true);
      setThinking(false);
      worker.postMessage({
        type: "generate",
        phase: startMode,
        difficulty: startDifficulty,
        playerColor: color,
        seed: (Math.random() * 2 ** 32) >>> 0,
      });
      return;
    }
    setScenario(null);

    if (color === BLACK && !humanOpponent) {
      // You chose Black, so the engine opens the game as White.
      setThinking(true);
      worker.postMessage({
        type: "move",
        board: fresh,
        color: WHITE,
        depth: depthRef.current,
        ctx: freshCtx,
        fuzz: FUZZ_BY_DEPTH[depthRef.current] || 0,
        coach: null,
      });
    } else {
      setThinking(false);
    }
  };

  const reset = () => newGame(playerColor);

  /**
   * End the game without a mate. `controlledColor` is whoever is entitled to
   * act right now: your colour against the engine, the side to move in
   * hot-seat — so resigning always gives up on behalf of the right player.
   */
  const finishGame = (result) => {
    if (thinking) {
      // A search is in flight on a game that no longer exists.
      workerRef.current?.terminate();
      workerRef.current = makeWorker();
      setThinking(false);
    }
    setEnded(result);
    setPremove(null);
    setDrawOffer(null);
    setSelected(null);
    setPromotionChoice(null);
    playSound("gameEnd");
    if (!vsHuman) recordGameEnd();
  };

  const resign = () => {
    if (gameOver) return;
    finishGame({ outcome: "resigned", winner: opposite(controlledColor) });
  };

  /**
   * Offer a draw. Against a human it's a question; against the engine it's
   * answered immediately from the same evaluation the search uses, which makes
   * the refusal informative — being told "I'm a pawn up and still playing for
   * it" is worth more to a learner than a silent no.
   */
  const offerDraw = () => {
    if (gameOver || thinking) return;
    if (vsHuman) {
      setDrawOffer({ from: turn });
      return;
    }
    const verdict = drawVerdict(board, engineColor);
    setDrawReply(verdict.reason);
    if (verdict.accept) finishGame({ outcome: "agreed", winner: null });
  };

  /** Hot-seat: the player who was asked answers. */
  const answerDraw = (accepted) => {
    setDrawOffer(null);
    if (accepted) finishGame({ outcome: "agreed", winner: null });
  };

  // The theme is a document attribute, so it has to be pushed out to the DOM
  // rather than rendered — including on first load, for the saved choice.
  useEffect(() => {
    applyTheme(boardTheme);
  }, [boardTheme]);

  // Escape backs out of whatever is on top: the picker first (a pawn is
  // waiting mid-move), then the result card.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (promotionChoice) setPromotionChoice(null);
      else if (cardOpen) setCardOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [promotionChoice, cardOpen]);

  /** Batch-grade every ply of the finished game for the per-colour report. */
  const requestReview = () => {
    if (reviewProgress || plyLog.length === 0) return;
    setReviewProgress({ done: 0, total: plyLog.length });
    workerRef.current.postMessage({
      type: "review",
      plies: plyLog,
      depth: coachDepth,
    });
  };

  const resetHabits = () => {
    clearHabitStats();
    setHabitStats(emptyStats());
    setGameCounts({});
  };

  // Static evaluation of the position on the board right now.
  const staticEval = useMemo(() => evaluate(board), [board]);
  // Eval bar: 50% is equal; each pawn of advantage shifts it ~5%.
  const whitePct = Math.max(3, Math.min(97, 50 + staticEval / 20));

  // Each cell carries the ply it represents, so clicking it can jump straight
  // to the position that move produced.
  const moveRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      rows.push({
        n: i / 2 + 1,
        white: history[i],
        black: history[i + 1],
        whitePly: i,
        blackPly: i + 1,
      });
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
  // Board orientation: the side that "owns" the bottom of the board. Against
  // the engine that's your colour; in hot-seat with auto-flip it follows the
  // side to move, so each player sees their own pieces nearest them. The manual
  // Flip button XORs on top of either.
  const bottomColor = vsHuman ? (autoFlip ? turn : WHITE) : playerColor;
  const targetOrient = (bottomColor === BLACK) !== flipped;

  // Card-flip animation. `orientBlack` lags one beat behind the target so the
  // board can squash shut, swap sides at the midpoint, and open again. Driving
  // it off the derived orientation means both triggers animate: the Flip board
  // button and the hot-seat auto-flip between turns.
  const [orientBlack, setOrientBlack] = useState(targetOrient);
  const [flipping, setFlipping] = useState(false);
  // Read the current orientation through a ref so the effect below depends on
  // the *target* alone. Depending on `orientBlack` too would re-run the effect
  // the moment the mid-flip swap lands, and its cleanup would cancel the very
  // timer that re-opens the board — leaving it squashed shut forever.
  const orientRef = useRef(orientBlack);
  orientRef.current = orientBlack;

  useEffect(() => {
    if (targetOrient === orientRef.current) {
      // Nothing to do — but a flip already in flight was just cancelled (e.g.
      // hitting Flip board mid-auto-flip lands us back where we started), so
      // make sure the board doesn't stay squashed shut.
      setFlipping(false);
      return;
    }
    // Someone who asked for less motion gets the swap with no theatre — and
    // crucially no timer, which a CSS-only override would leave stalling.
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setOrientBlack(targetOrient);
      return;
    }
    setFlipping(true);
    const swap = setTimeout(() => setOrientBlack(targetOrient), FLIP_MS);
    const open = setTimeout(() => setFlipping(false), FLIP_MS * 2);
    return () => {
      clearTimeout(swap);
      clearTimeout(open);
    };
  }, [targetOrient]);

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

  /**
   * The offset a just-moved piece starts from, in display space. Only applied
   * on the first frame ("start"); dropping it lets the CSS transition carry
   * the piece home. Board deltas are converted here rather than when the move
   * was made, so a board that flipped in between still animates correctly.
   */
  const slideStyle = (r, c) => {
    if (!slide || slide.phase !== "start") return undefined;
    const sign = orientBlack ? -1 : 1;
    const offset = (dr, dc) => ({
      transform: `translate(${dc * sign * 100}%, ${dr * sign * 100}%)`,
      transition: "none",
    });
    if (r === slide.toR && c === slide.toC) {
      return offset(slide.fromR - slide.toR, slide.fromC - slide.toC);
    }
    // Castling moves two pieces; the rook slides along the same rank.
    if (slide.rook && r === slide.toR && c === slide.rook.toC) {
      return offset(0, slide.rook.fromC - slide.rook.toC);
    }
    return undefined;
  };

  /**
   * Where the promotion picker sits: a column of four squares hanging off the
   * promotion square, in display space. It drops downwards from the top half
   * of the board and upwards from the bottom half, so it is always on screen
   * whichever way round the board is.
   */
  const promoStyle = ({ r, c }) => {
    const dr = orientBlack ? 7 - r : r;
    const dc = orientBlack ? 7 - c : c;
    const downwards = dr <= 3;
    return {
      left: `${dc * 12.5}%`,
      [downwards ? "top" : "bottom"]: `${(downwards ? dr : 7 - dr) * 12.5}%`,
      flexDirection: downwards ? "column" : "column-reverse",
    };
  };

  /**
   * How the game ended, in the two pieces the result card needs: a headline
   * ("You win") and the manner of it ("by checkmate"). Every ending funnels
   * through here so the card, unlike the status line, never has to know which
   * of the three ways a game can stop actually happened.
   */
  const result = useMemo(() => {
    if (!gameOver) return null;
    let winner = null;
    let how = "";
    if (ended) {
      winner = ended.winner;
      how = ended.outcome === "agreed" ? "by agreement" : "by resignation";
    } else if (flagged) {
      winner = flagged.outcome === "flagged-draw" ? null : flagged.winner;
      how = flagged.outcome === "flagged-draw" ? "on time, without the material to mate" : "on time";
    } else if (status === "checkmate") {
      // `turn` is the side with no reply, so the winner is the other one.
      winner = opposite(turn);
      how = "by checkmate";
    } else {
      // Every remaining terminal status is a draw, and rules.js owns the
      // wording so the card and the status line can't drift apart.
      how = DRAW_REASONS[status] || "by agreement";
    }
    const headline =
      winner == null
        ? "Draw"
        : vsHuman
          ? `${COLOR_NAME[winner]} wins`
          : winner === playerColor
            ? "You win"
            : "Engine wins";
    return { headline, how, winner };
  }, [gameOver, ended, flagged, status, turn, vsHuman, playerColor]);

  // Send focus to the card when it opens, so keyboard users land on it and
  // Escape is obviously the way out.
  const cardRef = useRef(null);
  useEffect(() => {
    if (cardOpen) cardRef.current?.focus();
  }, [cardOpen]);

  // Where the display is in the game, counted in plies. `viewPly` is null when
  // live, which is the same position as the end of the log.
  const currentPly = viewPly === null ? plyLog.length : viewPly;

  /**
   * The opening, named from the moves played up to whatever position is on
   * screen — so stepping back through the game walks the name back too.
   * Keyed on coordinates rather than notation (see openings.js).
   */
  const opening = useMemo(() => {
    const played = plyLog.slice(0, currentPly).map((p) => p.played);
    return played.length ? openingForMoves(played) : null;
  }, [plyLog, currentPly]);

  /**
   * One move in the list: a button that jumps to the position it produced,
   * carrying its review grade when the game has been analysed.
   */
  const moveCell = (text, ply) => {
    if (!text) return "";
    const grade = gradeByPly?.get(ply);
    return (
      <button
        className={
          "move-cell" +
          (currentPly === ply + 1 ? " move-cell-current" : "") +
          (grade ? " move-" + grade.bucket : "")
        }
        onClick={() => goToPly(ply + 1)}
        title={grade ? `${grade.verdict} — best was ${grade.bestStr}` : "Jump to this move"}
      >
        {text}
        {grade && <span className="move-mark">{GRADE_MARKS[grade.bucket]}</span>}
      </button>
    );
  };

  /** The strip of pieces one colour has taken, with its material lead. */
  const capturedStrip = (color) => {
    const taken = captured[color];
    const lead = color === WHITE ? captured.advantage : -captured.advantage;
    if (taken.length === 0 && lead <= 0) return <div className="captured" aria-hidden="true" />;
    return (
      <div className="captured" aria-label={`Pieces ${COLOR_NAME[color]} has captured`}>
        {taken.map((type, i) => (
          <span
            key={i}
            className={"captured-piece " + (color === WHITE ? "black-piece" : "white-piece")}
          >
            {GLYPHS[opposite(color) + type]}
          </span>
        ))}
        {lead > 0 && <span className="captured-lead">+{lead}</span>}
      </div>
    );
  };

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
    const start = squareAt(e.clientX, e.clientY);

    // Dragging a piece: left button, not in draw mode, on a piece you may move.
    // Click-to-move still works — this only adds a second way in, as on
    // chess.com, and selecting on pointer-down means the target dots are
    // already up by the time the drag begins.
    if (!drawing && e.button === 0 && start) {
      const piece = board[start.r][start.c];
      const yours = piece && piece[0] === controlledColor;
      // Dragging is allowed on your turn, and also while the engine thinks —
      // dropping then queues a premove, because it lands in handleSquareClick
      // exactly as a click does.
      const canGrab = queueingPremove || (!thinking && !gameOver && !settingUp && turn === controlledColor);
      if (yours && canGrab && !viewingHistory) {
        // Deliberately *not* capturing the pointer here: capturing on
        // pointer-down retargets the following click to the board, which
        // silently breaks click-to-move. Capture only once the pointer
        // actually moves (see onBoardPointerMove), so a plain click is
        // untouched and a real drag still tracks outside the board.
        // Note we do *not* select here. A plain click selects via the
        // square's own onClick, and selecting on pointer-down too would let
        // the click immediately toggle it back off.
        dragRef.current = { from: start, piece, moved: false, pointerId: e.pointerId };
        setDrag({ from: start, piece, x: e.clientX, y: e.clientY });
        return;
      }
      return; // not a draggable piece — let the click handler deal with it
    }

    if (!drawing) return;
    // Right-click is how a premove is taken back, the same as on chess.com.
    // Drawing an arrow with one is a side effect of that, not a conflict.
    if (premove) setPremove(null);
    const sq = start;
    if (!sq) return;
    e.preventDefault();
    // Arrows have to be real chess: work out where this piece may legally go,
    // replaying any arrows already drawn so plans can chain. A null result
    // means the square is empty, and the arrow is a freeform annotation.
    const dests = targetsForDrag(board, ctx, userArrows, sq);
    drawStartRef.current = { sq, color: sketchColor(e), dests };
    setDrawDests(dests);
    boardElRef.current?.setPointerCapture?.(e.pointerId);
  };

  /** May the sketch in progress end on this square? */
  const canDrawTo = (start, sq) => !start.dests || start.dests.has(squareKey(sq.r, sq.c));

  const onBoardPointerMove = (e) => {
    if (dragRef.current) {
      if (!dragRef.current.moved) {
        dragRef.current.moved = true;
        // Now it is a real drag: capture the pointer so it keeps tracking
        // outside the board, and select the piece so its legal squares light
        // up under the cursor.
        boardElRef.current?.setPointerCapture?.(dragRef.current.pointerId);
        setSelected(dragRef.current.from);
      }
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : null));
      return;
    }
    const start = drawStartRef.current;
    if (!start) return;
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq || (sq.r === start.sq.r && sq.c === start.sq.c) || !canDrawTo(start, sq)) {
      // Nothing is previewed over an illegal square — the destination dots
      // already show where the arrow is allowed to land.
      setPreviewArrow(null);
      return;
    }
    setPreviewArrow({ from: [start.sq.r, start.sq.c], to: [sq.r, sq.c], color: start.color });
  };

  const onBoardPointerUp = (e) => {
    if (dragRef.current) {
      const { from, moved } = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      // A press with no movement is a click, and the square's own onClick will
      // handle it — doing it here as well would toggle the selection twice.
      if (!moved) return;
      const sq = squareAt(e.clientX, e.clientY);
      // Dropping back where you started just leaves the piece selected, so a
      // mis-grab doesn't deselect. Anywhere else goes through the same
      // handler a click would, so there is one move path, not two.
      if (sq && !(sq.r === from.r && sq.c === from.c)) handleSquareClick(sq.r, sq.c);
      return;
    }
    const start = drawStartRef.current;
    if (!start) return;
    drawStartRef.current = null;
    setPreviewArrow(null);
    setDrawDests(null);
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
    if (!canDrawTo(start, sq)) return; // not a move that piece could make
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

  // Blitz's payoff: did accuracy hold up when the clock got low? Grades come
  // back in ply order, so they line up with the clock readings in plyLog.
  const pressure = useMemo(() => {
    if (!timed || !gameOver) return null;
    const mine = [];
    gradeLog.forEach((g, i) => {
      const ply = plyLog.filter((p) => p.color === playerColor)[i];
      if (ply) mine.push({ loss: g.loss, msLeft: ply.msLeft });
    });
    if (mine.length === 0) return null;
    const split = pressureSplit(mine);
    return split.rushed.moves > 0 && split.calm.moves > 0 ? split : null;
  }, [timed, gameOver, gradeLog, plyLog, playerColor]);

  // Post-game review (vs engine): verdict counts, accuracy, biggest swings.
  const review = useMemo(() => {
    if (!gameOver) return null;
    return {
      ...summarize(gradeLog),
      critical: criticalMoments(evalHistory),
    };
  }, [gameOver, gradeLog, evalHistory]);

  // Post-game coach report (hot-seat): one per colour, built from the batch
  // analysis plus a read-only replay of the habit detector.
  const coachReports = useMemo(() => {
    if (!reviewGrades) return null;
    const build = (color) => ({
      color,
      ...summarize(reviewGrades, color),
      mistakes: topMistakes(reviewGrades, color),
      ...habitReport(plyLog, color),
    });
    return { w: build(WHITE), b: build(BLACK), critical: criticalMoments(evalHistory) };
  }, [reviewGrades, plyLog, evalHistory]);

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
          className={"mode-tab" + (mode === "play" && !vsHuman && !timed ? " active" : "")}
          role="tab"
          aria-selected={mode === "play" && !vsHuman && !timed}
          onClick={() => {
            setMode("play");
            if (vsHuman || timed) newGame(WHITE, "engine", false);
          }}
        >
          ♟ Play
        </button>
        <button
          className={"mode-tab" + (mode === "play" && vsHuman ? " active" : "")}
          role="tab"
          aria-selected={mode === "play" && vsHuman}
          onClick={() => {
            setMode("play");
            if (!vsHuman || timed) newGame(WHITE, "human", false);
          }}
        >
          👥 2 Players
        </button>
        <button
          className={"mode-tab" + (mode === "play" && timed ? " active" : "")}
          role="tab"
          aria-selected={mode === "play" && timed}
          onClick={() => {
            setMode("play");
            if (!timed) newGame(WHITE, "engine", true);
          }}
        >
          ⏱ Blitz
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
            {settingUp
              ? "Setting up a position…"
              : statusText(status, turn, thinking, playerColor, vsHuman, flagged, ended)}
            {(thinking || settingUp) && <span className="spinner" aria-hidden="true" />}
          </div>

          {timed && (
            <div className="clocks" aria-label="Clocks">
              {[opposite(playerColor), playerColor].map((color) => {
                const ms = liveClock(color);
                const running = !gameOver && color === turn;
                return (
                  <div
                    key={color}
                    className={
                      "clock" +
                      (running ? " clock-running" : "") +
                      (ms < 10000 ? " clock-low" : "") +
                      (ms <= 0 ? " clock-flag" : "")
                    }
                    role="timer"
                    aria-label={`${COLOR_NAME[color]} clock`}
                  >
                    <span className="clock-who">
                      {color === playerColor ? "You" : "Engine"}
                    </span>
                    <span className="clock-time">{formatClock(ms)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {scenario && (
            <p className="scenario" role="status">
              <strong>{scenario.label}</strong> — {scenario.target}
            </p>
          )}

          {premove && (
            <p className="premove-note" role="status">
              Premove queued: {squareName(premove.from.r, premove.from.c)} →{" "}
              {squareName(premove.to.r, premove.to.c)}. It plays the moment it's your
              turn, or is dropped if the engine makes it illegal.{" "}
              <button className="link-button" onClick={() => setPremove(null)}>
                Cancel
              </button>
            </p>
          )}

          {drawOffer && (
            <div className="draw-offer" role="alertdialog" aria-label="Draw offer">
              <span>
                {COLOR_NAME[drawOffer.from]} offers a draw. {COLOR_NAME[opposite(drawOffer.from)]},
                do you accept?
              </span>
              <button className="reset" onClick={() => answerDraw(true)}>Accept</button>
              <button className="reset" onClick={() => answerDraw(false)}>Decline</button>
            </div>
          )}
          {drawReply && !drawOffer && (
            <p className="draw-reply" role="status">{drawReply}</p>
          )}

          {capturedStrip(opposite(bottomColor))}

          <div
            ref={boardElRef}
            className={
              "board" +
              (blindfold ? " blindfold" : "") +
              (drawMode ? " drawing" : "") +
              (flipping ? " flipping" : "") +
              (viewingHistory ? " history" : "")
            }
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
                const piece = shownBoard[r][c];
                const dark = (r + c) % 2 === 1;
                const isSelected =
                  !viewingHistory && selected && selected.r === r && selected.c === c;
                // Coaching overlays describe the live position, so they are
                // meaningless — and misleading — over a rewound board.
                // While the engine thinks, the dots show where a premove may
                // be aimed rather than where you may move right now.
                const isTarget =
                  !viewingHistory &&
                  ((queueingPremove
                    ? premoveTargets.has(`${r}-${c}`)
                    : targets.some((m) => m.toR === r && m.toC === c)) ||
                    (drawDests ? drawDests.has(squareKey(r, c)) : false));
                const isPremove =
                  premove &&
                  ((premove.from.r === r && premove.from.c === c) ||
                    (premove.to.r === r && premove.to.c === c));
                const isLast =
                  shownLastMove &&
                  ((shownLastMove.fromR === r && shownLastMove.fromC === c) ||
                    (shownLastMove.toR === r && shownLastMove.toC === c));
                const badge = shownBadge && shownBadge.r === r && shownBadge.c === c
                  ? shownBadge
                  : null;
                const classes = [
                  "square",
                  dark ? "dark" : "light",
                  isSelected ? "selected" : "",
                  isLast ? "last-move" : "",
                  isPremove ? "premove" : "",
                  !viewingHistory && threatSquares.has(`${r}-${c}`) ? "threat" : "",
                  !viewingHistory && hintSquares.has(`${r}-${c}`) ? "hint" : "",
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
                      <span
                        className={
                          "piece " +
                          (piece[0] === "w" ? "white-piece" : "black-piece") +
                          (slide && !viewingHistory ? " piece-anim" : "") +
                          (drag && drag.from.r === r && drag.from.c === c ? " piece-dragging" : "")
                        }
                        style={viewingHistory ? undefined : slideStyle(r, c)}
                      >
                        {GLYPHS[piece]}
                      </span>
                    )}
                    {badge && (
                      <span className={"grade-badge grade-" + badge.bucket} title={badge.verdict}>
                        {GRADE_MARKS[badge.bucket]}
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
            {drag && (
              <span
                className={
                  "piece drag-ghost " +
                  (drag.piece[0] === "w" ? "white-piece" : "black-piece")
                }
                style={{ left: drag.x, top: drag.y }}
                aria-hidden="true"
              >
                {GLYPHS[drag.piece]}
              </span>
            )}

            {promotionChoice && (
              <div
                className="promo-picker"
                style={promoStyle(promotionChoice)}
                role="dialog"
                aria-label="Choose what the pawn becomes"
                // The board's own pointer handlers would read this as a drag
                // starting on the square underneath.
                onPointerDown={(e) => e.stopPropagation()}
              >
                {promotionChoice.moves.map((m) => (
                  <button
                    key={m.promotion}
                    className="promo-option"
                    autoFocus={m.promotion[1] === "q"}
                    onClick={(e) => {
                      e.stopPropagation();
                      playMove(m);
                    }}
                    aria-label={`Promote to ${PROMOTION_NAMES[m.promotion[1]]}`}
                    title={PROMOTION_NAMES[m.promotion[1]]}
                  >
                    <span
                      className={
                        "piece " + (m.promotion[0] === "w" ? "white-piece" : "black-piece")
                      }
                    >
                      {GLYPHS[m.promotion]}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {cardOpen && result && (
              <div
                className="result-scrim"
                // Clicking anywhere off the card puts it away — the final
                // position is usually the thing you actually want to look at.
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setCardOpen(false);
                }}
              >
                <div
                  className="result-card"
                  role="dialog"
                  aria-label="Game over"
                  tabIndex={-1}
                  ref={cardRef}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="result-close"
                    onClick={() => setCardOpen(false)}
                    aria-label="Dismiss and look at the position"
                  >
                    ×
                  </button>
                  <p className="result-headline">{result.headline}</p>
                  <p className="result-how">{result.how}</p>
                  <div className="result-actions">
                    <button className="reset" onClick={() => newGame(playerColor)}>
                      Rematch
                    </button>
                    <button
                      className="reset"
                      onClick={() => {
                        setCardOpen(false);
                        requestReview();
                      }}
                      disabled={!!reviewProgress || plyLog.length === 0}
                    >
                      Review
                    </button>
                  </div>
                  <p className="muted small">Esc, or click the board, to look at the position.</p>
                </div>
              </div>
            )}
          </div>

          {capturedStrip(bottomColor)}

          {teacherMode && boardArrows.length > 0 && (
            <p className="arrow-legend">
              Arrows: <span className="lg lg-red">red</span> = threat against you
              {" · "}<span className="lg lg-green">green</span> = hint for you
              {" · "}<span className="lg lg-blue">blue</span> = engine's last move
            </p>
          )}

          <div className="controls">
            {!vsHuman && (
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
            )}
            <button
              className="reset"
              onClick={undo}
              disabled={past.length === 0 || timed}
              title={
                vsHuman
                  ? "Take back the last move"
                  : "Take back your last move and the engine's reply"
              }
            >
              Undo move
            </button>
            <button className="reset" onClick={reset}>New game</button>
            {!gameOver && !settingUp && (
              <>
                <button
                  className="reset"
                  onClick={offerDraw}
                  disabled={thinking || !!drawOffer}
                  title={
                    vsHuman
                      ? "Ask your opponent for a draw"
                      : "Ask the engine for a draw — it answers from its own evaluation"
                  }
                >
                  Offer draw
                </button>
                <button
                  className="reset danger"
                  onClick={resign}
                  title={vsHuman ? `${COLOR_NAME[controlledColor]} gives up` : "Give up this game"}
                >
                  Resign
                </button>
              </>
            )}
            {timed && (
              <div className="start-picker" role="group" aria-label="Time control">
                <span className="muted small">Clock</span>
                {TIME_CONTROLS.map((c) => (
                  <button
                    key={c.id}
                    className={"chip" + (controlId === c.id ? " chip-active" : "")}
                    onClick={() => {
                      setControlId(c.id);
                      setClocks(createClocks(c.id));
                      setFlagged(null);
                    }}
                    aria-pressed={controlId === c.id}
                    title="Takes effect on the next new game"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
            <div className="start-picker" role="group" aria-label="Where a new game starts from">
              <span className="muted small">Start from</span>
              {[
                ["standard", "Opening"],
                ["midgame", "Random midgame"],
                ["endgame", "Random endgame"],
              ].map(([id, text]) => (
                <button
                  key={id}
                  className={"chip" + (startMode === id ? " chip-active" : "")}
                  onClick={() => setStartMode(id)}
                  aria-pressed={startMode === id}
                >
                  {text}
                </button>
              ))}
            </div>
            {startMode !== "standard" && (
              <div className="start-picker" role="group" aria-label="Practice difficulty">
                <span className="muted small">Give me</span>
                {[
                  ["balanced", "An equal game"],
                  ["convert", "A win to convert"],
                  ["defend", "A loss to defend"],
                ].map(([id, text]) => (
                  <button
                    key={id}
                    className={"chip" + (startDifficulty === id ? " chip-active" : "")}
                    onClick={() => setStartDifficulty(id)}
                    aria-pressed={startDifficulty === id}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
            <div className="start-picker" role="group" aria-label="Board colours">
              <span className="muted small">Board</span>
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={"chip" + (boardTheme === t.id ? " chip-active" : "")}
                  onClick={() => setBoardTheme(t.id)}
                  aria-pressed={boardTheme === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button className="reset" onClick={() => setFlipped((f) => !f)} title="Rotate the board 180°">
              Flip board
            </button>
            <button
              className="reset"
              onClick={() => setMutedState(setMuted(!isMuted()))}
              aria-pressed={muted}
              title={muted ? "Turn sound on" : "Turn sound off"}
            >
              {muted ? "🔇 Sound off" : "🔊 Sound on"}
            </button>
            <button
              className={"reset" + (drawMode ? " draw-active" : "")}
              onClick={() => setDrawMode((d) => !d)}
              aria-pressed={drawMode}
              title="Sketch plans: drag to draw arrows, tap a square to highlight it. Right-click-drag always draws, even with this off. Shift = red, Alt = blue, Ctrl = green. Left click clears."
            >
              ✏️ Draw
            </button>
            {!vsHuman && (
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
            )}
            {vsHuman && (
              <label
                className="teacher-toggle"
                title="Rotate the board after each move so the player to move sees their own pieces at the bottom"
              >
                <input
                  type="checkbox"
                  checked={autoFlip}
                  onChange={(e) => setAutoFlip(e.target.checked)}
                />
                <span>Auto-flip</span>
              </label>
            )}
            {!vsHuman && !timed && (
              <label className="teacher-toggle">
                <input
                  type="checkbox"
                  checked={teacherMode}
                  onChange={(e) => setTeacherMode(e.target.checked)}
                />
                <span>Teacher mode</span>
              </label>
            )}
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
          {vsHuman && gameOver && (
            <section className="panel panel-review" aria-label="Coach report">
              <h2>Coach report</h2>
              <p className="review-result">
                {statusText(status, turn, false, playerColor, true, flagged, ended)}
              </p>
              {!coachReports && (
                <>
                  <p className="muted small">
                    Analyze the whole game and get separate feedback for each
                    player — accuracy, the moves that cost the most, and the
                    habits to work on.
                  </p>
                  <button
                    className="reset"
                    onClick={requestReview}
                    disabled={!!reviewProgress || plyLog.length === 0}
                  >
                    {reviewProgress ? "Analyzing…" : "Coach the game"}
                  </button>
                  {reviewProgress && (
                    <p className="muted small" role="status" aria-live="polite">
                      Analyzing move {reviewProgress.done} of {reviewProgress.total}…
                    </p>
                  )}
                </>
              )}

              {coachReports && (
                <>
                  <div className="drill-nav" role="group" aria-label="Whose report to show">
                    {[WHITE, BLACK].map((col) => (
                      <button
                        key={col}
                        className={"chip" + (reviewColor === col ? " chip-active" : "")}
                        onClick={() => setReviewColor(col)}
                        aria-pressed={reviewColor === col}
                      >
                        {col === WHITE ? "♔ White" : "♚ Black"}
                      </button>
                    ))}
                  </div>

                  {(() => {
                    const rep = coachReports[reviewColor];
                    return (
                      <>
                        <p>
                          {COLOR_NAME[reviewColor]} accuracy:{" "}
                          <strong>{rep.accuracy != null ? `${rep.accuracy}%` : "—"}</strong>{" "}
                          <span className="muted small">({rep.graded} moves)</span>
                        </p>
                        <p className="review-counts">
                          <span className="rc rc-good">{rep.counts.best} best</span>
                          <span className="rc rc-good">{rep.counts.good} good</span>
                          <span className="rc rc-warn">{rep.counts.inaccuracy} inaccuracies</span>
                          <span className="rc rc-bad">{rep.counts.mistake} mistakes</span>
                          <span className="rc rc-bad">{rep.counts.blunder} blunders</span>
                        </p>

                        <h3 className="review-h3">Biggest mistakes</h3>
                        {rep.mistakes.length === 0 ? (
                          <p className="muted small">
                            Nothing serious — no move cost more than half a pawn.
                          </p>
                        ) : (
                          <ul className="review-critical">
                            {rep.mistakes.map((m) => (
                              <li key={m.ply}>
                                <span className={`badge badge-${m.tone}`}>{m.verdict}</span>{" "}
                                Move {m.moveNumber}: you played <strong>{m.playedStr}</strong>,
                                better was <strong>{m.bestStr}</strong>{" "}
                                <span className="muted">(−{(m.loss / 100).toFixed(1)})</span>
                              </li>
                            ))}
                          </ul>
                        )}

                        <h3 className="review-h3">Work on this</h3>
                        {rep.lessons.length === 0 ? (
                          <p className="muted small">
                            No recurring bad habits showed up this game — well played.
                          </p>
                        ) : (
                          <ul className="review-lessons">
                            {rep.lessons.slice(0, 3).map((l) => (
                              <li key={l.id}>
                                <strong>{l.label}</strong> ×{l.count} — {l.advice}
                              </li>
                            ))}
                          </ul>
                        )}
                        {rep.strengths.length > 0 && (
                          <p className="muted small">
                            Good habits seen: {rep.strengths.map((s) => s.label).join(", ")}.
                          </p>
                        )}
                      </>
                    );
                  })()}

                  {coachReports.critical.length > 0 && (
                    <>
                      <h3 className="review-h3">Critical moments</h3>
                      <ul className="review-critical">
                        {coachReports.critical.map((s) => (
                          <li key={s.ply}>
                            Move {Math.floor(s.ply / 2) + 1} ({history[s.ply] || "—"}):{" "}
                            {s.delta > 0 ? "+" : ""}{(s.delta / 100).toFixed(1)} swing
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
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
            </section>
          )}

          {!vsHuman && review && (
            <section className="panel panel-review" aria-label="Game review">
              <h2>Game review</h2>
              <p className="review-result">
                {statusText(status, turn, false, playerColor, false, flagged, ended)}
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
              {pressure && (
                <div className="pressure">
                  <h3 className="review-h3">Under pressure</h3>
                  <p>
                    With time to think: <strong>{pressure.calm.accuracy}%</strong>{" "}
                    <span className="muted small">({pressure.calm.moves} moves)</span>
                    {" · "}
                    Under {PRESSURE_THRESHOLD_MS / 1000}s:{" "}
                    <strong>{pressure.rushed.accuracy}%</strong>{" "}
                    <span className="muted small">({pressure.rushed.moves} moves)</span>
                  </p>
                  <p className="muted small">
                    {pressure.rushed.accuracy < pressure.calm.accuracy - 5
                      ? "Your play drops when the clock does — that gap is the thing to train."
                      : "You held your standard as the clock ran down. That's the hard part."}
                  </p>
                </div>
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

          {teacherMode && !vsHuman && !timed && (
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

          {!vsHuman && (
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
          )}

          {!vsHuman && (
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
          )}

          {!vsHuman && (
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
          )}

          <section className="panel" aria-label="Move list">
            <h2>Moves</h2>
            {moveRows.length === 0 ? (
              <p className="muted">
                {playerColor === WHITE
                  ? "No moves yet — you're White, go ahead."
                  : "No moves yet — the engine opens as White."}
              </p>
            ) : (
              <>
                {opening && (
                  <p className="opening">
                    <strong>{opening.name}</strong>{" "}
                    <span className="opening-eco">{opening.eco}</span>
                  </p>
                )}
                <div className="move-nav" role="group" aria-label="Step through the game">
                  <button
                    className="chip"
                    onClick={() => goToPly(0)}
                    disabled={currentPly === 0}
                    aria-label="Jump to the start"
                    title="Start (Home)"
                  >
                    ⏮
                  </button>
                  <button
                    className="chip"
                    onClick={() => goToPly(currentPly - 1)}
                    disabled={currentPly === 0}
                    aria-label="Previous move"
                    title="Back (←)"
                  >
                    ◀
                  </button>
                  <span className="move-nav-pos">
                    {currentPly} / {plyLog.length}
                  </span>
                  <button
                    className="chip"
                    onClick={() => goToPly(currentPly + 1)}
                    disabled={!viewingHistory}
                    aria-label="Next move"
                    title="Forward (→)"
                  >
                    ▶
                  </button>
                  <button
                    className="chip"
                    onClick={() => goToPly(plyLog.length)}
                    disabled={!viewingHistory}
                    aria-label="Back to the live position"
                    title="Live (End)"
                  >
                    ⏭
                  </button>
                </div>
                {viewingHistory && (
                  <p className="viewing-note" role="status">
                    Reviewing move {currentPly} — the board is read-only.{" "}
                    <button className="link-button" onClick={() => goToPly(plyLog.length)}>
                      Back to the game
                    </button>
                  </p>
                )}
                <table className="move-list">
                  <tbody>
                    {moveRows.map((row) => (
                      <tr key={row.n}>
                        <td className="move-num">{row.n}.</td>
                        <td>{moveCell(row.white, row.whitePly)}</td>
                        <td>{moveCell(row.black, row.blackPly)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {gradeByPly && (
                  <p className="muted small grade-key">
                    ★ best · ✓ good · ?! inaccuracy · ? mistake · ?? blunder
                  </p>
                )}
              </>
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
