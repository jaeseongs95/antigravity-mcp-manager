'use strict';

/**
 * Host-Neutral Safe DOM Builder, Focus Trap, Korean IME Guard, and Scroll Helper.
 *
 * Invariants:
 * 1. Zero unsafe HTML sinks (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`).
 * 2. Zero hardcoded host/vendor CSS selectors — fallback focus target is injected via callback.
 * 3. Korean/CJK IME composition (`e.isComposing || e.keyCode === 229`) is protected against
 *    premature `Enter` submit or `Escape` dismissal.
 */

const { disposableEvent } = require('../shared/dom-disposables');

const FOCUSABLE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']);

/**
 * Returns true if a keyboard event occurs during active IME composition (e.g., Korean Hangul).
 *
 * @param {any} event
 * @returns {boolean}
 */
function isImeComposing(event) {
  return Boolean(event && (event.isComposing === true || event.keyCode === 229));
}

/**
 * Removes all child nodes from `el` using safe DOM APIs only.
 *
 * @param {any} el
 */
function clearElement(el) {
  if (!el) return;
  while (el.firstChild && typeof el.removeChild === 'function') {
    el.removeChild(el.firstChild);
  }
  if (Array.isArray(el.children) && el.children.length > 0 && typeof el.replaceChildren === 'function') {
    el.replaceChildren();
  }
}

/**
 * Safe declarative DOM element builder (`h(doc, tag, props, ...children)`).
 *
 * @param {any} doc
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children
 */
function h(doc, tag, props, ...children) {
  const el = doc.createElement(tag);
  if (props && typeof props === 'object') {
    const keys = Object.keys(props);
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      const val = props[key];
      if (val === undefined || val === null || val === false) continue;

      if (key === 'className' || key === 'class') {
        el.className = String(val);
        if (typeof el.setAttribute === 'function') {
          el.setAttribute('class', String(val));
        }
      } else if (key === 'text') {
        el.textContent = String(val);
      } else if (key === 'value') {
        el.value = String(val);
      } else if (key === 'checked') {
        el.checked = Boolean(val);
      } else if (key === 'disabled') {
        el.disabled = Boolean(val);
        if (val && typeof el.setAttribute === 'function') {
          el.setAttribute('disabled', 'disabled');
        }
      } else if (key === 'selected') {
        el.selected = Boolean(val);
      } else if (key === 'style' && typeof val === 'object') {
        if (el.style) {
          Object.assign(el.style, val);
        }
      } else if (key === 'dataset' && typeof val === 'object') {
        const dKeys = Object.keys(val);
        for (let j = 0; j < dKeys.length; j += 1) {
          const dk = dKeys[j];
          const dv = val[dk];
          if (dv === undefined || dv === null) continue;
          if (el.dataset) el.dataset[dk] = String(dv);
          if (typeof el.setAttribute === 'function') {
            const kebab = dk.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
            el.setAttribute(`data-${kebab}`, String(dv));
          }
        }
      } else if (key.startsWith('on') && typeof val === 'function') {
        const eventType = key.slice(2).toLowerCase();
        if (typeof el.addEventListener === 'function') {
          el.addEventListener(eventType, val);
        } else {
          el[key.toLowerCase()] = val;
        }
      } else if (typeof el.setAttribute === 'function') {
        if (key === 'id') el.id = String(val);
        if (key === 'type') el.type = String(val);
        if (key === 'name') el.name = String(val);
        if (key === 'placeholder') el.placeholder = String(val);
        if (key === 'role') el.role = String(val);
        el.setAttribute(key, val === true ? '' : String(val));
      } else {
        el[key] = val;
      }
    }
  }

  const appendChildItem = (item) => {
    if (item === null || item === undefined || item === false) return;
    if (Array.isArray(item)) {
      for (let i = 0; i < item.length; i += 1) {
        appendChildItem(item[i]);
      }
      return;
    }
    if (typeof item === 'string' || typeof item === 'number') {
      if (typeof doc.createTextNode === 'function') {
        el.appendChild(doc.createTextNode(String(item)));
      } else {
        el.textContent = `${el.textContent || ''}${item}`;
      }
      return;
    }
    if (typeof el.appendChild === 'function') {
      el.appendChild(item);
    }
  };

  for (let i = 0; i < children.length; i += 1) {
    appendChildItem(children[i]);
  }
  return el;
}

/**
 * Collects focusable descendants inside `root` in DOM order.
 *
 * @param {any} root
 * @returns {any[]}
 */
function getFocusableElements(root) {
  if (!root) return [];
  const results = [];
  const visit = (node) => {
    if (!node || node === root) {
      // Visit children below
    } else {
      const tag = String(node.tagName || '').toUpperCase();
      const hidden =
        node.disabled === true ||
        node.hidden === true ||
        (typeof node.getAttribute === 'function' && node.getAttribute('aria-hidden') === 'true') ||
        (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden'));
      if (!hidden) {
        const tabIdxAttr = typeof node.getAttribute === 'function' ? node.getAttribute('tabindex') : null;
        const tabIdx = tabIdxAttr !== null && tabIdxAttr !== undefined ? Number(tabIdxAttr) : node.tabIndex;
        const isFocusableTag =
          FOCUSABLE_TAGS.has(tag) &&
          (tag !== 'A' || Boolean(node.href || (typeof node.getAttribute === 'function' && node.getAttribute('href'))));
        if ((isFocusableTag && tabIdx !== -1) || (typeof tabIdx === 'number' && !Number.isNaN(tabIdx) && tabIdx >= 0)) {
          if (typeof node.focus === 'function') {
            results.push(node);
          }
        }
      }
    }
    const kids = node.children || node.childNodes || [];
    for (let i = 0; i < kids.length; i += 1) {
      visit(kids[i]);
    }
  };
  visit(root);
  return results;
}

/**
 * Checks whether `el` is currently connected to `doc`.
 *
 * @param {any} doc
 * @param {any} el
 * @returns {boolean}
 */
function isElementConnected(doc, el) {
  if (!el || typeof el.focus !== 'function') return false;
  if (el.isConnected === false) return false;
  if (doc && typeof doc.contains === 'function') {
    return doc.contains(el);
  }
  let cur = el;
  while (cur) {
    if (cur === doc || (doc && (cur === doc.body || cur === doc.documentElement))) {
      return true;
    }
    cur = cur.parentNode;
  }
  return Boolean(el.isConnected);
}

/**
 * Restores keyboard focus to `openerEl` if connected, or invokes injected `getFallbackFocusTarget()`.
 *
 * @param {any} doc
 * @param {any} openerEl
 * @param {(() => any) | null} [getFallbackFocusTarget]
 */
function restoreFocusSafely(doc, openerEl, getFallbackFocusTarget) {
  if (isElementConnected(doc, openerEl)) {
    try {
      openerEl.focus();
      return openerEl;
    } catch {
      // Continue to fallback
    }
  }
  if (typeof getFallbackFocusTarget === 'function') {
    const fallbackEl = getFallbackFocusTarget();
    if (isElementConnected(doc, fallbackEl)) {
      try {
        fallbackEl.focus();
        return fallbackEl;
      } catch {
        // Continue to document body fallback
      }
    }
  }
  const bodyTarget = doc && (doc.body || doc.documentElement);
  if (bodyTarget && typeof bodyTarget.focus === 'function') {
    try {
      bodyTarget.focus();
      return bodyTarget;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Installs a keyboard focus trap (`Tab` / `Shift+Tab`) and IME-safe `Escape` handler on `dialogEl`.
 *
 * @param {{
 *   doc: any,
 *   dialogEl: any,
 *   onEscape?: (event: any) => void
 * }} params
 */
function installDialogKeyboardTrap(params) {
  const { doc, dialogEl, onEscape } = params;
  return disposableEvent(dialogEl, 'keydown', (event) => {
    if (!event || isImeComposing(event)) return;

    if (event.key === 'Escape') {
      if (typeof onEscape === 'function') {
        event.preventDefault?.();
        event.stopPropagation?.();
        onEscape(event);
      }
      return;
    }

    if (event.key !== 'Tab') return;
    const focusables = getFocusableElements(dialogEl);
    if (focusables.length === 0) {
      event.preventDefault?.();
      dialogEl.focus?.();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = doc ? doc.activeElement : null;

    if (event.shiftKey) {
      if (!active || active === first || !focusables.includes(active)) {
        event.preventDefault?.();
        last.focus();
      }
    } else if (!active || active === last || !focusables.includes(active)) {
      event.preventDefault?.();
      first.focus();
    }
  });
}

/**
 * Preserves `container.scrollTop` across synchronous DOM re-renders.
 *
 * @param {any} container
 * @param {() => void} renderFn
 */
function preserveScrollTop(container, renderFn) {
  const prevScrollTop = container && typeof container.scrollTop === 'number' ? container.scrollTop : 0;
  renderFn();
  if (container && typeof prevScrollTop === 'number') {
    container.scrollTop = prevScrollTop;
  }
}

module.exports = {
  isImeComposing,
  clearElement,
  h,
  getFocusableElements,
  isElementConnected,
  restoreFocusSafely,
  installDialogKeyboardTrap,
  preserveScrollTop,
};
