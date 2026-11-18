'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sha256Hex } = require('../../src/core/sha256');
const { CONFIG_WRITE_REASONS } = require('../../src/core/ports');

let tempDirSeq = 0;

/**
 * Resolves the isolated test temporary root (`D:/codex/build/antigravity-mcp-manager-v2` on Windows
 * when `D:/` exists, or `os.tmpdir()/antigravity-mcp-manager-v2` on Linux/macOS CI).
 */
function getTestBuildRoot() {
  if (process.platform === 'win32' && fs.existsSync('D:\\')) {
    return path.join('D:\\codex\\build', 'antigravity-mcp-manager-v2');
  }
  return path.join(os.tmpdir(), 'antigravity-mcp-manager-v2');
}

function createTestTempDir(prefix = 'case') {
  const root = getTestBuildRoot();
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, `${prefix}-${process.pid}-${Date.now()}-${++tempDirSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
      try {
        const remaining = fs.readdirSync(root);
        if (remaining.length === 0) {
          fs.rmdirSync(root);
        }
      } catch {}
    },
  };
}

/**
 * Deterministic in-memory `ConfigRepositoryPort` test double supporting:
 * - 0-byte `""` `FOUND` (`exists: true, rawText: ''`),
 * - `MISSING` (`exists: false`),
 * - `SERVICE_UNAVAILABLE` / `READ_FAILED` / `URI_UNRESOLVED`,
 * - SHA-256 CAS `CONFLICT` + `onBeforeWrite` hook for concurrent external edits & rollback simulation.
 */
function createInMemoryConfigRepo(initial = {}) {
  const state = {
    uri: initial.uri || 'file:///mock/home/.gemini/antigravity/mcp_config.json',
    fsPath: initial.fsPath || '/mock/home/.gemini/antigravity/mcp_config.json',
    exists: initial.exists !== undefined ? Boolean(initial.exists) : true,
    rawText: typeof initial.rawText === 'string' ? initial.rawText : '{\n  "mcpServers": {}\n}\n',
    readError: initial.readError || null,
    writeError: initial.writeError || null,
    onBeforeWrite: typeof initial.onBeforeWrite === 'function' ? initial.onBeforeWrite : null,
    readCalls: [],
    writeCalls: [],
    revealCalls: [],
  };

  return {
    state,
    setExternalDiskContent(rawText, exists = true) {
      state.exists = Boolean(exists);
      state.rawText = exists ? String(rawText) : '';
    },
    async resolveConfigUri() {
      return state.uri;
    },
    async readConfig() {
      state.readCalls.push({ ts: Date.now() });
      if (state.readError) {
        return {
          ok: false,
          reason: state.readError.reason || 'READ_FAILED',
          error: state.readError.error || 'Simulated read error',
          uri: state.uri,
          fsPath: state.fsPath,
          rawText: null,
          digest: null,
        };
      }
      if (!state.exists) {
        return {
          ok: true,
          status: 'MISSING',
          exists: false,
          uri: state.uri,
          fsPath: state.fsPath,
          rawText: '',
          digest: null,
        };
      }
      return {
        ok: true,
        status: 'FOUND',
        exists: true,
        uri: state.uri,
        fsPath: state.fsPath,
        rawText: state.rawText,
        digest: sha256Hex(state.rawText),
      };
    },
    async writeConfig(req) {
      state.writeCalls.push({ ...req });
      if (typeof state.onBeforeWrite === 'function') {
        await state.onBeforeWrite(req, state, state.writeCalls.length);
      }
      if (state.writeError) {
        return {
          ok: false,
          persisted: false,
          reason: state.writeError.reason || CONFIG_WRITE_REASONS.WRITE_FAILED,
          error: state.writeError.error || 'Simulated write error',
          uri: req.uri || state.uri,
        };
      }

      const currentDigest = state.exists ? sha256Hex(state.rawText) : null;
      if (req.expectedExists !== undefined && Boolean(req.expectedExists) !== state.exists) {
        return {
          ok: false,
          persisted: false,
          reason: CONFIG_WRITE_REASONS.CONFLICT,
          currentExists: state.exists,
          currentRawText: state.exists ? state.rawText : null,
          currentDigest,
          error: 'CAS existence mismatch (CONFLICT).',
        };
      }
      if (state.exists && req.expectedDigest !== undefined && req.expectedDigest !== currentDigest) {
        return {
          ok: false,
          persisted: false,
          reason: CONFIG_WRITE_REASONS.CONFLICT,
          currentExists: true,
          currentRawText: state.rawText,
          currentDigest,
          error: 'CAS SHA-256 digest mismatch (CONFLICT).',
        };
      }

      state.exists = true;
      state.rawText = String(req.rawText ?? '');
      const nextDigest = sha256Hex(state.rawText);
      return {
        ok: true,
        persisted: true,
        uri: req.uri || state.uri,
        fsPath: state.fsPath,
        digest: nextDigest,
      };
    },
    async revealConfigInExplorer(uri) {
      state.revealCalls.push(uri || state.uri);
      return { ok: true, uri: uri || state.uri };
    },
  };
}

function createFakeMcpRuntime(initialServers = []) {
  const state = {
    servers: Array.isArray(initialServers) ? [...initialServers] : [],
    toggleHandler: null,
    listCalls: [],
    refreshCalls: [],
    toggleCalls: [],
  };

  return {
    state,
    async listServerStates(opts = {}) {
      state.listCalls.push(opts);
      return { ok: true, servers: [...state.servers] };
    },
    async refreshServers(opts = {}) {
      state.refreshCalls.push(opts);
      return { ok: true };
    },
    async toggleServer(serverName, enabled) {
      state.toggleCalls.push({ serverName, enabled });
      if (typeof state.toggleHandler === 'function') {
        return state.toggleHandler(serverName, enabled, state);
      }
      const existing = state.servers.find((s) => s.serverName === serverName || s.name === serverName);
      if (existing) {
        existing.enabled = enabled;
        existing.status = enabled ? 'CONNECTED' : 'DISABLED';
      }
      return { ok: true, supported: true };
    },
  };
}

function createFakeOAuthBroker(initial = {}) {
  const state = {
    waitHandler: initial.waitHandler || null,
    openResult: initial.openResult !== undefined ? initial.openResult : { ok: true },
    completeResult: initial.completeResult || { ok: true },
    disconnectResult: initial.disconnectResult || { ok: true },
    waitCalls: [],
    openUrlCalls: [],
    completeCalls: [],
    disconnectCalls: [],
  };

  return {
    state,
    async waitForAuthReadyOrUrl(serverName, timeoutMs, signal) {
      state.waitCalls.push({ serverName, timeoutMs });
      if (typeof state.waitHandler === 'function') {
        return state.waitHandler(serverName, timeoutMs, signal);
      }
      return null;
    },
    async openAuthorizationUrl(url) {
      state.openUrlCalls.push(url);
      return state.openResult;
    },
    async completeAuthorization(serverName, code) {
      state.completeCalls.push({ serverName, code });
      return typeof state.completeResult === 'function'
        ? state.completeResult(serverName, code)
        : state.completeResult;
    },
    async disconnectSession(serverName, account) {
      state.disconnectCalls.push({ serverName, account });
      return state.disconnectResult;
    },
  };
}

// --- Synthetic DOM Harness for Node Unit Tests (`test/ui/` & `test/adapters/`) ---

function matchesSimpleSelector(el, selectorPart) {
  if (!el || el.nodeType !== 1) return false;
  const trimmed = selectorPart.trim();
  if (!trimmed) return false;
  if (trimmed === '*') return true;

  let rem = trimmed;
  // Extract attribute selectors `[attr]`, `[attr="val"]`, `[attr^="val"]`, `[attr$="val"]`, `[attr*="val"]`, `[attr~="val"]`
  const attrChecks = [];
  rem = rem.replace(
    /\[([a-zA-Z0-9_-]+)(?:(\^=|\$=|\*=|~=|==|=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g,
    (_m, k, op, v1, v2, v3) => {
      const expected = v1 !== undefined ? v1 : v2 !== undefined ? v2 : v3 !== undefined ? v3 : null;
      attrChecks.push({ key: k, op: op || null, expected });
      return '';
    }
  );

  const idMatches = [];
  rem = rem.replace(/#([a-zA-Z0-9_-]+)/g, (_m, id) => {
    idMatches.push(id);
    return '';
  });

  const classMatches = [];
  rem = rem.replace(/\.([a-zA-Z0-9_-]+)/g, (_m, cls) => {
    classMatches.push(cls);
    return '';
  });

  const tag = rem.trim().toUpperCase();
  if (tag && el.tagName !== tag) return false;

  for (const id of idMatches) {
    if (el.id !== id) return false;
  }
  const elClasses = String(el.className || '').split(/\s+/).filter(Boolean);
  for (const cls of classMatches) {
    if (!elClasses.includes(cls)) return false;
  }
  for (const chk of attrChecks) {
    const val = el.getAttribute(chk.key);
    if (chk.op === null || chk.expected === null) {
      if (val === null) return false;
    } else if (chk.op === '^=') {
      if (val === null || chk.expected.length === 0 || !val.startsWith(chk.expected)) return false;
    } else if (chk.op === '$=') {
      if (val === null || chk.expected.length === 0 || !val.endsWith(chk.expected)) return false;
    } else if (chk.op === '*=') {
      if (val === null || chk.expected.length === 0 || !val.includes(chk.expected)) return false;
    } else if (chk.op === '~=') {
      if (
        val === null ||
        chk.expected.length === 0 ||
        /\s/.test(chk.expected) ||
        !val.trim().split(/\s+/).includes(chk.expected)
      ) {
        return false;
      }
    } else if (val !== chk.expected) {
      return false;
    }
  }
  return true;
}

function matchesSelectorChain(el, fullChain, boundaryRoot) {
  const parts = fullChain.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;

  let cur = el.parentNode;
  for (let i = parts.length - 2; i >= 0; i--) {
    let matched = false;
    while (cur && cur !== boundaryRoot?.parentNode) {
      if (cur.nodeType === 1 && matchesSimpleSelector(cur, parts[i])) {
        matched = true;
        cur = cur.parentNode;
        break;
      }
      cur = cur.parentNode;
    }
    if (!matched) return false;
  }
  return true;
}

function matchesSelectorList(el, selector, boundaryRoot) {
  if (typeof selector !== 'string' || !selector.trim()) return false;
  const groups = selector.split(',');
  for (const grp of groups) {
    if (matchesSelectorChain(el, grp, boundaryRoot)) return true;
  }
  return false;
}

function createSyntheticDomEnv(options = {}) {
  const mutationObservers = [];
  const storageMap = new Map(Object.entries(options.initialLocalStorage || {}));
  let docRef = null;

  function notifyMutation(record) {
    for (const obs of mutationObservers) {
      if (obs.active) {
        obs.records.push(record);
        if (options.autoFlushMutations !== false) {
          obs.callback([record], obs);
        }
      }
    }
  }

  class SyntheticNode {
    constructor(nodeType) {
      this.nodeType = nodeType;
      this.parentNode = null;
      this.childNodes = [];
      this._listeners = new Map();
    }

    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }

    get firstChild() {
      return this.childNodes[0] || null;
    }

    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }

    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 && idx + 1 < this.parentNode.childNodes.length
        ? this.parentNode.childNodes[idx + 1]
        : null;
    }

    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === docRef || (docRef && cur === docRef.documentElement)) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    appendChild(child) {
      if (!child) return child;
      if (child.nodeType === 11) {
        for (const c of [...child.childNodes]) {
          this.appendChild(c);
        }
        return child;
      }
      if (child.parentNode) {
        child.parentNode.removeChild(child);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      notifyMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] });
      return child;
    }

    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const idx = this.childNodes.indexOf(refNode);
      if (idx === -1) return this.appendChild(newNode);
      if (newNode.parentNode) {
        newNode.parentNode.removeChild(newNode);
      }
      newNode.parentNode = this;
      this.childNodes.splice(idx, 0, newNode);
      notifyMutation({ type: 'childList', target: this, addedNodes: [newNode], removedNodes: [] });
      return newNode;
    }

    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
        if (docRef && docRef.activeElement === child) {
          docRef.activeElement = docRef.body;
        }
        notifyMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [child] });
      }
      return child;
    }

    replaceChildren(...nodes) {
      for (const c of [...this.childNodes]) {
        this.removeChild(c);
      }
      for (const n of nodes) {
        if (typeof n === 'string') {
          this.appendChild(new SyntheticText(n));
        } else if (n) {
          this.appendChild(n);
        }
      }
    }

    remove() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    }

    contains(other) {
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentNode;
      }
      return false;
    }

    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      if (!this._listeners.has(type)) {
        this._listeners.set(type, new Set());
      }
      this._listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      const set = this._listeners.get(type);
      if (set) set.delete(fn);
    }

    dispatchEvent(rawEvent) {
      const evt = rawEvent || { type: 'unknown' };
      if (!evt.target) evt.target = this;
      evt.defaultPrevented = Boolean(evt.defaultPrevented);
      let propagationStopped = false;
      evt.preventDefault = () => {
        evt.defaultPrevented = true;
      };
      evt.stopPropagation = () => {
        propagationStopped = true;
      };

      let cur = this;
      while (cur) {
        evt.currentTarget = cur;
        const set = cur._listeners.get(evt.type);
        if (set) {
          for (const fn of [...set]) {
            fn.call(cur, evt);
          }
        }
        if (propagationStopped || evt.bubbles === false) break;
        cur = cur.parentNode;
      }
      return !evt.defaultPrevented;
    }

    querySelectorAll(selector) {
      const results = [];
      const walk = (n) => {
        for (const child of n.childNodes) {
          if (child.nodeType === 1) {
            if (matchesSelectorList(child, selector, this)) {
              results.push(child);
            }
            walk(child);
          }
        }
      };
      walk(this);
      return results;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  class SyntheticText extends SyntheticNode {
    constructor(data) {
      super(3);
      this.data = String(data ?? '');
    }
    get textContent() {
      return this.data;
    }
    set textContent(v) {
      this.data = String(v ?? '');
    }
  }

  class SyntheticElement extends SyntheticNode {
    constructor(tagName) {
      super(1);
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this._attrs = new Map();
      this.dataset = {};
      this.style = {
        setProperty(k, v) {
          this[k] = v;
        },
        removeProperty(k) {
          delete this[k];
        },
      };
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.hidden = false;
      this.scrollTop = 0;
      this.nonce = '';
      this.ownerDocument = null;

      const self = this;
      this.classList = {
        add(...tokens) {
          const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
          for (const t of tokens) if (t) set.add(t);
          self.className = [...set].join(' ');
        },
        remove(...tokens) {
          const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
          for (const t of tokens) set.delete(t);
          self.className = [...set].join(' ');
        },
        contains(t) {
          return String(self.className || '').split(/\s+/).filter(Boolean).includes(t);
        },
        toggle(t, force) {
          const has = this.contains(t);
          const next = force !== undefined ? Boolean(force) : !has;
          if (next) this.add(t);
          else this.remove(t);
          return next;
        },
      };
    }

    get id() {
      return this._attrs.get('id') || '';
    }
    set id(v) {
      this.setAttribute('id', String(v ?? ''));
    }

    get className() {
      return this._attrs.get('class') || '';
    }
    set className(v) {
      this.setAttribute('class', String(v ?? ''));
    }

    get textContent() {
      return this.childNodes.map((c) => c.textContent || '').join('');
    }
    set textContent(v) {
      this.childNodes = [];
      const str = String(v ?? '');
      if (str) {
        const tn = new SyntheticText(str);
        tn.parentNode = this;
        this.childNodes.push(tn);
      }
    }

    setAttribute(name, val) {
      const k = String(name).toLowerCase();
      const s = String(val);
      this._attrs.set(k, s);
      if (k === 'nonce') this.nonce = s;
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        this.dataset[camel] = s;
      }
      notifyMutation({ type: 'attributes', target: this, attributeName: k });
    }

    getAttribute(name) {
      const k = String(name).toLowerCase();
      return this._attrs.has(k) ? this._attrs.get(k) : null;
    }

    hasAttribute(name) {
      return this._attrs.has(String(name).toLowerCase());
    }

    removeAttribute(name) {
      const k = String(name).toLowerCase();
      this._attrs.delete(k);
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
        delete this.dataset[camel];
      }
    }

    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelectorList(cur, selector, docRef)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }

    focus() {
      if (this.disabled) return;
      if (docRef) {
        docRef.activeElement = this;
      }
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent({ type: 'click', bubbles: true, target: this });
    }
  }

  class SyntheticDocument extends SyntheticNode {
    constructor() {
      super(9);
      docRef = this;
      this.documentElement = new SyntheticElement('HTML');
      this.documentElement.ownerDocument = this;
      this.documentElement.parentNode = this;
      this.childNodes.push(this.documentElement);

      this.head = new SyntheticElement('HEAD');
      this.head.ownerDocument = this;
      this.body = new SyntheticElement('BODY');
      this.body.ownerDocument = this;
      this.documentElement.appendChild(this.head);
      this.documentElement.appendChild(this.body);
      this.activeElement = this.body;
      this.defaultView = null;
    }

    createElement(tag) {
      const el = new SyntheticElement(tag);
      el.ownerDocument = this;
      return el;
    }

    createTextNode(text) {
      return new SyntheticText(text);
    }

    createDocumentFragment() {
      return new SyntheticNode(11);
    }

    getElementById(id) {
      if (!id) return null;
      return this.querySelector(`#${id}`);
    }
  }

  class SyntheticMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.active = false;
      this.records = [];
      mutationObservers.push(this);
    }
    observe() {
      this.active = true;
    }
    disconnect() {
      this.active = false;
    }
    takeRecords() {
      const out = [...this.records];
      this.records.length = 0;
      return out;
    }
  }

  const doc = new SyntheticDocument();
  const localStorage = {
    get length() {
      return storageMap.size;
    },
    getItem(k) {
      return storageMap.has(String(k)) ? storageMap.get(String(k)) : null;
    },
    setItem(k, v) {
      storageMap.set(String(k), String(v));
    },
    removeItem(k) {
      storageMap.delete(String(k));
    },
    clear() {
      storageMap.clear();
    },
    key(i) {
      return [...storageMap.keys()][i] || null;
    },
  };

  const parsedLoc = new URL(options.url || 'https://antigravity.google.com/r/test-session');
  const winListeners = new Map();

  const win = {
    document: doc,
    location: {
      href: parsedLoc.href,
      origin: parsedLoc.origin,
      protocol: parsedLoc.protocol,
      host: parsedLoc.host,
      hostname: parsedLoc.hostname,
      pathname: parsedLoc.pathname,
      search: parsedLoc.search,
      hash: parsedLoc.hash,
    },
    origin: parsedLoc.origin,
    localStorage,
    MutationObserver: SyntheticMutationObserver,
    HTMLElement: SyntheticElement,
    Element: SyntheticElement,
    Node: SyntheticNode,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    setInterval: (...args) => setInterval(...args),
    clearInterval: (...args) => clearInterval(...args),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(evt) {
      const set = winListeners.get(evt.type);
      if (set) {
        for (const fn of [...set]) fn.call(win, evt);
      }
      return !evt.defaultPrevented;
    },
  };
  win.window = win;
  win.self = win;
  win.top = win;
  win.parent = win;
  doc.defaultView = win;

  return {
    win,
    doc,
    localStorage,
    storageMap,
    mutationObservers,
  };
}

module.exports = {
  getTestBuildRoot,
  createTestTempDir,
  createInMemoryConfigRepo,
  createFakeMcpRuntime,
  createFakeOAuthBroker,
  createSyntheticDomEnv,
};
