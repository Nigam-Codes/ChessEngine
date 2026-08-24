/**
 * Game furniture: the promotion picker, the capture tray, resign and offer
 * draw, and the result card.
 *
 * The promotion is reached by really playing to it, because the whole point of
 * the picker is the moment a pawn lands on the eighth rank — a hand-placed
 * position would skip the path that gets it there. The line is the fastest
 * promotion two cooperating players can reach:
 *
 *   1. b4 a5  2. bxa5 h6  3. a6 h5  4. a7 h4  5. axb8=?
 *
 * a7 is free because Black's a-pawn left it on move one, and a pawn on a7
 * gives no check, so Black is never forced to react.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const moves = (page) => page.$eval(".move-list", (el) => el.innerText.replace(/\s+/g, " "));

main(async () => {
  const { browser, page, errors } = await open();

  /* --- The tray starts empty ----------------------------------------------- */

  if ((await page.$$(".captured")).length !== 2) throw new Error("expected two capture strips");
  if (await page.$(".captured-piece")) throw new Error("something was captured before move one");
  console.log("PASS: two capture strips, both empty at the start");

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await page.uncheck('label:has-text("Auto-flip") input');

  for (const [f, t] of [
    ["b2", "b4"], ["a7", "a5"], ["b4", "a5"], ["h7", "h6"],
    ["a5", "a6"], ["h6", "h5"], ["a6", "a7"], ["h5", "h4"],
  ]) {
    await play(page, f, t);
  }
  const beforePromo = await moves(page);
  if (!/bxa5/.test(beforePromo)) throw new Error(`expected bxa5 in ${beforePromo}`);
  console.log("PASS: a pawn was walked to the seventh");

  /* --- The picker, and backing out of it ----------------------------------- */

  await play(page, "a7", "b8");
  await page.waitForSelector(".promo-picker", { timeout: 5000 });
  const options = await page.$$eval(".promo-option", (els) =>
    els.map((el) => el.getAttribute("aria-label"))
  );
  for (const piece of ["Queen", "Rook", "Bishop", "Knight"]) {
    if (!options.some((o) => o.includes(piece))) throw new Error(`no ${piece} option: ${options}`);
  }
  console.log(`PASS: the picker offers all four pieces (${options.length})`);

  await page.keyboard.press("Escape");
  await page.waitForSelector(".promo-picker", { state: "detached", timeout: 3000 });
  if ((await moves(page)) !== beforePromo) throw new Error("Escape queened anyway");
  const stillThere = await page.$eval(sq("a7"), (el) => el.getAttribute("aria-label"));
  if (!/white p/.test(stillThere)) throw new Error(`the pawn left a7: ${stillThere}`);
  console.log("PASS: Escape cancels the promotion and leaves the pawn where it was");

  /* --- Underpromotion ------------------------------------------------------ */

  await play(page, "a7", "b8");
  await page.waitForSelector(".promo-picker");
  await page.click('.promo-option[aria-label*="Knight"]');
  await page.waitForFunction(() => /axb8=N/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 5000,
  });
  const onB8 = await page.$eval(sq("b8"), (el) => el.getAttribute("aria-label"));
  if (!/white n/.test(onB8)) throw new Error(`b8 should hold a white knight, got ${onB8}`);
  console.log("PASS: underpromotion plays, notates axb8=N, and puts a knight on b8");

  /* --- The tray and the material lead -------------------------------------- */

  const lead = await page.$$eval(".captured-lead", (els) => els.map((e) => e.innerText.trim()));
  if (!lead.includes("+6")) throw new Error(`expected a +6 lead, got ${JSON.stringify(lead)}`);
  if (lead.length !== 1) throw new Error("only the side that is ahead shows a number");
  console.log(`PASS: the tray shows a single ${lead[0]} to the side that is ahead`);

  /* --- Resigning ------------------------------------------------------------ */

  await page.click('button:has-text("Resign")');
  await page.waitForSelector(".result-card", { timeout: 5000 });
  const headline = await page.$eval(".result-headline", (el) => el.innerText.trim());
  const how = await page.$eval(".result-how", (el) => el.innerText.trim());
  if (headline !== "White wins") throw new Error(`Black resigned, so: ${headline}`);
  if (how !== "by resignation") throw new Error(`unexpected detail: ${how}`);
  console.log(`PASS: resigning ends the game — "${headline}, ${how}"`);

  await page.click(".result-close");
  await page.waitForSelector(".result-card", { state: "detached", timeout: 3000 });
  if (!/axb8=N/.test(await moves(page))) throw new Error("dismissing the card lost the game");
  if (await page.$('button:has-text("Resign")')) {
    throw new Error("Resign still offered after the game ended");
  }
  console.log("PASS: the card dismisses without disturbing the finished game");

  /* --- The engine answers a draw offer -------------------------------------- */

  await page.click('.mode-tabs button:has-text("Play")');
  await page.waitForSelector('button:has-text("Offer draw")');
  await page.click('button:has-text("Offer draw")');
  await page.waitForSelector(".draw-reply", { timeout: 5000 });
  const reply = await page.$eval(".draw-reply", (el) => el.innerText.trim());
  if (!/accepts/.test(reply)) throw new Error(`a level start should be accepted: ${reply}`);
  await page.waitForSelector(".result-card", { timeout: 5000 });
  if ((await page.$eval(".result-headline", (el) => el.innerText.trim())) !== "Draw") {
    throw new Error("an accepted draw offer should end in a draw");
  }
  console.log(`PASS: the engine answers a draw offer — "${reply}"`);

  /* --- Rematch -------------------------------------------------------------- */

  await page.click('.result-card button:has-text("Rematch")');
  await page.waitForSelector(".result-card", { state: "detached", timeout: 5000 });
  if (await page.$(".captured-piece")) throw new Error("the new game kept the old captures");
  await play(page, "e2", "e4");
  await page.waitForFunction(() => /e4/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  console.log("PASS: Rematch clears the board and the game is playable again");

  await finish(browser, errors, "ALL PROMOTION / FURNITURE TESTS PASSED");
});
