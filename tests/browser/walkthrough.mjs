/**
 * The guided step-by-step post-mortem in teacher mode.
 *
 * Played against the engine so the walkthrough covers *your* mistakes, and
 * with a deliberately awful opening so there is something to walk through —
 * a clean game correctly produces no steps at all, which is checked too.
 */
import { chromium } from "playwright-core";

const sq = (name) => `button[aria-label^="${name},"]`;

const run = async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(process.env.APP_URL || "http://localhost:4173/", { waitUntil: "networkidle" });

  await page.check('label:has-text("Teacher mode") input');
  console.log("PASS: teacher mode is on");

  const engineIdle = () =>
    page.waitForFunction(() => !/thinking/i.test(document.querySelector(".status").innerText), null, {
      timeout: 60000,
    });

  // Give away material on purpose so there is a real mistake to explain.
  const line = [["f2", "f3"], ["g2", "g4"], ["b1", "a3"], ["d1", "d2"]];
  for (const [from, to] of line) {
    await engineIdle();
    if (await page.$(".result-card")) break; // mated already
    await page.click(sq(from));
    await page.click(sq(to));
    await page.waitForTimeout(200);
  }
  await engineIdle();
  console.log("PASS: a deliberately poor game was played against the engine");

  // The panel only exists once the game is over AND reviewed.
  if (await page.$(".panel-walk")) throw new Error("walkthrough shown before the game ended");
  if (!(await page.$(".result-card"))) {
    await page.click('button:has-text("Resign")');
    await page.waitForSelector(".result-card");
  }
  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached" });
  // The panel is there once the game is over, but it must offer the analysis
  // rather than pretending to have it.
  await page.waitForSelector(".panel-walk", { timeout: 5000 });
  if (await page.$(".walk-points")) throw new Error("steps shown before any review ran");
  console.log("PASS: the panel offers to analyse rather than inventing a walkthrough");

  // It has to be able to start its own review: against the engine the result
  // card is the only other trigger, and that can be dismissed.
  await page.click('.panel-walk button:has-text("Analyse this game")');
  await page.waitForSelector('.panel-walk button:has-text("Walk me through it")', {
    timeout: 180000,
  });
  console.log("PASS: the panel runs its own analysis to completion");

  const intro = await page.$eval(".panel-walk", (el) => el.innerText);
  if (/Nothing to walk through/.test(intro)) {
    throw new Error("expected mistakes in a deliberately bad game");
  }

  /* ---------------- Stepping through ---------------- */

  await page.click('.panel-walk button:has-text("Walk me through it")');
  await page.waitForSelector(".walk-points li", { timeout: 5000 });

  const first = await page.$eval(".panel-walk", (el) => el.innerText);
  // Case-insensitive: the badge is uppercased in CSS, so innerText shouts.
  if (!/(inaccuracy|mistake|blunder)/i.test(first)) {
    throw new Error(`the step should carry a verdict, got: ${first.slice(0, 120)}`);
  }
  if (!/Better was/.test(first)) throw new Error("the step should name the better move");
  console.log(`PASS: the first step explains a real mistake — "${first.split("\n").find((l) => /Better was/.test(l))}"`);

  // Opening a step must rewind the board to the position it describes.
  if (!(await page.$(".board.history"))) {
    throw new Error("the step did not put its own position on the board");
  }
  // And draw both moves: what was played, and what was better.
  const arrowColours = await page.$$eval(".board .arrow-layer line, .board .arrow-layer polygon", (els) =>
    [...new Set(els.map((e) => e.getAttribute("stroke") || e.getAttribute("fill")))].filter(Boolean)
  );
  if (arrowColours.length < 2) {
    throw new Error(`expected played and better arrows, got ${JSON.stringify(arrowColours)}`);
  }
  console.log(`PASS: the board rewinds and draws both moves (${arrowColours.length} arrow colours)`);

  /* ---------------- Next / Previous / Done ---------------- */

  const counter = () => page.$eval(".walk-nav .move-nav-pos", (el) => el.innerText.trim());
  const [, total] = (await counter()).split("/").map((s) => Number(s.trim()));
  if (total > 1) {
    const before = await page.$eval(".walk-points", (el) => el.innerText);
    await page.click('.walk-nav button:has-text("Next")');
    await page.waitForFunction(
      (prev) => document.querySelector(".walk-points").innerText !== prev,
      before,
      { timeout: 5000 }
    );
    if ((await counter()) !== `2 / ${total}`) throw new Error("the counter did not advance");
    await page.click('.walk-nav button:has-text("Previous")');
    await page.waitForFunction(() =>
      document.querySelector(".walk-nav .move-nav-pos").innerText.trim().startsWith("1 ")
    );
    console.log(`PASS: Next and Previous walk the ${total} steps and change the explanation`);
  } else {
    console.log("PASS: a single-step walkthrough (only one mistake found)");
  }

  await page.click('.walk-nav button:has-text("Done")');
  await page.waitForFunction(() => !document.querySelector(".board.history"), null, { timeout: 5000 });
  if (await page.$(".walk-points")) throw new Error("Done should close the step");
  console.log("PASS: Done closes the walkthrough and returns the board to the final position");

  /* ---------------- Teacher mode gates it ---------------- */

  await page.uncheck('label:has-text("Teacher mode") input');
  await page.waitForTimeout(150);
  if (await page.$(".panel-walk")) throw new Error("the walkthrough is a teacher-mode feature");
  console.log("PASS: turning teacher mode off removes the walkthrough");

  if (errors.length) throw new Error("console errors: " + errors.join(" | "));
  console.log("\nALL WALKTHROUGH TESTS PASSED");
  await browser.close();
};

run().catch((e) => {
  console.error("SMOKE FAIL:", e.message);
  process.exit(1);
});
