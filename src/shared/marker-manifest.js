'use strict';

/**
 * Anchored Marker Manifest Parser, Companion-Safe Merger, and Block Uninstaller.
 *
 * Only line-start anchored markers (`^[ \t]*\/\/ === ... ===[ \t]*$`) are recognized,
 * preventing false matches inside JavaScript string literals or inline comments (MCP-TC-028).
 */

const MCP_BEGIN_MARKER = '// === BEGIN_AGY_MCP_MANAGER_V1 ===';
const MCP_END_MARKER = '// === END_AGY_MCP_MANAGER_V1 ===';

const MCP_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
const MCP_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
const KO_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;
const KO_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;

/**
 * Splits `text` into line records with exact UTF-16 character offsets.
 * @param {string} text
 */
function splitLinesWithOffsets(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const lines = [];
  let lineStart = 0;
  for (let i = 0; i <= normalized.length; i += 1) {
    if (i === normalized.length || normalized.charCodeAt(i) === 10) {
      const lineText = normalized.slice(lineStart, i);
      const lineEndWithNewline = i < normalized.length ? i + 1 : i;
      lines.push({
        text: lineText,
        start: lineStart,
        end: i,
        endWithNewline: lineEndWithNewline,
      });
      lineStart = i + 1;
    }
  }
  return { normalized, lines };
}

/**
 * Parses `statusbar_autoinject.js` (or combined companion bundle) using column-0 anchored markers.
 *
 * @param {string} content
 */
function parseAutoinjectCompanionManifest(content) {
  const { normalized, lines } = splitLinesWithOffsets(content);

  let mcpBeginIdx = -1;
  let mcpEndIdx = -1;
  let koBeginIdx = -1;
  let koEndIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].text;
    if (mcpBeginIdx === -1 && MCP_BEGIN_LINE_RE.test(t)) {
      mcpBeginIdx = i;
      continue;
    }
    if (mcpBeginIdx !== -1 && mcpEndIdx === -1 && MCP_END_LINE_RE.test(t)) {
      mcpEndIdx = i;
      continue;
    }
    if (koBeginIdx === -1 && KO_BEGIN_LINE_RE.test(t)) {
      koBeginIdx = i;
      continue;
    }
    if (koBeginIdx !== -1 && koEndIdx === -1 && KO_END_LINE_RE.test(t)) {
      koEndIdx = i;
    }
  }

  let mcpRange = null;
  let hasOrphanMcpBegin = false;
  if (mcpBeginIdx !== -1) {
    if (mcpEndIdx !== -1 && mcpEndIdx > mcpBeginIdx) {
      mcpRange = {
        start: lines[mcpBeginIdx].start,
        end: lines[mcpEndIdx].endWithNewline,
      };
    } else {
      hasOrphanMcpBegin = true;
      const stopLineIdx = koBeginIdx > mcpBeginIdx ? koBeginIdx : -1;
      mcpRange = {
        start: lines[mcpBeginIdx].start,
        end: stopLineIdx !== -1 ? lines[stopLineIdx].start : normalized.length,
      };
    }
  }

  let koRange = null;
  if (koBeginIdx !== -1) {
    koRange = {
      start: lines[koBeginIdx].start,
      end: koEndIdx > koBeginIdx ? lines[koEndIdx].endWithNewline : normalized.length,
    };
  }

  const strippedWithoutMcpAndKo = removeRangeText(
    mcpRange ? removeRangeText(normalized, mcpRange.start, mcpRange.end) : normalized,
    0,
    0,
    true
  );
  const residualOutsideMcpAndKo = (() => {
    const intervals = [];
    if (mcpRange) intervals.push(mcpRange);
    if (koRange) intervals.push(koRange);
    intervals.sort((a, b) => a.start - b.start);
    let cursor = 0;
    let acc = '';
    for (const iv of intervals) {
      if (iv.start > cursor) {
        acc += normalized.slice(cursor, iv.start);
      }
      cursor = Math.max(cursor, iv.end);
    }
    if (cursor < normalized.length) {
      acc += normalized.slice(cursor);
    }
    return acc.trim();
  })();

  void strippedWithoutMcpAndKo;

  return {
    normalized,
    hasStatusbarCore: residualOutsideMcpAndKo.length > 0,
    hasMcpBlock: mcpBeginIdx !== -1 && mcpEndIdx > mcpBeginIdx,
    hasOrphanMcpBegin,
    hasKoBlock: koBeginIdx !== -1,
    mcpRange,
    koRange,
  };
}

function removeRangeText(str, start, end) {
  return str.slice(0, start) + str.slice(end);
}

/**
 * Wraps `bundleSource` inside canonical V1 anchored markers.
 * @param {string} bundleSource
 * @returns {string}
 */
function buildMarkedMcpBlock(bundleSource) {
  const cleanBody = String(bundleSource ?? '').replace(/\r\n/g, '\n').trim();
  return `${MCP_BEGIN_MARKER}\n${cleanBody}\n${MCP_END_MARKER}\n`;
}

/**
 * Merges or updates the MCP Manager block inside `existingContent` while preserving
 * `antigravity-statusbar` and `ko-thought-translator` companion blocks intact.
 *
 * @param {string} existingContent
 * @param {string} bundleSource
 * @returns {string}
 */
function mergeMcpManagerBlock(existingContent, bundleSource) {
  const markedBlock = buildMarkedMcpBlock(bundleSource);
  const parsed = parseAutoinjectCompanionManifest(existingContent);
  const { normalized, mcpRange, koRange } = parsed;

  if (!normalized.trim()) {
    return markedBlock;
  }

  if (mcpRange) {
    const before = normalized.slice(0, mcpRange.start).replace(/[ \t]+$/g, '');
    const after = normalized.slice(mcpRange.end).replace(/^\n+/, '');
    const prefix = before ? (before.endsWith('\n') ? before : `${before}\n`) : '';
    const suffix = after ? `\n${after.replace(/\n*$/, '\n')}` : '';
    return `${prefix}${markedBlock}${suffix}`.replace(/\n{3,}/g, '\n\n');
  }

  if (koRange) {
    const beforeKo = normalized.slice(0, koRange.start).replace(/\s+$/, '');
    const fromKo = normalized.slice(koRange.start).replace(/\s+$/, '');
    const prefix = beforeKo ? `${beforeKo}\n\n` : '';
    return `${prefix}${markedBlock}\n${fromKo}\n`;
  }

  const trimmedExisting = normalized.replace(/\s+$/, '');
  return `${trimmedExisting}\n\n${markedBlock}`;
}

/**
 * Removes ONLY the MCP Manager block from `existingContent`, preserving any companion
 * (`antigravity-statusbar`, `ko-thought-translator`) code intact.
 * Returns `''` if no companion code remains.
 *
 * @param {string} existingContent
 * @returns {string}
 */
function removeMcpManagerBlock(existingContent) {
  const parsed = parseAutoinjectCompanionManifest(existingContent);
  const { normalized, mcpRange } = parsed;
  if (!mcpRange) {
    return normalized.trim() ? `${normalized.replace(/\s+$/, '')}\n` : '';
  }

  const before = normalized.slice(0, mcpRange.start).replace(/[ \t]+$/, '');
  const after = normalized.slice(mcpRange.end);
  const joined = `${before}\n${after}`.replace(/\n{3,}/g, '\n\n').trim();
  return joined ? `${joined}\n` : '';
}

module.exports = {
  MCP_BEGIN_MARKER,
  MCP_END_MARKER,
  parseAutoinjectCompanionManifest,
  buildMarkedMcpBlock,
  mergeMcpManagerBlock,
  removeMcpManagerBlock,
};
