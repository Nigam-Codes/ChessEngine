/**
 * pwa.js — installing the app, and keeping it up to date once installed.
 *
 * Everything here is a no-op where it doesn't apply: in development (Vite
 * serves no service worker), inside the native app (which carries its own
 * copy of the files), and in browsers without service workers. Events are
 * broadcast on `window` so the banner can listen without knowing any of this.
 */

export const isNative = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

/** Running from the home screen rather than in a browser tab? */
export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

/**
 * iOS never fires the install event — Safari only offers "Add to Home
 * Screen" from its Share sheet — so the app has to say so itself. iPadOS
 * reports itself as a Mac, hence the touch check.
 */
export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

let installEvent = null;
let reloadingForUpdate = false;

export function registerServiceWorker({ force = false } = {}) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (isNative()) return;
  if (!force && !import.meta.env.PROD) return;

  // Android / desktop Chrome: hold on to the install prompt until asked.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    window.dispatchEvent(new Event("app-installable"));
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    window.dispatchEvent(new Event("app-installed"));
  });

  window.addEventListener("load", async () => {
    let reg;
    try {
      reg = await navigator.serviceWorker.register("./sw.js");
    } catch {
      return; // offline support is a bonus, never a reason to break the app
    }
    const announce = () => window.dispatchEvent(new Event("app-update-ready"));
    if (reg.waiting && navigator.serviceWorker.controller) announce();
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      next?.addEventListener("statechange", () => {
        // "installed" with an existing controller means an *update* is
        // waiting; without one it is simply the first install.
        if (next.state === "installed" && navigator.serviceWorker.controller) announce();
      });
    });
    // An installed app can stay open for days; look for updates whenever it
    // comes back to the foreground.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  });

  // Only reload when the person asked to — on a first install the new worker
  // also takes control, and reloading then would be a pointless flash.
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) window.location.reload();
  });
}

export const canPromptInstall = () => !!installEvent;

/** Show the browser's own install dialog. Resolves true if accepted. */
export async function promptInstall() {
  if (!installEvent) return false;
  const e = installEvent;
  installEvent = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome === "accepted";
}

/** Swap to the waiting version and reload into it. */
export async function applyUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg?.waiting) return window.location.reload();
  reloadingForUpdate = true;
  reg.waiting.postMessage("skip-waiting");
}
