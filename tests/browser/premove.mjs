/**
 * Premove: queueing a move while the engine is still searching.
 *
 * The engine has to actually be thinking for a premove to mean anything, so
 * the strength slider goes to maximum first — that buys a long enough search
 * to queue inside, without racing on wall-clock time.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const labelOf = (page, name) => page.$eval(sq(name), (el) => el.getAttribute("aria-label"));
const moveCount = (page) => page.$$eval(".move-cell", (els) => els.length);
const thinking = (page) =>
  page.waitForFunction(() => /thinking/i.test(document.querySelector(".status").innerText), null, {
    timeout: 10000,
  });
const settled = (page) =>
  page.waitForFunction(() => !/thinking/i.test(document.querySelector(".status").innerText), null, {
    timeout: 120000,
  });

main(async () => {
  const { browser, page, errors } = await open();

  // React tracks the last value it set, so assigning el.value directly is
  // ignored — the native setter is what makes the change visible to it.
  await page.$eval('input[aria-label^="Engine strength"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "6");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(
    () => /depth 6/.test(document.querySelector(".strength").innerText),
    null,
    { timeout: 5000 }
  );

  /* --- Queue one ------------------------------------------------------------ */

  await play(page, "e2", "e4");
  await thinking(page);

  // d2-d4 is legal whatever Black replies — nothing can occupy d4 or block
  // d2-d4 in a single move from the starting position — so it must fire.
  await play(page, "d2", "d4");
  await page.waitForSelector(".premove-note", { timeout: 5000 });
  if (!/d2 → d4/.test(await page.$eval(".premove-note", (el) => el.innerText))) {
    throw new Error("the premove was not recorded");
  }
  const marked = await page.$$eval(".square.premove", (els) =>
    els.map((e) => e.getAttribute("aria-label").split(",")[0]).sort()
  );
  if (marked.join(",") !== "d2,d4") throw new Error(`highlighted ${marked}`);
  if (!/white p/.test(await labelOf(page, "d2"))) throw new Error("the pawn left d2 early");
  console.log("PASS: a click during the search queues a premove and marks both squares");

  /* --- It fires when the turn returns ---------------------------------------- */

  await page.waitForFunction(() => /d4/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 120000,
  });
  if (!/white p/.test(await labelOf(page, "d4"))) throw new Error("d4 should hold a white pawn");
  if (await page.$(".premove-note")) throw new Error("the note outlived the move");
  if (await page.$(".square.premove")) throw new Error("the highlight outlived the move");
  console.log("PASS: the premove played itself the moment the turn came back");

  /* --- Cancelling -------------------------------------------------------------*/

  await settled(page);
  await play(page, "b1", "c3");
  await thinking(page);
  await play(page, "g1", "f3");
  await page.waitForSelector(".premove-note");
  const queued = await moveCount(page);
  await page.click('.premove-note button:has-text("Cancel")');
  await page.waitForSelector(".premove-note", { state: "detached", timeout: 5000 });
  await settled(page);
  if ((await moveCount(page)) !== queued + 1) {
    throw new Error("a cancelled premove fired anyway");
  }
  if (!/white n/.test(await labelOf(page, "g1"))) throw new Error("the cancelled knight moved");
  console.log("PASS: a queued premove can be cancelled, and then does not fire");

  /* --- One the engine makes illegal is dropped -------------------------------- */

  // Queue exd5, which is legal only if the engine puts a piece on d5. Rather
  // than assuming what it plays, look at the position it actually produced and
  // assert the matching outcome — so the test stays honest either way.
  await page.click('button:has-text("New game")');
  await play(page, "e2", "e4");
  await thinking(page);
  await play(page, "e4", "d5");
  await page.waitForSelector(".premove-note", { timeout: 5000 });
  const before = await moveCount(page);
  await settled(page);
  await page.waitForTimeout(500); // let the release effect run if it is going to

  const d5 = await labelOf(page, "d5");
  const played = (await moveCount(page)) - before;
  if (/black/.test(d5)) {
    if (played !== 2) throw new Error("d5 was occupied, so exd5 should have fired");
    console.log("PASS: the engine played into the premove, and it fired");
  } else {
    if (played !== 1) throw new Error(`exd5 was illegal but ${played - 1} extra move(s) appeared`);
    if (!/white p/.test(await labelOf(page, "e4"))) throw new Error("the pawn moved anyway");
    if (await page.$(".premove-note")) throw new Error("the dead premove is still queued");
    console.log("PASS: a premove the engine made illegal is discarded, not forced");
  }

  /* --- Hot-seat has none ------------------------------------------------------ */

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await play(page, "e2", "e4");
  await page.waitForTimeout(400);
  if (await page.$(".premove-note")) throw new Error("hot-seat should never queue a premove");
  console.log("PASS: hot-seat plays directly — there is no wait to fill");

  await finish(browser, errors, "ALL PREMOVE TESTS PASSED");
});
