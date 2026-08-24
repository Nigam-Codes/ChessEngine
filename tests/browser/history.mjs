/**
 * Stepping back through a finished game, and the review's grades on the board.
 *
 * Hot-seat so both sides are scriptable and the engine never moves
 * mid-assertion; the game is ended by resigning, which is the quickest route to
 * the post-game review the badges depend on.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const labelOf = (page, name) => page.$eval(sq(name), (el) => el.getAttribute("aria-label"));
const positions = (page) => page.$$eval(".move-nav-pos", (els) => els.map((e) => e.innerText.trim()));

main(async () => {
  const { browser, page, errors } = await open();

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await page.uncheck('label:has-text("Auto-flip") input');

  // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5
  for (const [f, t] of [
    ["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"], ["f1", "c4"], ["f8", "c5"],
  ]) {
    await play(page, f, t);
  }
  await page.waitForFunction(() => /Bc5/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 5000,
  });
  console.log("PASS: six plies played");

  /* --- Two sets of controls, one definition -------------------------------- */

  const both = await positions(page);
  if (both.length !== 2) throw new Error(`expected two control groups, got ${both.length}`);
  if (both[0] !== "6 / 6" || both[1] !== "6 / 6") {
    throw new Error(`the control groups disagree: ${JSON.stringify(both)}`);
  }
  console.log("PASS: the board and the move list carry the same controls, in step");

  await page.click('.board-nav button[aria-label="Previous move"]');
  await page.waitForFunction(
    () => [...document.querySelectorAll(".move-nav-pos")].every((e) => e.innerText.trim() === "5 / 6"),
    null,
    { timeout: 3000 }
  );
  if (!(await page.$(".board-nav-active"))) throw new Error("the board box should mark itself active");
  await page.click('.board-nav button:has-text("Back to the game")');
  await page.waitForFunction(() => !document.querySelector(".board.history"), null, { timeout: 3000 });
  console.log("PASS: stepping from the board-side box moves both, and returns to live");

  /* --- Clicking a move rewinds --------------------------------------------- */

  await page.click('.move-list button:has-text("e4")');
  await page.waitForSelector(".board.history", { timeout: 3000 });
  if (!/white p/.test(await labelOf(page, "e4"))) throw new Error("e4 should hold a white pawn");
  if (!/empty/.test(await labelOf(page, "e5"))) throw new Error("Black had not played e5 yet");
  if (!/white n/.test(await labelOf(page, "g1"))) throw new Error("the knight should still be home");
  if (!/read-only/.test(await page.$eval(".viewing-note", (el) => el.innerText))) {
    throw new Error("a rewound board must announce itself as read-only");
  }
  console.log("PASS: clicking a move rewinds the board and says the board is read-only");

  /* --- Arrow keys ----------------------------------------------------------- */

  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.querySelector(".move-nav-pos").innerText.trim() === "2 / 6",
    null,
    { timeout: 3000 }
  );
  if (!/black p/.test(await labelOf(page, "e5"))) throw new Error("→ should have played 1… e5");
  await page.keyboard.press("Home");
  await page.waitForFunction(
    () => document.querySelector(".move-nav-pos").innerText.trim() === "0 / 6",
    null,
    { timeout: 3000 }
  );
  if (!/white p/.test(await labelOf(page, "e2"))) throw new Error("Home should restore the start");
  console.log("PASS: ← → and Home walk the game");

  /* --- A rewound board is read-only ----------------------------------------- */

  const before = await page.$eval(".move-list", (el) => el.innerText);
  await play(page, "d2", "d4");
  await page.waitForTimeout(250);
  if ((await page.$eval(".move-list", (el) => el.innerText)) !== before) {
    throw new Error("a move was played on a rewound board");
  }
  await page.waitForFunction(() => !document.querySelector(".board.history"), null, { timeout: 3000 });
  console.log("PASS: no move can be played while reviewing, and a click returns to live");

  /* --- Grades on the board and in the list ---------------------------------- */

  await page.click('button:has-text("Resign")');
  await page.waitForSelector(".result-card");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached" });
  await page.click('button:has-text("Coach the game")');
  await page.waitForFunction(() => document.querySelectorAll(".move-mark").length > 0, null, {
    timeout: 120000,
  });
  const allowed = ["★", "✓", "?!", "?", "??"];
  const marks = await page.$$eval(".move-mark", (els) => els.map((e) => e.innerText.trim()));
  for (const m of marks) {
    if (!allowed.includes(m)) throw new Error(`unexpected grade mark ${JSON.stringify(m)}`);
  }
  console.log(`PASS: every graded move is marked — ${marks.join(" ")}`);

  await page.click('.move-list button:has-text("Nf3")');
  await page.waitForSelector(".board.history");
  const badge = await page.$eval(".grade-badge", (el) => ({
    text: el.innerText.trim(),
    cls: el.className,
    square: el.closest("button").getAttribute("aria-label").split(",")[0],
  }));
  if (badge.square !== "f3") throw new Error(`the badge belongs on f3, not ${badge.square}`);
  if (!allowed.includes(badge.text)) throw new Error(`bad badge text ${badge.text}`);
  console.log(`PASS: the board badge sits on the destination square (f3 "${badge.text}")`);

  // Named alternatives, not \w+ — the class list also contains "grade-badge".
  const bucket = badge.cls.match(/grade-(best|good|inaccuracy|mistake|blunder)/)[1];
  const cellClass = await page.$eval('.move-list button:has-text("Nf3")', (el) => el.className);
  if (!cellClass.includes("move-" + bucket)) {
    throw new Error(`the board says ${bucket}, the move list says ${cellClass}`);
  }
  console.log(`PASS: the board and the move list agree on the grade (${bucket})`);

  await finish(browser, errors, "ALL HISTORY / BADGE TESTS PASSED");
});
