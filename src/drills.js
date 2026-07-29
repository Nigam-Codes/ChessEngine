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

import { initialBoard, initialContext } from "./engine.js";

/** Castling rights intact, no en-passant target — for drills that castle. */
const canCastle = () => initialContext();

/** An en-passant target square, e.g. epAt("d6"). */
const epAt = (sq) => ({
  rights: { wk: false, wq: false, bk: false, bq: false },
  ep: { r: 8 - Number(sq[1]), c: sq.charCodeAt(0) - 97 },
});

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
    id: "pawnfork",
    title: "The pawn fork",
    tactic: "Offense",
    intro:
      "Forks aren't just for knights — a humble pawn can attack two pieces at once, and nothing trades cheaper. The black knight and bishop stand one push apart.",
    position: pos({ c3: "wp", d3: "wp", c5: "bn", e5: "bb", g1: "wk", g8: "bk" }),
    steps: [
      {
        task: "Push the pawn that attacks both minor pieces.",
        accept: [mv("d3", "d4")],
        reply: mv("c5", "e6"),
        explain:
          "One pawn, two targets worth three points each. Black can only save one piece.",
        hint: { text: "From d4 a pawn attacks both c5 and e5.", arrow: mv("d3", "d4") },
      },
      {
        task: "The knight fled. Take the bishop.",
        accept: [mv("d4", "e5")],
        reply: null,
        explain: "A bishop for free. Pawn forks are the cheapest tactic in chess — watch for enemy pieces a pawn-push apart.",
        hint: { text: "Capture on e5.", arrow: mv("d4", "e5") },
      },
    ],
    outro: "Defensively: never park two pieces where a single pawn push hits both.",
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
    id: "doubleattack",
    title: "The queen's double attack",
    tactic: "Offense",
    intro:
      "The queen's power is hitting two directions at once. Black's king is exposed on one diagonal and the rook on e5 sits loose on the fifth rank — find the square that attacks both.",
    position: pos({ d1: "wq", g1: "wk", e8: "bk", e5: "br", a7: "bp" }),
    steps: [
      {
        task: "Move the queen where it gives check and attacks the rook.",
        accept: [mv("d1", "h5")],
        reply: mv("e8", "d8"),
        explain:
          "Check along the diagonal, rook attacked along the rank. Black must answer the check first.",
        hint: { text: "From h5 the queen sees e8 and e5 at once.", arrow: mv("d1", "h5") },
      },
      {
        task: "The king stepped aside. Collect the rook.",
        accept: [mv("h5", "e5")],
        reply: null,
        explain:
          "Loose pieces drop off! Most queen tactics are exactly this: a check paired with an undefended piece.",
        hint: { text: "Take on e5.", arrow: mv("h5", "e5") },
      },
    ],
    outro:
      "Defensive habit: keep your pieces defended. An undefended piece plus any check is a double attack waiting to happen.",
  },
  {
    id: "removedefender",
    title: "Remove the defender",
    tactic: "Offense",
    intro:
      "Your rook pins the knight on d5 to the king — but the bishop on e6 guards it, so taking now is a bad trade. Get rid of the bodyguard first.",
    position: pos({ d1: "wr", h3: "wb", g1: "wk", d8: "bk", d5: "bn", e6: "bb", h7: "bp" }),
    steps: [
      {
        task: "Capture the knight's only defender.",
        accept: [mv("h3", "e6")],
        reply: mv("h7", "h6"),
        explain:
          "The bodyguard is gone, and the pinned knight still can't run. Black can only wait.",
        hint: { text: "Your bishop can take on e6 — nothing recaptures.", arrow: mv("h3", "e6") },
        traps: [
          {
            to: rc("d5"),
            text: "Not yet — the bishop on e6 recaptures and you've traded a rook for a knight. Remove the defender first.",
          },
        ],
      },
      {
        task: "Now win the pinned knight.",
        accept: [mv("d1", "d5")],
        reply: null,
        explain:
          "Rook takes knight, with check. When a defended piece is your target, ask: can I capture, chase away, or overload its defender?",
        hint: { text: "Take on d5 with the rook.", arrow: mv("d1", "d5") },
      },
    ],
    outro: "Every tactic has a defender-shaped weakness — count the guards, then subtract one.",
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
    endsInMate: true,
  },
  {
    id: "smothered",
    title: "The smothered mate",
    tactic: "Offense",
    intro:
      "Black's king is completely walled in by its own rook and pawns. Only a knight can reach past that wall — because only a knight attacks squares it doesn't travel through.",
    position: pos({ h8: "bk", g8: "br", g7: "bp", h7: "bp", g5: "wn", g1: "wk" }),
    steps: [
      {
        task: "Deliver checkmate with the knight.",
        accept: [mv("g5", "f7")],
        reply: null,
        explain:
          "Smothered mate! The king's own army blocks every escape square, and no black piece can capture the knight on f7.",
        hint: { text: "From f7 the knight checks h8 — and nothing can take it.", arrow: mv("g5", "f7") },
      },
    ],
    outro:
      "A cramped king is a fragile king — as the defender, keep at least one flight square open.",
    endsInMate: true,
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
    id: "luft",
    title: "Give your king air",
    tactic: "Defense",
    intro:
      "Black's rook is about to land on e1 — checkmate, because your own pawns box your king in. You have one move to defuse the threat.",
    position: pos({ g1: "wk", f2: "wp", g2: "wp", h2: "wp", e8: "br", g8: "bk", a7: "bp" }),
    steps: [
      {
        task: "Stop the back-rank mate.",
        accept: [
          mv("h2", "h3"), mv("h2", "h4"),
          mv("g2", "g3"),
          mv("f2", "f3"), mv("f2", "f4"),
          mv("g1", "f1"),
        ],
        reply: null,
        explain:
          "Now ...Re1 is just a check, not a checkmate — your king has an escape square (or defends e1 itself). This escape hatch is called 'luft'.",
        hint: {
          text: "Nudge a pawn in front of the king — h3 is the classic luft move.",
          arrow: mv("h2", "h3"),
        },
        traps: [
          {
            to: rc("h1"),
            text: "On h1 the king is even more boxed in — ...Re1 would still be checkmate. Make an escape square instead.",
          },
        ],
      },
    ],
    outro:
      "Whole games are lost to the back rank. Once your rooks drift away from it, spend one quiet move on luft.",
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
  {
    id: "italian",
    title: "Opening: the Italian Game",
    tactic: "Opening",
    intro:
      "The oldest opening plan in the book: claim the center, develop a knight, then aim your bishop at Black's weakest square — f7, defended only by the king.",
    position: initialBoard(),
    steps: [
      {
        task: "Stake your claim in the center.",
        accept: [mv("e2", "e4")],
        reply: mv("e7", "e5"),
        explain: "1. e4 opens lines for the queen and bishop and fights for d5. Black mirrors.",
        hint: { text: "Push the king's pawn two squares.", arrow: mv("e2", "e4") },
      },
      {
        task: "Develop with a threat.",
        accept: [mv("g1", "f3")],
        reply: mv("b8", "c6"),
        explain:
          "2. Nf3 develops toward the center *and* attacks e5 — development with tempo. Black defends.",
        hint: { text: "Knights before bishops: the king's knight attacks e5.", arrow: mv("g1", "f3") },
      },
      {
        task: "Point your bishop at Black's weakest square.",
        accept: [mv("f1", "c4")],
        reply: mv("f8", "c5"),
        explain:
          "3. Bc4 eyes f7, the one square only the king defends. That's the Italian Game: fast development, central control, early pressure.",
        hint: { text: "The light-squared bishop belongs on c4.", arrow: mv("f1", "c4") },
      },
    ],
    outro:
      "Typical plans from here: castle short, play c3 and d4 for a big center, and watch for tactics on f7.",
  },
  {
    id: "queensgambit",
    title: "Opening: the Queen's Gambit",
    tactic: "Opening",
    intro:
      "A 'gambit' that risks nothing: White offers the c-pawn to lure Black's central pawn away — and can always regain it.",
    position: initialBoard(),
    steps: [
      {
        task: "Take the center with the queen's pawn.",
        accept: [mv("d2", "d4")],
        reply: mv("d7", "d5"),
        explain: "1. d4 controls e5 and c5 and is defended by the queen from the start.",
        hint: { text: "Push the queen's pawn two squares.", arrow: mv("d2", "d4") },
      },
      {
        task: "Offer the gambit pawn.",
        accept: [mv("c2", "c4")],
        reply: mv("d5", "c4"),
        explain:
          "2. c4 attacks d5. If Black captures — as here — the central d5 pawn leaves the center for a side pawn White can win back.",
        hint: { text: "Attack d5 with your c-pawn.", arrow: mv("c2", "c4") },
      },
      {
        task: "Open the path to regain the pawn.",
        accept: [mv("e2", "e3")],
        reply: mv("g8", "f6"),
        explain:
          "3. e3 frees the bishop: Bxc4 comes next and White has traded a side pawn for Black's central pawn — a positional win dressed up as a gambit.",
        hint: { text: "A small pawn move opens the f1 bishop's diagonal to c4.", arrow: mv("e2", "e3") },
      },
    ],
    outro:
      "The lesson generalizes: center pawns are worth more than side pawns, and 'free' pawns often cost the center.",
  },
  {
    id: "castle-safety",
    title: "Castling: get the king to safety",
    tactic: "Opening",
    intro:
      "Your king is still in the centre where the files are about to open — the most dangerous place on the board. Castling solves two problems in one move: it tucks the king behind a wall of pawns and brings a rook towards the middle.",
    position: pos({
      e1: "wk", h1: "wr", a1: "wr", c4: "wb", g1: "wn",
      e4: "wp", d4: "wp", f2: "wp", g2: "wp", h2: "wp",
      e8: "bk", h8: "br", e5: "bp", d6: "bp", a7: "bp",
    }),
    context: canCastle(),
    steps: [
      {
        task: "Clear the last piece between your king and the rook.",
        accept: [mv("g1", "f3"), mv("g1", "e2"), mv("g1", "h3")],
        reply: mv("a7", "a6"),
        explain:
          "You can only castle when every square between king and rook is empty — so the knight had to go first. Nf3 also defends e5 and heads for the centre.",
        hint: { text: "The knight on g1 is in the way — develop it.", arrow: mv("g1", "f3") },
      },
      {
        task: "Now castle. Click the king two squares over — or just click your rook.",
        accept: [mv("e1", "g1")],
        reply: null,
        explain:
          "O-O! The king hides on g1 behind three untouched pawns, and the rook lands on f1 pointing down the half-open f-file. One move, two jobs done.",
        hint: { text: "King to g1 — the rook jumps over to f1 by itself.", arrow: mv("e1", "g1") },
        traps: [
          {
            to: rc("d2"),
            text: "Walking the king forward keeps it in the danger zone — and it forfeits castling forever. Castle instead.",
          },
        ],
      },
    ],
    outro:
      "Rule of thumb: castle within the first ten moves unless you have a concrete reason not to. A king in the centre is the single most common cause of a lost opening.",
  },
  {
    id: "castle-illegal",
    title: "Castling: when you're not allowed",
    tactic: "Defense",
    intro:
      "Castling has three restrictions people forget: you cannot castle out of check, through a square the enemy attacks, or into check. Here the bishop on a6 rakes the f1 square — so the king may not cross it. Find another way to get safe.",
    position: pos({
      e1: "wk", h1: "wr", f2: "wp", g2: "wp", h2: "wp",
      a6: "bb", e8: "bk", a8: "br", h7: "bp",
    }),
    context: canCastle(),
    steps: [
      {
        task: "Castling is unavailable. Block the bishop's diagonal instead.",
        accept: [mv("h1", "f1"), mv("e1", "d1"), mv("e1", "d2")],
        reply: mv("h7", "h6"),
        explain:
          "Right — Rf1 blocks the diagonal (and next move you could still castle if the king were free), while a king step also solves the immediate problem. Notice the engine never offered you g1: the rule is enforced, not suggested.",
        hint: {
          text: "The bishop attacks f1 through the empty diagonal — put something on f1, or move the king.",
          arrow: mv("h1", "f1"),
        },
      },
    ],
    outro:
      "The three restrictions in one line: not out of check, not through check, not into check. The square the *rook* crosses doesn't matter — only the king's path.",
  },
  {
    id: "greek-gift",
    title: "The Greek Gift sacrifice",
    tactic: "Offense",
    intro:
      "The classic attack on a castled king. Black has castled kingside and played ...h6 loosely; your bishop, knight and queen are all trained on that corner. Give up the bishop to rip the king's cover open.",
    position: pos({
      g1: "wk", d3: "wb", f3: "wn", d1: "wq", e5: "wp", d4: "wp",
      g8: "bk", f8: "br", f7: "bp", g7: "bp", h7: "bp", d5: "bp", a7: "bp",
    }),
    steps: [
      {
        task: "Sacrifice the bishop on h7.",
        accept: [mv("d3", "h7")],
        reply: mv("g8", "h7"),
        explain:
          "Bxh7+! The king must take — and now it stands on h7 with no pawn cover at all.",
        hint: { text: "The bishop takes on h7, with check.", arrow: mv("d3", "h7") },
        traps: [
          {
            to: rc("g5"),
            text: "The knight jump comes second, not first. Without Bxh7+ dragging the king out, Ng5 just gets chased away by ...h6.",
          },
        ],
      },
      {
        task: "Bring the knight in with check.",
        accept: [mv("f3", "g5")],
        reply: mv("h7", "g8"),
        explain:
          "Ng5+ — the king scurries back, but the damage is done: the h-file is wide open and the pawn shelter is gone.",
        hint: { text: "Knight to g5, hitting the king again.", arrow: mv("f3", "g5") },
      },
      {
        task: "Bring the queen to the open h-file.",
        accept: [mv("d1", "h5")],
        reply: null,
        explain:
          "Qh5 and Black cannot meet the threat of Qh7#. Bishop, knight, queen — the Greek Gift is three moves and hundreds of years old.",
        hint: { text: "Queen swings to h5, threatening mate on h7.", arrow: mv("d1", "h5") },
      },
    ],
    outro:
      "The pattern needs three things: a bishop aimed at h7, a knight ready for g5, and a queen that can reach the h-file. Defensively — that's exactly what to look for before you weaken your own castled position.",
  },
  {
    id: "opposite-castling",
    title: "Opposite-side castling: storm the king",
    tactic: "Strategy",
    intro:
      "You castled queenside, Black castled kingside. When the kings live on opposite wings, the game becomes a race: push the pawns in front of the *enemy* king, because they no longer shelter yours.",
    position: pos({
      c1: "wk", d1: "wr", a2: "wp", b2: "wp", c2: "wp", g2: "wp", h2: "wp", e4: "wp",
      g8: "bk", f8: "br", f7: "bp", g7: "bp", h7: "bp", e5: "bp", a7: "bp",
    }),
    steps: [
      {
        task: "Start the pawn storm against Black's king.",
        accept: [mv("h2", "h4"), mv("g2", "g4")],
        reply: mv("a7", "a6"),
        explain:
          "h4! This pawn costs you nothing in safety — your king is on the other side of the board. Every square it advances pries open a file toward g8.",
        hint: {
          text: "Push a pawn on the side where the enemy king is sitting.",
          arrow: mv("h2", "h4"),
        },
        traps: [
          {
            to: rc("c4"),
            text: "That pawn shelters your own king. Advancing it opens lines toward yourself — storm with the pawns far from your king, not the ones in front of it.",
          },
        ],
      },
      {
        task: "Keep the pawn rolling.",
        accept: [mv("h4", "h5"), mv("g2", "g4")],
        reply: null,
        explain:
          "h5 next, then h6 — Black must either take (opening the h-file for your rook) or watch the pawn crash through. In opposite-castling positions, speed beats material: the attack that lands first wins.",
        hint: { text: "Push it again.", arrow: mv("h4", "h5") },
      },
    ],
    outro:
      "Same-side castling? Do the opposite — keep your pawns home and manoeuvre pieces. The pawns in front of your own king are armour, not ammunition.",
  },
  {
    id: "connect-rooks",
    title: "Castling connects the rooks",
    tactic: "Strategy",
    intro:
      "Development isn't finished when the minor pieces are out — it's finished when the rooks can see each other. Castling is the move that does it, because it tucks the king aside and lets the rooks defend one another along the back rank.",
    position: pos({
      e1: "wk", a1: "wr", h1: "wr", f4: "wb", d2: "wq", c3: "wn", f3: "wn",
      e4: "wp", d4: "wp", a2: "wp", f2: "wp", g2: "wp", h2: "wp",
      e8: "bk", h8: "br", e5: "bp", a7: "bp",
    }),
    context: canCastle(),
    steps: [
      {
        task: "Finish development — castle.",
        accept: [mv("e1", "g1"), mv("e1", "c1")],
        reply: mv("a7", "a6"),
        explain:
          "Castled. Both rooks now stand on the back rank with nothing between them — each defends the other, and either can swing to an open file.",
        hint: { text: "Either side works here; O-O is the safer square.", arrow: mv("e1", "g1") },
      },
      {
        task: "Put a rook where it will matter — the open or half-open central file.",
        accept: [mv("a1", "d1"), mv("a1", "e1"), mv("f1", "e1")],
        reply: null,
        explain:
          "Rooks belong on open files and behind pawns. That's the whole point of connecting them: now moving one doesn't hang the other.",
        hint: { text: "Bring the spare rook toward the centre.", arrow: mv("a1", "d1") },
      },
    ],
    outro:
      "Checklist for a finished opening: pawns in the centre, minor pieces out, king castled, rooks connected and pointing at open files.",
  },
  {
    id: "en-passant-rule",
    title: "En passant: the rule",
    tactic: "Opening",
    intro:
      "Black has just played ...d7-d5, sprinting two squares to slip past your pawn on e5. The en-passant rule stops that trick: you may capture the pawn as if it had only moved one square — but only on this very move.",
    position: pos({ e5: "wp", d5: "bp", g1: "wk", g8: "bk", h7: "bp" }),
    context: epAt("d6"),
    steps: [
      {
        task: "Capture the pawn in passing — take on d6.",
        accept: [mv("e5", "d6")],
        reply: mv("h7", "h6"),
        explain:
          "exd6 e.p.! Your pawn lands on d6 and the black pawn vanishes from d5 — the one capture in chess where you don't finish on the captured piece's square.",
        hint: {
          text: "Your pawn captures diagonally onto the empty d6 square.",
          arrow: mv("e5", "d6"),
        },
        traps: [
          {
            to: rc("e6"),
            text: "Pushing past keeps the pawns locked and lets the d5 pawn live. The en-passant capture is offered for one move only — use it or lose it.",
          },
        ],
      },
    ],
    outro:
      "Three conditions: your pawn is on its fifth rank, an enemy pawn beside it has just double-stepped, and you capture *immediately*. Wait a move and the right is gone forever.",
  },
  {
    id: "en-passant-tactic",
    title: "En passant as a weapon",
    tactic: "Offense",
    intro:
      "En passant isn't only a rule to remember — it's a tactic. Black just played ...f7-f5, hoping to blunt your attack by keeping the position closed. Open it back up.",
    position: pos({
      e5: "wp", f5: "bp", d1: "wr", h1: "wk",
      g8: "bk", g7: "bp", h7: "bp", f8: "br", a7: "bp",
    }),
    context: epAt("f6"),
    steps: [
      {
        task: "Punish the pawn advance — capture en passant.",
        accept: [mv("e5", "f6")],
        reply: mv("g7", "f6"),
        explain:
          "exf6 e.p.! Black had to recapture with the g-pawn, and look what happened to that king: the pawn shelter is shattered and the g-file is open.",
        hint: { text: "Take on f6 in passing.", arrow: mv("e5", "f6") },
      },
      {
        task: "Occupy the file you just opened.",
        accept: [mv("d1", "g1")],
        reply: null,
        explain:
          "Rg1! Black's g-pawn was dragged off to f6, so the g-file is wide open and the rook stares straight at the king. A pawn advance that looked defensive became the weakness that lost the game.",
        hint: { text: "The g-file has no pawn on it any more.", arrow: mv("d1", "g1") },
      },
    ],
    outro:
      "Whenever an enemy pawn double-steps past yours, stop and ask what the capture would open. Often the file it exposes is worth more than the pawn.",
  },
  {
    id: "keysquares",
    title: "Endgame: escort the pawn home",
    tactic: "Endgame",
    intro:
      "King and pawn against king — the ending every game can become. With your king *in front* of the pawn, the win is a forced march.",
    position: pos({ d6: "wk", e6: "wp", e8: "bk" }),
    steps: [
      {
        task: "Advance the pawn — the king can't stop it.",
        accept: [mv("e6", "e7")],
        reply: mv("e8", "f7"),
        explain:
          "The pawn takes e7 while your king guards it. Black's king must step aside — it can't reach d8 or f8 (your pawn covers both).",
        hint: { text: "Push the pawn; your king protects e7.", arrow: mv("e6", "e7") },
      },
      {
        task: "Shoulder the enemy king away from the queening square.",
        accept: [mv("d6", "d7")],
        reply: mv("f7", "f6"),
        explain:
          "Kd7 seizes e8 by force. Black can never touch the pawn again — promotion is unstoppable.",
        hint: { text: "Your king takes control of e8.", arrow: mv("d6", "d7") },
      },
      {
        task: "Promote!",
        accept: [mv("e7", "e8")],
        reply: null,
        explain: "A new queen. King in front of the pawn + opposition = win, every time.",
        hint: { text: "March the pawn to the last rank.", arrow: mv("e7", "e8") },
      },
    ],
    outro:
      "Rule to remember: in king-and-pawn endings, the king leads and the pawn follows — not the other way around.",
  },
  {
    id: "square",
    title: "Endgame: the square rule",
    tactic: "Endgame",
    intro:
      "Can the defending king catch a runner? Draw a square from the pawn to the promotion rank — if the king can't step inside it, the pawn wins the race. Here Black's king stands one square outside.",
    position: pos({ a4: "wp", h1: "wk", f6: "bk" }),
    steps: [
      {
        task: "Start the race.",
        accept: [mv("a4", "a5")],
        reply: mv("f6", "e6"),
        explain: "The square is now a5–e5–e8–a8. Black's king on e6 is inside… by exactly one step too few.",
        hint: { text: "Run! Push the a-pawn.", arrow: mv("a4", "a5") },
      },
      {
        task: "Keep running — don't hesitate.",
        accept: [mv("a5", "a6")],
        reply: mv("e6", "d6"),
        explain: "Every push shrinks the square. The king chases but never gains a tempo.",
        hint: { text: "Push again.", arrow: mv("a5", "a6") },
      },
      {
        task: "One more push.",
        accept: [mv("a6", "a7")],
        reply: mv("d6", "c7"),
        explain: "The king arrives at c7 one move too late — a8 is out of reach.",
        hint: { text: "Push.", arrow: mv("a6", "a7") },
      },
      {
        task: "Promote.",
        accept: [mv("a7", "a8")],
        reply: null,
        explain: "Queen! Count the square *before* you commit to a pawn race — it decides the game in one glance.",
        hint: { text: "a8 makes a queen.", arrow: mv("a7", "a8") },
      },
    ],
    outro:
      "The square rule works both ways — use it to know when your pawn queens, and when your king must run back.",
  },
  {
    id: "philidor",
    title: "Endgame: the Philidor draw",
    tactic: "Endgame",
    intro:
      "Rook endgame, a pawn down — but drawable with the famous Philidor method. The pawn has just advanced to e3, so the passive defense is over: your rook belongs *behind* the enemy king now.",
    position: pos({ e1: "wk", a3: "wr", e5: "bk", e3: "bp", h7: "br" }),
    steps: [
      {
        task: "Send your rook to the far rank, behind the enemy king.",
        accept: [mv("a3", "a8")],
        reply: mv("e5", "e4"),
        explain:
          "Once the pawn advanced, the king lost its shelter square — from a8 your rook checks forever.",
        hint: { text: "The eighth rank is the rook's home now.", arrow: mv("a3", "a8") },
      },
      {
        task: "Start checking from behind.",
        accept: [mv("a8", "e8")],
        reply: mv("e4", "d3"),
        explain:
          "Check! The king has nowhere to hide from rear checks — step forward and it abandons the pawn, step back and nothing has changed. That's the Philidor draw.",
        hint: { text: "Check along the e-file, from behind.", arrow: mv("a8", "e8") },
      },
    ],
    outro:
      "The full method: keep your rook on your third rank while the pawn waits, and the instant it advances, switch to endless checks from behind.",
  },
  {
    id: "rookroller",
    title: "Endgame: the rook mate",
    tactic: "Endgame",
    intro:
      "King and rook against king — the mate every player must be able to force. The kings stand shoulder to shoulder; the rook delivers the final blow on the edge.",
    position: pos({ a8: "bk", b6: "wk", h7: "wr" }),
    steps: [
      {
        task: "Deliver checkmate in one move.",
        accept: [mv("h7", "h8")],
        reply: null,
        explain:
          "Checkmate! Your king takes away a7 and b7; the rook seals the back rank. King boxes, rook strikes.",
        hint: { text: "The rook slides to the eighth rank.", arrow: mv("h7", "h8") },
      },
    ],
    outro:
      "The method in full: use the rook to fence the king onto the edge, walk your own king up for the shoulder block, then mate.",
    endsInMate: true,
  },
];
