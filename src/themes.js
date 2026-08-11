/**
 * themes.js — board colour schemes.
 *
 * The board already draws every colour from CSS custom properties, so a theme
 * is a palette swap and nothing else: this module owns the list and the
 * persisted choice, and the stylesheet owns the actual colours under
 * `:root[data-board="..."]`. No colour values live here, so the two can't
 * drift into disagreeing about what "green" means.
 */

const STORAGE_KEY = "chess-lab-board-theme-v1";

export const THEMES = [
  { id: "slate", label: "Slate" },
  { id: "green", label: "Green" },
  { id: "brown", label: "Brown" },
  { id: "blue", label: "Blue" },
];

export const DEFAULT_THEME = "slate";

export function isTheme(id) {
  return THEMES.some((t) => t.id === id);
}

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** The saved theme, or the default. Never throws and never returns junk. */
export function loadTheme() {
  const store = storage();
  if (!store) return DEFAULT_THEME;
  try {
    const saved = store.getItem(STORAGE_KEY);
    return isTheme(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Save the choice and put it on the document, which is what actually changes
 * the colours. An unknown id falls back rather than leaving the board unstyled.
 */
export function applyTheme(id) {
  const theme = isTheme(id) ? id : DEFAULT_THEME;
  const store = storage();
  try {
    if (store) store.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked — the choice just won't survive a reload.
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-board", theme);
  }
  return theme;
}
