/**
 * Render every icon and splash screen from one design, so they can be
 * regenerated instead of being mystery binaries. Run with: npm run icons
 *
 * Web icons are full-bleed squares: iOS and Android cut their own rounded
 * corners, and an icon that rounds itself ends up rounded twice. The
 * "maskable" variant keeps the knight inside the central safe zone, because
 * Android may crop it to a circle.
 *
 * Native assets (when android/ and ios/ exist) are written over Capacitor's
 * placeholders *at the sizes the templates already use*, read from the files
 * themselves — so a future template with different sizes still gets the right
 * images. Android's adaptive icon is two layers (a transparent knight over a
 * flat colour); iOS rejects app icons with any transparency, so its icon is
 * opaque.
 *
 * The knight is a font glyph (FreeSerif's), baked into the PNG here — so the
 * phone never needs the font.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const ROOT = new URL("..", import.meta.url).pathname;

// The app's own board colours, so the icon looks like the thing it opens.
const LIGHT = "#5a6684";
const DARK = "#3a4359";
const INK = "#14161c";
// Android's adaptive-icon background: one flat colour behind the knight.
const ADAPTIVE_BG = "#2c3346";

const knight = (px, size) => `
  <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
              font-family:FreeSerif,'DejaVu Sans',serif;font-size:${Math.round(px)}px;line-height:1;
              color:#fafafa;text-shadow:0 ${size * 0.02}px ${size * 0.04}px rgba(0,0,0,.65);
              transform:translateY(-${size * 0.02}px)">♞&#xFE0E;</div>`;

/** The full icon: a corner of the board with a knight on it. */
function boardIcon(size, scale, { round = false } = {}) {
  const cell = size / 4;
  let squares = "";
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      squares += `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${(r + c) % 2 ? DARK : LIGHT}"/>`;
    }
  }
  return `<div style="position:relative;width:${size}px;height:${size}px;overflow:hidden;${round ? "border-radius:50%;" : ""}">
    <svg width="${size}" height="${size}" style="position:absolute;inset:0">${squares}
      <rect width="${size}" height="${size}" fill="url(#g)"/>
      <defs><radialGradient id="g" cx="50%" cy="45%" r="70%">
        <stop offset="0%" stop-color="${INK}" stop-opacity="0"/>
        <stop offset="100%" stop-color="${INK}" stop-opacity="0.75"/>
      </radialGradient></defs>
    </svg>${knight(size * scale, size)}</div>`;
}

const DESIGNS = {
  icon: (w, h, o) => boardIcon(w, o.scale ?? 0.78),
  round: (w) => boardIcon(w, 0.7, { round: true }),
  // Adaptive foreground: 108dp canvas, only the central 72dp is guaranteed
  // visible, and the launcher supplies the background.
  foreground: (w) => `<div style="position:relative;width:${w}px;height:${w}px">${knight(w * 0.5, w)}</div>`,
  splash: (w, h) =>
    `<div style="position:relative;width:${w}px;height:${h}px;background:${INK}">${knight(Math.min(w, h) * 0.26, Math.min(w, h))}</div>`,
};

const pngSize = (file) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );

const jobs = [
  { out: "public/icons/icon-192.png", w: 192, h: 192, design: "icon" },
  { out: "public/icons/icon-512.png", w: 512, h: 512, design: "icon" },
  { out: "public/icons/icon-maskable-512.png", w: 512, h: 512, design: "icon", scale: 0.56 },
  { out: "public/icons/apple-touch-icon.png", w: 180, h: 180, design: "icon", scale: 0.74 },
  { out: "public/icons/favicon-32.png", w: 32, h: 32, design: "icon", scale: 0.92 },
];

const androidRes = join(ROOT, "android/app/src/main/res");
if (existsSync(androidRes)) {
  for (const file of walk(androidRes).filter((f) => f.endsWith(".png"))) {
    const name = file.split("/").pop();
    const design =
      name === "ic_launcher.png" ? "icon" :
      name === "ic_launcher_round.png" ? "round" :
      name === "ic_launcher_foreground.png" ? "foreground" :
      name === "splash.png" ? "splash" : null;
    if (!design) continue;
    const [w, h] = pngSize(file);
    jobs.push({ out: file.slice(ROOT.length), w, h, design, transparent: design !== "icon" && design !== "splash" });
  }
  // The flat colour behind the adaptive icon's knight.
  const bgXml = join(androidRes, "values/ic_launcher_background.xml");
  if (existsSync(bgXml)) {
    writeFileSync(bgXml, readFileSync(bgXml, "utf8").replace(/#[0-9A-Fa-f]{6}/, ADAPTIVE_BG));
  }
}

const iosAssets = join(ROOT, "ios/App/App/Assets.xcassets");
if (existsSync(iosAssets)) {
  for (const file of walk(iosAssets).filter((f) => f.endsWith(".png"))) {
    const [w, h] = pngSize(file);
    jobs.push({ out: file.slice(ROOT.length), w, h, design: file.includes("AppIcon") ? "icon" : "splash" });
  }
}

const browser = await chromium.launch({ executablePath: EXE });
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.w, height: job.h } });
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:${job.transparent ? "transparent" : INK}">` +
      DESIGNS[job.design](job.w, job.h, job) +
      "</body></html>"
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: join(ROOT, job.out),
    clip: { x: 0, y: 0, width: job.w, height: job.h },
    omitBackground: !!job.transparent,
  });
  await page.close();
  console.log(`  ${job.design.padEnd(10)} ${String(job.w).padStart(4)}×${String(job.h).padEnd(4)} ${job.out}`);
}
await browser.close();

// App Store Connect rejects an app icon that has an alpha channel at all, even
// a fully opaque one (ITMS-90717). Chromium writes opaque screenshots as plain
// RGB today; check rather than trust that it always will.
for (const job of jobs.filter((j) => j.out.includes("AppIcon"))) {
  const colourType = readFileSync(join(ROOT, job.out))[25];
  if (colourType !== 2) {
    console.error(`  ✗ ${job.out} has an alpha channel (PNG colour type ${colourType}) — the App Store will reject it`);
    process.exit(1);
  }
}
