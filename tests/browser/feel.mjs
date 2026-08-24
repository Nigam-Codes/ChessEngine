/**
 * Physical feel: sound, the piece slide, and dragging.
 *
 * Sound cannot be observed from the DOM, so the AudioContext is wrapped before
 * the app loads and the oscillators and noise buffers it starts are counted.
 * That is the difference between proving sound fires and assuming it does.
 */
import { open, sq, play, engineIdle, centre, finish, main } from "./_harness.mjs";

const spy = () => {
  window.__audio = { osc: 0, noise: 0, contexts: 0 };
  const Real = window.AudioContext;
  if (!Real) return;
  window.AudioContext = class extends Real {
    constructor(...a) {
      super(...a);
      window.__audio.contexts++;
    }
    createOscillator() {
      window.__audio.osc++;
      return super.createOscillator();
    }
    createBufferSource() {
      window.__audio.noise++;
      return super.createBufferSource();
    }
  };
};

main(async () => {
  const { browser, page, errors } = await open({ init: spy });
  const audio = () => page.evaluate(() => window.__audio);

  /* --- A move makes a noise ---------------------------------------------- */

  if ((await audio()).contexts !== 0) {
    throw new Error("an AudioContext was built before any gesture — it would be born suspended");
  }
  console.log("PASS: no AudioContext is created before the first gesture");

  await play(page, "e2", "e4");
  await page.waitForFunction(() => window.__audio.osc + window.__audio.noise > 0, null, {
    timeout: 5000,
  });
  const after = await audio();
  console.log(`PASS: the move is heard (${after.osc} tones, ${after.noise} knocks)`);

  /* --- The moved piece slides -------------------------------------------- */

  // The reverse FLIP renders the piece at its old offset for one frame, so the
  // transform is gone by the time the transition finishes — assert the end
  // state, which is the part that must always be true.
  await engineIdle(page);
  // Poll rather than sample once: the transition is 150ms and the engine can
  // reply inside that, so a single read can legitimately catch it mid-slide.
  // What must always become true is that it *settles* with no offset.
  await page.waitForFunction(
    (selector) => {
      const piece = document.querySelector(selector)?.querySelector(".piece");
      if (!piece) return false;
      const t = getComputedStyle(piece).transform;
      return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
    },
    sq("e4"),
    { timeout: 5000 }
  );
  console.log("PASS: the slide settles with the piece square on its destination");

  /* --- Click-to-move still works alongside dragging ---------------------- */

  await play(page, "d2", "d4");
  await page.waitForFunction(() => /d4/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  console.log("PASS: click-to-move survives the drag handlers");
  await engineIdle(page);

  /* --- Dragging ----------------------------------------------------------- */

  const [fx, fy] = await centre(page, "g1");
  const [tx, ty] = await centre(page, "f3");
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 8, fy + 8, { steps: 2 });
  // Mid-drag the original is dimmed and a ghost follows the pointer.
  await page.waitForSelector(".drag-ghost", { timeout: 3000 });
  if (!(await page.$(".piece-dragging"))) throw new Error("the lifted piece was not dimmed");
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => /Nf3/.test(document.querySelector(".move-list").innerText), null, {
    timeout: 10000,
  });
  if (await page.$(".drag-ghost")) throw new Error("the drag ghost outlived the drop");
  console.log("PASS: dragging a piece plays the move and clears the ghost");
  await engineIdle(page);

  /* --- Mute really silences ---------------------------------------------- */

  await page.click('button:has-text("Sound on")');
  const before = await audio();
  await play(page, "b1", "c3");
  await page.waitForTimeout(800);
  const quiet = await audio();
  if (quiet.osc !== before.osc || quiet.noise !== before.noise) {
    throw new Error("a muted session still made sound");
  }
  console.log("PASS: mute silences playback");

  // And the preference survives a reload.
  await page.reload({ waitUntil: "networkidle" });
  const label = await page.$eval('button:has-text("Sound")', (el) => el.innerText);
  if (!/Sound off/.test(label)) throw new Error(`mute was not remembered: ${label}`);
  console.log("PASS: the mute preference is remembered across a reload");

  await finish(browser, errors, "ALL PHYSICAL-FEEL TESTS PASSED");
});
