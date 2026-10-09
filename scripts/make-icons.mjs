/**
 * Render the app icons from one design, so they can be regenerated instead of
 * being mystery binaries. Run with: node scripts/make-icons.mjs
 *
 * Every icon is a full-bleed square: iOS and Android cut their own rounded
 * corners, and an icon that rounds itself ends up rounded twice. The
 * "maskable" variant keeps the knight inside the central safe zone, because
 * Android may crop it to a circle.
 *
 * The knight is a font glyph (FreeSerif's), baked into the PNG here — so the
 * phone never needs the font.
 */
import { chromium } from "playwright-core";

const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const OUT = new URL("../public/icons/", import.meta.url).pathname;

// The app's own board colours, so the icon looks like the thing it opens.
const LIGHT = "#5a6684";
const DARK = "#3a4359";

function html(size, knightScale) {
  const cell = size / 4;
  let squares = "";
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      squares += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${(r + c) % 2 ? DARK : LIGHT}"/>`;
    }
  }
  const font = Math.round(size * knightScale);
  return `<!doctype html><html><body style="margin:0;background:#14161c">
  <div style="position:relative;width:${size}px;height:${size}px;overflow:hidden">
    <svg width="${size}" height="${size}" style="position:absolute;inset:0">${squares}
      <rect width="${size}" height="${size}" fill="url(#g)"/>
      <defs><radialGradient id="g" cx="50%" cy="45%" r="70%">
        <stop offset="0%" stop-color="#14161c" stop-opacity="0"/>
        <stop offset="100%" stop-color="#14161c" stop-opacity="0.75"/>
      </radialGradient></defs>
    </svg>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
                font-family:FreeSerif,'DejaVu Sans',serif;font-size:${font}px;line-height:1;
                color:#fafafa;text-shadow:0 ${size * 0.02}px ${size * 0.04}px rgba(0,0,0,.65);
                transform:translateY(-${size * 0.02}px)">♞&#xFE0E;</div>
  </div></body></html>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, scale: 0.78 },
  { file: "icon-512.png", size: 512, scale: 0.78 },
  // Android may crop this to a circle: keep the knight inside the safe zone.
  { file: "icon-maskable-512.png", size: 512, scale: 0.56 },
  { file: "apple-touch-icon.png", size: 180, scale: 0.74 },
  { file: "favicon-32.png", size: 32, scale: 0.92 },
];

const browser = await chromium.launch({ executablePath: EXE });
for (const icon of ICONS) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
  await page.setContent(html(icon.size, icon.scale));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT + icon.file, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
  await page.close();
  console.log(`  wrote public/icons/${icon.file} (${icon.size}px)`);
}
await browser.close();
