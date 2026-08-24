/**
 * Blitz: clocks, time pressure, and flagging.
 *
 * The clock is driven from real timestamps, so rather than waiting sixty
 * seconds the suite moves the page's clock forward — which also proves the
 * time is recomputed rather than decremented by the interval, since a jump
 * a throttled tab could produce must still drain the clock correctly.
 */
import { open, sq, play, finish, main } from "./_harness.mjs";

const clockText = (page, which) =>
  page.$$eval(".clock", (els, w) => els[w].innerText.replace(/\n/g, " "), which);

main(async () => {
  const { browser, page, errors } = await open();

  if (await page.$(".clocks")) throw new Error("clocks shown in the untimed Play tab");
  console.log("PASS: no clocks outside Blitz");

  await page.click('.mode-tabs button:has-text("Blitz")');
  await page.waitForSelector(".clocks");
  const you = await clockText(page, 1);
  const engine = await clockText(page, 0);
  if (!/you/i.test(you) || !/engine/i.test(engine)) {
    throw new Error(`clock labels wrong: ${engine} / ${you}`);
  }
  if (!/3:00/.test(you)) throw new Error(`expected the 3+2 default, got ${you}`);
  console.log(`PASS: Blitz shows both clocks (${you.trim()})`);

  /* --- Only the side to move burns time ----------------------------------- */

  await page.waitForTimeout(1500);
  if ((await clockText(page, 1)) === you) throw new Error("your clock did not tick on your move");
  if (!/3:00/.test(await clockText(page, 0))) {
    throw new Error("the engine's clock ran while it was not its turn");
  }
  console.log(`PASS: only the clock of the side to move runs (${(await clockText(page, 1)).trim()})`);

  /* --- The engine pays for its own thinking ------------------------------- */

  await play(page, "e2", "e4");
  await page.waitForFunction(
    () => !/3:00/.test(document.querySelectorAll(".clock")[0].innerText),
    null,
    { timeout: 30000 }
  );
  console.log(`PASS: the engine's clock ran during its search (${(await clockText(page, 0)).trim()})`);

  /* --- Takebacks and live coaching are off under a clock ------------------ */

  if (!(await page.$eval('button:has-text("Undo move")', (el) => el.disabled))) {
    throw new Error("undo should be disabled in Blitz");
  }
  if (await page.$('label:has-text("Teacher mode")')) {
    throw new Error("live coaching should be hidden in Blitz");
  }
  console.log("PASS: undo and live coaching are disabled under a clock");

  /* --- Switching the time control ----------------------------------------- */

  await page.click('.start-picker button:has-text("1+0 Bullet")');
  await page.click('button:has-text("New game")');
  await page.waitForFunction(() => /1:00|59\./.test(document.querySelector(".clock").innerText), null, {
    timeout: 10000,
  });
  console.log("PASS: a new time control applies on the next new game (1+0)");

  /* --- Flagging ------------------------------------------------------------ */

  await page.evaluate(() => {
    const realNow = Date.now;
    let skew = 0;
    Date.now = () => realNow() + skew;
    window.__skip = (ms) => {
      skew += ms;
    };
  });
  await page.evaluate(() => window.__skip(61000));
  await page.waitForFunction(
    () => /lose on time|wins on time|Draw\./.test(document.body.innerText),
    null,
    { timeout: 15000 }
  );
  const flagMsg = await page.$eval(".status", (el) => el.innerText.trim());
  console.log(`PASS: the clock flags and ends the game — "${flagMsg}"`);

  /* --- A flag is a game over ------------------------------------------------ */

  await page.waitForSelector(".result-card", { timeout: 5000 });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached", timeout: 5000 });
  const before = await page.$$eval(".move-cell", (e) => e.length);
  await play(page, "d2", "d4");
  await page.waitForTimeout(300);
  if ((await page.$$eval(".move-cell", (e) => e.length)) !== before) {
    throw new Error("a move was accepted after the flag fell");
  }
  console.log("PASS: the result card appears, Escape dismisses it, and no move is accepted");

  /* --- Leaving Blitz turns the clocks off ---------------------------------- */

  await page.click('.mode-tabs button:has-text("Play")');
  await page.waitForFunction(() => !document.querySelector(".clocks"), null, { timeout: 5000 });
  console.log("PASS: leaving Blitz removes the clocks");

  await finish(browser, errors, "ALL BLITZ TESTS PASSED");
});
