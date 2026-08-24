/**
 * Core regression: the paths every feature shares.
 *
 * Deliberately broad rather than deep — each phase's own behaviour is covered
 * by its unit suite, and what this guards is that the pieces still fit
 * together after a change to any one of them: the move loop, the shared
 * pointer handlers, teacher-mode arrows, history navigation, and the result
 * card. It is the suite to run when you have touched something central.
 */
import { chromium } from "playwright-core";

const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const URL = process.env.APP_URL || "http://localhost:4173/";
const sq = (name) => `button[aria-label^="${name},"]`;

const run = async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL, { waitUntil: "networkidle" });

  const idle = () =>
    page.waitForFunction(() => !/thinking/i.test(document.querySelector(".status").innerText), null, {
      timeout: 60000,
    });
  const centre = async (name) => {
    const b = await page.locator(sq(name)).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
  };

  /* --- The app renders at all -------------------------------------------- */

  if ((await page.$$eval(".board .square", (e) => e.length)) !== 64) {
    throw new Error("the board did not render 64 squares");
  }
  if ((await page.$$eval(".board .piece", (e) => e.length)) !== 32) {
    throw new Error("the opening position did not render");
  }
  console.log("PASS: the app renders a full board");

  /* --- Click to move, and the engine answers ----------------------------- */

  await page.click(sq("e2"));
  await page.click(sq("e4"));
  await page.waitForFunction(() => /e4/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  await idle();
  const plies = await page.$$eval(".move-cell", (e) => e.length);
  if (plies < 2) throw new Error(`the engine did not reply (${plies} plies)`);
  console.log("PASS: click-to-move works and the engine replies");

  /* --- Dragging, and right-drag still draws arrows ------------------------ */

  const [fx, fy] = await centre("d2");
  const [tx, ty] = await centre("d4");
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => /d4/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  console.log("PASS: dragging a piece plays the move");
  await idle();

  const [ax, ay] = await centre("a7");
  const [bx, by] = await centre("a5");
  await page.mouse.move(ax, ay);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(bx, by, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await page.waitForSelector(".board .arrow-layer line", { state: "attached", timeout: 5000 });
  console.log("PASS: right-drag still sketches an arrow, not a move");
  await page.click(sq("h3")); // a left click clears the sketch

  /* --- Teacher mode: coaching and its arrows ----------------------------- */

  await page.check('label:has-text("Teacher mode") input');
  await idle();
  await page.click(sq("g1"));
  await page.click(sq("f3"));
  await page.waitForSelector(".panel-coach", { timeout: 60000 });
  await idle();
  const legend = await page.$eval(".arrow-legend", (el) => el.innerText).catch(() => "");
  if (legend && !/threat against you/.test(legend)) {
    throw new Error(`the live arrow legend is wrong: ${legend}`);
  }
  console.log("PASS: teacher mode grades a move and keeps its own arrow legend");

  /* --- History navigation ------------------------------------------------ */

  const live = await page.$eval(".board-nav .move-nav-pos", (el) => el.innerText.trim());
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    (was) => document.querySelector(".board-nav .move-nav-pos").innerText.trim() !== was,
    live,
    { timeout: 5000 }
  );
  if (!(await page.$(".board.history"))) throw new Error("stepping back did not rewind the board");
  await page.keyboard.press("End");
  await page.waitForFunction(() => !document.querySelector(".board.history"), null, { timeout: 5000 });
  console.log("PASS: history navigation rewinds and returns to live");

  /* --- Ending a game: card, and the PNG export --------------------------- */

  await page.click('button:has-text("Resign")');
  await page.waitForSelector(".result-card", { timeout: 5000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click('.result-card button:has-text("Save card")'),
  ]);
  if (!download.suggestedFilename().endsWith(".png")) throw new Error("the card is not a PNG");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached", timeout: 5000 });
  console.log("PASS: the game ends with a result card and exports a PNG");

  /* --- Every mode still opens -------------------------------------------- */

  for (const tab of ["2 Players", "Blitz", "Learn", "Play"]) {
    await page.click(`.mode-tabs button:has-text("${tab}")`);
    await page.waitForTimeout(250);
    if (await page.$(".error-boundary")) throw new Error(`${tab} failed to render`);
  }
  console.log("PASS: every mode tab opens without error");

  if (errors.length) throw new Error("console errors: " + errors.join(" | "));
  console.log("\nALL CORE BROWSER TESTS PASSED");
  await browser.close();
};

run().catch((e) => {
  console.error("BROWSER FAIL:", e.message);
  process.exit(1);
});
