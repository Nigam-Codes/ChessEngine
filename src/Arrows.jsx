import React, { useId } from "react";

/**
 * ArrowLayer — an SVG overlay that draws move/threat arrows on top of a
 * board grid. Coordinates are board squares: { from: [r, c], to: [r, c] }.
 * The parent element must be position: relative; the layer ignores pointer
 * events so squares underneath stay clickable.
 *
 * Colors carry meaning throughout the app:
 *   red   — a threat aimed at you (defensive awareness)
 *   green — a resource for you (hints, escape squares)
 *   blue  — an explanation (the engine's last move, lesson annotations)
 *   yellow — secondary emphasis in lesson diagrams
 */
const COLORS = {
  red: "#ff6b6b",
  green: "#3ecf74",
  blue: "#6ea8fe",
  yellow: "#f2c14e",
};

export default function ArrowLayer({ arrows }) {
  // Marker ids must be unique per rendered SVG or browsers reuse the first.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (!arrows || arrows.length === 0) return null;
  return (
    <svg className="arrow-layer" viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        {Object.entries(COLORS).map(([name, color]) => (
          <marker
            key={name}
            id={`ah-${uid}-${name}`}
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth="3.2"
            markerHeight="3.2"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        ))}
      </defs>
      {arrows.map((a, i) => {
        const color = a.color in COLORS ? a.color : "blue";
        const x1 = a.from[1] * 10 + 5;
        const y1 = a.from[0] * 10 + 5;
        const x2 = a.to[1] * 10 + 5;
        const y2 = a.to[0] * 10 + 5;
        // Stop the shaft short of the target center so the arrowhead
        // lands on it instead of overshooting.
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const t = Math.max(0, (len - 2.4) / len);
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x1 + dx * t}
            y2={y1 + dy * t}
            stroke={COLORS[color]}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.85"
            markerEnd={`url(#ah-${uid}-${color})`}
          />
        );
      })}
    </svg>
  );
}
