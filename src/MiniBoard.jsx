import React from "react";
import ArrowLayer from "./Arrows.jsx";

// Every glyph carries U+FE0E (text presentation selector): without it, iOS
// renders ♟ as a colored emoji that ignores CSS, so white pawns show black.
export const GLYPHS = {
  wk: "♚︎", wq: "♛︎", wr: "♜︎", wb: "♝︎", wn: "♞︎", wp: "♟︎",
  bk: "♚︎", bq: "♛︎", br: "♜︎", bb: "♝︎", bn: "♞︎", bp: "♟︎",
};

/** A small, non-interactive board for lesson diagrams. */
export default function MiniBoard({ position, highlights = [], arrows = [] }) {
  const marked = new Set(highlights.map(([r, c]) => `${r}-${c}`));
  return (
    <div className="mini-board" aria-hidden="true">
      {position.map((row, r) =>
        row.map((piece, c) => (
          <div
            key={`${r}-${c}`}
            className={
              "mini-square " +
              ((r + c) % 2 === 1 ? "dark" : "light") +
              (marked.has(`${r}-${c}`) ? " hl" : "")
            }
          >
            {piece && (
              <span className={"piece " + (piece[0] === "w" ? "white-piece" : "black-piece")}>
                {GLYPHS[piece]}
              </span>
            )}
          </div>
        ))
      )}
      <ArrowLayer arrows={arrows} />
    </div>
  );
}
