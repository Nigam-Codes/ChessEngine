/**
 * Castling, en passant, and the board-flip animation.
 *
 * The two special moves are exercised through their Learn drills, which are
 * scripted and so deterministic; the flip is exercised directly, including the
 * case that once left the board stuck shut — interrupting a flip mid-animation.
 */
import { open, sq, engineIdle, finish, main } from "./_harness.mjs";

const firstSquare = (page) =>
  page.$eval(".board button", (el) => el.getAttribute("aria-label").split(",")[0]);

main(async () => {
  const { browser, page, errors } = await open();

  /* --- Castling in a real game -------------------------------------------- */

  for (const [from, to] of [["e2", "e4"], ["g1", "f3"], ["f1", "c4"]]) {
    await engineIdle(page);
    await page.click(sq(from));
    await page.click(sq(to));
    await page.waitForTimeout(150);
  }
  await engineIdle(page);

  // Clicking the rook is the second way in, and the easier one on a phone.
  await page.click(sq("e1"));
  await page.click(sq("h1"));
  await page.waitForFunction(() => /O-O/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  const kingHome = await page.$eval(sq("g1"), (el) => el.getAttribute("aria-label"));
  const rookHome = await page.$eval(sq("f1"), (el) => el.getAttribute("aria-label"));
  if (!/white k/.test(kingHome)) throw new Error(`the king is not on g1: ${kingHome}`);
  if (!/white r/.test(rookHome)) throw new Error(`the rook did not travel with it: ${rookHome}`);
  console.log("PASS: castling by rook-click moves both pieces and notates O-O");

  /* --- En passant, via its drill ------------------------------------------ */

  await page.click('.mode-tabs button:has-text("Learn")');
  await page.waitForSelector(".learn");
  await page.click('[aria-label="Drill categories"] button:has-text("Strategy")');
  const strategy = await page.$$eval('[aria-label="Drills"] button', (e) => e.map((b) => b.innerText));
  if (strategy.length === 0) throw new Error("the Strategy category is empty");
  console.log(`PASS: the Strategy category is populated (${strategy.length} drills)`);

  await page.click('[aria-label="Drill categories"] button:has-text("All")');
  await page.click('[aria-label="Drills"] button:has-text("En passant: the rule")');
  await page.waitForSelector(".drill-task");
  const task = await page.$eval(".drill-task", (el) => el.innerText);
  if (!/pawn/i.test(task)) throw new Error(`unexpected en-passant task: ${task}`);
  console.log("PASS: the en-passant drill loads");

  /* --- Flipping the board -------------------------------------------------- */

  await page.click('.mode-tabs button:has-text("Play")');
  await page.waitForSelector(".controls");
  const start = await firstSquare(page);
  if (start !== "a8") throw new Error(`White should see a8 first, got ${start}`);

  await page.click('button:has-text("Flip board")');
  await page.waitForFunction(
    () =>
      document.querySelector(".board button").getAttribute("aria-label").startsWith("h1") &&
      !document.querySelector(".board.flipping"),
    null,
    { timeout: 8000 }
  );
  console.log("PASS: Flip board turns the board and settles");

  /* --- Interrupting a flip must not leave it squashed --------------------- */

  await page.click('button:has-text("Flip board")');
  await page.waitForTimeout(60); // mid-animation
  await page.click('button:has-text("Flip board")');
  await page.waitForFunction(() => !document.querySelector(".board.flipping"), null, { timeout: 8000 });
  const height = await page.$eval(".board", (el) => el.getBoundingClientRect().height);
  if (height < 100) throw new Error(`the board stayed squashed shut (${height}px)`);
  console.log(`PASS: interrupting a flip recovers cleanly (board is ${Math.round(height)}px tall)`);

  await finish(browser, errors, "ALL CASTLING / EN PASSANT / FLIP TESTS PASSED");
});
