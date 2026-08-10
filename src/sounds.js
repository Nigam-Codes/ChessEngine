/**
 * sounds.js — the noises a chess board makes.
 *
 * Everything is synthesised with Web Audio rather than shipped as files:
 * chess.com's own samples are copyrighted, and generating short percussive
 * tones in code costs no download weight and stays tunable.
 *
 * Two browser realities shape the design:
 *
 *   - an AudioContext created before a user gesture is born "suspended" and
 *     stays silent, so the context is built lazily on the first real click and
 *     then reused for the rest of the session;
 *   - none of this exists in Node, so every entry point is a no-op when
 *     Web Audio is missing. That keeps the module importable by tests.
 */

const STORAGE_KEY = "chess-lab-muted-v1";

let ctx = null;
let muted = false;

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Read the persisted mute preference. Safe to call anywhere. */
export function loadMuted() {
  const store = storage();
  if (!store) return false;
  try {
    muted = store.getItem(STORAGE_KEY) === "1";
  } catch {
    muted = false;
  }
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  const store = storage();
  try {
    if (store) store.setItem(STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Storage blocked — the preference just won't survive a reload.
  }
  return muted;
}

export function isMuted() {
  return muted;
}

/**
 * Get (or lazily build) the AudioContext. Returns null where Web Audio does
 * not exist, which is every non-browser environment.
 */
function audio() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Browsers suspend contexts created outside a gesture; nudge it awake.
  if (ctx.state === "suspended") ctx.resume?.();
  return ctx;
}

/**
 * One shaped tone. Chess pieces are wood on wood, so the useful ingredients
 * are a fast attack, a short exponential decay, and a low-ish frequency that
 * drops slightly — that "thock" rather than a musical beep.
 */
function tone(
  ac,
  { freq = 220, endFreq = null, duration = 0.09, type = "triangle", gain = 0.18, delay = 0 }
) {
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
  // A tiny ramp instead of an instant jump avoids the click of a hard edge.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/**
 * A short burst of filtered noise — the woody component of a piece landing.
 * A pure oscillator alone sounds like a synth; the noise is what sells it.
 */
function knock(ac, { gain = 0.2, duration = 0.05, freq = 1400 } = {}) {
  const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decay the noise so it reads as an impact rather than a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = freq;
  const env = ac.createGain();
  env.gain.value = gain;
  src.connect(filter);
  filter.connect(env);
  env.connect(ac.destination);
  src.start();
}

/**
 * The sound set. Each is deliberately under ~200ms — anything longer gets
 * tiring in a bullet game where you hear it every second.
 */
const VOICES = {
  move: (ac) => {
    knock(ac, { gain: 0.16, duration: 0.045, freq: 1200 });
    tone(ac, { freq: 180, endFreq: 120, duration: 0.07, gain: 0.1 });
  },
  capture: (ac) => {
    // Harder and grittier than a quiet move — something was taken.
    knock(ac, { gain: 0.3, duration: 0.07, freq: 2200 });
    tone(ac, { freq: 130, endFreq: 80, duration: 0.11, gain: 0.16, type: "sawtooth" });
  },
  castle: (ac) => {
    // Two taps, because two pieces moved.
    knock(ac, { gain: 0.16, duration: 0.04, freq: 1200 });
    knock(ac, { gain: 0.14, duration: 0.04, freq: 1000 });
    tone(ac, { freq: 160, endFreq: 120, duration: 0.07, gain: 0.1, delay: 0.09 });
  },
  check: (ac) => {
    // Rising two-note figure: attention, not alarm.
    tone(ac, { freq: 620, duration: 0.1, gain: 0.14, type: "triangle" });
    tone(ac, { freq: 930, duration: 0.13, gain: 0.13, type: "triangle", delay: 0.09 });
  },
  promote: (ac) => {
    tone(ac, { freq: 520, duration: 0.09, gain: 0.13 });
    tone(ac, { freq: 780, duration: 0.09, gain: 0.13, delay: 0.08 });
    tone(ac, { freq: 1040, duration: 0.16, gain: 0.13, delay: 0.16 });
  },
  gameEnd: (ac) => {
    // Falling figure — it's over.
    tone(ac, { freq: 500, duration: 0.16, gain: 0.14 });
    tone(ac, { freq: 400, duration: 0.16, gain: 0.14, delay: 0.14 });
    tone(ac, { freq: 300, duration: 0.3, gain: 0.15, delay: 0.28 });
  },
  lowTime: (ac) => {
    // The blitz heartbeat.
    tone(ac, { freq: 880, duration: 0.06, gain: 0.12, type: "square" });
  },
  illegal: (ac) => {
    tone(ac, { freq: 150, endFreq: 90, duration: 0.12, gain: 0.13, type: "sawtooth" });
  },
};

/**
 * Play a named sound. Never throws: a missing name, a muted session, or a
 * browser without Web Audio all just return false.
 */
export function playSound(name) {
  if (muted) return false;
  const voice = VOICES[name];
  if (!voice) return false;
  const ac = audio();
  if (!ac) return false;
  try {
    voice(ac);
    return true;
  } catch {
    // Audio hardware can fail or be blocked; never let that break a move.
    return false;
  }
}

/** The names available, for tests and for anyone wiring up new events. */
export const SOUND_NAMES = Object.keys(VOICES);

/**
 * Pick the right sound for a move that was just played. Keeps the choice in
 * one place so every caller (your move, the engine's, a drill) agrees.
 */
export function soundForMove(move, { check = false, gameOver = false } = {}) {
  if (gameOver) return "gameEnd";
  if (check) return "check";
  if (move?.promotion) return "promote";
  if (move?.castle) return "castle";
  if (move?.captured) return "capture";
  return "move";
}
