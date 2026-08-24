/**
 * Shared setup for the browser suites: one place that knows where Chromium
 * lives, where the app is served, and how to fail on a console error.
 */
import { chromium } from "playwright-core";

export const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
export const APP_URL = process.env.APP_URL || "http://localhost:4173/";

/** A square button, by algebraic name. */
export const sq = (name) => `button[aria-label^="${name},"]`;

/**
 * Open the app. `init` runs before any page script, for spying on browser
 * APIs the DOM cannot show you.
 */
export async function open({ width = 1280, height = 1900, init = null } = {}) {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  if (init) await page.addInitScript(init);
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  return { browser, page, errors };
}

/** Wait until the engine has stopped searching. */
export const engineIdle = (page) =>
  page.waitForFunction(() => !/thinking/i.test(document.querySelector(".status").innerText), null, {
    timeout: 60000,
  });

/** Click from-square then to-square. */
export async function play(page, from, to) {
  await page.click(sq(from));
  await page.click(sq(to));
}

/** The centre of a square, in page coordinates — for pointer-level tests. */
export async function centre(page, name) {
  const box = await page.locator(sq(name)).boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Standard tail: fail on any console error, then report and close. */
export async function finish(browser, errors, banner) {
  if (errors.length) throw new Error("console errors: " + errors.join(" | "));
  console.log(`\n${banner}`);
  await browser.close();
}

/** Wrap a suite so a failure exits non-zero with a readable message. */
export function main(fn) {
  fn().catch((e) => {
    console.error("BROWSER FAIL:", e.message);
    process.exit(1);
  });
}
