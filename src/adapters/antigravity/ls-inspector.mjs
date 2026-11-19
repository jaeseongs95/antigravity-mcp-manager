/**
 * Read-Only Antigravity Language Server Inspector (`src/adapters/antigravity/ls-inspector.mjs`).
 *
 * Calls ONLY read-only Connect RPCs (`GetMcpServerStates`, `GetAllPlugins`) using
 * `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`. Never invokes mutation RPCs
 * and never exposes CSRF tokens, env maps, or header secrets in returned DTOs.
 */

import { redactErrorMessage } from '../../core/secret-redactor.mjs';
import { isLoopbackHostname } from '../../core/validator.mjs';

const LS_SERVICE_PREFIX = '/exa.language_server_pb.LanguageServerService';

function isSafeLoopbackAddress(lsAddress) {
  if (typeof lsAddress !== 'string' || !lsAddress.trim()) return false;
  try {
    const parsed = new URL(`http://${lsAddress.trim()}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/') return false;
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

export function createAntigravityLsInspector({
  lsAddress = process.env.ANTIGRAVITY_LS_ADDRESS || '',
  csrfToken = process.env.ANTIGRAVITY_CSRF_TOKEN || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
} = {}) {
  async function postLsReadRpc(method, bodyObj = {}) {
    if (!isSafeLoopbackAddress(lsAddress) || !csrfToken || typeof fetchImpl !== 'function') {
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `http://${lsAddress.trim()}${LS_SERVICE_PREFIX}/${method}`;
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-codeium-csrf-token': csrfToken,
        },
        body: JSON.stringify(bodyObj),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function inspectRuntime(workspaceUris = []) {
    if (!lsAddress || !csrfToken) {
      return { available: false, servers: {}, plugins: [] };
    }

    const [statesRes, pluginsRes] = await Promise.all([
      postLsReadRpc('GetMcpServerStates', {}),
      postLsReadRpc('GetAllPlugins', Array.isArray(workspaceUris) && workspaceUris.length > 0 ? { workspaceUris } : {}),
    ]);

    if (!statesRes && !pluginsRes) {
      return { available: false, servers: {}, plugins: [] };
    }

    const servers = Object.create(null);
    for (const st of Array.isArray(statesRes?.states) ? statesRes.states : []) {
      const name = st?.spec?.name || st?.serverId || st?.name || st?.serverInfo?.name;
      if (!name || typeof name !== 'string') continue;
      const tools = Array.isArray(st.tools) ? st.tools : [];
      const toolNames = tools
        .map((t) => (typeof t?.name === 'string' ? t.name : null))
        .filter(Boolean);
      const rawErr =
        typeof st.error === 'string' && st.error.trim()
          ? st.error
          : Array.isArray(st.toolErrors) && st.toolErrors.length > 0
            ? String(st.toolErrors[0]?.error || st.toolErrors[0] || '')
            : null;

      servers[name] = {
        status: String(st.status || 'UNKNOWN'),
        toolCount: tools.length,
        toolNames,
        error: rawErr ? redactErrorMessage(rawErr) : null,
        hasAuthToken: Boolean(st.hasAuthToken),
      };
    }

    const plugins = [];
    for (const p of Array.isArray(pluginsRes?.plugins) ? pluginsRes.plugins : []) {
      const dir = String(p?.path || '').split(/[/\\]/).filter(Boolean).pop() || String(p?.name || '');
      const mcpNames = (Array.isArray(p?.mcpServers) ? p.mcpServers : [])
        .map((m) => (typeof m?.name === 'string' ? m.name : null))
        .filter(Boolean);
      const isGlobal = Boolean(p?.isGlobal);
      plugins.push({
        name: String(p?.name || dir),
        dir,
        path: typeof p?.path === 'string' ? p.path : '',
        disabled: Boolean(p?.disabled),
        isGlobal,
        scope: isGlobal ? 'global' : 'workspace',
        mcpServerNames: mcpNames,
      });
    }

    return {
      available: true,
      servers,
      plugins,
    };
  }

  return { inspectRuntime };
}
