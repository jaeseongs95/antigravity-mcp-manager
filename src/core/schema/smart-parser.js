'use strict';

const presets = require('./presets');
const authCodec = require('./auth-codec');
const serverSpec = require('./server-spec');
const jsoncCodec = require('./jsonc-codec');

const {
  KNOWN_UVX_PACKAGES,
  sanitizeServerName,
  deriveServerNameFromUrl,
  deriveServerNameFromCommandAndArgs,
} = presets;

const {
  mergeHeadersCaseInsensitive,
  parseKeyValueInput,
  normalizeQuickAuthToken,
  extractUrlAuthAndCleanUrl,
} = authCodec;

const {
  isPlainObject,
  registerSmartInputFallback,
  parseArgsInput,
  extractAndValidateTransport,
  assertServerSpecSecurity,
  validateAndBuildServerSpec,
  normalizeMcpConfigObject,
} = serverSpec;

const { parseJsonc } = jsoncCodec;

/**
 * Detects unquoted shell metacharacters (`;`, `|`, `&`, `>`, `<`, `` ` ``, `$(`, `\r`, `\n`)
 * in raw command-line input with ZERO exemption for `curl` (`Rev 6 §5.2`, `MCP-TC-045`).
 */
function hasUnquotedShellChaining(raw) {
  const s = String(raw ?? '');
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = i + 1 < s.length ? s[i + 1] : '';
    if (ch === '\r' || ch === '\n') {
      return true;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === ';' || ch === '`' || ch === '|' || ch === '&' || ch === '>' || ch === '<') {
        return true;
      }
      if (ch === '$' && next === '(') {
        return true;
      }
    }
  }
  return false;
}

function computeRequiresConfirmation(res) {
  if (!res || !res.ok) return false;
  if (res.requiresConfirmation) return true;
  if (res.spec && typeof res.spec.command === 'string' && res.spec.command.trim()) {
    return true;
  }
  if (isPlainObject(res.multipleServers)) {
    for (const s of Object.values(res.multipleServers)) {
      if (s && typeof s.command === 'string' && s.command.trim()) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Merges optional `quickAuth` and `inlineHeaders` case-insensitively and enforces
 * `assertServerSpecSecurity` AFTER all merges on both `res.spec` and every `res.multipleServers` entry (`Rev 6 F3`, `5095348c-F4`).
 */
function finalizeAndVerifySmartResult(res, quickAuth, inlineHeaders = null, opts = {}) {
  if (!res || !res.ok) return res;

  const authHeaderPatch = quickAuth ? { [quickAuth.headerKey]: quickAuth.headerValue } : null;
  const hasInlineHeaders = isPlainObject(inlineHeaders) && Object.keys(inlineHeaders).length > 0;

  if (isPlainObject(res.multipleServers)) {
    const nextMulti = {};
    for (const [name, rawSpec] of Object.entries(res.multipleServers)) {
      const tr = extractAndValidateTransport(rawSpec);
      if (!tr.ok) return tr;
      const candidate = { ...rawSpec };
      if (tr.transport === 'http' && (hasInlineHeaders || authHeaderPatch)) {
        candidate.headers = mergeHeadersCaseInsensitive(candidate.headers, inlineHeaders, authHeaderPatch);
      } else if (tr.transport === 'stdio' && quickAuth) {
        const env = { ...(candidate.env || {}) };
        const placeholderKey = Object.keys(env).find((k) => /^<.*>$/.test(String(env[k] || '').trim()));
        if (placeholderKey) {
          env[placeholderKey] = quickAuth.rawToken;
        } else {
          env.MCP_AUTH_TOKEN = quickAuth.rawToken;
        }
        candidate.env = env;
      }
      const sec = assertServerSpecSecurity(candidate, {
        confirmPathOverride: Boolean(opts.confirmPathOverride),
        allowInsecureHttp: Boolean(opts.allowInsecureHttp),
      });
      if (!sec.ok) return sec;
      nextMulti[name] = sec.spec;
    }
    res.multipleServers = nextMulti;
    const firstKey = Object.keys(nextMulti)[0];
    if (firstKey) {
      res.serverName = firstKey;
      res.spec = nextMulti[firstKey];
    }
  } else if (isPlainObject(res.spec)) {
    const tr = extractAndValidateTransport(res.spec);
    if (!tr.ok) return tr;
    const candidate = { ...res.spec };
    if (tr.transport === 'http' && (hasInlineHeaders || authHeaderPatch)) {
      candidate.headers = mergeHeadersCaseInsensitive(candidate.headers, inlineHeaders, authHeaderPatch);
    } else if (tr.transport === 'stdio' && quickAuth) {
      const env = { ...(candidate.env || {}) };
      const placeholderKey = Object.keys(env).find((k) => /^<.*>$/.test(String(env[k] || '').trim()));
      if (placeholderKey) {
        env[placeholderKey] = quickAuth.rawToken;
      } else {
        env.MCP_AUTH_TOKEN = quickAuth.rawToken;
      }
      candidate.env = env;
    }
    const sec = assertServerSpecSecurity(candidate, {
      confirmPathOverride: Boolean(opts.confirmPathOverride),
      allowInsecureHttp: Boolean(opts.allowInsecureHttp),
    });
    if (!sec.ok) return sec;
    res.spec = sec.spec;
    res.warnings = sec.warnings;
  }

  res.requiresConfirmation = computeRequiresConfirmation(res);
  return res;
}

function parseSmartMcpInput(rawInput, optionalAuthToken = '', options = {}) {
  if (typeof rawInput !== 'string' || !rawInput.trim()) {
    return {
      ok: false,
      error: 'Please enter an MCP server URL, package name, command, or JSON snippet.',
    };
  }
  if (isPlainObject(optionalAuthToken)) {
    options = optionalAuthToken;
    optionalAuthToken = optionalAuthToken.quickAuthInput || optionalAuthToken.authToken || '';
  }
  const trimmed = rawInput.trim();
  const quickAuth = normalizeQuickAuthToken(optionalAuthToken);
  const secOpts = {
    confirmPathOverride: Boolean(options.confirmPathOverride),
    allowInsecureHttp: Boolean(options.allowInsecureHttp),
  };

  // 1. JSON / JSONC snippet (`{ "mcpServers": ... }`, `{ "my-server": { ... } }`, or `{ "url": "..." }`)
  if (trimmed.startsWith('{')) {
    const parsedJsonc = parseJsonc(trimmed);
    if (!parsedJsonc.ok) {
      return { ok: false, error: parsedJsonc.error };
    }
    const obj = parsedJsonc.value;
    if (!isPlainObject(obj)) {
      return { ok: false, code: 'INVALID_SERVER_SPEC', error: 'MCP JSON snippet root must be an object.' };
    }

    const isDirectSingleServerCandidate =
      'url' in obj ||
      'serverUrl' in obj ||
      'command' in obj ||
      obj.type === 'http' ||
      obj.type === 'stdio';

    if (isDirectSingleServerCandidate) {
      // Rev 6 F3: Validate raw `obj` BEFORE `obj.url || obj.serverUrl` projection so Split-URL,
      // empty `serverUrl: ""`, non-string fields, and `command` + `url` coexistence are never masked!
      const rawTr = extractAndValidateTransport(obj);
      if (!rawTr.ok) {
        return rawTr;
      }

      const isHttp = rawTr.transport === 'http';
      const serverName =
        sanitizeServerName(obj.name || obj.serverName) ||
        (isHttp
          ? deriveServerNameFromUrl(rawTr.canonicalUrl)
          : deriveServerNameFromCommandAndArgs(rawTr.command, obj.args));

      const built = validateAndBuildServerSpec({
        serverName,
        description: obj.description,
        transport: rawTr.transport,
        command: rawTr.transport === 'stdio' ? rawTr.command : undefined,
        args: obj.args,
        env: obj.env,
        cwd: obj.cwd,
        url: rawTr.urlKey === 'url' ? rawTr.rawCanonicalUrl : undefined,
        serverUrl: rawTr.urlKey === 'serverUrl' ? rawTr.rawCanonicalUrl : undefined,
        headers: obj.headers,
        oauth: obj.oauth,
        bearerToken: obj.bearerToken || obj.token || '',
        authMode: obj.bearerToken || obj.token ? 'bearer' : obj.authMode,
        apiKeyHeader: obj.apiKeyHeader,
        disabled: Boolean(obj.disabled),
        confirmPathOverride: secOpts.confirmPathOverride,
        allowInsecureHttp: secOpts.allowInsecureHttp,
      });
      return finalizeAndVerifySmartResult(built, quickAuth, null, secOpts);
    }

    const norm = normalizeMcpConfigObject(obj, {
      enforceSecurity: true,
      confirmPathOverride: secOpts.confirmPathOverride,
      allowInsecureHttp: secOpts.allowInsecureHttp,
    });
    if (!norm.ok) {
      return norm;
    }
    if (norm.config && isPlainObject(norm.config.mcpServers)) {
      const entries = Object.entries(norm.config.mcpServers);
      if (entries.length === 0) {
        return { ok: false, code: 'MISSING_TRANSPORT_SPEC', error: 'No MCP server entries found in JSON object.' };
      }
      const [firstName, firstSpec] = entries[0];
      return finalizeAndVerifySmartResult(
        {
          ok: true,
          serverName: firstName,
          spec: firstSpec,
          multipleServers: entries.length > 1 ? norm.config.mcpServers : null,
        },
        quickAuth,
        null,
        secOpts
      );
    }
    return { ok: false, error: 'Could not recognize MCP JSON snippet.' };
  }

  // Reject shell metacharacters across ALL non-JSON command/curl/URL-with-flags inputs (`Rev 6 §5.2`)
  if (hasUnquotedShellChaining(trimmed)) {
    return {
      ok: false,
      code: 'SHELL_METACHAR_BLOCKED',
      error: 'Shell chaining or redirection operators (;, |, &, >, <, `, $(), or newlines) are not allowed in Quick Auto-Add.',
    };
  }

  // 1b. URL accompanied by inline auth flags/tokens (`https://host/mcp Bearer xxx`, `curl -H ... https://host/mcp`)
  if (/https?:\/\/\S+/i.test(trimmed) && /\s/.test(trimmed)) {
    const tokens = parseArgsInput(trimmed);
    const firstToken = String(tokens[0] || '');
    const isUrlOrCurlStart = /^https?:\/\/\S+$/i.test(firstToken) || /^curl(?:\.exe)?$/i.test(firstToken);
    const urlToken = tokens.find((t) => /^https?:\/\/\S+$/i.test(t));
    if (urlToken && isUrlOrCurlStart) {
      const rest = tokens.filter((t) => t !== urlToken && !/^curl(?:\.exe)?$/i.test(t));
      let inlineHeaders = {};
      for (let i = 0; i < rest.length; i++) {
        const tk = rest[i];
        if ((tk === '-H' || tk === '--header') && rest[i + 1]) {
          inlineHeaders = mergeHeadersCaseInsensitive(
            inlineHeaders,
            parseKeyValueInput(rest[i + 1], { caseInsensitiveKeys: true })
          );
          i++;
        } else if ((tk === '--token' || tk === '--bearer' || /^bearer$/i.test(tk)) && rest[i + 1]) {
          inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
            Authorization: `Bearer ${rest[i + 1].replace(/^Bearer\s+/i, '')}`,
          });
          i++;
        } else if ((tk === '--api-key' || tk === '--apikey') && rest[i + 1]) {
          inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
            'X-API-Key': rest[i + 1],
          });
          i++;
        } else if (rest.length === 1 && !tk.startsWith('-')) {
          const parsedAuth = normalizeQuickAuthToken(tk);
          if (parsedAuth) {
            inlineHeaders = mergeHeadersCaseInsensitive(inlineHeaders, {
              [parsedAuth.headerKey]: parsedAuth.headerValue,
            });
          }
        }
      }
      const baseRes = parseSmartMcpInput(urlToken, '', secOpts);
      return finalizeAndVerifySmartResult(baseRes, quickAuth, inlineHeaders, secOpts);
    }
  }

  // 2. Single-token URL (`http://...` or `https://...`)
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const host = u.hostname.toLowerCase();

      if (host === 'github.com' || host === 'www.github.com') {
        const parts = u.pathname.split('/').filter(Boolean);
        const srcIdx = parts.indexOf('src');
        if (parts[0] === 'modelcontextprotocol' && parts[1] === 'servers' && srcIdx !== -1 && parts[srcIdx + 1]) {
          const subPkg = parts[srcIdx + 1];
          const pkgName = `@modelcontextprotocol/server-${subPkg}`;
          return finalizeAndVerifySmartResult(
            validateAndBuildServerSpec({
              serverName: sanitizeServerName(subPkg) || 'mcp-server',
              transport: 'stdio',
              command: 'npx',
              args: ['-y', pkgName],
              confirmPathOverride: secOpts.confirmPathOverride,
            }),
            quickAuth,
            null,
            secOpts
          );
        }
        if (parts.length >= 2) {
          const owner = parts[0];
          const repo = parts[1].replace(/\.git$/i, '');
          return finalizeAndVerifySmartResult(
            validateAndBuildServerSpec({
              serverName: sanitizeServerName(repo) || sanitizeServerName(owner) || 'github-mcp',
              transport: 'stdio',
              command: 'npx',
              args: ['-y', `github:${owner}/${repo}`],
              confirmPathOverride: secOpts.confirmPathOverride,
            }),
            quickAuth,
            null,
            secOpts
          );
        }
      }

      if ((host === 'npmjs.com' || host === 'www.npmjs.com') && u.pathname.startsWith('/package/')) {
        const pkgName = u.pathname.slice('/package/'.length).replace(/\/+$/, '');
        if (pkgName) {
          return finalizeAndVerifySmartResult(
            validateAndBuildServerSpec({
              serverName: deriveServerNameFromCommandAndArgs('npx', [pkgName]),
              transport: 'stdio',
              command: 'npx',
              args: ['-y', pkgName],
              confirmPathOverride: secOpts.confirmPathOverride,
            }),
            quickAuth,
            null,
            secOpts
          );
        }
      }

      const { cleanUrl, extractedHeaders } = extractUrlAuthAndCleanUrl(trimmed);
      const serverName = deriveServerNameFromUrl(cleanUrl);
      // Merge quickAuth before final security gate so non-loopback `http://` + quickAuth immediately fails with `INSECURE_HTTP_CREDENTIALS_BLOCKED`
      const mergedInitialHeaders = mergeHeadersCaseInsensitive(
        extractedHeaders,
        quickAuth ? { [quickAuth.headerKey]: quickAuth.headerValue } : null
      );
      const built = validateAndBuildServerSpec({
        serverName,
        transport: 'http',
        url: cleanUrl,
        headers: mergedInitialHeaders,
        allowInsecureHttp: secOpts.allowInsecureHttp,
      });
      return finalizeAndVerifySmartResult(built, null, null, secOpts);
    } catch {
      return { ok: false, code: 'INVALID_SERVER_URL', error: 'Invalid URL format.' };
    }
  }

  // 3. Bare package name (`@scope/pkg` or `mcp-server-*`)
  if (/^(?:@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-._~]+|mcp-server-[a-z0-9-._~]+|[a-z0-9-._~]+-mcp(?:-server)?)(?:@[^\s]+)?$/i.test(trimmed)) {
    const barePkg = trimmed.replace(/@[^@/]+$/, '');
    const isUvx = KNOWN_UVX_PACKAGES.has(barePkg.toLowerCase());
    const command = isUvx ? 'uvx' : 'npx';
    const args = isUvx ? [trimmed] : ['-y', trimmed];
    return finalizeAndVerifySmartResult(
      validateAndBuildServerSpec({
        serverName: deriveServerNameFromCommandAndArgs(command, args),
        transport: 'stdio',
        command,
        args,
        confirmPathOverride: secOpts.confirmPathOverride,
      }),
      quickAuth,
      null,
      secOpts
    );
  }

  // 4. Full command line (`npx -y ...`, `uvx ...`, `bun run ...`, etc.)
  const tokens = parseArgsInput(trimmed);
  if (tokens.length > 0) {
    const command = tokens[0];
    const args = tokens.slice(1);
    const serverName = deriveServerNameFromCommandAndArgs(command, args);
    return finalizeAndVerifySmartResult(
      validateAndBuildServerSpec({
        serverName,
        transport: 'stdio',
        command,
        args,
        confirmPathOverride: secOpts.confirmPathOverride,
      }),
      quickAuth,
      null,
      secOpts
    );
  }

  return { ok: false, error: 'Could not recognize MCP server address or command.' };
}

registerSmartInputFallback(parseSmartMcpInput);

module.exports = {
  ...presets,
  ...authCodec,
  ...serverSpec,
  ...jsoncCodec,
  hasUnquotedShellChaining,
  parseSmartMcpInput,
};
