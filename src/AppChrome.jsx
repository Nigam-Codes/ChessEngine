/**
 * AppChrome — the one strip of UI that belongs to the *app* rather than to
 * chess: "install me" and "a new version is ready". Sits at the bottom of the
 * screen, says one thing at a time, and remembers being dismissed.
 */
import React, { useEffect, useState } from "react";
import {
  isIOS,
  isNative,
  isStandalone,
  canPromptInstall,
  promptInstall,
  applyUpdate,
} from "./pwa.js";

const DISMISS_KEY = "chess-lab-install-dismissed-v1";

const dismissedBefore = () => {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

/** iOS's Share icon — a box with an arrow out of it — which is what to look for. */
const ShareIcon = () => (
  <svg
    viewBox="0 0 24 24"
    width="1.05em"
    height="1.05em"
    aria-hidden="true"
    style={{ verticalAlign: "-0.15em" }}
  >
    <path d="M12 14V3M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 10H5.5v10.5h13V10H16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

export default function AppChrome() {
  const [update, setUpdate] = useState(false);
  const [installable, setInstallable] = useState(canPromptInstall);
  const [dismissed, setDismissed] = useState(dismissedBefore);

  useEffect(() => {
    const onUpdate = () => setUpdate(true);
    const onInstallable = () => setInstallable(true);
    const onInstalled = () => setInstallable(false);
    window.addEventListener("app-update-ready", onUpdate);
    window.addEventListener("app-installable", onInstallable);
    window.addEventListener("app-installed", onInstalled);
    return () => {
      window.removeEventListener("app-update-ready", onUpdate);
      window.removeEventListener("app-installable", onInstallable);
      window.removeEventListener("app-installed", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // fine — it just comes back next visit
    }
  };

  // An update outranks an install suggestion: it is about the app you have.
  let content = null;
  if (update) {
    content = (
      <>
        <span>A new version is ready.</span>
        <button className="reset" onClick={applyUpdate}>
          Reload
        </button>
      </>
    );
  } else if (!dismissed && !isStandalone() && !isNative()) {
    if (installable) {
      content = (
        <>
          <span>Install Chess Lab on this device — it works offline, too.</span>
          <button className="reset" onClick={() => promptInstall().then(() => setInstallable(false))}>
            Install
          </button>
          <button className="link-button" onClick={dismiss}>
            Not now
          </button>
        </>
      );
    } else if (isIOS()) {
      content = (
        <>
          <span>
            Install on your {/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone"}: tap{" "}
            <strong>Share</strong> <ShareIcon />, then{" "}
            <strong>Add to Home Screen</strong>.
          </span>
          <button className="link-button" onClick={dismiss}>
            Got it
          </button>
        </>
      );
    }
  }

  if (!content) return null;
  return (
    <div className="app-chrome" role="status" aria-live="polite">
      {content}
    </div>
  );
}
