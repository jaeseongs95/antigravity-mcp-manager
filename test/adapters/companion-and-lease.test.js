'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MCP_BEGIN_MARKER,
  MCP_END_MARKER,
  parseAutoinjectCompanionManifest,
  mergeMcpManagerBlock,
  removeMcpManagerBlock,
} = require('../../src/shared/marker-manifest');
const { resolveHostAdapterConfig } = require('../../src/adapters/antigravity/host-config');
const { createCompanionCoordinator } = require('../../src/adapters/antigravity/companion-coordinator');
const {
  RC_TAP_METHODS,
  incrementIframeSuppression,
  acquireRemoteControlLease,
} = require('../../src/adapters/antigravity/remote-control-lease');
const { createSyntheticDomEnv } = require('../helpers/dom-and-rpc-fakes');

test('MCP-TC-017 & 028: marker-manifest ignores string-literal markers, repairs orphan BEGIN markers, and removes MCP block while preserving companions byte-for-byte', () => {
  const statusbarCore = 'window.agyStatusBar = { init() { return "status-ok"; } };';
  const koBlock = [
    '// === BEGIN_AGY_KO_THOUGHT_LOCALIZER_V1 ===',
    'const fakeLiteral = "// === BEGIN_AGY_MCP_MANAGER_V1 ===\\n// === END_AGY_MCP_MANAGER_V1 ===";',
    'window.agyKoThoughtTranslator = { active: true };',
    '// === END_AGY_KO_THOUGHT_LOCALIZER_V1 ===',
  ].join('\n');

  const initialCombined = `${statusbarCore}\n\n${koBlock}\n`;

  // Indented string literal inside koBlock must NOT be mistaken for an active MCP block
  const manifestBefore = parseAutoinjectCompanionManifest(initialCombined);
  assert.equal(manifestBefore.hasStatusbarCore, true);
  assert.equal(manifestBefore.hasKoBlock, true);
  assert.equal(manifestBefore.hasMcpBlock, false);

  // Merge MCP Manager block
  const merged = mergeMcpManagerBlock(initialCombined, 'window.agyMcpManager = { version: "2.0.0" };');
  const manifestAfter = parseAutoinjectCompanionManifest(merged);
  assert.equal(manifestAfter.hasStatusbarCore, true);
  assert.equal(manifestAfter.hasMcpBlock, true);
  assert.equal(manifestAfter.hasKoBlock, true);
  assert.equal(merged.includes(MCP_BEGIN_MARKER), true);
  assert.equal(merged.includes(MCP_END_MARKER), true);

  // Removing MCP Manager block preserves both statusbarCore and koBlock intact
  const stripped = removeMcpManagerBlock(merged);
  assert.equal(stripped.includes('window.agyStatusBar'), true);
  assert.equal(stripped.includes('window.agyKoThoughtTranslator'), true);
  assert.equal(stripped.includes('window.agyMcpManager'), false);
  const manifestStripped = parseAutoinjectCompanionManifest(stripped);
  assert.equal(manifestStripped.hasMcpBlock, false);
  assert.equal(manifestStripped.hasStatusbarCore, true);
  assert.equal(manifestStripped.hasKoBlock, true);

  // Orphan `BEGIN` marker before `KO_THOUGHT_LOCALIZER` is repaired cleanly without eating `koBlock`
  const orphanInput = `${statusbarCore}\n${MCP_BEGIN_MARKER}\nbrokenHalfWritten();\n${koBlock}\n`;
  const repaired = mergeMcpManagerBlock(orphanInput, 'window.agyMcpManager = { repaired: true };');
  const repManifest = parseAutoinjectCompanionManifest(repaired);
  assert.equal(repManifest.hasMcpBlock, true);
  assert.equal(repManifest.hasOrphanMcpBegin, false);
  assert.equal(repManifest.hasKoBlock, true);
  assert.equal(repaired.includes('brokenHalfWritten'), false);

  // Sole MCP block removal returns `""`
  const soleMcp = mergeMcpManagerBlock('', 'window.agyMcpManager = {};');
  assert.equal(removeMcpManagerBlock(soleMcp), '');
});

test('MCP-TC-042 (AUDIT-M6): companion-coordinator cancels 1500ms retry timer immediately on dispose() with zero post-dispose RPCs or script injections', async () => {
  const { win, doc } = createSyntheticDomEnv({ url: 'https://antigravity.google.com/r/sess-1' });
  const gaHost = doc.createElement('ga-remote-control');
  doc.body.appendChild(gaHost);

  let pluginInfoCalls = 0;
  const rpcTransport = {
    isAvailable: () => true,
    async fetchHostInstalledPluginInfo() {
      pluginInfoCalls += 1;
      return null; // Unresolved -> triggers 1500ms retry schedule
    },
  };

  const hostConfig = resolveHostAdapterConfig({}, win);
  const coordinator = createCompanionCoordinator({ win, doc, hostConfig, rpcTransport });
  coordinator.start();

  await new Promise((r) => setTimeout(r, 25));
  assert.equal(pluginInfoCalls, 1);

  // Dispose immediately while 1500ms retry timer is pending
  coordinator.dispose();

  await new Promise((r) => setTimeout(r, 1600));
  assert.equal(pluginInfoCalls, 1, 'Pending 1500ms companion retry timer must NOT fire after dispose()');
  assert.equal(doc.querySelectorAll('script[data-agy-companion]').length, 0);
});

test('MCP-TC-022, 030 & 037: acquireRemoteControlLease chains multiple leases cleanly, ref-counts suppression, and restores all 18 prototype methods on final release', () => {
  assert.equal(RC_TAP_METHODS.length, 18);

  class FakeRemoteControlComponent {}
  const origFns = new Map();
  let origOnIframeLoadCount = 0;
  for (const m of RC_TAP_METHODS) {
    const fn =
      m === 'onIframeLoad'
        ? function onIframeLoad() {
            origOnIframeLoadCount += 1;
            return 'loaded';
          }
        : function () {
            return m;
          };
    origFns.set(m, fn);
    FakeRemoteControlComponent.prototype[m] = fn;
  }

  const inst = new FakeRemoteControlComponent();
  const seenByA = [];
  const seenByB = [];

  const leaseA = acquireRemoteControlLease({
    onInstanceSeen(_rc, method) {
      seenByA.push(method);
    },
  });
  const leaseB = acquireRemoteControlLease({
    onInstanceSeen(_rc, method) {
      seenByB.push(method);
    },
  });

  leaseA.tapTarget(null, inst);
  leaseB.tapTarget(null, inst);

  // Ref-counted suppression across two active promotions
  const releaseSup1 = incrementIframeSuppression(inst);
  const releaseSup2 = incrementIframeSuppression(inst);
  assert.equal(inst.__agySuppressAutoIframeLoadCount, 2);
  assert.equal(inst.onIframeLoad(), undefined);
  assert.equal(origOnIframeLoadCount, 0);

  // Releasing first suppression keeps suppression active until second releases
  releaseSup1();
  assert.equal(inst.__agySuppressAutoIframeLoadCount, 1);
  assert.equal(inst.onIframeLoad(), undefined);
  assert.equal(origOnIframeLoadCount, 0);

  releaseSup2();
  assert.equal(inst.__agySuppressAutoIframeLoadCount, undefined);
  assert.equal(inst.onIframeLoad(), 'loaded');
  assert.equal(origOnIframeLoadCount, 1);

  assert.equal(seenByA.includes('onIframeLoad'), true);
  assert.equal(seenByB.includes('onIframeLoad'), true);

  // Releasing leaseA leaves leaseB active
  leaseA.release();
  inst.reconnect();
  assert.equal(seenByB.includes('reconnect'), true);

  // Releasing final leaseB restores all 18 prototype methods to exact original function references
  leaseB.release();
  for (const m of RC_TAP_METHODS) {
    assert.equal(
      FakeRemoteControlComponent.prototype[m],
      origFns.get(m),
      `Prototype method "${m}" must be restored to exact original reference`
    );
  }
});
