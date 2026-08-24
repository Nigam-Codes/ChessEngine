/**
 * Two-player hot-seat: both colours playable at one keyboard, auto-flip
 * between turns, a per-colour coach report, and — the point of the mode —
 * the engine never running and your habit profile never being polluted by
 * the other player's moves.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const waitOrient = (page, expected) =>
  page.waitForFunction(
    (exp) => {
      const b = document.querySelector(".board button");
      return (
        b &&
        b.getAttribute("aria-label").split(",")[0] === exp &&
        !document.querySelector(".board.flipping")
      );
    },
    expected,
    { timeout: 8000 }
  );

main(async () => {
  const { browser, page, errors } = await open();

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  console.log("PASS: the 2 Players tab opens with an auto-flip control");

  /* --- Both colours move, and the board turns between them --------------- */

  await play(page, "e2", "e4");
  await page.waitForFunction(() => /Black to move/.test(document.body.innerText), null, {
    timeout: 5000,
  });
  await waitOrient(page, "h1");
  console.log("PASS: White moved, the turn passed and the board flipped for Black");

  await play(page, "e7", "e5");
  await page.waitForFunction(() => /White to move/.test(document.body.innerText), null, {
    timeout: 5000,
  });
  await waitOrient(page, "a8");
  console.log("PASS: Black moved as a human, and the board flipped back");

  if (await page.$(".spinner")) throw new Error("the engine ran during a hot-seat game");
  console.log("PASS: the engine never searches in hot-seat");

  /* --- Auto-flip can be turned off ---------------------------------------- */

  await page.uncheck('label:has-text("Auto-flip") input');
  await play(page, "g1", "f3");
  await page.waitForFunction(() => /Black to move/.test(document.body.innerText), null, {
    timeout: 5000,
  });
  const stayed = await page.$eval(".board button", (el) => el.getAttribute("aria-label"));
  if (!stayed.startsWith("a8")) throw new Error(`the board flipped with auto-flip off: ${stayed}`);
  console.log("PASS: with auto-flip off the board stays put");

  /* --- Per-colour coach report -------------------------------------------- */

  await play(page, "b8", "c6");
  await page.click('button:has-text("Resign")');
  await page.waitForSelector(".result-card");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached" });

  await page.click('button:has-text("Coach the game")');
  await page.waitForSelector(".review-counts", { timeout: 120000 });
  const whiteReport = await page.$eval(".panel-review", (el) => el.innerText);
  await page.click('.panel-review [aria-label="Whose report to show"] button:has-text("Black")');
  await page.waitForTimeout(300);
  const blackReport = await page.$eval(".panel-review", (el) => el.innerText);
  if (whiteReport === blackReport) {
    throw new Error("both players got an identical report — the split is not working");
  }
  console.log("PASS: White and Black get separate coach reports");

  /* --- Hot-seat must not touch your lifetime habit profile ---------------- */

  const habits = await page
    .$eval('[aria-label="Habit tracker"]', (el) => el.innerText)
    .catch(() => null);
  if (habits && /[1-9]\d* \/ [1-9]/.test(habits)) {
    throw new Error("hot-seat play landed in the lifetime habit stats");
  }
  console.log("PASS: an opponent's blunders stay out of your habit profile");

  await finish(browser, errors, "ALL HOT-SEAT TESTS PASSED");
});
