/**
 * The installable app: manifest, icons, offline, install prompts, updates.
 *
 * The offline check is the one that matters — "installable" means nothing if
 * the installed app shows a dinosaur on the train. So the network is cut and
 * the app must still open *and the engine must still answer a move*, which
 * proves the engine's worker came from the cache too.
 */
import fs from "node:fs";
import { chromium, devices } from "playwright-core";
import { EXE, APP_URL, sq, main } from "./_harness.mjs";

const SW_PATH = new URL("../../dist/sw.js", import.meta.url).pathname;

main(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];
  const watch = (page) => {
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  };

  /* --- Manifest and icons --------------------------------------------------- */

  const context = await browser.newContext({ viewport: { width: 1100, height: 1500 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(APP_URL, { waitUntil: "networkidle" });

  const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.href);
  const manifest = await (await page.request.get(manifestHref)).json();
  for (const key of ["name", "short_name", "start_url", "display", "icons", "theme_color"]) {
    if (!manifest[key]) throw new Error(`manifest is missing ${key}`);
  }
  if (manifest.display !== "standalone") throw new Error(`display is ${manifest.display}`);
  const sizes = manifest.icons.map((i) => i.sizes);
  if (!sizes.includes("192x192") || !sizes.includes("512x512")) {
    throw new Error(`installability needs 192 and 512 icons, got ${sizes}`);
  }
  if (!manifest.icons.some((i) => i.purpose === "maskable")) throw new Error("no maskable icon");
  for (const icon of manifest.icons) {
    const res = await page.request.get(new URL(icon.src, manifestHref).toString());
    const bytes = await res.body();
    if (res.status() !== 200) throw new Error(`${icon.src} → ${res.status()}`);
    const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    if (`${w}x${h}` !== icon.sizes) throw new Error(`${icon.src} is ${w}x${h}, manifest says ${icon.sizes}`);
  }
  const touch = await page.$eval('link[rel="apple-touch-icon"]', (el) => el.href);
  if ((await page.request.get(touch)).status() !== 200) throw new Error("apple-touch-icon is missing");
  console.log(`PASS: the manifest is complete and every icon it names exists at its stated size (${sizes.join(", ")})`);

  /* --- The service worker takes over --------------------------------------- */

  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true), null, { timeout: 20000 });
  await page.reload({ waitUntil: "networkidle" });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) throw new Error("the service worker never took control of the page");
  console.log("PASS: the service worker installs and controls the page");

  /* --- Offline: the app opens and the engine still plays -------------------- */

  await context.setOffline(true);
  await page.reload({ waitUntil: "load" });
  const squares = await page.$$eval(".board .square", (e) => e.length);
  if (squares !== 64) throw new Error(`offline the board rendered ${squares} squares`);
  await page.click(sq("e2"));
  await page.click(sq("e4"));
  await page.waitForFunction(() => document.querySelectorAll(".move-cell").length >= 2, null, {
    timeout: 30000,
  });
  console.log("PASS: with the network cut, the app opens and the engine still answers a move");
  await context.setOffline(false);

  /* --- Android-style install prompt ---------------------------------------- */

  // Headless Chromium never decides a page is installable on its own, so the
  // browser's event is stood in for — what is under test is our handling.
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = () => {
      window.__prompted = true;
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  await page.waitForSelector('.app-chrome button:has-text("Install")', { timeout: 5000 });
  await page.click('.app-chrome button:has-text("Install")');
  await page.waitForFunction(() => window.__prompted === true, null, { timeout: 5000 });
  await page.waitForSelector(".app-chrome", { state: "detached", timeout: 5000 });
  console.log("PASS: the install prompt is offered, opens the browser's dialog, then gets out of the way");

  /* --- iPhone: the app has to explain installing itself --------------------- */

  const iphone = await browser.newContext({ ...devices["iPhone 13"] });
  const ios = await iphone.newPage();
  watch(ios);
  await ios.goto(APP_URL, { waitUntil: "networkidle" });
  await ios.waitForSelector(".app-chrome", { timeout: 5000 });
  const hint = await ios.$eval(".app-chrome", (el) => el.innerText);
  if (!/Add to Home Screen/.test(hint)) throw new Error(`unexpected iOS hint: ${hint}`);
  await ios.click('.app-chrome button:has-text("Got it")');
  await ios.reload({ waitUntil: "networkidle" });
  await ios.waitForTimeout(400);
  if (await ios.$(".app-chrome")) throw new Error("the iOS hint came back after being dismissed");
  console.log("PASS: on iPhone the app explains Add to Home Screen, once");

  // At phone width nothing scrolls sideways — on a real phone that is the
  // whole page wobbling under your thumb.
  const overflow = await ios.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  if (overflow > 1) throw new Error(`the iPhone layout scrolls sideways by ${overflow}px`);
  console.log("PASS: the iPhone layout fits the screen");
  await iphone.close();

  /* --- A new version: announced, never forced ------------------------------- */

  // Publish a "new version" by changing the deployed worker, as a real deploy
  // would, then restore it whatever happens.
  const original = fs.readFileSync(SW_PATH, "utf8");
  try {
    fs.writeFileSync(SW_PATH, original.replace(/const VERSION = "([0-9a-f]+)"/, 'const VERSION = "$1-next"'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector('.app-chrome:has-text("A new version is ready")', { timeout: 20000 });
    const before = await page.evaluate(() => caches.keys());
    // Announced, not applied: the game in progress is untouched until asked.
    if ((await page.$$eval(".move-cell", (e) => e.length)) < 2) throw new Error("the update disturbed the game");
    await Promise.all([
      page.waitForEvent("load", { timeout: 20000 }),
      page.click('.app-chrome button:has-text("Reload")'),
    ]);
    await page.waitForFunction(async () => (await caches.keys()).some((k) => k.endsWith("-next")), null, {
      timeout: 20000,
    });
    const after = await page.evaluate(() => caches.keys());
    if (after.length !== 1) throw new Error(`old caches were not cleaned up: ${after.join(", ")}`);
    console.log(`PASS: an update is announced, applied only on Reload, and the old cache is removed (${before.length} → ${after.length})`);
  } finally {
    fs.writeFileSync(SW_PATH, original);
  }

  if (errors.length) throw new Error("console errors: " + errors.join(" | "));
  console.log("\nALL INSTALLABLE-APP TESTS PASSED");
  await browser.close();
});
