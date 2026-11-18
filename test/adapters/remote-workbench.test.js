'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const { resolveHostAdapterConfig, buildAllowedScriptUrlValidator } = require('../../src/adapters/antigravity/host-config');
const { acquireRemoteControlLease } = require('../../src/adapters/antigravity/remote-control-lease');
const {
  canDefineOwnPropertyOnScope,
  installCdnWorkerAdapter,
} = require('../../src/adapters/antigravity/remote-workbench/cdn-worker-bridge');
const {
  FRAME_PROMOTION_STATE,
  promoteCrossOriginRemoteIframe,
} = require('../../src/adapters/antigravity/remote-workbench/frame-promoter-fsm');
const { createSyntheticDomEnv } = require('../helpers/dom-and-rpc-fakes');

test('MCP-TC-036, 037 & 039: frame-promoter-fsm enforces PASSIVE_ATTACHED yield, PREFLIGHT untrusted URL abort, and mainScript.onerror ROLLED_BACK restoration', () => {
  const cdnWorkbenchUrl =
    'https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/out/vs/code/browser/workbench/workbench.html?hostTheme=dark&iframe=true';

  // 1. Companion already owns promotion (`__agyRemotePromotionOwner = 'ko-thought-translator'`) -> `PASSIVE_ATTACHED`
  {
    const { win, doc } = createSyntheticDomEnv({ url: 'https://antigravity.google.com/r/s1' });
    win.__agyRemotePromotionOwner = 'ko-thought-translator';
    const ga = doc.createElement('ga-remote-control');
    const iframe = doc.createElement('iframe');
    iframe.src = cdnWorkbenchUrl;
    iframe.setAttribute('src', cdnWorkbenchUrl);
    ga.appendChild(iframe);
    doc.body.appendChild(ga);

    const hostConfig = resolveHostAdapterConfig({}, win);
    const remoteLease = acquireRemoteControlLease({ win, doc });
    const handle = promoteCrossOriginRemoteIframe({ win, doc, iframe, hostConfig, remoteLease, version: '2.0.0' });

    assert.equal(handle.state, FRAME_PROMOTION_STATE.PASSIVE_ATTACHED);
    assert.equal(iframe.src, cdnWorkbenchUrl, 'PASSIVE_ATTACHED must NOT blank or overwrite companion-owned iframe');
    handle.dispose();
    remoteLease.release();
  }

  // 2. Untrusted iframe URL (`https://evil.example.com/workbench.html`) -> aborts in `PREFLIGHT` -> `ROLLED_BACK`
  {
    const { win, doc } = createSyntheticDomEnv({ url: 'https://antigravity.google.com/r/s2' });
    const iframe = doc.createElement('iframe');
    const evilUrl = 'https://evil.example.com/web/build_1/workbench.html';
    iframe.src = evilUrl;
    iframe.setAttribute('src', evilUrl);
    doc.body.appendChild(iframe);

    const hostConfig = resolveHostAdapterConfig({}, win);
    const remoteLease = acquireRemoteControlLease({ win, doc });
    const handle = promoteCrossOriginRemoteIframe({ win, doc, iframe, hostConfig, remoteLease, version: '2.0.0' });

    assert.equal(handle.promoted, false);
    assert.equal(handle.state, FRAME_PROMOTION_STATE.ROLLED_BACK);
    assert.equal(iframe.src, evilUrl);
    remoteLease.release();
  }

  // 3. Full promotion -> zero `<base>` elements, zero-arg `cd.open()/cd.close()`, `mainScript.onerror` -> `ROLLED_BACK` restores original `iframe.src`
  {
    const { win, doc } = createSyntheticDomEnv({ url: 'https://antigravity.google.com/r/s3' });
    const childEnv = createSyntheticDomEnv({ url: 'about:blank' });
    let cdWriteCalled = false;
    let cdOpenArgsCount = -1;
    childEnv.doc.open = function (...args) {
      cdOpenArgsCount = args.length;
    };
    childEnv.doc.close = function () {};
    childEnv.doc.write = function () {
      cdWriteCalled = true;
    };

    const ga = doc.createElement('ga-remote-control');
    const iframe = doc.createElement('iframe');
    let rawAttrSrc = cdnWorkbenchUrl;
    iframe.src = cdnWorkbenchUrl;
    iframe.setAttribute('src', cdnWorkbenchUrl);
    const origSetAttr = iframe.setAttribute.bind(iframe);
    iframe.setAttribute = (k, v) => {
      if (String(k).toLowerCase() === 'src') rawAttrSrc = String(v);
      origSetAttr(k, v);
    };
    iframe.contentWindow = childEnv.win;
    iframe.contentDocument = childEnv.doc;
    ga.appendChild(iframe);
    doc.body.appendChild(ga);

    const hostConfig = resolveHostAdapterConfig({}, win);
    const remoteLease = acquireRemoteControlLease({ win, doc });
    const handle = promoteCrossOriginRemoteIframe({ win, doc, iframe, hostConfig, remoteLease, version: '2.0.0' });

    assert.equal(handle.promoted, true);
    assert.equal(handle.state, FRAME_PROMOTION_STATE.PROMOTING);
    assert.equal(rawAttrSrc, 'about:blank');
    // Spoofed `iframe.src` getter reports canonical URL to host Angular component while promoted
    assert.equal(iframe.src, cdnWorkbenchUrl);

    // Fire `about:blank` load -> injects `<script type="module" src=".../workbench.js">` with ZERO `<base>` elements
    iframe.dispatchEvent({ type: 'load', bubbles: false });
    assert.equal(cdWriteCalled, false, 'document.write must NEVER be called');
    assert.equal(cdOpenArgsCount, 0, 'document.open() must be called with 0 arguments');
    assert.equal(childEnv.doc.querySelectorAll('base').length, 0, 'ZERO <base> elements permitted under base-uri self');

    const mainScript = childEnv.doc.querySelector('script');
    assert.ok(mainScript, 'Expected promoted workbench script element');
    assert.equal(String(mainScript.src).startsWith('https://www.gstatic.com/_/boq-chrome-jetski/web/build_20261118/'), true);

    // Simulate HTTP 500 `mainScript.onerror` -> transitions to `ROLLED_BACK`, cleans `owner`, and restores raw `iframe.src`
    mainScript.dispatchEvent({ type: 'error', bubbles: false });
    assert.equal(handle.state, FRAME_PROMOTION_STATE.ROLLED_BACK);
    assert.equal(win.__agyRemotePromotionOwner, undefined);
    assert.equal(rawAttrSrc, cdnWorkbenchUrl);
    remoteLease.release();
  }
});

test('MCP-TC-038, 049 & Rev 6 F4: cdn-worker-bridge handles Window.prototype inherited [Replaceable] origin/self, WebIDL binding vs constructors, URL.canParse, nested importScripts, falsy throw 0, and EvalError normalization', async () => {
  // Verify prototype-inherited `[Replaceable]` guard (`!ownDesc && Object.isExtensible(wfw)`)
  const protoWithAccessor = {};
  Object.defineProperty(protoWithAccessor, 'origin', {
    get() {
      return 'https://antigravity.google.com';
    },
    set() {},
    configurable: true,
    enumerable: true,
  });
  const inheritedTarget = Object.create(protoWithAccessor);
  assert.equal(Object.getOwnPropertyDescriptor(inheritedTarget, 'origin'), undefined);
  assert.equal(canDefineOwnPropertyOnScope(inheritedTarget, 'origin'), true);

  // Build realistic synthetic child + worker iframe execution environment with `vm` context
  const { win: cw, doc: cd } = createSyntheticDomEnv({ url: 'https://antigravity.google.com/r/worker-test' });
  const scriptsByUrl = new Map([
    [
      'https://www.gstatic.com/_/boq-chrome-jetski/web/b1/workerMain.js',
      `
        // 1. Extracted WebIDL receiver-sensitive method (\`const addEL = self.addEventListener\`)
        const addEL = self.addEventListener;
        const origCheck = self.origin;
        // 2. Preserved constructors & static methods (\`self.URL\`, \`self.URL.canParse\`, \`self.Object.keys\`)
        const canParseRel = self.URL.canParse('./sub/helper.js', self.location.href);
        const resolvedRel = new self.URL('./sub/helper.js', 'about:blank').href;
        const objKeysOk = Array.isArray(self.Object.keys({ a: 1 }));
        // 3. Nested importScripts where inner throws 0 (falsy) and outer catches & continues!
        let caughtFalsy = 'not-caught';
        self.importScripts('./outerImport.js');
        addEL('message', (ev) => {
          if (ev.data === 'ping') {
            self.postMessage({
              origCheck,
              canParseRel,
              resolvedRel,
              objKeysOk,
              outerRecovered: self.__outerRecovered,
              caughtInnerVal: self.__caughtInnerVal,
            });
          } else if (ev.data === 'throw-falsy-zero') {
            throw 0;
          }
        });
      `,
    ],
    [
      'https://www.gstatic.com/_/boq-chrome-jetski/web/b1/outerImport.js',
      `
        try {
          self.importScripts('./innerThrowsZero.js');
        } catch (err) {
          self.__caughtInnerVal = err;
        }
        self.__outerRecovered = true;
      `,
    ],
    [
      'https://www.gstatic.com/_/boq-chrome-jetski/web/b1/innerThrowsZero.js',
      `throw 0;`,
    ],
  ]);

  cw.MessageChannel = MessageChannel;
  cw.ErrorEvent = class FakeErrorEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.message = init.message || '';
      this.filename = init.filename || '';
      this.error = init.error;
      this.cancelable = init.cancelable !== false;
      this.defaultPrevented = false;
    }
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    }
  };
  cw.Worker = function NativeWorker() {
    throw new Error('Cross-origin native Worker blocked');
  };

  // Create isolated VM sandbox per bridge `<iframe sandbox="allow-scripts allow-same-origin">`
  const origCreateEl = cd.createElement.bind(cd);
  const hookedCreateEl = (tag) => {
    const el = origCreateEl(tag);
    if (String(tag).toLowerCase() === 'iframe') {
      const wfEnv = createSyntheticDomEnv({ url: 'about:blank' });
      const wfListeners = new Map();
      let receiverCheckPassed = false;

      const sandboxProto = {};
      Object.defineProperty(sandboxProto, 'origin', {
        get() {
          return 'https://antigravity.google.com';
        },
        configurable: true,
      });

      const sandboxBase = Object.create(sandboxProto);
      Object.assign(sandboxBase, {
        location: { href: 'about:blank', origin: 'https://antigravity.google.com' },
        document: wfEnv.doc,
        URL,
        Object,
        Array,
        Error,
        EvalError,
        TypeError,
        SyntaxError,
        Promise,
        MessageChannel,
        structuredClone,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        fetch: async (u) => ({
          ok: scriptsByUrl.has(String(u)),
          status: scriptsByUrl.has(String(u)) ? 200 : 404,
          text: async () => scriptsByUrl.get(String(u)) || '',
        }),
        XMLHttpRequest: class FakeSyncXhr {
          open(_m, u) {
            this._u = String(u);
          }
          send() {
            if (scriptsByUrl.has(this._u)) {
              this.status = 200;
              this.responseText = scriptsByUrl.get(this._u);
            } else {
              this.status = 404;
              this.responseText = '';
            }
          }
        },
        addEventListener: Object.assign(
          function addEventListener(type, fn) {
            // Strict WebIDL brand check: `this` MUST be `wfw` (`sandboxCtx`), NOT `workerSelfProxy`!
            if (this !== sandboxCtx) {
              throw new TypeError('Illegal invocation');
            }
            receiverCheckPassed = true;
            if (!wfListeners.has(type)) wfListeners.set(type, []);
            wfListeners.get(type).push(fn);
          },
          { prototype: undefined }
        ),
        removeEventListener: Object.assign(function removeEventListener() {}, { prototype: undefined }),
        dispatchEvent: Object.assign(
          function dispatchEvent(ev) {
            const arr = wfListeners.get(ev.type) || [];
            for (const fn of arr) fn(ev);
            return !ev.defaultPrevented;
          },
          { prototype: undefined }
        ),
      });

      const sandboxCtx = vm.createContext(sandboxBase);
      sandboxCtx.window = sandboxCtx;
      sandboxCtx.self = sandboxCtx;
      sandboxCtx.globalThis = sandboxCtx;

      wfEnv.doc.open = () => {};
      wfEnv.doc.close = () => {};
      const origWfCreateEl = wfEnv.doc.createElement.bind(wfEnv.doc);
      wfEnv.doc.createElement = (childTag) => {
        const childEl = origWfCreateEl(childTag);
        if (String(childTag).toLowerCase() === 'script') {
          let textVal = '';
          Object.defineProperty(childEl, 'text', {
            get: () => textVal,
            set: (v) => {
              textVal = String(v);
            },
          });
        }
        return childEl;
      };
      const origHeadAppend = wfEnv.doc.head.appendChild.bind(wfEnv.doc.head);
      wfEnv.doc.head.appendChild = (node) => {
        origHeadAppend(node);
        if (node.tagName === 'SCRIPT' && node.text) {
          vm.runInContext(node.text, sandboxCtx);
        }
        return node;
      };

      el.contentWindow = sandboxCtx;
      el.contentDocument = wfEnv.doc;
      el._receiverCheckPassed = () => receiverCheckPassed;

      const origBodyAppend = cd.body.appendChild.bind(cd.body);
      cd.body.appendChild = (appended) => {
        const res = origBodyAppend(appended);
        if (appended === el) {
          queueMicrotask(() => el.dispatchEvent({ type: 'load', bubbles: false }));
        }
        return res;
      };
    }
    return el;
  };

  const hostConfig = resolveHostAdapterConfig({}, cw);
  const isAllowedScriptUrl = buildAllowedScriptUrlValidator(hostConfig, cw);
  const activeWorkerBridges = new Set();

  installCdnWorkerAdapter({
    cw,
    cd,
    origCreateEl: hookedCreateEl,
    nonce: 'nonce-12345678',
    cdnBaseUrl: 'https://www.gstatic.com/_/boq-chrome-jetski/web/b1',
    hostOrigin: 'https://antigravity.google.com',
    hostConfig,
    isAllowedScriptUrl,
    ttPolicyCtrl: {
      hasNativePolicy: true,
      issueScriptToken: () => Symbol('tok'),
      revokeScriptToken: () => {},
      toScript: (code) => code,
      toScriptURL: (u) => u,
    },
    activeWorkerBridges,
  });

  const worker = new cw.Worker('./workerMain.js');
  const replyPromise = new Promise((resolve, reject) => {
    worker.onmessage = (ev) => resolve(ev.data);
    worker.onerror = (errEv) => reject(new Error(`Unexpected worker error: ${errEv.message}`));
  });

  worker.postMessage('ping');
  const reply = await replyPromise;

  assert.equal(reply.origCheck, 'https://www.gstatic.com');
  assert.equal(reply.canParseRel, true);
  assert.equal(reply.resolvedRel, 'https://www.gstatic.com/_/boq-chrome-jetski/web/b1/sub/helper.js');
  assert.equal(reply.objKeysOk, true);
  assert.equal(reply.outerRecovered, true, 'Outer importScripts must recover after catching inner error');
  assert.strictEqual(reply.caughtInnerVal, 0, 'Falsy thrown value `0` must be preserved without becoming undefined');

  // Terminate cleans up iframe and port
  assert.equal(activeWorkerBridges.size, 1);
  worker.terminate();
  assert.equal(cd.body.querySelectorAll('iframe').length, 0, 'Bridge iframe must be removed on terminate()');
});
