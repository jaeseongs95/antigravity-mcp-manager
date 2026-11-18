'use strict';

/**
 * Pure ECMAScript UTF-16 code-unit JSONC parser and sequential span-preserving `mcpServers` editor (`Rev 6 §5.1`).
 *
 * Invariants:
 * - Strictly indexes by UTF-16 code units (`0 .. str.length - 1`, `str.charCodeAt(i)`), with ZERO `Array.from(...)`
 *   code-point splitting so surrogate pairs (astral emoji/CJK symbols in comments or strings) never skew `.slice()` spans.
 * - Preserves top-level & sibling `//` and `/* *\/` comments, formatting, and unknown properties (`$schema`, `inputs`, etc.).
 * - Inserts missing `,` immediately after `lastProp.valueNode.end` (BEFORE any inline `// comment` on that line)
 *   and removes trailing `,` cleanly when `mcpServers` or a sibling server already ended with a trailing comma.
 * - Sequentially re-tokenizes on every `applySingleJsoncMutation` call inside `applyJsoncServerMutations`.
 */

function isWsCharCode(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Replaces comments (`//...`, `/*...*\/`) and trailing commas outside string literals with `' '`
 * while preserving `\r`, `\n`, and exact 1:1 UTF-16 code-unit length (`result.length === src.length`).
 * @param {string} rawText
 * @returns {string}
 */
function stripJsoncToValidJson(rawText) {
  const src = String(rawText ?? '');
  const len = src.length;
  const codes = new Uint16Array(len);

  let i = 0;
  let inString = false;
  let escaped = false;

  while (i < len) {
    const c = src.charCodeAt(i);
    const next = i + 1 < len ? src.charCodeAt(i + 1) : 0;

    if (inString) {
      codes[i] = c;
      if (escaped) {
        escaped = false;
      } else if (c === 0x5c /* \ */) {
        escaped = true;
      } else if (c === 0x22 /* " */) {
        inString = false;
      }
      i += 1;
      continue;
    }

    if (c === 0x22 /* " */) {
      inString = true;
      codes[i] = c;
      i += 1;
      continue;
    }

    if (c === 0x2f /* / */ && next === 0x2f /* / */) {
      codes[i] = 0x20;
      codes[i + 1] = 0x20;
      i += 2;
      while (i < len) {
        const cc = src.charCodeAt(i);
        if (cc === 0x0a || cc === 0x0d) break;
        codes[i] = 0x20;
        i += 1;
      }
      continue;
    }

    if (c === 0x2f /* / */ && next === 0x2a /* * */) {
      codes[i] = 0x20;
      codes[i + 1] = 0x20;
      i += 2;
      while (i < len) {
        const cc = src.charCodeAt(i);
        const nn = i + 1 < len ? src.charCodeAt(i + 1) : 0;
        if (cc === 0x2a /* * */ && nn === 0x2f /* / */) {
          codes[i] = 0x20;
          codes[i + 1] = 0x20;
          i += 2;
          break;
        }
        codes[i] = cc === 0x0a || cc === 0x0d ? cc : 0x20;
        i += 1;
      }
      continue;
    }

    codes[i] = c;
    i += 1;
  }

  // Pass 2: Replace trailing commas (outside strings) before `}` or `]` with space (0x20)
  inString = false;
  escaped = false;
  for (let idx = 0; idx < len; idx++) {
    const c = codes[idx];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true;
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) {
      inString = true;
      continue;
    }
    if (c === 0x2c /* , */) {
      let look = idx + 1;
      while (look < len && isWsCharCode(codes[look])) {
        look += 1;
      }
      if (look < len && (codes[look] === 0x7d /* } */ || codes[look] === 0x5d /* ] */)) {
        codes[idx] = 0x20;
      }
    }
  }

  // Decode Uint16Array in chunks to avoid call stack limits while keeping exact UTF-16 code units
  let out = '';
  const CHUNK = 8192;
  for (let offset = 0; offset < len; offset += CHUNK) {
    const slice = codes.subarray(offset, Math.min(offset + CHUNK, len));
    out += String.fromCharCode.apply(null, slice);
  }
  return out;
}

/**
 * Parses JSON or JSONC text into a JavaScript value.
 * @param {string} rawText
 * @returns {{ ok: true, value: any } | { ok: false, error: string }}
 */
function parseJsonc(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { ok: false, error: 'Configuration text is empty.' };
  }
  try {
    const cleaned = stripJsoncToValidJson(rawText);
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (err) {
    return { ok: false, error: `Invalid JSON/JSONC syntax: ${err && err.message ? err.message : String(err)}` };
  }
}

function tokenizeJsonSpans(cleanedJson) {
  const tokens = [];
  let i = 0;
  const len = cleanedJson.length;
  while (i < len) {
    const code = cleanedJson.charCodeAt(i);
    if (isWsCharCode(code)) {
      i += 1;
      continue;
    }
    const ch = cleanedJson[i];
    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':' || ch === ',') {
      tokens.push({ type: ch, start: i, end: i + 1, value: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const start = i;
      i += 1;
      let escaped = false;
      while (i < len) {
        const c = cleanedJson.charCodeAt(i);
        i += 1;
        if (escaped) {
          escaped = false;
        } else if (c === 0x5c) {
          escaped = true;
        } else if (c === 0x22) {
          break;
        }
      }
      const raw = cleanedJson.slice(start, i);
      tokens.push({ type: 'string', start, end: i, value: JSON.parse(raw) });
      continue;
    }
    const start = i;
    while (i < len) {
      const cc = cleanedJson.charCodeAt(i);
      if (
        isWsCharCode(cc) ||
        cc === 0x7b ||
        cc === 0x7d ||
        cc === 0x5b ||
        cc === 0x5d ||
        cc === 0x3a ||
        cc === 0x2c ||
        cc === 0x22
      ) {
        break;
      }
      i += 1;
    }
    tokens.push({ type: 'literal', start, end: i, value: cleanedJson.slice(start, i) });
  }
  return tokens;
}

function parseValueNode(tokens, startIdx) {
  const tok = tokens[startIdx];
  if (!tok) return null;
  if (tok.type === '{') {
    const props = [];
    let idx = startIdx + 1;
    while (idx < tokens.length && tokens[idx].type !== '}') {
      const keyTok = tokens[idx];
      if (!keyTok || keyTok.type !== 'string') break;
      idx += 1;
      if (tokens[idx] && tokens[idx].type === ':') idx += 1;
      const valRes = parseValueNode(tokens, idx);
      if (!valRes) break;
      idx = valRes.nextIdx;
      let commaPos = -1;
      if (tokens[idx] && tokens[idx].type === ',') {
        commaPos = tokens[idx].start;
        idx += 1;
      }
      props.push({
        key: keyTok.value,
        keyStart: keyTok.start,
        keyEnd: keyTok.end,
        valueNode: valRes.node,
        commaPos,
      });
    }
    const closeTok = tokens[idx];
    return {
      node: {
        type: 'object',
        start: tok.start,
        end: closeTok ? closeTok.end : tok.end,
        closeStart: closeTok ? closeTok.start : tok.end,
        props,
      },
      nextIdx: closeTok ? idx + 1 : idx,
    };
  }
  if (tok.type === '[') {
    let idx = startIdx + 1;
    const items = [];
    while (idx < tokens.length && tokens[idx].type !== ']') {
      const itemRes = parseValueNode(tokens, idx);
      if (!itemRes) break;
      items.push(itemRes.node);
      idx = itemRes.nextIdx;
      if (tokens[idx] && tokens[idx].type === ',') idx += 1;
    }
    const closeTok = tokens[idx];
    return {
      node: {
        type: 'array',
        start: tok.start,
        end: closeTok ? closeTok.end : tok.end,
        items,
      },
      nextIdx: closeTok ? idx + 1 : idx,
    };
  }
  return {
    node: { type: tok.type, start: tok.start, end: tok.end },
    nextIdx: startIdx + 1,
  };
}

function indentJsonLines(jsonStr, indentPrefix) {
  const lines = jsonStr.split('\n');
  return lines.map((line, idx) => (idx === 0 ? line : `${indentPrefix}${line}`)).join('\n');
}

/**
 * Finds the original trailing comma index in `rawSrc` between `afterValueIdx` and `limitIdx`
 * while skipping comments and whitespace (since `stripJsoncToValidJson` blanks trailing commas).
 */
function findOriginalTrailingComma(rawSrc, afterValueIdx, limitIdx) {
  let i = afterValueIdx;
  while (i < limitIdx) {
    const c = rawSrc.charCodeAt(i);
    const next = i + 1 < limitIdx ? rawSrc.charCodeAt(i + 1) : 0;
    if (isWsCharCode(c)) {
      i += 1;
      continue;
    }
    if (c === 0x2c /* , */) {
      return i;
    }
    if (c === 0x2f && next === 0x2f) {
      i += 2;
      while (i < limitIdx && rawSrc.charCodeAt(i) !== 0x0a && rawSrc.charCodeAt(i) !== 0x0d) {
        i += 1;
      }
      continue;
    }
    if (c === 0x2f && next === 0x2a) {
      i += 2;
      while (i < limitIdx) {
        if (rawSrc.charCodeAt(i) === 0x2a && i + 1 < limitIdx && rawSrc.charCodeAt(i + 1) === 0x2f) {
          i += 2;
          break;
        }
        i += 1;
      }
      continue;
    }
    break;
  }
  return -1;
}

/**
 * Inserts a new property text after `lastProp` inside `containerObj` (`rootNode` or `serversObj`),
 * placing the `,` immediately after `lastProp.valueNode.end` (BEFORE any same-line `// comment`)
 * unless a trailing comma already exists between `lastProp.valueNode.end` and `containerObj.closeStart`,
 * and inserting the new property line cleanly right before `containerObj.closeStart`.
 */
function appendPropertyPreservingComments(current, containerObj, lastProp, propIndent, newPropText, closeIndent) {
  const valEnd = lastProp.valueNode.end;
  const closeStart = containerObj.closeStart;
  const existingTrailingComma = findOriginalTrailingComma(current, valEnd, closeStart);

  // Determine insertion point right before closing `}` (rewinding trailing spaces/tabs on the closing brace line)
  let beforeClose = closeStart;
  while (beforeClose > valEnd && (current.charCodeAt(beforeClose - 1) === 0x20 || current.charCodeAt(beforeClose - 1) === 0x09)) {
    beforeClose -= 1;
  }
  const hasNewlineBeforeClose =
    beforeClose > valEnd && (current.charCodeAt(beforeClose - 1) === 0x0a || current.charCodeAt(beforeClose - 1) === 0x0d);

  const prefixInsert = hasNewlineBeforeClose ? `${propIndent}${newPropText}\n${closeIndent}` : `\n${propIndent}${newPropText}\n${closeIndent}`;

  if (existingTrailingComma !== -1) {
    return current.slice(0, beforeClose) + prefixInsert + current.slice(closeStart);
  }
  return (
    current.slice(0, valEnd) +
    ',' +
    current.slice(valEnd, beforeClose) +
    prefixInsert +
    current.slice(closeStart)
  );
}

/**
 * Applies a single surgical mutation (`set` or `delete`) to `"mcpServers"` and returns updated JSONC text.
 * @param {string} currentText
 * @param {{ op: 'set', name: string, spec: object } | { op: 'delete', name: string }} mut
 * @returns {string}
 */
function applySingleJsoncMutation(currentText, mut) {
  if (!mut || typeof mut.name !== 'string' || !mut.name) {
    return currentText;
  }
  const current =
    typeof currentText === 'string' && currentText.trim()
      ? currentText.replace(/\r\n?/g, '\n')
      : '{\n  "mcpServers": {}\n}\n';

  const cleaned = stripJsoncToValidJson(current);
  const verifyParse = parseJsonc(current);
  if (!verifyParse.ok || !verifyParse.value || typeof verifyParse.value !== 'object' || Array.isArray(verifyParse.value)) {
    throw new Error(verifyParse.ok ? 'Root of mcp_config.json must be a JSON object.' : verifyParse.error);
  }

  const tokens = tokenizeJsonSpans(cleaned);
  const rootRes = parseValueNode(tokens, 0);
  if (!rootRes || rootRes.node.type !== 'object') {
    throw new Error('Root of mcp_config.json must be a JSON object.');
  }

  const rootNode = rootRes.node;
  const mcpProp = rootNode.props.find((p) => p.key === 'mcpServers');

  if (!mcpProp || mcpProp.valueNode.type !== 'object') {
    if (mut.op === 'delete') return current;
    const entryText = `"mcpServers": {\n    ${JSON.stringify(mut.name)}: ${indentJsonLines(JSON.stringify(mut.spec, null, 2), '    ')}\n  }`;
    if (rootNode.props.length === 0) {
      const innerRoot = current.slice(rootNode.start + 1, rootNode.closeStart);
      const hasRootComments = innerRoot.trim().length > 0;
      if (hasRootComments) {
        return `${current.slice(0, rootNode.closeStart)}  ${entryText}\n${current.slice(rootNode.closeStart)}`;
      }
      return `${current.slice(0, rootNode.start)}{\n  ${entryText}\n}${current.slice(rootNode.end)}`;
    }
    const lastRootProp = rootNode.props[rootNode.props.length - 1];
    return appendPropertyPreservingComments(current, rootNode, lastRootProp, '  ', entryText, '');
  }

  const serversObj = mcpProp.valueNode;
  const existingIdx = serversObj.props.findIndex((p) => p.key === mut.name);

  if (mut.op === 'set') {
    const formattedVal = indentJsonLines(JSON.stringify(mut.spec, null, 2), '    ');
    const newEntryProp = `${JSON.stringify(mut.name)}: ${formattedVal}`;

    if (existingIdx >= 0) {
      const targetProp = serversObj.props[existingIdx];
      return (
        current.slice(0, targetProp.valueNode.start) +
        formattedVal +
        current.slice(targetProp.valueNode.end)
      );
    }

    if (serversObj.props.length === 0) {
      const inner = current.slice(serversObj.start + 1, serversObj.closeStart);
      const hasCommentsInside = inner.trim().length > 0;
      if (hasCommentsInside) {
        return (
          current.slice(0, serversObj.closeStart) +
          `  ${newEntryProp}\n  ` +
          current.slice(serversObj.closeStart)
        );
      }
      return (
        current.slice(0, serversObj.start) +
        `{\n    ${newEntryProp}\n  }` +
        current.slice(serversObj.end)
      );
    }

    const lastProp = serversObj.props[serversObj.props.length - 1];
    return appendPropertyPreservingComments(current, serversObj, lastProp, '    ', newEntryProp, '  ');
  }

  if (mut.op === 'delete' && existingIdx >= 0) {
    const targetProp = serversObj.props[existingIdx];
    let removeStart = targetProp.keyStart;
    while (
      removeStart > serversObj.start + 1 &&
      (current.charCodeAt(removeStart - 1) === 0x20 || current.charCodeAt(removeStart - 1) === 0x09)
    ) {
      removeStart -= 1;
    }
    if (removeStart > serversObj.start + 1 && current.charCodeAt(removeStart - 1) === 0x0a) {
      removeStart -= 1;
    }

    let removeEnd = targetProp.valueNode.end;
    const ownComma = findOriginalTrailingComma(
      current,
      removeEnd,
      existingIdx + 1 < serversObj.props.length ? serversObj.props[existingIdx + 1].keyStart : serversObj.closeStart
    );
    if (ownComma !== -1) {
      removeEnd = ownComma + 1;
    } else if (existingIdx > 0 && existingIdx === serversObj.props.length - 1) {
      const prevProp = serversObj.props[existingIdx - 1];
      const prevComma = findOriginalTrailingComma(current, prevProp.valueNode.end, targetProp.keyStart);
      if (prevComma !== -1) {
        return (
          current.slice(0, prevComma) +
          current.slice(prevComma + 1, removeStart) +
          current.slice(removeEnd)
        );
      }
    }
    return current.slice(0, removeStart) + current.slice(removeEnd);
  }

  return current;
}

/**
 * Applies an ordered list of surgical mutations (`set` or `delete`) to `"mcpServers"` entries,
 * re-tokenizing sequentially on each step (`Rev 6 §5.1`).
 */
function applyJsoncServerMutations(rawText, mutations) {
  if (!Array.isArray(mutations) || mutations.length === 0) {
    const base =
      typeof rawText === 'string' && rawText.trim()
        ? rawText.replace(/\r\n?/g, '\n')
        : '{\n  "mcpServers": {}\n}\n';
    return base.endsWith('\n') ? base : `${base}\n`;
  }

  let current =
    typeof rawText === 'string' && rawText.trim()
      ? rawText.replace(/\r\n?/g, '\n')
      : '{\n  "mcpServers": {}\n}\n';

  for (let i = 0; i < mutations.length; i++) {
    current = applySingleJsoncMutation(current, mutations[i]);
  }
  return current.endsWith('\n') ? current : `${current}\n`;
}

module.exports = {
  stripJsoncToValidJson,
  parseJsonc,
  applySingleJsoncMutation,
  applyJsoncServerMutations,
};
