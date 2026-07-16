/**
 * lessons.js — the "Chess school" curriculum for teacher mode.
 * Each lesson has a short explanation, a diagram position, and squares to
 * highlight on it.
 */

/** Build an 8×8 board from { e4: "wp", g8: "bk", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [sq, piece] of Object.entries(pieces)) {
    const c = sq.charCodeAt(0) - 97; // 'a' → 0
    const r = 8 - Number(sq[1]); // rank 8 → row 0
    board[r][c] = piece;
  }
  return board;
}

/** Same conversion for highlight squares: "e4" → [4, 4]. */
function sq(...names) {
  return names.map((s) => [8 - Number(s[1]), s.charCodeAt(0) - 97]);
}

/** A directional arrow for a diagram: arrow("c7", "e8", "red"). */
function arrow(from, to, color = "blue") {
  const conv = (s) => [8 - Number(s[1]), s.charCodeAt(0) - 97];
  return { from: conv(from), to: conv(to), color };
}

export const LESSONS = [
  {
    id: "values",
    title: "Piece values",
    body: "Every trade is arithmetic. A pawn is worth 1, knights and bishops about 3, a rook 5, and the queen 9 — the king is priceless. Before you capture anything, ask: what do I give, what do I get? Winning a knight for a pawn is +2; trading your rook for a bishop is −2. Most beginner games are decided by nothing more than this counting.",
    position: pos({ a2: "wp", b1: "wn", c1: "wb", a1: "wr", d1: "wq", e1: "wk" }),
    highlights: [],
  },
  {
    id: "center",
    title: "Control the center",
    body: "The four central squares are the crossroads of the board: pieces placed there reach the most squares. Open with 1. e4 or 1. d4, fight for the highlighted squares, and your pieces will always have somewhere useful to go. This is also exactly what the engine's piece-square tables reward.",
    position: pos({ e4: "wp", d4: "wp", f3: "wn", g8: "bn", e1: "wk", e8: "bk" }),
    highlights: sq("e4", "d4", "e5", "d5"),
    arrows: [arrow("e4", "d5"), arrow("d4", "e5"), arrow("f3", "e5")],
  },
  {
    id: "develop",
    title: "Develop before you attack",
    body: "Get your knights and bishops off the back rank before moving the same piece twice or launching an attack. A lone queen raid gets chased around while the opponent develops with gain of time. Rule of thumb: knights before bishops, and don't bring the queen out early.",
    position: pos({ e4: "wp", d4: "wp", f3: "wn", c3: "wn", c4: "wb", e1: "wk", e8: "bk", b8: "bn", c8: "bb" }),
    highlights: sq("f3", "c3", "c4"),
    arrows: [arrow("b8", "c6", "yellow"), arrow("c8", "f5", "yellow")],
  },
  {
    id: "hanging",
    title: "Hanging pieces",
    body: "A piece is 'hanging' when it can simply be taken for free — attacked, and not defended. Here the black rook stares down the d-file at White's bishop, which nothing protects. Before every move you make, scan once: after this move, can anything of mine just be taken? Teacher mode does this scan for you and shows the result.",
    position: pos({ d4: "wb", d8: "br", h8: "bk", e1: "wk" }),
    highlights: sq("d4", "d8"),
    arrows: [arrow("d8", "d4", "red")],
  },
  {
    id: "fork",
    title: "The fork",
    body: "One piece attacks two targets at once — the opponent can only save one. Knights are the classic forkers because their jump is easy to miss: here the knight attacks the king on a8 and the rook on e8 simultaneously. The king must move, and the rook is lost. Pawns fork too, and those are the cheapest tactics in chess.",
    position: pos({ c7: "wn", a8: "bk", e8: "br", g1: "wk" }),
    highlights: sq("c7", "a8", "e8"),
    arrows: [arrow("c7", "a8", "red"), arrow("c7", "e8", "red")],
  },
  {
    id: "pin",
    title: "The pin",
    body: "A pinned piece can't move because a more valuable piece stands behind it on the same line. The bishop on g4 pins the knight on f3 to the white king — the knight is frozen, so it can't defend anything else, and attackers can pile onto it. Pins against the king are absolute: moving the pinned piece is literally illegal.",
    position: pos({ g4: "bb", f3: "wn", e2: "wk", g8: "bk" }),
    highlights: sq("g4", "f3", "e2"),
    arrows: [arrow("g4", "e2", "red")],
  },
  {
    id: "skewer",
    title: "The skewer",
    body: "The pin's reverse: the *more* valuable piece stands in front. The bishop attacks the king, the king must step aside, and the queen behind it falls. Skewers punish careless king and queen placement on the same diagonal, rank, or file.",
    position: pos({ b2: "wb", f6: "bk", g7: "bq", b1: "wk" }),
    highlights: sq("b2", "f6", "g7"),
    arrows: [arrow("b2", "f6", "red"), arrow("f6", "e6", "yellow"), arrow("b2", "g7", "red")],
  },
  {
    id: "discovered",
    title: "Discovered attack",
    body: "Moving one piece unmasks an attack from another behind it. When the knight on e4 moves anywhere, the rook on e1 suddenly attacks the black queen — and the knight is free to create a second threat of its own on the same turn. Two threats at once is more than most positions can answer.",
    position: pos({ e1: "wr", e4: "wn", e7: "bq", g8: "bk", g1: "wk" }),
    highlights: sq("e4", "e1", "e7"),
    arrows: [arrow("e4", "c5", "blue"), arrow("e1", "e7", "red")],
  },
  {
    id: "backrank",
    title: "The back-rank mate",
    body: "A castled king tucked behind its own pawns is safe — until a rook or queen lands on the back rank and there's no escape square. Here Re8 would be checkmate. When your rooks leave the first rank, make a flight square ('luft') for your king by nudging a pawn like h3.",
    position: pos({ g8: "bk", f7: "bp", g7: "bp", h7: "bp", e1: "wr", g1: "wk" }),
    highlights: sq("e1", "e8", "g8"),
    arrows: [arrow("e1", "e8", "red"), arrow("e8", "g8", "red")],
  },
  {
    id: "counting",
    title: "Count attackers and defenders",
    body: "Before capturing on a square, count both sides. The queen can take the pawn on d5 — but the pawn on e6 recaptures, trading a 9 for a 1. A capture is only safe when your attackers outnumber (and out-cheap) the defenders. This exact trap is why the engine uses quiescence search: it never stops calculating in the middle of a capture sequence, and neither should you.",
    position: pos({ d5: "bp", e6: "bp", d1: "wq", h1: "wk", h8: "bk" }),
    highlights: sq("d5", "e6", "d1"),
    arrows: [arrow("d1", "d5", "blue"), arrow("e6", "d5", "red")],
  },
  {
    id: "defending",
    title: "Defending a threat",
    body: "When a piece is attacked you have five defences: move it, defend it, block the line, capture the attacker, or create a bigger threat elsewhere. Here the rook attacks the bishop (red). White can step away with Bb2 (green), add a defender with Nf3 (green), or block with Rd5 (blue). Count the cost of each and pick the cheapest — never just hope the opponent doesn't see it. This is the defensive half of every tactic in the lessons above.",
    position: pos({ d8: "br", d4: "wb", g1: "wn", a5: "wr", h1: "wk", h8: "bk" }),
    highlights: sq("d4", "d8"),
    arrows: [
      arrow("d8", "d4", "red"),
      arrow("d4", "b2", "green"),
      arrow("g1", "f3", "green"),
      arrow("a5", "d5", "blue"),
    ],
  },
];
