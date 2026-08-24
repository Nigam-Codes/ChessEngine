/**
 * The draws that need more than a board to see, and the ply log they depend on.
 *
 * Threefold repetition is unprovable without the whole game, which is why this
 * suite also guards that the engine's own replies are logged — they once were
 * not, and with half the game missing repetition could never be detected and
 * the move-list rewind skipped every reply.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const labelOf = (page, name) => page.$eval(sq(name), (el) => el.getAttribute("aria-label"));

main(async () => {
  const { browser, page, errors } = await open();

  /* --- Threefold repetition ------------------------------------------------- */

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await page.uncheck('label:has-text("Auto-flip") input');

  // Knights out and back twice: the starting position then stands for the
  // third time (start, after ply 4, after ply 8) with White to move.
  for (let cycle = 0; cycle < 2; cycle++) {
    await play(page, "g1", "f3");
    await play(page, "g8", "f6");
    await play(page, "f3", "g1");
    await play(page, "f6", "g8");
  }
  await page.waitForFunction(
    () => /same position three times/.test(document.querySelector(".status").innerText),
    null,
    { timeout: 8000 }
  );
  console.log("PASS: shuffling back to the same position three times is a draw");

  const how = await page.$eval(".result-how", (el) => el.innerText.trim());
  const head = await page.$eval(".result-headline", (el) => el.innerText.trim());
  if (how !== "by threefold repetition") throw new Error(`the card says "${how}"`);
  if (head !== "Draw") throw new Error(`expected a draw headline, got "${head}"`);
  console.log(`PASS: the result card names the rule — "${head}, ${how}"`);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached" });
  const before = await page.$$eval(".move-cell", (e) => e.length);
  await play(page, "e2", "e4");
  await page.waitForTimeout(300);
  if ((await page.$$eval(".move-cell", (e) => e.length)) !== before) {
    throw new Error("a move was accepted after the draw");
  }
  console.log("PASS: the game is really over — no move is accepted");

  /* --- The engine's replies are in the log ---------------------------------- */

  await page.click('.mode-tabs button:has-text("Play")');
  await page.waitForFunction(
    () => !/three times/.test(document.querySelector(".status").innerText),
    null,
    { timeout: 5000 }
  );
  await play(page, "e2", "e4");
  await page.waitForFunction(
    () => document.querySelector(".board-nav .move-nav-pos")?.innerText.trim() === "2 / 2",
    null,
    { timeout: 60000 }
  );
  console.log("PASS: against the engine the log holds both plies, not just yours");

  // Stepping back one lands between your move and the engine's reply. Before
  // the fix this jumped straight to the start.
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => document.querySelector(".move-nav-pos").innerText.trim() === "1 / 2",
    null,
    { timeout: 5000 }
  );
  if (!/white p/.test(await labelOf(page, "e4"))) throw new Error("e4 should hold a white pawn");
  if (!/empty/.test(await labelOf(page, "e2"))) throw new Error("e2 should be empty");
  console.log("PASS: stepping back lands between your move and the engine's reply");

  await page.keyboard.press("Home");
  await page.waitForFunction(
    () => document.querySelector(".move-nav-pos").innerText.trim() === "0 / 2",
    null,
    { timeout: 5000 }
  );
  if (!/white p/.test(await labelOf(page, "e2"))) throw new Error("the start should have a pawn on e2");
  console.log("PASS: and back again to the starting position");

  await finish(browser, errors, "ALL DRAW-RULE TESTS PASSED");
});
