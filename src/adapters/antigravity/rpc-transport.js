'use strict';

/**
 * Unified Antigravity LanguageServerService RPC Transport (Direct Fiber + Remote `proxyCommand`).
 *
 * Preserves HTTP status codes (such as HTTP 404 / 502) on transport errors so
 * `antigravity-ports-adapter.js` never confuses proxy transport failures with `ENOENT`.
 */

function toCamelCaseMethod(pascalMethod) {
  const clean = String(pascalMethod || '').trim();
  if (!clean) return '';
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

/**
 * Unwraps Connect-JSON / proxyCommand envelopes while surfacing HTTP transport errors.
 *
 * @param {any} rawResponse
 * @param {string} methodName
 */
function unwrapProxyCommandResponse(rawResponse, methodName) {
  if (rawResponse === undefined || rawResponse === null) {
    return { __fromProxyCommand: true };
  }

  if (typeof rawResponse === 'string') {
    const trimmed = rawResponse.trim();
    if (!trimmed) return { __fromProxyCommand: true };
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      const err = new Error(`Non-JSON RPC response from ${methodName}: ${trimmed.slice(0, 160)}`);
      if (/404\s+page\s+not\s+found|\bhttp\s*404\b/i.test(trimmed)) {
        err.status = 404;
      }
      throw err;
    }
    return unwrapProxyCommandResponse(parsed, methodName);
  }

  if (typeof rawResponse === 'object') {
    const httpStatus = Number(rawResponse.status ?? rawResponse.statusCode ?? rawResponse.httpStatus ?? 0);
    if (httpStatus >= 400) {
      const msg =
        rawResponse.error?.message ||
        rawResponse.message ||
        rawResponse.statusText ||
        `HTTP ${httpStatus} during ${methodName}`;
      const err = new Error(String(msg));
      err.status = httpStatus;
      if (rawResponse.error?.code) err.code = rawResponse.error.code;
      throw err;
    }

    if (rawResponse.error && typeof rawResponse.error === 'object') {
      const err = new Error(String(rawResponse.error.message || `RPC error in ${methodName}`));
      if (rawResponse.error.code) err.code = String(rawResponse.error.code);
      if (rawResponse.error.httpStatus) err.status = Number(rawResponse.error.httpStatus);
      throw err;
    }

    const body =
      rawResponse.body !== undefined
        ? rawResponse.body
        : rawResponse.data !== undefined && ('status' in rawResponse || 'headers' in rawResponse)
          ? rawResponse.data
          : rawResponse;

    if (typeof body === 'string') {
      return unwrapProxyCommandResponse(body, methodName);
    }
    if (body && typeof body === 'object' && !Array.isArray(body) && !(body instanceof Uint8Array)) {
      return { ...body, __fromProxyCommand: true };
    }
    return body;
  }

  return rawResponse;
}

/**
 * Creates a unified RPC transport over Fiber `LanguageServerService` and Remote `proxyCommand`.
 *
 * @param {{
 *   win: any,
 *   doc: any,
 *   hostConfig: any,
 *   fiberGateway: any,
 *   remoteLease: any
 * }} deps
 */
function createRpcTransport(deps) {
  const { win, doc, hostConfig, fiberGateway, remoteLease } = deps;

  function isAvailable() {
    const svc = fiberGateway.getLanguageServerService();
    if (svc) return true;
    const rc = remoteLease.getInstance(win, doc);
    return Boolean(rc && typeof rc.proxyCommand === 'function');
  }

  async function callMethod(methodName, payload = {}, callOpts = {}) {
    const camel = toCamelCaseMethod(methodName);
    const svc = fiberGateway.getLanguageServerService();

    if (svc && typeof svc[camel] === 'function') {
      if (Array.isArray(callOpts.positionalArgs) && svc[camel].length >= callOpts.positionalArgs.length) {
        return await svc[camel](...callOpts.positionalArgs);
      }
      return await svc[camel](payload);
    }

    const rc = remoteLease.getInstance(win, doc);
    if (rc && typeof rc.proxyCommand === 'function') {
      const endpoint = `${hostConfig.rpcServicePrefix}/${methodName}`;
      const rawRes = await rc.proxyCommand(endpoint, payload);
      return unwrapProxyCommandResponse(rawRes, methodName);
    }

    const unavailableErr = new Error(`LanguageServerService.${methodName} is unavailable in current host session`);
    unavailableErr.code = 'SERVICE_UNAVAILABLE';
    throw unavailableErr;
  }

  async function fetchHostInstalledPluginInfo() {
    const detected = {
      hasStatusbar: false,
      hasMcpManager: true,
      hasKoTranslator: false,
      rawIds: [],
    };

    const methodsToTry = ['GetCustomizationStates', 'GetAllPlugins', 'GetAllSkills'];
    for (let i = 0; i < methodsToTry.length; i += 1) {
      try {
        const res = await callMethod(methodsToTry[i], {});
        const serialized = JSON.stringify(res || '').toLowerCase();
        if (serialized.includes('statusbar')) detected.hasStatusbar = true;
        if (serialized.includes('ko-thought-translator') || serialized.includes('ko_thought')) {
          detected.hasKoTranslator = true;
        }
      } catch {
        // Method may not exist on all Antigravity versions; try next
      }
    }

    if (win && typeof win === 'object') {
      win.__agyHostInstalledPlugins = detected;
    }
    return detected;
  }

  return {
    isAvailable,
    callMethod,
    fetchHostInstalledPluginInfo,
  };
}

module.exports = {
  toCamelCaseMethod,
  unwrapProxyCommandResponse,
  createRpcTransport,
};
