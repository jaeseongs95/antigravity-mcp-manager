/**
 * Renderer Mount Coordinator (`src/adapters/antigravity/renderer/mount-coordinator.mjs`).
 *
 * SOLID Boundaries:
 * - OCP: Coordinates an open list of uniform Mount Adapters (`ensureMount`, `syncLabels`,
 *   `getFrames`, `handleKeydown`, `dispose`) without knowing internal DOM details of each surface.
 * - DIP: Receives `runtime` (wrapping `addonHost`) and `adapters` via dependency injection;
 *   wires a single deterministic `runtime.onDispose(...)` teardown that disconnects observers,
 *   detaches window listeners, disposes adapters, and removes owner-scoped CSS.
 */

import { ADDON_STYLE_ID, buildAddonCss } from './addon-styles.mjs';

export function createMountCoordinator({ runtime, adapters, win = window, doc = document }) {
  let started = false;
  let disposed = false;
  let scheduled = false;
  let observer = null;
  let unbindUrlListener = null;
  let domReadyHandler = null;

  function ensureAllMounts() {
    if (disposed) return;
    for (const adapter of adapters) {
      adapter.ensureMount();
    }
  }

  function syncAllLabels() {
    if (disposed) return;
    for (const adapter of adapters) {
      adapter.syncLabels();
    }
  }

  function collectFrames() {
    const frames = [];
    for (const adapter of adapters) {
      for (const frame of adapter.getFrames()) {
        frames.push(frame);
      }
    }
    return frames;
  }

  function scheduleEnsure() {
    if (disposed || scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      ensureAllMounts();
    };
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(run);
    } else {
      setTimeout(run, 16);
    }
  }

  function onKeydown(ev) {
    if (disposed) return;
    for (const adapter of adapters) {
      adapter.handleKeydown(ev);
    }
  }

  function onMessage(ev) {
    if (disposed) return;
    if (!runtime.isTrustedIframeMessage(ev, collectFrames())) return;
    if (ev.data?.type === 'agy-mcp-lang-change' && (ev.data.lang === 'ko' || ev.data.lang === 'en')) {
      runtime.writeSavedLang(ev.data.lang);
      syncAllLabels();
    }
  }

  function attachObserver() {
    if (disposed || !doc.body || observer) return;
    ensureAllMounts();
    observer = new MutationObserver(scheduleEnsure);
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scheduled = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (domReadyHandler) {
      win.removeEventListener('DOMContentLoaded', domReadyHandler);
      domReadyHandler = null;
    }
    win.removeEventListener('keydown', onKeydown);
    win.removeEventListener('message', onMessage);
    if (unbindUrlListener) {
      unbindUrlListener();
      unbindUrlListener = null;
    }

    for (let i = adapters.length - 1; i >= 0; i -= 1) {
      try {
        adapters[i].dispose();
      } catch {
        // Isolate per-adapter teardown errors
      }
    }
    try {
      runtime.removeStyle(ADDON_STYLE_ID);
    } catch {
      // Ignore if host already removed style
    }
  }

  function start() {
    if (started || disposed) return;
    started = true;

    runtime.injectStyle(ADDON_STYLE_ID, buildAddonCss());
    runtime.onDispose(dispose);

    win.addEventListener('keydown', onKeydown);
    win.addEventListener('message', onMessage);
    unbindUrlListener = runtime.bindServerUrlListener((nextUrl) => {
      if (nextUrl) {
        scheduleEnsure();
      }
    });

    if (doc.body) {
      attachObserver();
    } else {
      domReadyHandler = () => {
        domReadyHandler = null;
        attachObserver();
      };
      win.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
    }
  }

  return Object.freeze({
    start,
    ensureAllMounts,
    syncAllLabels,
    dispose,
  });
}
