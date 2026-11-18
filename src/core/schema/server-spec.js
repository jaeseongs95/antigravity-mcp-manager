'use strict';

const {
  deriveServerNameFromUrl,
  deriveServerNameFromCommandAndArgs,
} = require('./presets');
const {
  SENSITIVE_QUERY_PARAM_RE,
  mergeHeadersCaseInsensitive,
  parseKeyValueInput,
  buildAuthHeaders,
  extractUrlAuthAndCleanUrl,
} = require('./auth-codec');
const { parseJsonc } = require('./jsonc-codec');
const {
  isLoopbackHostname,
  classifyHttpServerUrl,
} = require('../security/url-policy');

/**
 * 19 Process loader / runtime hijacking environment variables hard-blocked in `v2.0.0` (`Rev 6 §5.2`).
 */
const DANGEROUS_ENV_KEYS = new Set([
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'LD_AUDIT',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'DYLD_FALLBACK_LIBRARY_PATH',
  'NODE_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'RUBYOPT',
  'PERL5OPT',
  'JAVA_TOOL_OPTIONS',
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
  'PROMPT_COMMAND',
]);

let registeredSmartFallback = null;

function registerSmartInputFallback(fn) {
  if (typeof fn === 'function') {
    registeredSmartFallback = fn;
  }
}

function isPlainObject(val) {
  return Boolean(val && typeof val === 'object' && !Array.isArray(val));
}

function isLoopbackHost(hostname) {
  return isLoopbackHostname(hostname);
}

function hasPathEnvOverride(envMap) {
  if (!envMap || typeof envMap !== 'object') return false;
  return Object.keys(envMap).some((k) => String(k || '').trim().toUpperCase() === 'PATH');
}

function validateSafeEnvMap(envMap, { confirmPathOverride = false } = {}) {
  if (!envMap || typeof envMap !== 'object') return { ok: true, warnings: [] };
  const blocked = [];
  let hasPathOverride = false;
  for (const rawKey of Object.keys(envMap)) {
    const upper = String(rawKey || '').trim().toUpperCase();
    if (!upper) continue;
    if (DANGEROUS_ENV_KEYS.has(upper)) {
      blocked.push(rawKey);
    } else if (upper === 'PATH') {
      hasPathOverride = true;
    }
  }
  if (blocked.length > 0) {
    return {
      ok: false,
      code: 'DANGEROUS_ENV_BLOCKED',
      blockedKeys: blocked,
      error: `Blocked unsafe environment variable(s): ${blocked.join(', ')}. Loader/runtime hijack variables are not permitted.`,
    };
  }
  if (hasPathOverride && !confirmPathOverride) {
    return {
      ok: false,
      code: 'PATH_OVERRIDE_CONFIRM_REQUIRED',
      requiresConfirmation: true,
      error: 'Overriding PATH in server environment can hijack executable lookup. Confirm explicitly to save.',
    };
  }
  return {
    ok: true,
    warnings: hasPathOverride ? ['PATH_OVERRIDE'] : [],
  };
}

/**
 * Canonical transport & single-URL validator (`Rev 6 §5.2 #2`, `F3`):
 * 1) Rejects non-string defined `command`, `url`, `serverUrl`, non-array `args`, non-plain-object `env`/`headers`/`oauth` (`INVALID_SERVER_SPEC`).
 * 2) Collects all non-empty URL fields (`url`, `serverUrl`) and rejects distinct non-empty URLs (`CONFLICTING_SERVER_URLS`).
 * 3) Rejects simultaneous `command` + URL (`AMBIGUOUS_TRANSPORT_SPEC`) and empty transport (`MISSING_TRANSPORT_SPEC`).
 */
function extractAndValidateTransport(spec) {
  if (!isPlainObject(spec)) {
    return {
      ok: false,
      code: 'INVALID_SERVER_SPEC',
      error: 'Server configuration must be a plain JSON object.',
    };
  }

  if (spec.command !== undefined && typeof spec.command !== 'string') {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"command" must be a string when specified.' };
  }
  if (spec.url !== undefined && typeof spec.url !== 'string') {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"url" must be a string when specified.' };
  }
  if (spec.serverUrl !== undefined && typeof spec.serverUrl !== 'string') {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"serverUrl" must be a string when specified.' };
  }
  if (spec.args !== undefined && (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string'))) {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"args" must be an array of strings when specified.' };
  }
  if (spec.env !== undefined && !isPlainObject(spec.env)) {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"env" must be a plain JSON object when specified.' };
  }
  if (spec.headers !== undefined && !isPlainObject(spec.headers)) {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"headers" must be a plain JSON object when specified.' };
  }
  if (spec.oauth !== undefined && !isPlainObject(spec.oauth)) {
    return { ok: false, code: 'INVALID_SERVER_SPEC', error: '"oauth" must be a plain JSON object when specified.' };
  }

  const u1 = typeof spec.url === 'string' ? spec.url.trim() : '';
  const u2 = typeof spec.serverUrl === 'string' ? spec.serverUrl.trim() : '';

  if (u1 !== '' && u2 !== '' && u1 !== u2) {
    return {
      ok: false,
      code: 'CONFLICTING_SERVER_URLS',
      error: 'Conflicting non-empty "url" and "serverUrl" fields are not permitted (Split-URL blocked).',
    };
  }

  const canonicalUrl = u1 || u2;
  const command = typeof spec.command === 'string' ? spec.command.trim() : '';
  const hasCommand = command.length > 0;

  if (hasCommand && canonicalUrl !== '') {
    return {
      ok: false,
      code: 'AMBIGUOUS_TRANSPORT_SPEC',
      error: 'Ambiguous server configuration: "command" (stdio) and "url"/"serverUrl" (HTTP) cannot coexist.',
    };
  }

  if (!hasCommand && canonicalUrl === '') {
    return {
      ok: false,
      code: 'MISSING_TRANSPORT_SPEC',
      error: 'Server configuration must specify a non-empty "command" (stdio) or "url" (Streamable HTTP).',
    };
  }

  if (hasCommand) {
    return {
      ok: true,
      transport: 'stdio',
      command,
      canonicalUrl: '',
      urlKey: null,
      urlInfo: null,
    };
  }

  const urlInfo = classifyHttpServerUrl(canonicalUrl);
  if (!urlInfo.ok) {
    return {
      ok: false,
      code: urlInfo.code || 'INVALID_SERVER_URL',
      error: urlInfo.error,
    };
  }

  const urlKey = u1 === '' && u2 !== '' ? 'serverUrl' : 'url';
  return {
    ok: true,
    transport: 'http',
    command: '',
    canonicalUrl: urlInfo.href,
    rawCanonicalUrl: canonicalUrl,
    urlKey,
    urlInfo,
  };
}

function specCarriesHttpCredentials(spec, urlInfo) {
  if (urlInfo && urlInfo.hasEmbeddedCredentials) return true;
  if (urlInfo && urlInfo.parsed) {
    let hasQuerySecret = false;
    urlInfo.parsed.searchParams.forEach((val, key) => {
      if (val && SENSITIVE_QUERY_PARAM_RE.test(key)) {
        hasQuerySecret = true;
      }
    });
    if (hasQuerySecret) return true;
  }
  if (isPlainObject(spec.headers)) {
    for (const [k, v] of Object.entries(spec.headers)) {
      const cleanVal = String(v ?? '').trim();
      if (!cleanVal) continue;
      if (
        /^(?:authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-mcp-token|x-access-token)$/i.test(k) ||
        /(?:token|secret|key|auth|bearer|cookie|session|password)/i.test(k) ||
        /^(?:Bearer|Basic)\s+\S+/i.test(cleanVal)
      ) {
        return true;
      }
    }
  }
  if (
    spec.authMode === 'bearer' ||
    spec.authMode === 'apiKey' ||
    spec.authMode === 'basic' ||
    spec.authMode === 'oauth'
  ) {
    return true;
  }
  if (isPlainObject(spec.oauth) && (spec.oauth.clientId || spec.oauth.clientSecret)) {
    return true;
  }
  return false;
}

/**
 * Post-merge unified security gate enforced across ALL 4 entry points (`Rev 6 §5.2`, `F3`, `F5`):
 * `validateAndBuildServerSpec`, `saveRawConfig`, `smart-parser`, and `applyAuthToAllHttp`.
 */
function assertServerSpecSecurity(spec, opts = {}) {
  const tr = extractAndValidateTransport(spec);
  if (!tr.ok) return tr;

  const envCheck = validateSafeEnvMap(spec.env, {
    confirmPathOverride: Boolean(opts.confirmPathOverride),
  });
  if (!envCheck.ok) return envCheck;

  const warnings = [...envCheck.warnings];

  if (tr.transport === 'http') {
    const hasCredentials = specCarriesHttpCredentials(spec, tr.urlInfo);
    if (tr.urlInfo.isInsecureRemoteHttp) {
      if (hasCredentials) {
        return {
          ok: false,
          code: 'INSECURE_HTTP_CREDENTIALS_BLOCKED',
          error:
            'Sending authentication credentials or OAuth tokens over non-loopback plaintext http:// is blocked. Use https:// or loopback (localhost / 127.0.0.1 / [::1]).',
        };
      }
      if (!opts.allowInsecureHttp) {
        return {
          ok: false,
          code: 'INSECURE_HTTP_CONFIRM_REQUIRED',
          requiresConfirmation: true,
          error:
            'Plaintext non-loopback http:// MCP URLs expose traffic without TLS. Use https:// or confirm insecure HTTP explicitly.',
        };
      }
      warnings.push('INSECURE_HTTP');
    }
  }

  // Canonicalize spec: strip empty/duplicate URL keys and deduplicate headers case-insensitively
  const normalizedSpec = { ...spec };
  if (tr.transport === 'http') {
    delete normalizedSpec.command;
    delete normalizedSpec.url;
    delete normalizedSpec.serverUrl;
    normalizedSpec[tr.urlKey] = tr.rawCanonicalUrl;
    if (isPlainObject(normalizedSpec.headers)) {
      const mergedHdrs = mergeHeadersCaseInsensitive(normalizedSpec.headers);
      if (Object.keys(mergedHdrs).length > 0) {
        normalizedSpec.headers = mergedHdrs;
      } else {
        delete normalizedSpec.headers;
      }
    }
  } else {
    delete normalizedSpec.url;
    delete normalizedSpec.serverUrl;
    normalizedSpec.command = tr.command;
  }

  return {
    ok: true,
    transport: tr.transport,
    canonicalUrl: tr.canonicalUrl,
    urlKey: tr.urlKey,
    urlInfo: tr.urlInfo,
    spec: normalizedSpec,
    warnings,
  };
}

function validateHttpEndpointSecurity(cleanUrl, { hasCredentials, allowInsecureHttp }) {
  const urlInfo = classifyHttpServerUrl(cleanUrl);
  if (!urlInfo.ok) {
    return { ok: false, code: urlInfo.code, error: 'Remote MCP Server URL is not a valid HTTP/HTTPS URL.' };
  }
  if (urlInfo.isInsecureRemoteHttp) {
    if (hasCredentials || urlInfo.hasEmbeddedCredentials) {
      return {
        ok: false,
        code: 'INSECURE_HTTP_CREDENTIALS_BLOCKED',
        error:
          'Sending authentication credentials or OAuth tokens over non-loopback plaintext http:// is blocked. Use https:// or loopback (localhost / 127.0.0.1 / [::1]).',
      };
    }
    if (!allowInsecureHttp) {
      return {
        ok: false,
        code: 'INSECURE_HTTP_CONFIRM_REQUIRED',
        requiresConfirmation: true,
        error:
          'Plaintext non-loopback http:// MCP URLs expose traffic without TLS. Use https:// or confirm insecure HTTP explicitly.',
      };
    }
    return { ok: true, warnings: ['INSECURE_HTTP'] };
  }
  return { ok: true, warnings: [] };
}

function parseArgsInput(raw) {
  if (Array.isArray(raw)) {
    return raw.filter((x) => x !== null && x !== undefined).map((x) => String(x));
  }
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((x) => x !== null && x !== undefined).map((x) => String(x));
      }
    } catch {}
  }
  if (trimmed.includes('\n')) {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  const tokens = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = re.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\(["\\])/g, '$1'));
    } else if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\(['\\])/g, '$1'));
    } else {
      tokens.push(match[3]);
    }
  }
  return tokens;
}

function formatArgsForInput(args) {
  if (!Array.isArray(args) || args.length === 0) return '';
  return args.join('\n');
}

function detectTransport(spec) {
  const tr = extractAndValidateTransport(spec);
  if (tr.ok) return tr.transport;
  if (spec && typeof spec === 'object') {
    if ((typeof spec.url === 'string' && spec.url.trim()) || (typeof spec.serverUrl === 'string' && spec.serverUrl.trim())) {
      return 'http';
    }
  }
  return 'stdio';
}

function validateAndBuildServerSpec(
  {
    serverName,
    description,
    transport,
    command,
    args,
    argsText,
    env,
    envText,
    cwd,
    urlKey,
    url,
    serverUrl,
    headers,
    headersText,
    authMode,
    oauth,
    oauthClientMode,
    oauthClientId,
    oauthClientSecret,
    oauthScopes,
    bearerToken,
    apiKeyHeader,
    apiKeyValue,
    basicUser,
    basicPass,
    disabled,
    confirmPathOverride = false,
    allowInsecureHttp = false,
    existingSpec,
  },
  externalExistingSpec
) {
  let effectiveConfirmPath = Boolean(confirmPathOverride);
  let effectiveAllowInsecureHttp = Boolean(allowInsecureHttp);
  let effectiveExternalExisting = externalExistingSpec;
  if (
    isPlainObject(externalExistingSpec) &&
    ('allowInsecureHttp' in externalExistingSpec ||
      'confirmPathOverride' in externalExistingSpec ||
      'existingSpec' in externalExistingSpec) &&
    !('command' in externalExistingSpec || 'url' in externalExistingSpec || 'serverUrl' in externalExistingSpec)
  ) {
    effectiveConfirmPath = Boolean(effectiveConfirmPath || externalExistingSpec.confirmPathOverride);
    effectiveAllowInsecureHttp = Boolean(effectiveAllowInsecureHttp || externalExistingSpec.allowInsecureHttp);
    effectiveExternalExisting = externalExistingSpec.existingSpec;
  }
  confirmPathOverride = effectiveConfirmPath;
  allowInsecureHttp = effectiveAllowInsecureHttp;

  // Reject Split-URL or ambiguous raw inputs immediately if caller passed both `url` and `serverUrl` or `command` + `url`
  const preU1 = typeof url === 'string' ? url.trim() : '';
  const preU2 = typeof serverUrl === 'string' ? serverUrl.trim() : '';
  if (preU1 && preU2 && preU1 !== preU2) {
    return {
      ok: false,
      code: 'CONFLICTING_SERVER_URLS',
      error: 'Conflicting non-empty "url" and "serverUrl" fields are not permitted (Split-URL blocked).',
    };
  }

  let cleanName = typeof serverName === 'string' ? serverName.trim() : '';
  const rawCmd = typeof command === 'string' ? command.trim() : '';
  const rawUrl = preU1 || preU2;
  const rawArgsStr =
    typeof args === 'string' ? args.trim() : typeof argsText === 'string' ? argsText.trim() : '';

  if (registeredSmartFallback) {
    if (/^https?:\/\/\S+$/i.test(cleanName) && !rawUrl) {
      return registeredSmartFallback(cleanName, bearerToken || apiKeyValue || '');
    }
    if (transport !== 'http' && !rawUrl) {
      if (/^https?:\/\/\S+$/i.test(rawCmd)) {
        const smart = registeredSmartFallback(rawCmd, bearerToken || apiKeyValue || '');
        if (smart.ok) {
          if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
          return smart;
        }
      }
      if ((rawCmd === 'npx' || !rawCmd) && /^https?:\/\/\S+$/i.test(rawArgsStr)) {
        const smart = registeredSmartFallback(rawArgsStr, bearerToken || apiKeyValue || '');
        if (smart.ok) {
          if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
          return smart;
        }
      }
      if (rawCmd.includes(' ') && !rawArgsStr) {
        const smart = registeredSmartFallback(rawCmd, bearerToken || apiKeyValue || '');
        if (smart.ok) {
          if (cleanName && /^[a-zA-Z0-9._-]+$/.test(cleanName)) smart.serverName = cleanName;
          return smart;
        }
      }
    }
  }

  if (!cleanName) {
    if (transport === 'http' || /^https?:\/\/.+/i.test(rawUrl)) {
      cleanName = deriveServerNameFromUrl(rawUrl);
    } else {
      const parsedArgsCandidate = parseArgsInput(args !== undefined ? args : argsText);
      cleanName = deriveServerNameFromCommandAndArgs(command, parsedArgsCandidate);
    }
  }
  if (!cleanName) {
    return { ok: false, error: 'Server name is required (e.g. "filesystem" or "my-mcp-server").' };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
    return {
      ok: false,
      error: 'Server name may only contain letters, numbers, hyphens (-), underscores (_), and dots (.).',
    };
  }

  const resolvedExisting = existingSpec || effectiveExternalExisting;
  const base = isPlainObject(resolvedExisting) ? { ...resolvedExisting } : {};
  const usesServerUrlAlias = Boolean(
    urlKey === 'serverUrl' ||
      (preU1 === '' && preU2 !== '') ||
      (resolvedExisting &&
        typeof resolvedExisting.serverUrl === 'string' &&
        resolvedExisting.serverUrl.trim() &&
        !resolvedExisting.url)
  );
  delete base.command;
  delete base.args;
  delete base.env;
  delete base.url;
  delete base.serverUrl;
  delete base.headers;
  delete base.oauth;
  delete base.authMode;
  delete base.apiKeyHeader;
  delete base.description;
  delete base.disabled;
  if (cwd !== undefined) {
    delete base.cwd;
  }

  const cleanDesc = typeof description === 'string' ? description.trim() : '';

  if (transport === 'http') {
    if (rawCmd) {
      return {
        ok: false,
        code: 'AMBIGUOUS_TRANSPORT_SPEC',
        error: 'Ambiguous server configuration: "command" (stdio) and "url" (HTTP) cannot coexist.',
      };
    }
    if (!rawUrl) {
      return {
        ok: false,
        code: 'MISSING_TRANSPORT_SPEC',
        error: 'Remote MCP Server URL is required for Streamable HTTP transport.',
      };
    }
    if (!/^https?:\/\/.+/i.test(rawUrl)) {
      return {
        ok: false,
        code: 'INVALID_SERVER_URL',
        error: 'Remote MCP Server URL must start with https:// or http://.',
      };
    }

    const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(rawUrl);
    const manualHeaders = parseKeyValueInput(headers !== undefined ? headers : headersText, {
      caseInsensitiveKeys: true,
    });
    const effectiveAuthMode =
      extractedHeaders.Authorization &&
      (!authMode || authMode === 'oauth' || authMode === 'oauth_or_none' || authMode === 'none')
        ? ''
        : authMode;
    const combinedBaseHeaders = mergeHeadersCaseInsensitive(extractedHeaders, manualHeaders);
    const finalHeaders = buildAuthHeaders({
      authMode: effectiveAuthMode,
      bearerToken,
      apiKeyHeader,
      apiKeyValue,
      basicUser,
      basicPass,
      baseHeaders: combinedBaseHeaders,
    });

    const cId =
      typeof oauthClientId === 'string'
        ? oauthClientId.trim()
        : typeof oauth?.clientId === 'string'
          ? oauth.clientId.trim()
          : '';
    const cSec =
      typeof oauthClientSecret === 'string'
        ? oauthClientSecret.trim()
        : typeof oauth?.clientSecret === 'string'
          ? oauth.clientSecret.trim()
          : '';
    const cScopes =
      typeof oauthScopes === 'string'
        ? oauthScopes.trim()
        : Array.isArray(oauth?.scopes)
          ? oauth.scopes.join(' ').trim()
          : typeof oauth?.scopes === 'string'
            ? oauth.scopes.trim()
            : '';

    const hasExplicitFormCredentials =
      Object.keys(finalHeaders).length > 0 ||
      authMode === 'bearer' ||
      authMode === 'apiKey' ||
      authMode === 'basic' ||
      authMode === 'oauth' ||
      Boolean(cId || cSec);

    const httpSec = validateHttpEndpointSecurity(cleanUrl, {
      hasCredentials: hasExplicitFormCredentials,
      allowInsecureHttp,
    });
    if (!httpSec.ok) {
      return httpSec;
    }

    const spec = {
      ...base,
      [usesServerUrlAlias ? 'serverUrl' : 'url']: cleanUrl,
    };
    if (cleanDesc) {
      spec.description = cleanDesc;
    }
    if (Object.keys(finalHeaders).length > 0) {
      spec.headers = finalHeaders;
    }
    if ((authMode === 'none' || authMode === 'oauth_or_none') && !extractedHeaders.Authorization) {
      spec.authMode = authMode;
    } else if (authMode === 'apiKey') {
      spec.authMode = 'apiKey';
      const cleanHdr =
        typeof apiKeyHeader === 'string' && apiKeyHeader.trim() ? apiKeyHeader.trim() : 'X-API-Key';
      spec.apiKeyHeader = cleanHdr;
    }
    if (
      (authMode === 'oauth' || authMode === 'oauth_or_none' || !authMode) &&
      (oauthClientMode === 'custom' || cId || cSec || cScopes)
    ) {
      const oauthObj = {};
      if (oauthClientMode !== 'auto') {
        if (cId) oauthObj.clientId = cId;
        if (cSec) oauthObj.clientSecret = cSec;
      }
      if (cScopes) oauthObj.scopes = cScopes.split(/[\s,]+/).filter(Boolean);
      if (Object.keys(oauthObj).length > 0) {
        spec.oauth = oauthObj;
      }
    }
    if (disabled) {
      spec.disabled = true;
    }

    // Final unified post-merge security gate (`Rev 6 §5.2 #2.1`)
    const finalGate = assertServerSpecSecurity(spec, {
      confirmPathOverride,
      allowInsecureHttp,
    });
    if (!finalGate.ok) {
      return finalGate;
    }

    return {
      ok: true,
      serverName: cleanName,
      spec: finalGate.spec,
      warnings: finalGate.warnings,
    };
  }

  if (rawUrl) {
    return {
      ok: false,
      code: 'AMBIGUOUS_TRANSPORT_SPEC',
      error: 'Ambiguous server configuration: "command" (stdio) and "url" (HTTP) cannot coexist.',
    };
  }
  if (!rawCmd) {
    return {
      ok: false,
      code: 'MISSING_TRANSPORT_SPEC',
      error: 'Executable command is required for Stdio transport (e.g. "npx", "node", "uvx").',
    };
  }

  const parsedArgs = parseArgsInput(args !== undefined ? args : argsText);
  const parsedEnv = parseKeyValueInput(env !== undefined ? env : envText);
  if (authMode === 'bearer' && typeof bearerToken === 'string' && bearerToken.trim()) {
    const cleanTok = bearerToken.trim().replace(/^Bearer\s+/i, '');
    if (cleanTok && !parsedEnv.MCP_AUTH_TOKEN) {
      parsedEnv.MCP_AUTH_TOKEN = cleanTok;
    }
  } else if (authMode === 'apiKey' && typeof apiKeyValue === 'string' && apiKeyValue.trim()) {
    const envKey =
      typeof apiKeyHeader === 'string' && apiKeyHeader.trim()
        ? apiKeyHeader.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
        : 'MCP_API_KEY';
    parsedEnv[envKey] = apiKeyValue.trim();
  }

  const cleanCwd = typeof cwd === 'string' ? cwd.trim() : '';
  const spec = {
    ...base,
    command: rawCmd,
  };
  if (cleanDesc) {
    spec.description = cleanDesc;
  }
  if (parsedArgs.length > 0) {
    spec.args = parsedArgs;
  }
  if (Object.keys(parsedEnv).length > 0) {
    spec.env = parsedEnv;
  }
  if (cleanCwd) {
    spec.cwd = cleanCwd;
  }
  if (disabled) {
    spec.disabled = true;
  }

  // Final unified post-merge security gate AFTER `apiKeyHeader -> env` and `envText -> env` merge (`Rev 6 §5.2 #2.1`)
  const finalGate = assertServerSpecSecurity(spec, {
    confirmPathOverride,
    allowInsecureHttp,
  });
  if (!finalGate.ok) {
    return finalGate;
  }

  return {
    ok: true,
    serverName: cleanName,
    spec: finalGate.spec,
    requiresConfirmation: true,
    warnings: finalGate.warnings,
  };
}

/**
 * Validates and normalizes a full `mcp_config.json` object or JSON/JSONC string (`Rev 6 §5.2`).
 * - Always enforces `extractAndValidateTransport` (Split-URL, non-string types, `command`+`url` ambiguity).
 * - When `options.enforceSecurity === true` or `options.enforceEnvSecurity === true`, runs `assertServerSpecSecurity`
 *   across every server entry!
 */
function normalizeMcpConfigObject(raw, options = {}) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { ok: true, config: { mcpServers: {} } };
    }
    const jsoncRes = parseJsonc(trimmed);
    if (!jsoncRes.ok) {
      return { ok: false, error: jsoncRes.error };
    }
    parsed = jsoncRes.value;
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'MCP config root must be a JSON object.' };
  }

  let serversMap = parsed.mcpServers;
  if (!isPlainObject(serversMap)) {
    const keys = Object.keys(parsed);
    const looksLikeDirectServerMap =
      keys.length > 0 &&
      keys.every(
        (k) =>
          isPlainObject(parsed[k]) &&
          ('command' in parsed[k] || 'url' in parsed[k] || 'serverUrl' in parsed[k])
      );
    if (looksLikeDirectServerMap) {
      serversMap = parsed;
      parsed = { mcpServers: { ...serversMap } };
    } else if (parsed.mcpServers === undefined) {
      parsed = { ...parsed, mcpServers: {} };
    } else {
      return {
        ok: false,
        error: '"mcpServers" must be a JSON object mapping server names to configurations.',
      };
    }
  } else {
    parsed = { ...parsed, mcpServers: { ...parsed.mcpServers } };
  }

  const enforceFullSecurity = Boolean(options.enforceSecurity || options.enforceEnvSecurity);
  const normalizedServers = {};

  for (const [name, rawSpec] of Object.entries(parsed.mcpServers)) {
    const tr = extractAndValidateTransport(rawSpec);
    if (!tr.ok) {
      return {
        ok: false,
        code: tr.code,
        error: `Server "${name}": ${tr.error}`,
      };
    }
    if (enforceFullSecurity) {
      const sec = assertServerSpecSecurity(rawSpec, {
        confirmPathOverride: Boolean(options.confirmPathOverride),
        allowInsecureHttp: Boolean(options.allowInsecureHttp),
      });
      if (!sec.ok) {
        return {
          ...sec,
          error: `Server "${name}": ${sec.error}`,
        };
      }
      normalizedServers[name] = sec.spec;
    } else {
      const cleaned = { ...rawSpec };
      if (tr.transport === 'http') {
        delete cleaned.command;
        delete cleaned.url;
        delete cleaned.serverUrl;
        cleaned[tr.urlKey] = tr.rawCanonicalUrl;
      } else {
        delete cleaned.url;
        delete cleaned.serverUrl;
      }
      normalizedServers[name] = cleaned;
    }
  }

  parsed.mcpServers = normalizedServers;
  return { ok: true, config: parsed };
}

module.exports = {
  DANGEROUS_ENV_KEYS,
  isPlainObject,
  isLoopbackHost,
  hasPathEnvOverride,
  validateSafeEnvMap,
  extractAndValidateTransport,
  assertServerSpecSecurity,
  validateHttpEndpointSecurity,
  registerSmartInputFallback,
  parseArgsInput,
  formatArgsForInput,
  formatArgsForEditor: formatArgsForInput,
  detectTransport,
  validateAndBuildServerSpec,
  normalizeMcpConfigObject,
};
