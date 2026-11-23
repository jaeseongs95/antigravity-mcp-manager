/**
 * Renderer Mount Coordinator (`src/adapters/antigravity/renderer/mount-coordinator.mjs`).
 *
 * SOLID Boundaries:
 * - OCP: Coordinates an open list of uniform Mount Adapters (`ensureMount`, `syncLabels`,
 *   `getFrames`, `handleKeydown`, `dispose`) and slot-scoped CSS descriptors without knowing
 *   internal DOM details of each surface.
 * - DIP: Receives `runtime` (wrapping `AddonManifest.v2` `addonHost`) and `adapters` via
 *   dependency injection; wires a single deterministic `runtime.onDispose(...)` teardown that
 *   disconnects observers, detaches managed listeners, disposes adapters, and removes every
 *   slot-scoped style.
 */

import { buildSlotStyleDescriptors } from './addon-styles.mjs';

export function createMountCoordinator({ runtime, adapters, win = window, doc = document }) {
  const styleDescriptors = buildSlotStyleDescriptors();
  let started = false;
  let disposed = false;
  let scheduled = false;
  let observer = null;
  let unbindUrlListener = null;
  let detachKeydown = null;
  let detachMessage = null;
  let detachDomReady = null;

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
    if (detachDomReady) {
      detachDomReady();
      detachDomReady = null;
    }
    if (detachKeydown) {
      detachKeydown();
      detachKeydown = null;
    }
    if (detachMessage) {
      detachMessage();
      detachMessage = null;
    }
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
    for (const desc of styleDescriptors) {
      try {
        runtime.removeStyle(desc.styleId);
      } catch {
        // Ignore if host already removed style
      }
    }
  }

  function start() {
    if (started || disposed) return;
    started = true;

    for (const desc of styleDescriptors) {
      runtime.injectStyle(desc.styleId, desc.cssText, { slotId: desc.slotId });
    }
    runtime.onDispose(dispose);

    detachKeydown = runtime.addManagedListener(win, 'keydown', onKeydown);
    detachMessage = runtime.addManagedListener(win, 'message', onMessage);
    unbindUrlListener = runtime.bindServerUrlListener((nextUrl) => {
      if (nextUrl) {
        scheduleEnsure();
      }
    });

    if (doc.body) {
      attachObserver();
    } else {
      detachDomReady = runtime.addManagedListener(
        win,
        'DOMContentLoaded',
        () => {
          detachDomReady = null;
          attachObserver();
        },
        { once: true }
      );
    }
  }

  return Object.freeze({
    start,
    ensureAllMounts,
    syncAllLabels,
    dispose,
  });
}
