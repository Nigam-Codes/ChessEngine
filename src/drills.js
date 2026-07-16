/**
 * drills.js — hands-on tutorials for Learn mode.
 *
 * Each drill is a small position where you (always White) must actually
 * *play* the tactic move by move. A step lists the moves it accepts, a
 * scripted opponent reply, the explanation shown after you get it right,
 * a hint, and optional "traps" — tempting wrong moves that earn a
 * specific explanation of why they fail.
 *
 * tests/drills.test.js replays every drill to prove each accepted move
 * and scripted reply is legal, so the tutorials can't drift out of sync
 * with the engine's rules.
 */

/** Build an 8×8 board from { e4: "wp", g8: "bk", ... }. */
function pos(pieces) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (const [sq, piece] of Object.entries(pieces)) {
    board[8 - Number(sq[1])][sq.charCodeAt(0) - 97] = piece;
  }
  return board;
}

/** "e4" → [4, 4] (row, column). */
const rc = (s) => [8 - Number(s[1]), s.charCodeAt(0) - 97];

/** A from→to move in board coordinates. */
const mv = (from, to) => ({ from: rc(from), to: rc(to) });

export const DRILLS = [
  {
    id: "fork",
    title: "The knight fork",
    tactic: "Offense",
    intro:
      "The black king on a8 and rook on e8 are both a knight's jump from one square. White to move.",
    position: pos({ b5: "wn", a8: "bk", e8: "br", g1: "wk" }),
    steps: [
      {
        task: "Jump the knight to the square that attacks king and rook at once.",
        accept: [mv("b5", "c7")],
        reply: mv("a8", "b7"),
        explain: "Check! The king must move — and it can't take the rook with it.",
        hint: { text: "From c7 a knight attacks both a8 and e8.", arrow: mv("b5", "c7") },
      },
      {
        task: "The king ran. Collect your prize.",
        accept: [mv("c7", "e8")],
        reply: null,
        explain:
          "A whole rook, for free. That's a fork: one attacker, two targets, and only one can be saved.",
        hint: { text: "Take the rook on e8.", arrow: mv("c7", "e8") },
      },
    ],
    outro:
      "In your games, watch for enemy king and heavy pieces standing a knight's jump apart — the engine's coach will flag forks against you, but finding them for yourself wins games.",
  },
  {
    id: "pin",
    title: "Attack the pinned piece",
    tactic: "Offense",
    intro:
      "Your rook on e1 pins the black knight on e4 to its king — moving the knight is illegal. A frozen piece is a target.",
    position: pos({ e1: "wr", d2: "wp", g1: "wk", e4: "bn", a7: "bp", e8: "bk" }),
    steps: [
      {
        task: "Attack the frozen knight with your cheapest attacker.",
        accept: [mv("d2", "d3")],
        reply: mv("a7", "a6"),
        explain: "The knight is attacked by a pawn and cannot run. Black can only wait.",
        hint: { text: "A pawn on d3 attacks e4.", arrow: mv("d2", "d3") },
      },
      {
        task: "Now take it.",
        accept: [mv("d3", "e4")],
        reply: null,
        explain: "A knight for nothing. Pinned pieces can't defend themselves — pile on them.",
        hint: { text: "Capture on e4 with the pawn.", arrow: mv("d3", "e4") },
      },
    ],
    outro: "Rule of thumb: don't rush to capture a pinned piece — attack it again first.",
  },
  {
    id: "skewer",
    title: "The skewer",
    tactic: "Offense",
    intro:
      "The black king and queen share the e-file. Attack the king through the file and whatever stands behind it falls.",
    position: pos({ a1: "wr", g2: "wk", e5: "bk", e8: "bq" }),
    steps: [
      {
        task: "Give a check that lines your rook up with king and queen.",
        accept: [mv("a1", "e1")],
        reply: mv("e5", "d4"),
        explain: "Check! The king must leave the file — and the queen stands right behind it.",
        hint: { text: "Slide the rook to the e-file.", arrow: mv("a1", "e1") },
      },
      {
        task: "Take the queen.",
        accept: [mv("e1", "e8")],
        reply: null,
        explain:
          "A skewer is a pin reversed: the valuable piece stands in front and is forced to step aside.",
        hint: { text: "Capture on e8.", arrow: mv("e1", "e8") },
      },
    ],
    outro: "Skewers punish a king and queen sharing a line — in your own games, don't let yours.",
  },
  {
    id: "discovered",
    title: "Discovered attack",
    tactic: "Offense",
    intro:
      "Your knight stands in front of your rook on the e-file, with Black's queen at the far end. Any knight move unmasks the rook — find the one that also creates a second threat.",
    position: pos({ e1: "wr", e4: "wn", e7: "bq", g8: "bk", g1: "wk" }),
    steps: [
      {
        task: "Move the knight with check, unmasking the rook.",
        accept: [mv("e4", "f6")],
        reply: mv("g8", "h8"),
        explain:
          "Check from the knight — and suddenly the rook attacks the queen. Two threats in one move.",
        hint: { text: "Nf6+ hits the king while the rook eyes e7.", arrow: mv("e4", "f6") },
      },
      {
        task: "The king stepped aside. Win the queen.",
        accept: [mv("e1", "e7")],
        reply: null,
        explain: "The queen falls. A discovered attack is chess's buy-one-get-one-free.",
        hint: { text: "Rook takes on e7.", arrow: mv("e1", "e7") },
      },
    ],
    outro:
      "Whenever two of your pieces share a line with something valuable beyond them, ask what the front piece could do *elsewhere*.",
  },
  {
    id: "backrank",
    title: "Back-rank mate",
    tactic: "Offense",
    intro:
      "Black's king shelters behind its own pawns — with no escape square. One rook move ends the game.",
    position: pos({ g8: "bk", f7: "bp", g7: "bp", h7: "bp", e1: "wr", g1: "wk" }),
    steps: [
      {
        task: "Deliver checkmate in one move.",
        accept: [mv("e1", "e8")],
        reply: null,
        explain: "Checkmate! The pawns that shelter the king become its prison bars.",
        hint: { text: "The whole eighth rank is undefended.", arrow: mv("e1", "e8") },
      },
    ],
    outro:
      "Defensive habit: before your rooks leave the back rank, give your king an escape square (a pawn nudge like h3).",
  },
  {
    id: "defend",
    title: "Save the attacked bishop",
    tactic: "Defense",
    intro:
      "Black's rook attacks your bishop on d4. When something is attacked you have options: move it, defend it, block, capture the attacker, or counterattack. Pick a safe one.",
    position: pos({ d8: "br", d4: "wb", g1: "wn", h1: "wk", h8: "bk" }),
    steps: [
      {
        task: "Answer the threat: move the bishop to safety, or defend it with the knight.",
        accept: [
          mv("d4", "c3"), mv("d4", "b2"), mv("d4", "a1"),
          mv("d4", "e3"), mv("d4", "f2"),
          mv("d4", "e5"), mv("d4", "f6"),
          mv("g1", "f3"),
        ],
        reply: null,
        explain:
          "Threat answered — no material lost. Always run through the five defences (move, defend, block, capture, counterattack) and pick the cheapest.",
        hint: {
          text: "Bb2 keeps the bishop safe on the long diagonal — Nf3, defending it, works too.",
          arrow: mv("d4", "b2"),
        },
        traps: [
          {
            to: rc("g7"),
            text: "Careful — the black king on h8 guards g7. You'd lose the bishop for nothing.",
          },
        ],
      },
    ],
    outro: "Panic moves lose pieces; a calm scan of the five defences rarely does.",
  },
  {
    id: "poisoned",
    title: "Don't take the bait",
    tactic: "Defense",
    intro:
      "Your queen can grab the pawn on d5 — but should it? Count attackers and defenders before every capture. Sometimes the best tactical decision is the capture you don't make.",
    position: pos({ d1: "wq", g1: "wn", h1: "wk", d5: "bp", e6: "bp", h8: "bk" }),
    steps: [
      {
        task: "Skip the pawn grab and make the safe developing move instead.",
        accept: [mv("g1", "f3")],
        reply: null,
        explain:
          "Right. d5 looks free, but the e6 pawn recaptures: queen (9) for pawn (1) is the worst trade in chess. Counting defenders before you capture is the habit that saves the most points — and it's exactly why the engine uses quiescence search.",
        hint: { text: "The d5 pawn is defended by e6 — develop the knight.", arrow: mv("g1", "f3") },
        traps: [
          {
            to: rc("d5"),
            text: "The e6 pawn takes back! You'd trade your queen (9) for a pawn (1). Find a quieter move.",
          },
        ],
      },
    ],
    outro: "A capture is only safe when your attackers outnumber — and out-cheap — the defenders.",
  },
];
