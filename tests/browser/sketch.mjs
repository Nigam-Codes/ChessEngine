/**
 * Sketch arrows, and the rule that makes them useful: an arrow may only go
 * where the piece could actually go, so a plan drawn on the board is a plan
 * that is legal. Plans also chain — a second arrow starts from where the first
 * one landed.
 */
import { open, sq, centre, finish, main } from "./_harness.mjs";

const drag = async (page, from, to, button = "right") => {
  const [fx, fy] = await centre(page, from);
  const [tx, ty] = await centre(page, to);
  await page.mouse.move(fx, fy);
  await page.mouse.down({ button });
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up({ button });
};

const dots = (page) =>
  page.$$eval(".square .dot", (els) =>
    els.map((d) => d.closest("button").getAttribute("aria-label").split(",")[0]).sort()
  );
const arrows = (page) => page.$$eval(".board .arrow-layer line", (els) => els.length);

main(async () => {
  const { browser, page, errors } = await open();

  /* --- A knight may only be sketched in an L ----------------------------- */

  const [gx, gy] = await centre(page, "g1");
  await page.mouse.move(gx, gy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(gx + 5, gy + 5, { steps: 2 });
  const allowed = await dots(page);
  await page.mouse.up({ button: "right" });
  // From g1 a knight has exactly f3, h3 and e2 — and e2 is blocked by a pawn.
  if (!allowed.includes("f3") || !allowed.includes("h3")) {
    throw new Error(`knight destinations wrong: ${JSON.stringify(allowed)}`);
  }
  if (allowed.includes("g3") || allowed.includes("g4")) {
    throw new Error(`a knight was offered a straight-line square: ${JSON.stringify(allowed)}`);
  }
  console.log(`PASS: a knight sketches in an L, not a line (${allowed.join(", ")})`);

  /* --- An illegal target draws nothing ------------------------------------ */

  const before = await arrows(page);
  await drag(page, "g1", "g5"); // not a knight move
  if ((await arrows(page)) !== before) throw new Error("an illegal arrow was drawn");
  console.log("PASS: an arrow to an illegal square is refused");

  /* --- A legal one draws ---------------------------------------------------*/

  await drag(page, "g1", "f3");
  await page.waitForSelector(".board .arrow-layer line", { state: "attached", timeout: 3000 });
  console.log("PASS: a legal arrow is drawn");

  /* --- Plans chain: the next arrow starts where the last one landed ------- */

  const [fx, fy] = await centre(page, "f3");
  await page.mouse.move(fx, fy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(fx + 5, fy + 5, { steps: 2 });
  const chained = await dots(page);
  await page.mouse.up({ button: "right" });
  // The knight is only on f3 in the *plan*, so this proves arrows replay.
  if (!chained.includes("g5") || !chained.includes("e5")) {
    throw new Error(`the plan did not chain from f3: ${JSON.stringify(chained)}`);
  }
  console.log(`PASS: a second arrow chains from the planned square (${chained.join(", ")})`);

  /* --- A same-square drag toggles a highlight ---------------------------- */

  const [hx, hy] = await centre(page, "e5");
  await page.mouse.move(hx, hy);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(hx + 2, hy + 2);
  await page.mouse.up({ button: "right" });
  await page.waitForSelector(".square.user-hl", { timeout: 3000 });
  console.log("PASS: a drag that stays put toggles a square highlight");

  /* --- A left click wipes the sketch ------------------------------------- */

  await page.click(sq("a3"));
  await page.waitForFunction(() => document.querySelectorAll(".board .arrow-layer line").length === 0, null, {
    timeout: 3000,
  });
  if (await page.$(".square.user-hl")) throw new Error("the highlight survived a left click");
  console.log("PASS: a left click clears the whole sketch");

  /* --- Draw mode lets a plain drag sketch, for touch --------------------- */

  // Not :has-text("Draw") — that also matches "Offer draw", which would end
  // the game. The toggle is the one carrying aria-pressed.
  await page.click('button.reset[aria-pressed]:has-text("Draw")');
  await drag(page, "b1", "c3", "left");
  await page.waitForSelector(".board .arrow-layer line", { state: "attached", timeout: 3000 });
  const moves = await page.$$eval(".move-cell", (e) => e.length);
  if (moves !== 0) throw new Error("draw mode played a move instead of sketching");
  console.log("PASS: in draw mode a plain drag sketches and never moves a piece");

  await finish(browser, errors, "ALL SKETCH-ARROW TESTS PASSED");
});
