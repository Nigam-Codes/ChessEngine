/**
 * The exportable PNG game card.
 *
 * The card's model is unit-tested; what only a browser can prove is that a real
 * PNG comes out of the canvas and that it is not a blank rectangle. So the
 * download is intercepted, its bytes checked against the PNG signature and
 * IHDR, and the decoded pixels sampled for actual ink.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { open, play, finish, main } from "./_harness.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

main(async () => {
  const { browser, page, errors } = await open();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "chess-card-"));

  await page.click('.mode-tabs button:has-text("2 Players")');
  await page.waitForSelector('label:has-text("Auto-flip")');
  await page.uncheck('label:has-text("Auto-flip") input');
  for (const [f, t] of [
    ["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"], ["f1", "c4"], ["g8", "f6"],
  ]) {
    await play(page, f, t);
  }
  await page.click('button:has-text("Resign")');
  await page.waitForSelector(".result-card");

  /* --- A real PNG downloads ---------------------------------------------------- */

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click('.result-card button:has-text("Save card")'),
  ]);
  if (download.suggestedFilename() !== "chess-game-card.png") {
    throw new Error(`unexpected filename: ${download.suggestedFilename()}`);
  }
  const file = path.join(out, "card.png");
  await download.saveAs(file);
  const bytes = fs.readFileSync(file);

  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error("the file is not a PNG");
  // Width and height live in the IHDR chunk, big-endian, at bytes 16-23.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 2400 || height !== 1260) {
    throw new Error(`expected a 2x 1200x630 card, got ${width}x${height}`);
  }
  if (bytes.length < 10000) throw new Error(`suspiciously small card: ${bytes.length} bytes`);
  console.log(`PASS: a real PNG downloads — ${width}x${height}, ${(bytes.length / 1024) | 0} KB`);

  /* --- And it is not blank ------------------------------------------------------ */

  const colours = await page.evaluate(async (dataUrl) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    return seen.size;
  }, "data:image/png;base64," + bytes.toString("base64"));
  if (colours < 20) throw new Error(`the card looks blank — only ${colours} distinct colours`);
  console.log(`PASS: the card has real content (${colours} distinct sampled colours)`);

  /* --- Still saveable after a review -------------------------------------------- */

  await page.keyboard.press("Escape");
  await page.waitForSelector(".result-card", { state: "detached" });
  await page.click('button:has-text("Coach the game")');
  await page.waitForFunction(() => document.querySelectorAll(".move-mark").length > 0, null, {
    timeout: 120000,
  });
  const [reviewed] = await Promise.all([
    page.waitForEvent("download", { timeout: 20000 }),
    page.click('.controls button:has-text("Save card")'),
  ]);
  const file2 = path.join(out, "card-reviewed.png");
  await reviewed.saveAs(file2);
  const after = fs.readFileSync(file2);
  if (!after.subarray(0, 8).equals(SIGNATURE)) throw new Error("the second card is not a PNG");
  if (after.equals(bytes)) throw new Error("the reviewed card is identical — accuracy is missing");
  console.log("PASS: the card is still saveable after a review, and it changed");

  fs.rmSync(out, { recursive: true, force: true });
  await finish(browser, errors, "ALL SHARE-CARD TESTS PASSED");
});
