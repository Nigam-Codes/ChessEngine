/**
 * Learn mode: the drills, their feedback, and the category filter.
 *
 * Drills are scripted — a fixed position, a list of accepted moves, and a
 * canned reply — so unlike the engine they are fully deterministic, and the
 * suite can assert exact wording.
 */
import { open, sq, finish, main } from "./_harness.mjs";

main(async () => {
  const { browser, page, errors } = await open();
  await page.click('.mode-tabs button:has-text("Learn")');
  await page.waitForSelector(".learn");

  const feedback = () => page.$eval(".drill-feedback", (el) => el.innerText).catch(() => "");
  const task = () => page.$eval(".drill-task", (el) => el.innerText);

  /* --- The first drill loads and states its task ------------------------- */

  await page.click('[aria-label="Drills"] button:has-text("The knight fork")');
  await page.waitForSelector(".drill-task");
  if (!/knight/i.test(await task())) throw new Error(`unexpected task: ${await task()}`);
  console.log("PASS: a drill loads with its task");

  /* --- A wrong move is explained, not just rejected ---------------------- */

  await page.click(sq("b5"));
  await page.click(sq("d6")); // a legal knight move, but not the fork
  await page.waitForSelector(".feedback-bad", { timeout: 5000 });
  const wrong = await feedback();
  if (wrong.length < 10) throw new Error(`the wrong move got no explanation: "${wrong}"`);
  console.log(`PASS: a wrong move is corrected — "${wrong.split("\n")[0].slice(0, 60)}…"`);

  /* --- The hint draws the answer ----------------------------------------- */

  await page.click('button:has-text("Restart drill")');
  await page.click('button:has-text("Hint")');
  await page.waitForSelector(".feedback-hint", { timeout: 5000 });
  await page.waitForSelector(".learn .arrow-layer line", { state: "attached", timeout: 5000 });
  console.log("PASS: the hint explains and draws a green arrow");

  /* --- The right move is accepted and the scripted reply plays ----------- */

  await page.click('button:has-text("Restart drill")');
  await page.click(sq("b5"));
  await page.click(sq("c7"));
  await page.waitForSelector(".feedback-good", { timeout: 5000 });
  // The drill's canned reply is Ka8-b7, so the king must have moved.
  await page.waitForFunction(
    () => /black k/.test(document.querySelector('button[aria-label^="b7,"]').getAttribute("aria-label")),
    null,
    { timeout: 5000 }
  );
  console.log("PASS: the fork is accepted and the scripted reply is played");

  /* --- Finishing the drill ----------------------------------------------- */

  await page.click(sq("c7"));
  await page.click(sq("e8"));
  await page.waitForSelector(".drill-done", { timeout: 5000 });
  console.log("PASS: taking the rook completes the drill");

  /* --- Category filter --------------------------------------------------- */

  await page.click('[aria-label="Drill categories"] button:has-text("Opening")');
  const titles = await page.$$eval('[aria-label="Drills"] button', (els) =>
    els.map((e) => e.innerText)
  );
  if (titles.length === 0) throw new Error("the Opening category is empty");
  if (titles.some((t) => /knight fork/i.test(t))) {
    throw new Error("a tactics drill leaked into the Opening category");
  }
  if (!titles.some((t) => /Italian/i.test(t))) {
    throw new Error(`expected the Italian drill under Opening, got ${JSON.stringify(titles)}`);
  }
  console.log(`PASS: the category filter narrows the list (${titles.length} opening drills)`);

  // And a drill from the filtered list still plays.
  await page.click('[aria-label="Drills"] button:has-text("Italian")');
  await page.waitForSelector(".drill-task");
  await page.click(sq("e2"));
  await page.click(sq("e4"));
  await page.waitForSelector(".feedback-good", { timeout: 5000 });
  console.log("PASS: a drill from the filtered list accepts its first move");

  await finish(browser, errors, "ALL LEARN-MODE TESTS PASSED");
});
