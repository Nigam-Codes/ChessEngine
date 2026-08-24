/**
 * Board themes and live opening names.
 */
import { open, play, finish, main } from "./_harness.mjs";

const squareColor = (page) =>
  page.$eval(".board .square.dark", (el) => getComputedStyle(el).backgroundColor);
const openingName = (page) => page.$eval(".opening strong", (el) => el.innerText.trim());

main(async () => {
  const { browser, page, errors } = await open();

  /* --- Themes ---------------------------------------------------------------- */

  const slate = await squareColor(page);
  await page.click('[aria-label="Board colours"] button:has-text("Green")');
  const green = await squareColor(page);
  if (green === slate) throw new Error("the green theme changed nothing");
  console.log(`PASS: the theme picker repaints the board (${slate} → ${green})`);

  await page.click('[aria-label="Board colours"] button:has-text("Brown")');
  const brown = await squareColor(page);
  if (brown === green) throw new Error("brown did not apply over green");
  console.log(`PASS: a second theme applies over the first (${brown})`);

  await page.reload({ waitUntil: "networkidle" });
  if ((await squareColor(page)) !== brown) throw new Error("the theme was not remembered");
  const pressed = await page.$eval('[aria-label="Board colours"] [aria-pressed="true"]', (el) =>
    el.innerText.trim()
  );
  if (pressed !== "Brown") throw new Error(`the picker shows ${pressed} as active`);
  console.log("PASS: the choice survives a reload, and the picker agrees");

  await page.click('[aria-label="Board colours"] button:has-text("Slate")');

  /* --- Opening names ---------------------------------------------------------- */

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await page.uncheck('label:has-text("Auto-flip") input');

  await play(page, "e2", "e4");
  await page.waitForSelector(".opening", { timeout: 5000 });
  if ((await openingName(page)) !== "King's Pawn Opening") {
    throw new Error(`1. e4 is "${await openingName(page)}"`);
  }
  console.log("PASS: the opening is named from move one");

  for (const [f, t] of [["e7", "e5"], ["g1", "f3"], ["b8", "c6"], ["f1", "c4"]]) {
    await play(page, f, t);
  }
  await page.waitForFunction(
    () => document.querySelector(".opening strong").innerText.trim() === "Italian Game",
    null,
    { timeout: 5000 }
  );
  await play(page, "f8", "c5");
  await page.waitForFunction(
    () => document.querySelector(".opening strong").innerText.trim() === "Italian Game: Giuoco Piano",
    null,
    { timeout: 5000 }
  );
  const eco = await page.$eval(".opening-eco", (el) => el.innerText.trim());
  console.log(`PASS: the name sharpens as the line is played — Giuoco Piano (${eco})`);

  /* --- Rewinding walks the name back ------------------------------------------ */

  await page.click('.move-list button:has-text("e4")');
  await page.waitForFunction(
    () => document.querySelector(".opening strong").innerText.trim() === "King's Pawn Opening",
    null,
    { timeout: 5000 }
  );
  console.log("PASS: rewinding the game rewinds the opening name with it");

  /* --- Off book, the last name earned is kept --------------------------------- */

  await page.keyboard.press("End");
  await play(page, "d2", "d3");
  await page.waitForTimeout(250);
  if ((await openingName(page)) !== "Italian Game: Giuoco Piano") {
    throw new Error(`lost the name off book: "${await openingName(page)}"`);
  }
  console.log("PASS: leaving the book keeps the last name earned");

  await finish(browser, errors, "ALL THEME / OPENING TESTS PASSED");
});
