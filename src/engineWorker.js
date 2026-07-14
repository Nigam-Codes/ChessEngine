/**
 * engineWorker.js — runs the engine search off the main thread so the UI
 * stays responsive while the engine thinks at higher depths.
 */
import { bestMove } from "./engine.js";

self.onmessage = (event) => {
  const { board, color, depth } = event.data;
  const result = bestMove(board, color, depth);
  self.postMessage(result);
};
