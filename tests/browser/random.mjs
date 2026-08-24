/**
 * Random midgame and endgame starts.
 *
 * The positions are generated, so the suite asserts properties rather than
 * exact squares: sparseness, a coherent scenario label, that the difficulty
 * asked for is the difficulty given, and — the one that matters — that the
 * position is actually playable.
 */
import { open, sq, engineIdle, finish, main } from "./_harness.mjs";

const pieceCount = (page) => page.$$eval(".board .piece", (els) => els.length);
const banner = (page) => page.$eval(".scenario", (el) => el.innerText).catch(() => null);

/** Click pieces until one has a legal move, then play it. */
async function playAMove(page) {
  const squares = await page.$$eval(".board button", (els) =>
    els.map((e) => e.getAttribute("aria-label")).filter((l) => l.includes("white"))
  );
  for (const label of squares) {
    const name = label.split(",")[0];
    await page.click(sq(name));
    const dots = await page.$$eval(".square .dot", (els) =>
      els.map((d) => d.closest("button").getAttribute("aria-label").split(",")[0])
    );
    if (!dots.length) continue;
    await page.click(sq(dots[0]));
    // A generated endgame can easily put a pawn on the seventh, so this click
    // may land on the last rank and raise the promotion picker rather than
    // playing anything. Answer it the way a player would.
    if (await page.$(".promo-picker")) {
      await page.click('.promo-option[aria-label*="Queen"]');
      return `${name}${dots[0]}=Q`;
    }
    return `${name}${dots[0]}`;
  }
  throw new Error("no legal move available in the generated position");
}

const newGameFrom = async (page, mode) => {
  await page.click(`.start-picker button:has-text("${mode}")`);
  await page.click('button:has-text("New game")');
  await page.waitForSelector(".scenario", { timeout: 30000 });
};

main(async () => {
  const { browser, page, errors } = await open();

  /* --- The standard opening is still the default -------------------------- */

  if (await page.$(".scenario")) throw new Error("a scenario banner on a standard game");
  if ((await pieceCount(page)) !== 32) throw new Error("the default game is not the opening");
  console.log("PASS: the standard opening is still the default");

  /* --- A random endgame --------------------------------------------------- */

  await newGameFrom(page, "Random endgame");
  const endPieces = await pieceCount(page);
  const endBanner = await banner(page);
  if (endPieces > 8) throw new Error(`an endgame should be sparse, got ${endPieces} pieces`);
  if (!/—/.test(endBanner)) throw new Error(`the banner has no target: ${endBanner}`);
  console.log(`PASS: random endgame — ${endPieces} pieces, "${endBanner.replace(/\n/g, " ")}"`);

  const moved = await playAMove(page);
  await page.waitForFunction(() => document.querySelectorAll(".move-cell").length >= 2, null, {
    timeout: 60000,
  });
  console.log(`PASS: the position is playable and the engine replied (played ${moved})`);
  await engineIdle(page);

  /* --- Difficulty is respected -------------------------------------------- */

  await page.click('.start-picker button:has-text("A win to convert")');
  await page.click('button:has-text("New game")');
  await page.waitForSelector(".scenario", { timeout: 30000 });
  const winning = await banner(page);
  if (!/winning|convert/i.test(winning)) throw new Error(`asked to convert a win, got: ${winning}`);
  console.log(`PASS: difficulty respected — "${winning.replace(/\n/g, " ")}"`);

  // The hard direction matters more: these were once unreachable entirely.
  await page.click('.start-picker button:has-text("A loss to defend")');
  await page.click('button:has-text("New game")');
  await page.waitForSelector(".scenario", { timeout: 30000 });
  const worse = await banner(page);
  if (!/worse|hold|defend|draw/i.test(worse)) throw new Error(`asked to defend, got: ${worse}`);
  console.log(`PASS: defending positions are reachable — "${worse.replace(/\n/g, " ")}"`);

  /* --- A random midgame ---------------------------------------------------- */

  await newGameFrom(page, "Random midgame");
  const midPieces = await pieceCount(page);
  if (midPieces < 16 || midPieces > 32) throw new Error(`midgame has ${midPieces} pieces`);
  // Both kings must be on the board, or it is not a chess position.
  const kings = await page.$$eval(".board button", (els) =>
    els.map((e) => e.getAttribute("aria-label")).filter((l) => / k$/.test(l)).length
  );
  if (kings !== 2) throw new Error(`a generated position with ${kings} kings`);
  console.log(`PASS: random midgame — ${midPieces} pieces, both kings present`);

  /* --- Back to the opening ------------------------------------------------- */

  await page.click('.start-picker button:has-text("Opening")');
  await page.click('button:has-text("New game")');
  await page.waitForFunction(() => document.querySelectorAll(".board .piece").length === 32, null, {
    timeout: 20000,
  });
  if (await page.$(".scenario")) throw new Error("the scenario banner survived the switch back");
  console.log("PASS: switching back to Opening restores the standard game");

  await finish(browser, errors, "ALL RANDOM-START TESTS PASSED");
});
