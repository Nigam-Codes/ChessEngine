/**
 * useOnlineSession — the connection to the other player, as React state.
 *
 * Owns the transport, its status, and an *inbox* of validated messages. The
 * game component drains the inbox in an effect rather than reacting inside
 * the transport's callback, for the same reason premoves are released that
 * way: a callback closes over the render it was created in, and applying a
 * move needs the board as it is now, not as it was then.
 *
 * It also remembers the session in localStorage, because on a phone the app
 * is routinely killed in the background. Reopening it resumes the same game
 * with the same code, and a resync with the other device fills in anything
 * that happened in between.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPeerTransport } from "./net/peerTransport.js";
import { isValidMessage, makeRoomCode, PROTOCOL_VERSION } from "./online.js";

const STORAGE_KEY = "chess-lab-online-session-v1";
// A session older than this is a game someone walked away from.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSession() {
  const store = storage();
  if (!store) return null;
  try {
    const s = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (!s || !s.code || !s.role || Date.now() - (s.savedAt || 0) > MAX_AGE_MS) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  const store = storage();
  if (!store) return;
  try {
    if (session) store.setItem(STORAGE_KEY, JSON.stringify({ ...session, savedAt: Date.now() }));
    else store.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: the game still works, it just won't survive a reload.
  }
}

export function useOnlineSession() {
  const transportRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [role, setRole] = useState(null);
  const [code, setCode] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [rejected, setRejected] = useState(0);

  const begin = useCallback(async (nextRole, nextCode) => {
    transportRef.current?.close();
    const t = createPeerTransport();
    transportRef.current = t;
    setRole(nextRole);
    setCode(nextCode);
    setInbox([]);
    // A transport that has been replaced may still fire as it shuts down.
    // Only the current one is allowed to touch state.
    const current = () => transportRef.current === t;
    t.on("status", (s) => current() && setStatus(s));
    t.on("message", (msg) => {
      if (!current()) return;
      if (!isValidMessage(msg)) {
        // Counted rather than silently dropped, so a version mismatch or a
        // misbehaving peer is visible instead of looking like lag.
        setRejected((n) => n + 1);
        return;
      }
      setInbox((box) => [...box, msg]);
    });
    t.on("status", (s) => {
      // Announce ourselves every time the line comes up, first time or not:
      // the hello is what tells the other side to send its move list.
      if (s === "connected") t.send({ type: "hello", v: PROTOCOL_VERSION, role: nextRole });
    });
    if (nextRole === "host") await t.host(nextCode);
    else await t.join(nextCode);
  }, []);

  /** Start hosting a brand-new game. Returns the code to share. */
  const host = useCallback(
    (existingCode) => {
      const c = existingCode || makeRoomCode();
      begin("host", c);
      return c;
    },
    [begin]
  );

  const join = useCallback((c) => begin("guest", c), [begin]);

  const send = useCallback((msg) => transportRef.current?.send(msg) ?? false, []);

  /** Drop the oldest message once the game has dealt with it. */
  const consume = useCallback(() => setInbox((box) => box.slice(1)), []);

  /**
   * Leave the game. `linger` keeps *this* connection open a moment longer so a
   * last message (a resignation) can get out — bound to the connection being
   * left, so it can never cut off a new game started in the meantime.
   */
  const leave = useCallback(({ linger = 0 } = {}) => {
    const t = transportRef.current;
    transportRef.current = null;
    if (t) {
      if (linger) setTimeout(() => t.close(), linger);
      else t.close();
    }
    setStatus("idle");
    setRole(null);
    setCode(null);
    setInbox([]);
    saveSession(null);
  }, []);

  // Never leave a connection open behind an unmounted component.
  useEffect(() => () => transportRef.current?.close(), []);

  return { status, role, code, inbox, rejected, host, join, send, consume, leave };
}
