/**
 * online.js — the rules of talking to another player's device.
 *
 * Everything here is pure, so it is unit-tested without a network. The
 * transport (peer-to-peer today, perhaps a hosted relay later) only moves
 * these messages around; it never decides anything.
 *
 * Two principles shape it:
 *
 *   - **Never trust the wire.** A message from the other device is untrusted
 *     input. Its shape is checked before anything reads it, and a move is only
 *     ever applied if it is one of the legal moves of the position on *this*
 *     board. A peer cannot make you play an illegal move, whatever it sends.
 *
 *   - **Phones drop connections.** iOS suspends an app the moment you switch
 *     to Messages to send the link. So every move carries its ply number, and
 *     on reconnecting both sides swap their full move lists and the shorter
 *     one catches up. Moves are never lost or applied twice.
 */

import { legalMoves, squareName } from "./engine.js";

export const PROTOCOL_VERSION = 1;

/**
 * Where the game is published. Used for share links from inside the native
 * app, whose own address (capacitor://localhost) would mean nothing to the
 * person receiving the link.
 */
export const PUBLIC_URL = "https://nigam-codes.github.io/ChessEngine/";

/* ------------------------------------------------------------------ */
/* Room codes and links                                                */
/* ------------------------------------------------------------------ */

// No 0/o, 1/l/i: a code read aloud or typed from a screenshot must not be
// ambiguous. 30 symbols, 8 long ≈ 6.5 × 10^11 codes — collisions on a shared
// public broker are not a practical concern.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 8;

/** A fresh room code. `rng` is injectable so tests are deterministic. */
export function makeRoomCode(rng = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(rng() * ALPHABET.length) % ALPHABET.length];
  }
  return code;
}

/** Codes are shown in two groups, "k7m2-qx9p", because people read them out. */
export function formatCode(code) {
  return code.slice(0, 4) + "-" + code.slice(4);
}

/** The id the host registers with the broker. Namespaced to avoid strangers. */
export function peerIdFor(code) {
  return `chess-engine-lab-${code}`;
}

/** The link you send. `base` is this page's own address on the web. */
export function shareLink(code, base = PUBLIC_URL) {
  const clean = base.split("#")[0];
  return `${clean}#join=${code}`;
}

/**
 * Accept whatever the person pasted — the whole link, the code with its dash,
 * shouty capitals, stray spaces — and return the normalised code, or null.
 */
export function parseJoin(input) {
  if (typeof input !== "string") return null;
  const fromLink = input.match(/[#&?]join=([^&\s]+)/i);
  const raw = (fromLink ? fromLink[1] : input).toLowerCase().replace(/[\s-]/g, "");
  if (raw.length !== CODE_LENGTH) return null;
  for (const ch of raw) if (!ALPHABET.includes(ch)) return null;
  return raw;
}

/* ------------------------------------------------------------------ */
/* Moves on the wire                                                   */
/* ------------------------------------------------------------------ */

const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = new Set(["q", "r", "b", "n"]);

const parseSquare = (name) => ({ r: 8 - Number(name[1]), c: name.charCodeAt(0) - 97 });

/**
 * A move as it travels: from, to, and the promotion piece if any. Castling is
 * the king's two-square step and en passant is the pawn's diagonal, exactly as
 * the engine already represents them, so neither needs a special case.
 */
export function encodeMove(move) {
  return {
    from: squareName(move.fromR, move.fromC),
    to: squareName(move.toR, move.toC),
    promotion: move.promotion ? move.promotion[1] : null,
  };
}

/** The same move as a compact string, for move lists: "e2e4", "a7b8n". */
export function moveToUci(move) {
  const w = encodeMove(move);
  return w.from + w.to + (w.promotion || "");
}

export function uciToWire(uci) {
  if (typeof uci !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || null };
}

/**
 * Turn a wire move back into a real move — *only* if it is legal for `color`
 * in this position. Returns null for anything else, including a promotion
 * that doesn't name its piece, which would otherwise be ambiguous.
 */
export function moveFromWire(board, color, ctx, wire) {
  if (!wire || !SQUARE.test(wire.from) || !SQUARE.test(wire.to)) return null;
  if (wire.promotion != null && !PROMOTIONS.has(wire.promotion)) return null;
  const f = parseSquare(wire.from);
  const t = parseSquare(wire.to);
  return (
    legalMoves(board, color, ctx).find(
      (m) =>
        m.fromR === f.r &&
        m.fromC === f.c &&
        m.toR === t.r &&
        m.toC === t.c &&
        (m.promotion ? m.promotion === color + wire.promotion : wire.promotion == null)
    ) || null
  );
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

const isInt = (n) => Number.isInteger(n) && n >= 0;

/**
 * Check a message's shape before anything reads it. The other device is not
 * trusted — a bug, an old version, or someone poking at the connection must
 * not be able to crash the game or reach code with unexpected types.
 */
export function isValidMessage(msg) {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return false;
  switch (msg.type) {
    case "hello":
      return isInt(msg.v) && (msg.role === "host" || msg.role === "guest");
    case "start":
      return isInt(msg.v) && isInt(msg.game) && (msg.hostColor === "w" || msg.hostColor === "b");
    case "move":
      return (
        isInt(msg.game) &&
        isInt(msg.ply) &&
        !!msg.move &&
        typeof msg.move.from === "string" &&
        typeof msg.move.to === "string"
      );
    case "sync":
      return (
        isInt(msg.game) &&
        Array.isArray(msg.moves) &&
        msg.moves.length <= 1000 &&
        msg.moves.every((m) => uciToWire(m) !== null)
      );
    case "resign":
    case "draw-offer":
    case "rematch":
      return isInt(msg.game);
    case "draw-answer":
      return isInt(msg.game) && typeof msg.accept === "boolean";
    default:
      return false;
  }
}

/**
 * Where an incoming move sits relative to our own game. Each move carries the
 * index of the ply it is, so a move that arrives twice (resent after a drop)
 * is recognised and ignored, and one that arrives early means we missed
 * something and should ask for the full list.
 */
export function classifyIncoming(localPlies, msgPly) {
  if (msgPly === localPlies) return "apply";
  if (msgPly < localPlies) return "duplicate";
  return "gap";
}

/**
 * Reconcile two move lists after a reconnect. Both devices only ever apply
 * legal moves in turn, so normally one list is simply a prefix of the other —
 * someone missed the last move or two — and the short side catches up.
 *
 * A genuine fork should be impossible, but a connection is not a proof: if it
 * happens, the host's list wins. A deterministic rule beats two phones each
 * insisting they are right.
 */
export function resolveSync(local, remote, { isHost }) {
  const same = (n) => local.slice(0, n).every((m, i) => m === remote[i]);
  if (local.length === remote.length && same(local.length)) {
    return { action: "none" };
  }
  if (local.length < remote.length && same(local.length)) {
    return { action: "apply", moves: remote.slice(local.length) };
  }
  if (remote.length < local.length && same(remote.length)) {
    return { action: "wait" }; // they are behind; our sync message catches them up
  }
  return isHost ? { action: "wait" } : { action: "replace", moves: remote };
}
