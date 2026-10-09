/**
 * peerTransport.js — moves messages between two devices over WebRTC.
 *
 * This is the only file that knows the connection is peer-to-peer. It speaks
 * a deliberately small interface — host, join, send, on, close — so that a
 * hosted relay could replace it later without the game noticing.
 *
 * The broker (PeerJS's free public server by default) only introduces the
 * two devices; once they are connected, moves travel directly between them,
 * encrypted by WebRTC itself.
 *
 * Mobile reality drives most of this file. iOS suspends an app the moment you
 * switch to Messages to send the link, which drops both the broker connection
 * and the game connection. So the host re-registers its id and the guest keeps
 * redialling, both on a timer and the instant the app comes back to the
 * foreground. Statuses are reported as plain strings for the UI:
 *
 *   registering → waiting → connected ⇄ reconnecting,  and  closed | error
 */

import { peerIdFor } from "../online.js";

const RETRY_MS = 2500;

// A peer that vanishes without saying goodbye — which is exactly what iOS
// does to a backgrounded app — can look connected to WebRTC for half a
// minute or more. So both sides tick every few seconds, and silence for three
// ticks means the line is dead whatever WebRTC thinks.
const HEARTBEAT_MS = 3000;
const SILENCE_MS = 9000;
const HEARTBEAT = { __hb: 1 };

/**
 * Broker settings. Tests point this at a local PeerServer by setting
 * `window.__CHESS_BROKER__` before the page loads; there is deliberately no
 * way to change it from a URL, so a crafted link cannot route someone's game
 * through a broker of the sender's choosing.
 */
function brokerOptions() {
  const override = typeof window !== "undefined" ? window.__CHESS_BROKER__ : null;
  return { debug: 0, ...(override || {}) };
}

export function createPeerTransport() {
  const handlers = { message: [], status: [] };
  let peer = null;
  let conn = null;
  let role = null;
  let code = null;
  let status = "idle";
  let closed = false;
  let retryTimer = null;
  let heartbeatTimer = null;
  let lastHeard = 0;

  const emit = (event, value) => handlers[event].forEach((fn) => fn(value));
  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    emit("status", next);
  };

  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  /** Declare the line dead and start recovering from it. */
  const dropped = (c) => {
    if (conn !== c || closed) return;
    conn = null;
    stopHeartbeat();
    try {
      c.close();
    } catch {
      // already gone
    }
    setStatus("reconnecting");
    if (role === "guest") scheduleDial();
  };

  const startHeartbeat = (c) => {
    stopHeartbeat();
    lastHeard = Date.now();
    heartbeatTimer = setInterval(() => {
      if (conn !== c) return stopHeartbeat();
      if (Date.now() - lastHeard > SILENCE_MS) return dropped(c);
      try {
        c.send(HEARTBEAT);
      } catch {
        dropped(c);
      }
    }, HEARTBEAT_MS);
  };

  /** Adopt a data connection — the first one, or a replacement after a drop. */
  const attach = (c) => {
    if (conn && conn !== c) {
      try {
        conn.close();
      } catch {
        // already gone
      }
    }
    conn = c;
    c.on("open", () => {
      if (conn !== c) return;
      clearRetry();
      startHeartbeat(c);
      setStatus("connected");
    });
    c.on("data", (data) => {
      if (conn !== c) return;
      lastHeard = Date.now();
      // Heartbeats are this file's business; the game never sees them.
      if (data && data.__hb) return;
      emit("message", data);
    });
    c.on("close", () => dropped(c));
    c.on("error", () => dropped(c));
  };

  const dial = () => {
    if (closed || !peer || peer.destroyed) return;
    if (peer.disconnected) {
      peer.reconnect();
      return; // the "open" handler dials once the broker is back
    }
    if (conn && conn.open) return;
    attach(peer.connect(peerIdFor(code), { reliable: true, serialization: "json" }));
  };

  const scheduleDial = () => {
    clearRetry();
    if (closed) return;
    retryTimer = setTimeout(dial, RETRY_MS);
  };

  /** Coming back to the foreground is the moment to recover, not 2.5s later. */
  const onVisible = () => {
    if (closed || !peer || document.visibilityState !== "visible") return;
    if (peer.disconnected && !peer.destroyed) peer.reconnect();
    else if (role === "guest" && !(conn && conn.open)) dial();
  };

  async function start(nextRole, nextCode) {
    // Loaded only when someone actually plays online.
    const { Peer } = await import("peerjs");
    role = nextRole;
    code = nextCode;
    closed = false;
    setStatus("registering");

    peer = role === "host" ? new Peer(peerIdFor(code), brokerOptions()) : new Peer(brokerOptions());

    peer.on("open", () => {
      if (role === "host") {
        setStatus(conn && conn.open ? "connected" : "waiting");
      } else {
        dial();
      }
    });

    // Host: the guest (or the guest, again, after a drop) has arrived.
    peer.on("connection", (c) => {
      if (role !== "host") return;
      attach(c);
    });

    // Lost the broker — usually the app was backgrounded. The game connection
    // may well still be up; either way, re-register so the guest can find us.
    peer.on("disconnected", () => {
      if (closed || peer.destroyed) return;
      setTimeout(() => !closed && !peer.destroyed && peer.reconnect(), 500);
    });

    peer.on("error", (err) => {
      if (closed) return;
      const type = err && err.type;
      if (type === "peer-unavailable") {
        // The host isn't online right now — keep trying, they may be
        // switching apps to send us the link.
        setStatus("reconnecting");
        scheduleDial();
      } else if (type === "unavailable-id") {
        // Our own id is still held by the broker from a previous session (a
        // reload is faster than the broker's timeout). Retry until it frees.
        setStatus("reconnecting");
        setTimeout(() => !closed && restart(), RETRY_MS);
      } else if (type === "network" || type === "server-error" || type === "socket-error" || type === "socket-closed") {
        setStatus("reconnecting");
        setTimeout(() => !closed && !peer.destroyed && peer.reconnect(), RETRY_MS);
      } else {
        setStatus("error");
      }
    });

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
  }

  function restart() {
    const r = role;
    const c = code;
    teardown();
    closed = false;
    start(r, c);
  }

  function teardown() {
    clearRetry();
    stopHeartbeat();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
    try {
      conn && conn.close();
    } catch {
      // ignore
    }
    try {
      peer && peer.destroy();
    } catch {
      // ignore
    }
    conn = null;
    peer = null;
  }

  return {
    /** Register as the host of `code` and wait for the guest. */
    host: (c) => start("host", c),
    /** Connect to the host of `code`. */
    join: (c) => start("guest", c),
    /** Send a message. Returns false if there is no open connection right now. */
    send(msg) {
      if (!conn || !conn.open) return false;
      try {
        conn.send(msg);
        return true;
      } catch {
        return false;
      }
    },
    on(event, fn) {
      handlers[event].push(fn);
      return () => {
        handlers[event] = handlers[event].filter((h) => h !== fn);
      };
    },
    close() {
      closed = true;
      teardown();
      setStatus("closed");
    },
    get status() {
      return status;
    },
  };
}
