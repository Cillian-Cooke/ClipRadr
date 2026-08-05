/** Soft page refresh when workspace data changes (scans, adds, restore). */

import { store } from "./store.js";

let activeCleanup = null;

/**
 * Bind a page root to live workspace updates.
 * `load({ silent })` should fetch + paint. Silent refreshes skip full loading flash.
 */
export function bindLivePage(root, load) {
  if (typeof activeCleanup === "function") {
    try {
      activeCleanup();
    } catch {
      /* ignore */
    }
  }

  let cancelled = false;
  let timer = null;
  let seen = store.get().dataRevision ?? 0;
  let running = false;
  let queued = false;

  const run = async (silent) => {
    if (cancelled) return;
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await load({ silent: !!silent });
    } catch (e) {
      if (!silent) throw e;
      console.warn("live refresh failed", e);
    } finally {
      running = false;
      if (queued && !cancelled) {
        queued = false;
        run(true);
      }
    }
  };

  run(false);

  const unsub = store.subscribe(() => {
    if (cancelled) return;
    const rev = store.get().dataRevision ?? 0;
    if (rev === seen) return;
    seen = rev;
    clearTimeout(timer);
    timer = setTimeout(() => run(true), 280);
  });

  const cleanup = () => {
    cancelled = true;
    clearTimeout(timer);
    unsub();
    if (activeCleanup === cleanup) activeCleanup = null;
  };
  activeCleanup = cleanup;
  return cleanup;
}
