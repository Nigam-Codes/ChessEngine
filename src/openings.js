/**
 * openings.js — naming the opening as it is played.
 *
 * Lines are keyed by **coordinates**, not notation: "e2e4 e7e5 g1f3" rather
 * than "1. e4 e5 2. Nf3". Notation is a rendering decision that has already
 * changed once in this app and may change again; where a piece started and
 * where it landed cannot. It also sidesteps disambiguation entirely.
 *
 * This is a working subset, not an ECO database — a few dozen lines that
 * between them cover most games a learner will actually play. An unknown line
 * returns nothing rather than guessing at a name.
 */

/** Turn moves (as stored in plyLog) into the coordinate strings used here. */
export function movesToPath(moves) {
  const file = "abcdefgh";
  return moves
    .map((m) => `${file[m.fromC]}${8 - m.fromR}${file[m.toC]}${8 - m.toR}`)
    .join(" ");
}

/**
 * Ordered longest-last is not required — `openingFor` picks the longest
 * match — but keeping families together makes the table readable.
 */
export const OPENINGS = [
  // --- 1. e4 ---
  { eco: "B00", name: "King's Pawn Opening", line: "e2e4" },
  { eco: "C20", name: "Open Game", line: "e2e4 e7e5" },
  { eco: "C40", name: "King's Knight Opening", line: "e2e4 e7e5 g1f3" },
  { eco: "C42", name: "Petrov's Defence", line: "e2e4 e7e5 g1f3 g8f6" },
  { eco: "C44", name: "Open Game: Knights", line: "e2e4 e7e5 g1f3 b8c6" },
  { eco: "C45", name: "Scotch Game", line: "e2e4 e7e5 g1f3 b8c6 d2d4" },
  { eco: "C50", name: "Italian Game", line: "e2e4 e7e5 g1f3 b8c6 f1c4" },
  { eco: "C50", name: "Italian Game: Giuoco Piano", line: "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5" },
  { eco: "C55", name: "Italian Game: Two Knights Defence", line: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6" },
  { eco: "C60", name: "Ruy López", line: "e2e4 e7e5 g1f3 b8c6 f1b5" },
  { eco: "C70", name: "Ruy López: Morphy Defence", line: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6" },
  { eco: "C78", name: "Ruy López: Closed", line: "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6" },
  { eco: "C25", name: "Vienna Game", line: "e2e4 e7e5 b1c3" },
  { eco: "C23", name: "Bishop's Opening", line: "e2e4 e7e5 f1c4" },
  { eco: "C30", name: "King's Gambit", line: "e2e4 e7e5 f2f4" },

  { eco: "B20", name: "Sicilian Defence", line: "e2e4 c7c5" },
  { eco: "B22", name: "Sicilian Defence: Alapin", line: "e2e4 c7c5 c2c3" },
  { eco: "B23", name: "Sicilian Defence: Closed", line: "e2e4 c7c5 b1c3" },
  { eco: "B27", name: "Sicilian Defence: Open", line: "e2e4 c7c5 g1f3" },
  { eco: "B30", name: "Sicilian Defence: Old Sicilian", line: "e2e4 c7c5 g1f3 b8c6" },
  { eco: "B40", name: "Sicilian Defence: French Variation", line: "e2e4 c7c5 g1f3 e7e6" },
  { eco: "B50", name: "Sicilian Defence: Classical", line: "e2e4 c7c5 g1f3 d7d6" },
  {
    eco: "B90",
    name: "Sicilian Defence: Najdorf",
    line: "e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6",
  },

  { eco: "C00", name: "French Defence", line: "e2e4 e7e6" },
  { eco: "C01", name: "French Defence", line: "e2e4 e7e6 d2d4 d7d5" },
  { eco: "B10", name: "Caro-Kann Defence", line: "e2e4 c7c6" },
  { eco: "B01", name: "Scandinavian Defence", line: "e2e4 d7d5" },
  { eco: "B02", name: "Alekhine's Defence", line: "e2e4 g8f6" },
  { eco: "B07", name: "Pirc Defence", line: "e2e4 d7d6" },
  { eco: "B06", name: "Modern Defence", line: "e2e4 g7g6" },

  // --- 1. d4 ---
  { eco: "A40", name: "Queen's Pawn Opening", line: "d2d4" },
  { eco: "D00", name: "Closed Game", line: "d2d4 d7d5" },
  { eco: "D06", name: "Queen's Gambit", line: "d2d4 d7d5 c2c4" },
  { eco: "D20", name: "Queen's Gambit Accepted", line: "d2d4 d7d5 c2c4 d5c4" },
  { eco: "D30", name: "Queen's Gambit Declined", line: "d2d4 d7d5 c2c4 e7e6" },
  { eco: "D10", name: "Slav Defence", line: "d2d4 d7d5 c2c4 c7c6" },
  { eco: "A45", name: "Indian Defence", line: "d2d4 g8f6" },
  { eco: "E00", name: "Indian Game", line: "d2d4 g8f6 c2c4" },
  { eco: "E20", name: "Nimzo-Indian Defence", line: "d2d4 g8f6 c2c4 e7e6 b1c3 f8b4" },
  { eco: "E12", name: "Queen's Indian Defence", line: "d2d4 g8f6 c2c4 e7e6 g1f3 b7b6" },
  { eco: "E60", name: "King's Indian Defence", line: "d2d4 g8f6 c2c4 g7g6" },
  { eco: "E90", name: "King's Indian Defence", line: "d2d4 g8f6 c2c4 g7g6 b1c3 f8g7" },
  { eco: "D80", name: "Grünfeld Defence", line: "d2d4 g8f6 c2c4 g7g6 b1c3 d7d5" },
  { eco: "A56", name: "Benoni Defence", line: "d2d4 g8f6 c2c4 c7c5" },
  { eco: "A80", name: "Dutch Defence", line: "d2d4 f7f5" },

  // --- Flank openings ---
  { eco: "A10", name: "English Opening", line: "c2c4" },
  { eco: "A04", name: "Réti Opening", line: "g1f3" },
  { eco: "A02", name: "Bird's Opening", line: "f2f4" },
  { eco: "A01", name: "Larsen's Opening", line: "b2b3" },
  { eco: "A00", name: "King's Fianchetto Opening", line: "g2g3" },
];

/**
 * The most specific opening whose line the game has followed so far.
 *
 * Longest prefix wins: once the game reaches 3. Bc4 it is the Italian, not
 * merely the King's Knight Opening it also still matches. Returns null for a
 * line the table doesn't know, which is honest — a wrong name is worse than
 * no name.
 */
export function openingFor(path) {
  let best = null;
  for (const opening of OPENINGS) {
    if (path === opening.line || path.startsWith(opening.line + " ")) {
      if (!best || opening.line.length > best.line.length) best = opening;
    }
  }
  return best;
}

/** Convenience: name the opening straight from a list of played moves. */
export function openingForMoves(moves) {
  return openingFor(movesToPath(moves));
}
