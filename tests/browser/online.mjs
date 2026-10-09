/**
 * Online play, end to end: two separate browsers, one game.
 *
 * Runs its own PeerServer on localhost so the suite never depends on the
 * public broker or the internet. Each player gets a separate browser context,
 * which means separate storage — as close to two phones as one machine gets.
 *
 * The cases that matter on real phones are all here: joining from a link,
 * moves in both directions, a player vanishing mid-game and coming back to a
 * board that caught up on its own, resigning, and a rematch with colours
 * swapped.
 */
import { chromium } from "playwright-core";
import { PeerServer } from "peer";
import { EXE, APP_URL, sq, main } from "./_harness.mjs";

const BROKER_PORT = Number(process.env.BROKER_PORT || 9123);
const broker = { host: "127.0.0.1", port: BROKER_PORT, path: "/broker", secure: false, config: { iceServers: [] } };

const label = (page, name) => page.$eval(sq(name), (el) => el.getAttribute("aria-label"));
const status = (page) => page.$eval(".status", (el) => el.innerText.trim());
const waitFor = (page, fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout });
const pieceOn = (page, name, re) =>
  waitFor(
    page,
    ([n, src]) => new RegExp(src).test(document.querySelector(`button[aria-label^="${n},"]`)?.getAttribute("aria-label") || ""),
    [name, re.source]
  );

main(async () => {
  // IPv4 explicitly: the broker binds "::" by default, which fails in a
  // container without IPv6.
  const server = await new Promise((resolve) =>
    PeerServer({ port: BROKER_PORT, host: "127.0.0.1", path: "/broker" }, resolve)
  );

  const browser = await chromium.launch({
    executablePath: EXE,
    // Headless Chromium hides local addresses behind mDNS names that nothing
    // in a container can resolve. Real phones use STUN/TURN instead.
    args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
  });
  const errors = [];
  const player = async (name) => {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1700 } });
    await context.addInitScript((b) => {
      window.__CHESS_BROKER__ = b;
    }, broker);
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => m.type() === "error" && !/ERR_CONNECTION|WebSocket|Failed to load resource/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
    return { context, page };
  };

  const host = await player("host");
  const guest = await player("guest");

  /* --- The host creates a game and gets a link --------------------------- */

  await host.page.goto(APP_URL, { waitUntil: "networkidle" });
  await host.page.click('.mode-tabs button:has-text("Online")');
  await host.page.click('[aria-label="Your colour"] button:has-text("White")');
  await host.page.click('button:has-text("Create game")');
  await host.page.waitForSelector(".invite-link", { timeout: 20000 });
  await waitFor(host.page, () => /Waiting for your opponent/.test(document.querySelector(".online-status")?.innerText || ""));
  const link = await host.page.$eval(".invite-link", (el) => el.value);
  if (!/#join=[a-z2-9]{8}$/.test(link)) throw new Error(`unexpected invite link: ${link}`);
  console.log(`PASS: the host gets a shareable link (${link.replace(/^.*#/, "#")})`);

  // Nothing can be played before anyone has joined.
  await host.page.click(sq("e2"));
  await host.page.click(sq("e4"));
  if (!/white p/.test(await label(host.page, "e2"))) throw new Error("a move was played with nobody to play");
  console.log("PASS: the board is inert until an opponent joins");

  /* --- The guest opens the link ------------------------------------------- */

  await guest.page.goto(link, { waitUntil: "load" });
  for (const p of [host.page, guest.page]) {
    await waitFor(p, () => /Connected/.test(document.querySelector(".online-status")?.innerText || ""), null, 30000);
  }
  const hostSide = await host.page.$eval(".online-status", (el) => el.innerText);
  const guestSide = await guest.page.$eval(".online-status", (el) => el.innerText);
  if (!/you play White/.test(hostSide) || !/you play Black/.test(guestSide)) {
    throw new Error(`colours wrong: host "${hostSide}", guest "${guestSide}"`);
  }
  if ((await guest.page.evaluate(() => window.location.hash)) !== "") {
    throw new Error("the #join fragment should be cleared once used");
  }
  console.log("PASS: opening the link connects them — host White, guest Black");

  // The guest sees the board from Black's side.
  // Waited for rather than sampled: turning the board is animated.
  await waitFor(
    guest.page,
    () =>
      document.querySelector(".board button")?.getAttribute("aria-label").startsWith("h1") &&
      !document.querySelector(".board.flipping")
  );
  console.log("PASS: each player sees their own pieces at the bottom");

  /* --- Moves travel both ways --------------------------------------------- */

  await host.page.click(sq("e2"));
  await host.page.click(sq("e4"));
  await pieceOn(guest.page, "e4", /white p/);
  if (!/Your move/.test(await status(guest.page))) throw new Error(`guest status: ${await status(guest.page)}`);
  if (!/opponent's move/.test(await status(host.page))) throw new Error(`host status: ${await status(host.page)}`);
  console.log("PASS: White's move arrives on Black's board, and the turn passes");

  // Out of turn, a move is not played — it is queued as a premove, exactly as
  // against the engine. Cancel it so the scripted line below stays intact.
  await host.page.click(sq("d2"));
  await host.page.click(sq("d4"));
  await host.page.waitForSelector(".premove-note", { timeout: 5000 });
  if (!/white p/.test(await label(host.page, "d2"))) throw new Error("the host moved out of turn");
  await host.page.click('.premove-note button:has-text("Cancel")');
  await host.page.waitForSelector(".premove-note", { state: "detached", timeout: 5000 });
  // And the guest cannot touch White's pieces at all.
  await guest.page.click(sq("d2"));
  await guest.page.click(sq("d4"));
  await guest.page.waitForTimeout(300);
  if (!/white p/.test(await label(guest.page, "d2"))) throw new Error("the guest moved White's piece");
  console.log("PASS: out of turn a move is only queued as a premove, and nobody moves the other side");

  await guest.page.click(sq("e7"));
  await guest.page.click(sq("e5"));
  await pieceOn(host.page, "e5", /black p/);
  console.log("PASS: Black's reply arrives on White's board");

  /* --- A player vanishes, and comes back to a board that caught up --------- */

  // Close the guest's page outright: the closest thing to iOS killing the app.
  await guest.page.close();
  await waitFor(host.page, () => /reconnecting|Connection lost/i.test(document.querySelector(".online-status")?.innerText || ""), null, 30000);
  console.log("PASS: the host notices the guest has gone");

  // The host plays on while the guest is away.
  await host.page.click(sq("g1"));
  await host.page.click(sq("f3"));
  await pieceOn(host.page, "f3", /white n/);

  // The guest reopens the app — not the link, just the app — and is put
  // straight back into the game, with the move they missed already on the board.
  guest.page = await guest.context.newPage();
  guest.page.on("pageerror", (e) => errors.push(`guest: ${e}`));
  await guest.page.goto(APP_URL, { waitUntil: "load" });
  for (const p of [host.page, guest.page]) {
    await waitFor(p, () => /Connected/.test(document.querySelector(".online-status")?.innerText || ""), null, 40000);
  }
  await pieceOn(guest.page, "f3", /white n/);
  await pieceOn(guest.page, "e5", /black p/);
  const cells = await guest.page.$$eval(".move-cell", (e) => e.map((c) => c.innerText.trim()));
  if (cells.join(" ") !== "e4 e5 Nf3") throw new Error(`guest's move list after resuming: ${cells.join(" ")}`);
  console.log("PASS: the guest reopens the app and the board has caught up (e4 e5 Nf3)");

  // And play carries on from there.
  await guest.page.click(sq("b8"));
  await guest.page.click(sq("c6"));
  await pieceOn(host.page, "c6", /black n/);
  console.log("PASS: play continues normally after the reconnect");

  /* --- Resigning ------------------------------------------------------------ */

  await guest.page.click('.controls button:has-text("Resign")');
  await host.page.waitForSelector(".result-card", { timeout: 20000 });
  const headline = await host.page.$eval(".result-headline", (el) => el.innerText.trim());
  if (headline !== "You win") throw new Error(`host's result card says "${headline}"`);
  console.log(`PASS: the guest resigns and the host is told — "${headline}"`);

  /* --- Rematch, colours swapped -------------------------------------------- */

  await host.page.keyboard.press("Escape");
  await guest.page.keyboard.press("Escape").catch(() => {});
  await host.page.click('.online-box button:has-text("Offer a rematch")');
  await guest.page.waitForSelector('.online-box button:has-text("Accept")', { timeout: 20000 });
  await guest.page.click('.online-box button:has-text("Accept")');
  await waitFor(host.page, () => /you play Black/.test(document.querySelector(".online-status")?.innerText || ""));
  await waitFor(guest.page, () => /you play White/.test(document.querySelector(".online-status")?.innerText || ""));
  if ((await host.page.$$eval(".move-cell", (e) => e.length)) !== 0) throw new Error("the rematch kept old moves");
  console.log("PASS: a rematch starts a fresh game with colours swapped");

  /* --- Premove against a human ---------------------------------------------- */

  // The host is Black now and queues e7-e5 while White is still deciding.
  await host.page.click(sq("e7"));
  await host.page.click(sq("e5"));
  await host.page.waitForSelector(".premove-note", { timeout: 5000 });
  await guest.page.click(sq("d2"));
  await guest.page.click(sq("d4"));
  await pieceOn(guest.page, "e5", /black p/);
  console.log("PASS: a premove queued against a human fires the moment they move");

  /* --- Leaving ----------------------------------------------------------------*/

  await host.page.click('.online-box button:has-text("Resign and leave")');
  await guest.page.waitForSelector(".result-card", { timeout: 20000 });
  if ((await guest.page.$eval(".result-headline", (el) => el.innerText.trim())) !== "You win") {
    throw new Error("walking out of a game should count as resigning it");
  }
  await host.page.waitForSelector('button:has-text("Create game")', { timeout: 5000 });
  console.log("PASS: leaving mid-game resigns it, and the leaver is back at the lobby");

  if (errors.length) throw new Error("console errors: " + errors.join(" | "));
  console.log("\nALL ONLINE TESTS PASSED");
  await browser.close();
  server.close();
  process.exit(0);
});
