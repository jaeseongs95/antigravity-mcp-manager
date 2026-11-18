#!/usr/bin/env node
'use strict';
((outerModule, outerRequire) => {
  const __modules = {
  "./src/shared/marker-manifest": function(module, exports, require) {
    'use strict';
    const MCP_BEGIN_MARKER = '// === BEGIN_AGY_MCP_MANAGER_V1 ===';
    const MCP_END_MARKER = '// === END_AGY_MCP_MANAGER_V1 ===';
    const MCP_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
    const MCP_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_MCP_MANAGER(?:_V\d+)? ===[ \t]*$/;
    const KO_BEGIN_LINE_RE = /^[ \t]*\/\/ === BEGIN_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;
    const KO_END_LINE_RE = /^[ \t]*\/\/ === END_AGY_KO_THOUGHT_LOCALIZER(?:_V\d+)? ===[ \t]*$/;
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
    function buildMarkedMcpBlock(bundleSource) {
      const cleanBody = String(bundleSource ?? '').replace(/\r\n/g, '\n').trim();
      return `${MCP_BEGIN_MARKER}\n${cleanBody}\n${MCP_END_MARKER}\n`;
    }
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
  },
  "./scripts/lib/js-lexer": function(module, exports, require) {
    'use strict';
    const REGEX_KEYWORDS = new Set([
      'return',
      'throw',
      'case',
      'delete',
      'void',
      'typeof',
      'instanceof',
      'in',
      'of',
      'new',
      'yield',
      'await',
      'else',
      'do',
    ]);
    function countTrailingBackslashes(str) {
      let count = 0;
      for (let i = str.length - 1; i >= 0 && str[i] === '\\'; i -= 1) {
        count += 1;
      }
      return count;
    }
    function processLinesLexical(lines, options = {}) {
      const indentPrefix = options.indentPrefix || '';
      const preserveMarker = options.preserveMarker || '';
      const dropBlankLines = options.dropBlankLines !== false;
      const stripInlineComments = Boolean(options.stripInlineComments);
      const out = [];
      const stack = [
        {
          mode: 'CODE',
          braceDepth: 0,
          regexAllowed: true,
          prevWasDot: false,
          lastControlKw: false,
          parenStack: [],
        },
      ];
      let inBlockComment = false;
      let inSingle = false;
      let inDouble = false;
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
        const line = lines[lineIdx];
        const startsInTemplate = stack[stack.length - 1].mode === 'TEMPLATE';
        const startsInString = inSingle || inDouble;
        const startsInBlockComment = inBlockComment;
        const trimmed = line.trim();
        if (
          preserveMarker &&
          !startsInTemplate &&
          !startsInString &&
          !startsInBlockComment &&
          trimmed.includes(preserveMarker)
        ) {
          out.push(indentPrefix ? `${indentPrefix}${line}` : line);
          continue;
        }
        let i = 0;
        let inRegex = false;
        let inRegexCharClass = false;
        let hasCodeTokenOnLine = false;
        let inlineCommentStart = -1;
        while (i < line.length) {
          const ch = line[i];
          const next = line[i + 1] || '';
          const top = stack[stack.length - 1];
          if (top.mode === 'TEMPLATE') {
            hasCodeTokenOnLine = true;
            if (ch === '\\') {
              i += 2;
              continue;
            }
            if (ch === '`') {
              stack.pop();
              const outer = stack[stack.length - 1];
              outer.regexAllowed = false;
              outer.prevWasDot = false;
              outer.lastControlKw = false;
              i += 1;
              continue;
            }
            if (ch === '$' && next === '{') {
              stack.push({
                mode: 'TEMPLATE_EXPR',
                braceDepth: 1,
                regexAllowed: true,
                prevWasDot: false,
                lastControlKw: false,
                parenStack: [],
              });
              i += 2;
              continue;
            }
            i += 1;
            continue;
          }
          if (inBlockComment) {
            if (ch === '*' && next === '/') {
              inBlockComment = false;
              i += 2;
              continue;
            }
            i += 1;
            continue;
          }
          if (inSingle) {
            hasCodeTokenOnLine = true;
            if (ch === '\\') {
              i += 2;
              continue;
            }
            if (ch === "'") {
              inSingle = false;
              top.regexAllowed = false;
              top.prevWasDot = false;
              top.lastControlKw = false;
            }
            i += 1;
            continue;
          }
          if (inDouble) {
            hasCodeTokenOnLine = true;
            if (ch === '\\') {
              i += 2;
              continue;
            }
            if (ch === '"') {
              inDouble = false;
              top.regexAllowed = false;
              top.prevWasDot = false;
              top.lastControlKw = false;
            }
            i += 1;
            continue;
          }
          if (inRegex) {
            hasCodeTokenOnLine = true;
            if (ch === '\\') {
              i += 2;
              continue;
            }
            if (inRegexCharClass) {
              if (ch === ']') inRegexCharClass = false;
              i += 1;
              continue;
            }
            if (ch === '[') {
              inRegexCharClass = true;
              i += 1;
              continue;
            }
            if (ch === '/') {
              inRegex = false;
              i += 1;
              while (i < line.length && /[A-Za-z]/.test(line[i])) i += 1;
              top.regexAllowed = false;
              top.prevWasDot = false;
              top.lastControlKw = false;
              continue;
            }
            i += 1;
            continue;
          }
          if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
            i += 1;
            continue;
          }
          if (ch === '/' && next === '/') {
            inlineCommentStart = i;
            break;
          }
          if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 2;
            continue;
          }
          hasCodeTokenOnLine = true;
          if (ch === '/' && top.regexAllowed) {
            inRegex = true;
            inRegexCharClass = false;
            i += 1;
            continue;
          }
          if (ch === "'") {
            inSingle = true;
            i += 1;
            continue;
          }
          if (ch === '"') {
            inDouble = true;
            i += 1;
            continue;
          }
          if (ch === '`') {
            stack.push({ mode: 'TEMPLATE' });
            i += 1;
            continue;
          }
          if (/[A-Za-z_$]/.test(ch)) {
            let end = i + 1;
            while (end < line.length && /[A-Za-z0-9_$]/.test(line[end])) end += 1;
            const word = line.slice(i, end);
            const wasDot = top.prevWasDot;
            top.regexAllowed = !wasDot && REGEX_KEYWORDS.has(word);
            top.lastControlKw =
              !wasDot && (word === 'if' || word === 'while' || word === 'for' || word === 'with');
            top.prevWasDot = false;
            i = end;
            continue;
          }
          if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next))) {
            let end = i + 1;
            while (end < line.length && /[0-9A-Za-z_.]/.test(line[end])) end += 1;
            top.regexAllowed = false;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i = end;
            continue;
          }
          if (ch === '(') {
            top.parenStack.push(top.lastControlKw);
            top.regexAllowed = true;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if (ch === ')') {
            const afterControl = Boolean(top.parenStack.pop());
            top.regexAllowed = afterControl;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if (ch === '[') {
            top.regexAllowed = true;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if (ch === ']') {
            top.regexAllowed = false;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if (ch === '{') {
            if (top.mode === 'TEMPLATE_EXPR') top.braceDepth += 1;
            top.regexAllowed = true;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if (ch === '}') {
            if (top.mode === 'TEMPLATE_EXPR') {
              top.braceDepth -= 1;
              if (top.braceDepth === 0) {
                stack.pop();
                i += 1;
                continue;
              }
            }
            top.regexAllowed = true;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          if ((ch === '+' && next === '+') || (ch === '-' && next === '-')) {
            top.regexAllowed = false;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 2;
            continue;
          }
          if (ch === '.' && next === '.' && line[i + 2] === '.') {
            top.regexAllowed = true;
            top.prevWasDot = false;
            top.lastControlKw = false;
            i += 3;
            continue;
          }
          if (ch === '.') {
            top.regexAllowed = false;
            top.prevWasDot = true;
            top.lastControlKw = false;
            i += 1;
            continue;
          }
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
        }
        if (inSingle && countTrailingBackslashes(line) % 2 === 0) inSingle = false;
        if (inDouble && countTrailingBackslashes(line) % 2 === 0) inDouble = false;
        if (startsInTemplate || startsInString) {
          out.push(line);
          continue;
        }
        if (!hasCodeTokenOnLine) {
          if (dropBlankLines || startsInBlockComment || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
            continue;
          }
        }
        const effectiveLine =
          stripInlineComments && inlineCommentStart >= 0
            ? line.slice(0, inlineCommentStart).replace(/[ \t\r]+$/, '')
            : line;
        out.push(indentPrefix ? `${indentPrefix}${effectiveLine}` : effectiveLine);
      }
      return out;
    }
    function stripCommentsAndEmptyLines(source, indentPrefix = '    ') {
      return processLinesLexical(String(source || '').split('\n'), {
        indentPrefix,
        dropBlankLines: true,
        stripInlineComments: true,
      }).join('\n');
    }
    function stripPureCommentLinesLexical(lines, preserveMarker = '') {
      return processLinesLexical(lines, {
        indentPrefix: '',
        preserveMarker,
        dropBlankLines: false,
        stripInlineComments: false,
      });
    }
    function tokenizeJsSource(source) {
      const text = String(source || '');
      const tokens = [];
      const stack = [
        {
          mode: 'CODE',
          braceDepth: 0,
          regexAllowed: true,
          prevWasDot: false,
          lastControlKw: false,
          parenStack: [],
        },
      ];
      let i = 0;
      let line = 1;
      while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1] || '';
        const top = stack[stack.length - 1];
        if (top.mode === 'TEMPLATE') {
          let chunk = '';
          const startLine = line;
          while (i < text.length) {
            const c = text[i];
            const n = text[i + 1] || '';
            if (c === '\n') line += 1;
            if (c === '\\') {
              chunk += c + n;
              if (n === '\n') line += 1;
              i += 2;
              continue;
            }
            if (c === '`') {
              tokens.push({ type: 'template', value: chunk, line: startLine, prevWasDot: false });
              stack.pop();
              const outer = stack[stack.length - 1];
              outer.regexAllowed = false;
              outer.prevWasDot = false;
              outer.lastControlKw = false;
              i += 1;
              break;
            }
            if (c === '$' && n === '{') {
              tokens.push({ type: 'template', value: chunk, line: startLine, prevWasDot: false });
              stack.push({
                mode: 'TEMPLATE_EXPR',
                braceDepth: 1,
                regexAllowed: true,
                prevWasDot: false,
                lastControlKw: false,
                parenStack: [],
              });
              i += 2;
              break;
            }
            chunk += c;
            i += 1;
          }
          continue;
        }
        if (ch === '\n') {
          line += 1;
          i += 1;
          continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') {
          i += 1;
          continue;
        }
        if (ch === '/' && next === '/') {
          i += 2;
          while (i < text.length && text[i] !== '\n') i += 1;
          continue;
        }
        if (ch === '/' && next === '*') {
          i += 2;
          while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
            if (text[i] === '\n') line += 1;
            i += 1;
          }
          i += 2;
          continue;
        }
        if (ch === '/' && top.regexAllowed) {
          let raw = '/';
          const startLine = line;
          i += 1;
          let inClass = false;
          while (i < text.length) {
            const c = text[i];
            if (c === '\n') break;
            if (c === '\\') {
              raw += c + (text[i + 1] || '');
              i += 2;
              continue;
            }
            if (inClass) {
              if (c === ']') inClass = false;
              raw += c;
              i += 1;
              continue;
            }
            if (c === '[') {
              inClass = true;
              raw += c;
              i += 1;
              continue;
            }
            if (c === '/') {
              raw += '/';
              i += 1;
              while (i < text.length && /[A-Za-z]/.test(text[i])) {
                raw += text[i];
                i += 1;
              }
              break;
            }
            raw += c;
            i += 1;
          }
          tokens.push({ type: 'regex', value: raw, line: startLine, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          continue;
        }
        if (ch === "'" || ch === '"') {
          const quote = ch;
          const startLine = line;
          let val = '';
          i += 1;
          while (i < text.length) {
            const c = text[i];
            if (c === '\n') line += 1;
            if (c === '\\') {
              val += c + (text[i + 1] || '');
              if (text[i + 1] === '\n') line += 1;
              i += 2;
              continue;
            }
            if (c === quote) {
              i += 1;
              break;
            }
            val += c;
            i += 1;
          }
          tokens.push({ type: 'string', value: val, line: startLine, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          continue;
        }
        if (ch === '`') {
          stack.push({ mode: 'TEMPLATE' });
          i += 1;
          continue;
        }
        if (/[A-Za-z_$]/.test(ch)) {
          let end = i + 1;
          while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end += 1;
          const word = text.slice(i, end);
          const wasDot = top.prevWasDot;
          tokens.push({ type: 'identifier', value: word, line, prevWasDot: wasDot });
          top.regexAllowed = !wasDot && REGEX_KEYWORDS.has(word);
          top.lastControlKw =
            !wasDot && (word === 'if' || word === 'while' || word === 'for' || word === 'with');
          top.prevWasDot = false;
          i = end;
          continue;
        }
        if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next))) {
          let end = i + 1;
          while (end < text.length && /[0-9A-Za-z_.]/.test(text[end])) end += 1;
          tokens.push({ type: 'number', value: text.slice(i, end), line, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i = end;
          continue;
        }
        if (ch === '(') {
          tokens.push({ type: 'punct', value: '(', line, prevWasDot: false });
          top.parenStack.push(top.lastControlKw);
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === ')') {
          tokens.push({ type: 'punct', value: ')', line, prevWasDot: false });
          const afterControl = Boolean(top.parenStack.pop());
          top.regexAllowed = afterControl;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === '[') {
          tokens.push({ type: 'punct', value: '[', line, prevWasDot: false });
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === ']') {
          tokens.push({ type: 'punct', value: ']', line, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === '{') {
          tokens.push({ type: 'punct', value: '{', line, prevWasDot: false });
          if (top.mode === 'TEMPLATE_EXPR') top.braceDepth += 1;
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === '}') {
          if (top.mode === 'TEMPLATE_EXPR') {
            top.braceDepth -= 1;
            if (top.braceDepth === 0) {
              stack.pop();
              i += 1;
              continue;
            }
          }
          tokens.push({ type: 'punct', value: '}', line, prevWasDot: false });
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if (ch === '?' && next === '.') {
          tokens.push({ type: 'punct', value: '?.', line, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = true;
          top.lastControlKw = false;
          i += 2;
          continue;
        }
        if (ch === '.' && next === '.' && text[i + 2] === '.') {
          tokens.push({ type: 'punct', value: '...', line, prevWasDot: false });
          top.regexAllowed = true;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 3;
          continue;
        }
        if (ch === '.') {
          tokens.push({ type: 'punct', value: '.', line, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = true;
          top.lastControlKw = false;
          i += 1;
          continue;
        }
        if ((ch === '+' && next === '+') || (ch === '-' && next === '-')) {
          tokens.push({ type: 'punct', value: ch + next, line, prevWasDot: false });
          top.regexAllowed = false;
          top.prevWasDot = false;
          top.lastControlKw = false;
          i += 2;
          continue;
        }
        tokens.push({ type: 'punct', value: ch, line, prevWasDot: false });
        top.regexAllowed = true;
        top.prevWasDot = false;
        top.lastControlKw = false;
        i += 1;
      }
      return tokens;
    }
    module.exports = {
      stripCommentsAndEmptyLines,
      stripPureCommentLinesLexical,
      tokenizeJsSource,
    };
  },
  "./scripts/lib/file-lock": function(module, exports, require) {
    'use strict';
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const DEFAULT_LOCK_STALE_MS = 60000;
    const DEFAULT_STORAGE_LOCK_STALE_MS = 15000;
    const STORAGE_CODE_KEY = 'agy-statusbar-code';
    function createLockToken(prefix = 'lock') {
      return `${prefix}:${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
    }
    function isProcessAlive(pid) {
      const num = Number(pid);
      if (!Number.isInteger(num) || num <= 0) return false;
      try {
        process.kill(num, 0);
        return true;
      } catch (err) {
        return Boolean(err && err.code === 'EPERM');
      }
    }
    function writeLockPayloadExclusive(lockPath, token) {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        const payload = JSON.stringify({
          pid: process.pid,
          token,
          startedAt: new Date().toISOString(),
        });
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    function isLockRecordStale(lockPath, staleMs) {
      const stat = fs.statSync(lockPath);
      const ageMs = Date.now() - stat.mtimeMs;
      let ownerPid = 0;
      try {
        const info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        ownerPid = Number(info?.pid || 0);
      } catch {
        ownerPid = 0;
      }
      const ownerAlive = ownerPid > 0 && isProcessAlive(ownerPid);
      return (
        (ownerPid > 0 && !ownerAlive) ||
        (!ownerAlive && ageMs > staleMs) ||
        ageMs > staleMs * 10
      );
    }
    function isFileLockHeld(lockPath, staleMs = DEFAULT_LOCK_STALE_MS) {
      try {
        if (!fs.existsSync(lockPath)) return false;
        return !isLockRecordStale(lockPath, staleMs);
      } catch {
        return false;
      }
    }
    function restoreDisplacedLockFile(relTmp, lockPath) {
      try {
        fs.linkSync(relTmp, lockPath);
        try {
          fs.unlinkSync(relTmp);
        } catch {
        }
        return;
      } catch {
      }
      try {
        if (!fs.existsSync(lockPath)) {
          fs.renameSync(relTmp, lockPath);
          return;
        }
      } catch {
      }
      try {
        fs.unlinkSync(relTmp);
      } catch {
      }
    }
    function acquireFileLock(lockPath, token, staleMs = DEFAULT_LOCK_STALE_MS) {
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        try {
          writeLockPayloadExclusive(lockPath, token);
          return true;
        } catch (err) {
          if (!err || err.code !== 'EEXIST') return false;
        }
        if (!isLockRecordStale(lockPath, staleMs)) {
          return false;
        }
        const staleTmp = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(lockPath, staleTmp);
        } catch {
          return false;
        }
        try {
          if (!isLockRecordStale(staleTmp, staleMs)) {
            restoreDisplacedLockFile(staleTmp, lockPath);
            return false;
          }
        } catch {
        }
        try {
          fs.unlinkSync(staleTmp);
        } catch {
        }
        writeLockPayloadExclusive(lockPath, token);
        return true;
      } catch {
        return false;
      }
    }
    function releaseFileLock(lockPath, token) {
      try {
        if (!fs.existsSync(lockPath)) return false;
        const lockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        if (!lockInfo || lockInfo.token !== token) {
          return false;
        }
        const relTmp = `${lockPath}.rel.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        try {
          fs.renameSync(lockPath, relTmp);
        } catch {
          return false;
        }
        let movedInfo = null;
        try {
          movedInfo = JSON.parse(fs.readFileSync(relTmp, 'utf8'));
        } catch {
          movedInfo = null;
        }
        if (!movedInfo || movedInfo.token !== token) {
          restoreDisplacedLockFile(relTmp, lockPath);
          return false;
        }
        try {
          fs.unlinkSync(relTmp);
        } catch {
        }
        return true;
      } catch {
        return false;
      }
    }
    function writeFileAtomicSync(targetPath, content) {
      const dir = path.dirname(targetPath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${targetPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
      let fd = null;
      try {
        fd = fs.openSync(tmpPath, 'wx');
        if (Buffer.isBuffer(content)) {
          fs.writeSync(fd, content, 0, content.length, 0);
        } else {
          const buf = Buffer.from(String(content), 'utf8');
          fs.writeSync(fd, buf, 0, buf.length, 0);
        }
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tmpPath, targetPath);
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
          }
        }
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
          }
        }
      }
    }
    function captureFileSnapshots(filePaths) {
      const snapshots = [];
      for (let i = 0; i < filePaths.length; i += 1) {
        const filePath = filePaths[i];
        if (fs.existsSync(filePath)) {
          snapshots.push({
            filePath,
            existed: true,
            bytes: fs.readFileSync(filePath),
          });
        } else {
          snapshots.push({
            filePath,
            existed: false,
            bytes: null,
          });
        }
      }
      return snapshots;
    }
    function restoreFileSnapshots(snapshots) {
      for (let i = snapshots.length - 1; i >= 0; i -= 1) {
        const snap = snapshots[i];
        if (snap.existed && snap.bytes) {
          writeFileAtomicSync(snap.filePath, snap.bytes);
        } else if (!snap.existed && fs.existsSync(snap.filePath)) {
          fs.unlinkSync(snap.filePath);
        }
      }
    }
    function syncAppStorageCode(params) {
      const {
        autoinjectPath,
        appStoragePath,
        appStorageLockPath,
        codeOverride,
        storageKey = STORAGE_CODE_KEY,
        staleMs = DEFAULT_STORAGE_LOCK_STALE_MS,
      } = params;
      const lockToken = createLockToken('app-storage');
      if (!acquireFileLock(appStorageLockPath, lockToken, staleMs)) {
        return { ok: false, updated: false, error: 'APP_STORAGE_LOCK_BUSY' };
      }
      try {
        if (!fs.existsSync(appStoragePath)) {
          return { ok: true, updated: false, skippedMissing: true };
        }
        const desiredCode =
          typeof codeOverride === 'string'
            ? codeOverride
            : fs.existsSync(autoinjectPath)
              ? fs.readFileSync(autoinjectPath, 'utf8')
              : null;
        if (desiredCode === null) {
          return { ok: true, updated: false, skippedMissing: true };
        }
        const rawStorage = fs.readFileSync(appStoragePath, 'utf8');
        const parsed = JSON.parse(rawStorage);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, updated: false, error: 'APP_STORAGE_INVALID_OBJECT' };
        }
        if (parsed[storageKey] === desiredCode) {
          return { ok: true, updated: false };
        }
        parsed[storageKey] = desiredCode;
        writeFileAtomicSync(appStoragePath, `${JSON.stringify(parsed, null, 2)}\n`);
        return { ok: true, updated: true };
      } catch (err) {
        return { ok: false, updated: false, error: err?.message || String(err) };
      } finally {
        releaseFileLock(appStorageLockPath, lockToken);
      }
    }
    function removeAppStorageCodeKey(params) {
      const {
        appStoragePath,
        appStorageLockPath,
        storageKey = STORAGE_CODE_KEY,
        staleMs = DEFAULT_STORAGE_LOCK_STALE_MS,
      } = params;
      const lockToken = createLockToken('app-storage-rm');
      if (!acquireFileLock(appStorageLockPath, lockToken, staleMs)) {
        return { ok: false, updated: false, error: 'APP_STORAGE_LOCK_BUSY' };
      }
      try {
        if (!fs.existsSync(appStoragePath)) {
          return { ok: true, updated: false, skippedMissing: true };
        }
        const rawStorage = fs.readFileSync(appStoragePath, 'utf8');
        const parsed = JSON.parse(rawStorage);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, updated: false, error: 'APP_STORAGE_INVALID_OBJECT' };
        }
        if (!Object.prototype.hasOwnProperty.call(parsed, storageKey)) {
          return { ok: true, updated: false };
        }
        delete parsed[storageKey];
        writeFileAtomicSync(appStoragePath, `${JSON.stringify(parsed, null, 2)}\n`);
        return { ok: true, updated: true };
      } catch (err) {
        return { ok: false, updated: false, error: err?.message || String(err) };
      } finally {
        releaseFileLock(appStorageLockPath, lockToken);
      }
    }
    module.exports = {
      DEFAULT_LOCK_STALE_MS,
      DEFAULT_STORAGE_LOCK_STALE_MS,
      STORAGE_CODE_KEY,
      createLockToken,
      isProcessAlive,
      isFileLockHeld,
      acquireFileLock,
      releaseFileLock,
      writeFileAtomicSync,
      captureFileSnapshots,
      restoreFileSnapshots,
      syncAppStorageCode,
      removeAppStorageCodeKey,
    };
  },
  "./scripts/lib/asar-patcher": function(module, exports, require) {
    'use strict';
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const vm = require('vm');
    const { stripPureCommentLinesLexical } = require('./js-lexer');
    const { writeFileAtomicSync } = require('./file-lock');
    const PATCH_MARKER = 'AGY_STATUSBAR_AUTOINJECT_V5';
    const BLOCK_SIZE = 4 * 1024 * 1024;
    const UTILS_ANCHOR_TARGET = '    void win.loadURL(url);';
    const UTILS_ANCHOR_REPLACEMENT = [
      `    // ${PATCH_MARKER}`,
      '    const _injectAgyStatusBar = () => {',
      '        try {',
      '            if (win.isDestroyed() || win.webContents.isDestroyed() || !/^https?:/i.test(win.webContents.getURL())) return;',
      "            const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');",
      "            if (require('fs').existsSync(_p)) void win.webContents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});",
      '        } catch (_e) {}',
      '    };',
      "    win.webContents.on('dom-ready', _injectAgyStatusBar);",
      "    win.webContents.on('did-finish-load', _injectAgyStatusBar);",
      '    void win.loadURL(url);',
    ].join('\n');
    const MAIN_ANCHOR_TARGET = "electron_1.app.on('web-contents-created', (_event, contents) => {";
    const MAIN_ANCHOR_REPLACEMENT = [
      "electron_1.app.on('web-contents-created', (_event, contents) => {",
      `    // ${PATCH_MARKER}`,
      "    if (contents.getType() === 'window' && !(typeof scriptJail_1 !== 'undefined' && scriptJail_1.isScriptJailSession && scriptJail_1.isScriptJailSession(contents.session))) {",
      '        const _injectAgyMain = () => {',
      '            try {',
      '                if (contents.isDestroyed() || !/^https?:/i.test(contents.getURL())) return;',
      "                const _p = require('path').join(process.env.USERPROFILE || process.env.HOME || '', '.gemini', 'antigravity', 'statusbar_autoinject.js');",
      "                if (require('fs').existsSync(_p)) void contents.executeJavaScript(require('fs').readFileSync(_p, 'utf8')).catch(() => {});",
      '            } catch (_e) {}',
      '        };',
      "        contents.on('dom-ready', _injectAgyMain);",
      "        contents.on('did-finish-load', _injectAgyMain);",
      '    }',
    ].join('\n');
    const PRELOAD_ANCHOR_TARGET = "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);";
    const PRELOAD_ANCHOR_REPLACEMENT = [
      "electron_1.contextBridge.exposeInMainWorld('wsl', wslAPI);",
      `// ${PATCH_MARKER}`,
      "if (/^https?:$/i.test(globalThis.location?.protocol || '')) {",
      "    electron_1.ipcRenderer.invoke('storage:get-items').then((r) => {",
      "        if (r && r['agy-statusbar-code']) {",
      "            void electron_1.webFrame.executeJavaScript(r['agy-statusbar-code']).catch(() => {});",
      '        }',
      '    }).catch(() => {});',
      '}',
    ].join('\n');
    function sha256HexBuf(bufOrStr) {
      return crypto.createHash('sha256').update(bufOrStr).digest('hex');
    }
    function computeAsarIntegrity(buf) {
      const blocks = [];
      for (let i = 0; i < buf.length; i += BLOCK_SIZE) {
        blocks.push(sha256HexBuf(buf.subarray(i, Math.min(i + BLOCK_SIZE, buf.length))));
      }
      if (blocks.length === 0) {
        blocks.push(sha256HexBuf(Buffer.alloc(0)));
      }
      return {
        algorithm: 'SHA256',
        hash: sha256HexBuf(buf),
        blockSize: BLOCK_SIZE,
        blocks,
      };
    }
    function transformExactSize(origBuf, anchorTarget, anchorReplacement) {
      const origSize = origBuf.length;
      const origStr = origBuf.toString('utf8');
      const hasCrlf = origStr.includes('\r\n');
      const normalized = origStr.replace(/\r\n/g, '\n');
      const occ = normalized.split(anchorTarget).length - 1;
      if (occ !== 1) {
        throw new Error(`Expected single anchor occurrence, found ${occ}`);
      }
      const modified = normalized.replace(anchorTarget, anchorReplacement);
      const strippedLines = stripPureCommentLinesLexical(modified.split('\n'), PATCH_MARKER);
      let candidate = strippedLines.join(hasCrlf ? '\r\n' : '\n');
      const candBytes = Buffer.byteLength(candidate, 'utf8');
      if (candBytes > origSize) {
        throw new Error(`Transformed content exceeds original entry size (${candBytes} > ${origSize})`);
      }
      const diff = origSize - candBytes;
      if (diff > 0) {
        if (diff >= 3) {
          candidate += `//${' '.repeat(diff - 3)}\n`;
        } else {
          candidate += ' '.repeat(diff);
        }
      }
      const outBuf = Buffer.from(candidate, 'utf8');
      if (outBuf.length !== origSize) {
        throw new Error(`Exact byte size mismatch (${outBuf.length} !== ${origSize})`);
      }
      new vm.Script(outBuf.toString('utf8'));
      return outBuf;
    }
    function isAsarPatchedFast(asarPath) {
      let fd = null;
      try {
        if (!asarPath || !fs.existsSync(asarPath)) return false;
        fd = fs.openSync(asarPath, 'r');
        const prefixBuf = Buffer.alloc(16);
        if (fs.readSync(fd, prefixBuf, 0, 16, 0) < 16) return false;
        const u4 = prefixBuf.readUInt32LE(4);
        const strSize = prefixBuf.readUInt32LE(12);
        if (strSize <= 0 || strSize > 16 * 1024 * 1024) return false;
        const headerBuf = Buffer.alloc(strSize);
        fs.readSync(fd, headerBuf, 0, strSize, 16);
        const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
        const dataOffset = 8 + u4;
        const distFiles = header?.files?.dist?.files;
        if (!distFiles) return false;
        const utilsNode = distFiles['utils.js'];
        const mainNode = distFiles['main.js'];
        const preloadNode = distFiles['preload.js'];
        if (!utilsNode || !mainNode || !preloadNode) return false;
        const readEntry = (node) => {
          const b = Buffer.alloc(node.size);
          fs.readSync(fd, b, 0, node.size, dataOffset + Number(node.offset));
          return b.toString('utf8');
        };
        const utilsStr = readEntry(utilsNode);
        const mainStr = readEntry(mainNode);
        const preloadStr = readEntry(preloadNode);
        return (
          utilsStr.includes(PATCH_MARKER) &&
          mainStr.includes(PATCH_MARKER) &&
          preloadStr.includes(PATCH_MARKER)
        );
      } catch {
        return false;
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
          }
        }
      }
    }
    function readAsarArchive(filePath) {
      const buf = fs.readFileSync(filePath);
      const u0 = buf.readUInt32LE(0);
      const u4 = buf.readUInt32LE(4);
      const u8 = buf.readUInt32LE(8);
      const strSize = buf.readUInt32LE(12);
      const dataOffset = 8 + u4;
      const headerSlice = buf.subarray(0, dataOffset);
      const headerJsonBuf = buf.subarray(16, 16 + strSize);
      const header = JSON.parse(headerJsonBuf.toString('utf8').replace(/\0+$/, ''));
      const fileMap = new Map();
      const extractNode = (node, relPath) => {
        if (node.files) {
          for (const [name, child] of Object.entries(node.files)) {
            extractNode(child, relPath ? `${relPath}/${name}` : name);
          }
        } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
          const start = dataOffset + Number(node.offset);
          fileMap.set(relPath, buf.subarray(start, start + node.size));
        }
      };
      extractNode(header, '');
      let appVersion = 'unknown';
      try {
        const pkgBuf = fileMap.get('package.json');
        if (pkgBuf) {
          const pkg = JSON.parse(pkgBuf.toString('utf8'));
          if (pkg && pkg.version) appVersion = String(pkg.version);
        }
      } catch {
        appVersion = 'unknown';
      }
      return {
        buf,
        u0,
        u4,
        u8,
        strSize,
        dataOffset,
        headerSlice,
        headerJsonBuf,
        header,
        fileMap,
        appVersion,
      };
    }
    function isFileLockError(err) {
      const code = String(err?.code || '').toUpperCase();
      return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
    }
    function replaceAsarStrictAtomic(asarPath, nextAsarBuf) {
      const dir = path.dirname(asarPath);
      fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${asarPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
      let fd = null;
      try {
        fd = fs.openSync(tmpPath, 'wx');
        fs.writeSync(fd, nextAsarBuf, 0, nextAsarBuf.length, 0);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        fs.renameSync(tmpPath, asarPath);
        return { ok: true };
      } catch (err) {
        if (isFileLockError(err)) {
          return {
            ok: false,
            status: 'ASAR_LOCKED',
            error: `app.asar is locked by a running host process (${err.code}); close Antigravity and retry.`,
          };
        }
        return {
          ok: false,
          status: 'ASAR_WRITE_FAILED',
          error: err?.message || String(err),
        };
      } finally {
        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
          }
        }
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
          }
        }
      }
    }
    function buildSerializedAsarBuffer(u0, headerObj, fileMap) {
      const chunks = [];
      let currentOffset = 0n;
      const rebuildNode = (node, relPath) => {
        if (node.files) {
          for (const [name, child] of Object.entries(node.files)) {
            rebuildNode(child, relPath ? `${relPath}/${name}` : name);
          }
        } else if (!node.unpacked && node.offset !== undefined && node.size !== undefined) {
          const data = fileMap.get(relPath);
          node.size = data.length;
          node.offset = currentOffset.toString();
          node.integrity = computeAsarIntegrity(data);
          chunks.push(data);
          currentOffset += BigInt(data.length);
        }
      };
      rebuildNode(headerObj, '');
      const newHeaderStrBuf = Buffer.from(JSON.stringify(headerObj), 'utf8');
      const newStrSize = newHeaderStrBuf.length;
      const alignedStrSize = Math.ceil(newStrSize / 4) * 4;
      const newU8 = 4 + alignedStrSize;
      const newU4 = 4 + newU8;
      const totalHeaderSize = 8 + newU4;
      const newHeaderBuf = Buffer.alloc(totalHeaderSize, 0);
      newHeaderBuf.writeUInt32LE(u0, 0);
      newHeaderBuf.writeUInt32LE(newU4, 4);
      newHeaderBuf.writeUInt32LE(newU8, 8);
      newHeaderBuf.writeUInt32LE(newStrSize, 12);
      newHeaderStrBuf.copy(newHeaderBuf, 16);
      return {
        headerBuf: newHeaderBuf,
        archiveBuf: Buffer.concat([newHeaderBuf, ...chunks]),
      };
    }
    function patchAsarOnDisk(asarPath, backupJsonPath) {
      if (!asarPath || !fs.existsSync(asarPath)) {
        return {
          ok: true,
          status: 'SKIPPED_NO_ASAR',
          didPatch: false,
          didCreateBackup: false,
        };
      }
      if (isAsarPatchedFast(asarPath)) {
        let appVersion = 'unknown';
        try {
          appVersion = readAsarArchive(asarPath).appVersion;
        } catch {
          appVersion = 'unknown';
        }
        return {
          ok: true,
          status: 'ALREADY_PATCHED',
          didPatch: false,
          didCreateBackup: false,
          patchVersion: PATCH_MARKER,
          appVersion,
        };
      }
      let archive;
      try {
        archive = readAsarArchive(asarPath);
      } catch (err) {
        return {
          ok: false,
          status: 'ASAR_READ_FAILED',
          didPatch: false,
          didCreateBackup: false,
          error: err?.message || String(err),
        };
      }
      const utilsBuf = archive.fileMap.get('dist/utils.js');
      const mainBuf = archive.fileMap.get('dist/main.js');
      const preloadBuf = archive.fileMap.get('dist/preload.js');
      if (!utilsBuf || !mainBuf || !preloadBuf) {
        return {
          ok: false,
          status: 'FAILED_TARGET_FILES_MISSING',
          didPatch: false,
          didCreateBackup: false,
          appVersion: archive.appVersion,
          error: 'dist/utils.js, dist/main.js, or dist/preload.js missing in app.asar',
        };
      }
      const origPreloadOffset = archive.header?.files?.dist?.files?.['preload.js']?.offset;
      const originalAsarSha256 = sha256HexBuf(archive.buf);
      const originalHeaderSliceBase64 = Buffer.from(archive.headerSlice).toString('base64');
      const origEntriesBase64 = {
        'dist/utils.js': Buffer.from(utilsBuf).toString('base64'),
        'dist/main.js': Buffer.from(mainBuf).toString('base64'),
        'dist/preload.js': Buffer.from(preloadBuf).toString('base64'),
      };
      let patchedUtilsBuf;
      let patchedMainBuf;
      let patchedPreloadBuf;
      try {
        patchedUtilsBuf = transformExactSize(utilsBuf, UTILS_ANCHOR_TARGET, UTILS_ANCHOR_REPLACEMENT);
        patchedMainBuf = transformExactSize(mainBuf, MAIN_ANCHOR_TARGET, MAIN_ANCHOR_REPLACEMENT);
        patchedPreloadBuf = transformExactSize(preloadBuf, PRELOAD_ANCHOR_TARGET, PRELOAD_ANCHOR_REPLACEMENT);
      } catch (err) {
        return {
          ok: false,
          status: 'FAILED_PATTERN_OR_SIZE',
          didPatch: false,
          didCreateBackup: false,
          appVersion: archive.appVersion,
          error: err?.message || String(err),
        };
      }
      archive.fileMap.set('dist/utils.js', patchedUtilsBuf);
      archive.fileMap.set('dist/main.js', patchedMainBuf);
      archive.fileMap.set('dist/preload.js', patchedPreloadBuf);
      const clonedHeader = JSON.parse(JSON.stringify(archive.header));
      const { headerBuf: patchedHeaderBuf, archiveBuf: outBuf } = buildSerializedAsarBuffer(
        archive.u0,
        clonedHeader,
        archive.fileMap
      );
      const newPreloadOffset = clonedHeader?.files?.dist?.files?.['preload.js']?.offset;
      if (origPreloadOffset !== newPreloadOffset) {
        return {
          ok: false,
          status: 'FAILED_OFFSET_DRIFT',
          didPatch: false,
          didCreateBackup: false,
          appVersion: archive.appVersion,
          error: `preload.js offset drifted (${origPreloadOffset} -> ${newPreloadOffset})`,
        };
      }
      const patchedHeaderSha256 = sha256HexBuf(patchedHeaderBuf);
      const backupExistedBefore = Boolean(backupJsonPath && fs.existsSync(backupJsonPath));
      const prevBackupBytes = backupExistedBefore ? fs.readFileSync(backupJsonPath) : null;
      if (backupJsonPath) {
        const backupDoc = {
          schemaVersion: 1,
          patchMarker: PATCH_MARKER,
          appVersion: archive.appVersion,
          originalAsarSha256,
          patchedHeaderSha256,
          originalHeaderSliceBase64,
          entries: origEntriesBase64,
          createdAt: new Date().toISOString(),
        };
        try {
          writeFileAtomicSync(backupJsonPath, `${JSON.stringify(backupDoc, null, 2)}\n`);
        } catch (err) {
          return {
            ok: false,
            status: 'BACKUP_WRITE_FAILED',
            didPatch: false,
            didCreateBackup: false,
            error: err?.message || String(err),
          };
        }
      }
      const writeRes = replaceAsarStrictAtomic(asarPath, outBuf);
      if (!writeRes.ok) {
        if (backupJsonPath) {
          try {
            if (backupExistedBefore && prevBackupBytes) {
              writeFileAtomicSync(backupJsonPath, prevBackupBytes);
            } else if (!backupExistedBefore && fs.existsSync(backupJsonPath)) {
              fs.unlinkSync(backupJsonPath);
            }
          } catch {
          }
        }
        return {
          ok: false,
          status: writeRes.status,
          didPatch: false,
          didCreateBackup: false,
          error: writeRes.error,
        };
      }
      return {
        ok: true,
        status: 'PATCHED',
        didPatch: true,
        didCreateBackup: Boolean(backupJsonPath && !backupExistedBefore),
        patchVersion: PATCH_MARKER,
        appVersion: archive.appVersion,
        originalAsarSha256,
        patchedHeaderSha256,
      };
    }
    function restoreAsarOnDisk(asarPath, backupJsonPath) {
      if (!asarPath || !fs.existsSync(asarPath)) {
        return {
          ok: true,
          status: 'SKIPPED_NO_ASAR',
          didRestore: false,
        };
      }
      if (!backupJsonPath || !fs.existsSync(backupJsonPath)) {
        return {
          ok: false,
          status: 'RESTORE_BACKUP_MISSING',
          didRestore: false,
          error:
            'asar_v5_backup.json is missing; cannot verify original app.asar integrity (for legacy v1.5.0 installs, check app.asar.v*.orig manually).',
        };
      }
      let backup;
      try {
        backup = JSON.parse(fs.readFileSync(backupJsonPath, 'utf8'));
      } catch (err) {
        return {
          ok: false,
          status: 'RESTORE_BACKUP_CORRUPT',
          didRestore: false,
          error: `Failed to parse asar_v5_backup.json: ${err?.message || String(err)}`,
        };
      }
      if (
        !backup ||
        typeof backup.originalAsarSha256 !== 'string' ||
        typeof backup.patchedHeaderSha256 !== 'string' ||
        typeof backup.originalHeaderSliceBase64 !== 'string' ||
        !backup.entries
      ) {
        return {
          ok: false,
          status: 'RESTORE_BACKUP_CORRUPT',
          didRestore: false,
          error: 'asar_v5_backup.json is missing required integrity fields.',
        };
      }
      let currentArchive;
      try {
        currentArchive = readAsarArchive(asarPath);
      } catch (err) {
        return {
          ok: false,
          status: 'ASAR_READ_FAILED',
          didRestore: false,
          error: err?.message || String(err),
        };
      }
      const currentFullSha256 = sha256HexBuf(currentArchive.buf);
      const currentlyPatched = isAsarPatchedFast(asarPath);
      if (!currentlyPatched && currentFullSha256 === backup.originalAsarSha256) {
        return {
          ok: true,
          status: 'ALREADY_ORIGINAL',
          didRestore: false,
          originalAsarSha256: backup.originalAsarSha256,
        };
      }
      const currentHeaderSha256 = sha256HexBuf(currentArchive.headerSlice);
      if (!currentlyPatched || currentHeaderSha256 !== backup.patchedHeaderSha256) {
        return {
          ok: false,
          status: 'RESTORE_VERSION_MISMATCH',
          didRestore: false,
          error: 'Current app.asar does not match the recorded V5 patched header digest (host may have updated).',
        };
      }
      const origHeaderSlice = Buffer.from(backup.originalHeaderSliceBase64, 'base64');
      const payloadCopy = Buffer.from(currentArchive.buf.subarray(currentArchive.dataOffset));
      const distFiles = currentArchive.header?.files?.dist?.files || {};
      const entryDefs = [
        ['dist/utils.js', distFiles['utils.js']],
        ['dist/main.js', distFiles['main.js']],
        ['dist/preload.js', distFiles['preload.js']],
      ];
      for (let i = 0; i < entryDefs.length; i += 1) {
        const [relKey, node] = entryDefs[i];
        const encoded = backup.entries[relKey];
        if (!node || typeof encoded !== 'string') {
          return {
            ok: false,
            status: 'RESTORE_BACKUP_CORRUPT',
            didRestore: false,
            error: `Missing backup entry for ${relKey}`,
          };
        }
        const origEntryBuf = Buffer.from(encoded, 'base64');
        const offset = Number(node.offset);
        if (origEntryBuf.length !== Number(node.size) || offset + origEntryBuf.length > payloadCopy.length) {
          return {
            ok: false,
            status: 'RESTORE_VERSION_MISMATCH',
            didRestore: false,
            error: `Entry size/offset mismatch while restoring ${relKey}`,
          };
        }
        origEntryBuf.copy(payloadCopy, offset);
      }
      const candidateAsarBuf = Buffer.concat([origHeaderSlice, payloadCopy]);
      const candidateSha256 = sha256HexBuf(candidateAsarBuf);
      if (candidateSha256 !== backup.originalAsarSha256) {
        return {
          ok: false,
          status: 'RESTORE_DIGEST_MISMATCH',
          didRestore: false,
          error: `Reconstructed ASAR SHA-256 (${candidateSha256}) did not match expected original (${backup.originalAsarSha256}).`,
        };
      }
      const writeRes = replaceAsarStrictAtomic(asarPath, candidateAsarBuf);
      if (!writeRes.ok) {
        return {
          ok: false,
          status: writeRes.status,
          didRestore: false,
          error: writeRes.error,
        };
      }
      return {
        ok: true,
        status: 'RESTORED',
        didRestore: true,
        originalAsarSha256: candidateSha256,
      };
    }
    function createSyntheticAsarBuffer(filesByRelPath) {
      const rootHeader = { files: {} };
      const fileMap = new Map();
      for (const [relPath, rawContent] of Object.entries(filesByRelPath)) {
        const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = clean.split('/');
        let cursor = rootHeader;
        for (let i = 0; i < parts.length - 1; i += 1) {
          const seg = parts[i];
          if (!cursor.files[seg]) cursor.files[seg] = { files: {} };
          cursor = cursor.files[seg];
        }
        const leafName = parts[parts.length - 1];
        const buf = Buffer.isBuffer(rawContent) ? Buffer.from(rawContent) : Buffer.from(String(rawContent), 'utf8');
        cursor.files[leafName] = { size: buf.length, offset: '0' };
        fileMap.set(clean, buf);
      }
      return buildSerializedAsarBuffer(4, rootHeader, fileMap).archiveBuf;
    }
    module.exports = {
      PATCH_MARKER,
      BLOCK_SIZE,
      UTILS_ANCHOR_TARGET,
      MAIN_ANCHOR_TARGET,
      PRELOAD_ANCHOR_TARGET,
      sha256HexBuf,
      computeAsarIntegrity,
      transformExactSize,
      isAsarPatchedFast,
      readAsarArchive,
      patchAsarOnDisk,
      restoreAsarOnDisk,
      createSyntheticAsarBuffer,
    };
  },
  "./scripts/lib/rfc6455-ws": function(module, exports, require) {
    'use strict';
    const net = require('net');
    const crypto = require('crypto');
    const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const MAX_WS_BUFFER_BYTES = 16 * 1024 * 1024;
    function buildMaskedFrame(opcode, payloadBuf) {
      const mask = crypto.randomBytes(4);
      const len = payloadBuf.length;
      let headerLen = 2;
      if (len >= 126 && len <= 65535) headerLen = 4;
      else if (len > 65535) headerLen = 10;
      const frame = Buffer.alloc(headerLen + 4 + len);
      frame[0] = 0x80 | (opcode & 0x0f);
      let maskOffset = 2;
      if (len < 126) {
        frame[1] = 0x80 | len;
      } else if (len <= 65535) {
        frame[1] = 0x80 | 126;
        frame.writeUInt16BE(len, 2);
        maskOffset = 4;
      } else {
        frame[1] = 0x80 | 127;
        frame.writeBigUInt64BE(BigInt(len), 2);
        maskOffset = 10;
      }
      mask.copy(frame, maskOffset);
      const dataOffset = maskOffset + 4;
      for (let i = 0; i < len; i += 1) {
        frame[dataOffset + i] = payloadBuf[i] ^ mask[i & 3];
      }
      return frame;
    }
    function createRfc6455WebSocketClient(wsUrl, options = {}) {
      const maxBufferBytes = options.maxBufferBytes || MAX_WS_BUFFER_BYTES;
      const parsed = new URL(wsUrl);
      if (parsed.protocol !== 'ws:') {
        throw new Error(`Unsupported WebSocket protocol: ${parsed.protocol}`);
      }
      const port = Number(parsed.port || 80);
      const host = parsed.hostname || '127.0.0.1';
      const reqPath = `${parsed.pathname || '/'}${parsed.search || ''}`;
      const secKey = crypto.randomBytes(16).toString('base64');
      const expectedAccept = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');
      let sock = null;
      let handshakeDone = false;
      let closed = false;
      let closeNotified = false;
      let rxBuffer = Buffer.alloc(0);
      let fragmentOpcode = 0;
      let fragmentChunks = [];
      let fragmentTotalBytes = 0;
      const client = {
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        send(data) {
          if (closed || !sock || !handshakeDone) {
            throw new Error('WebSocket is not open');
          }
          const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
          sock.write(buildMaskedFrame(0x01, payload));
        },
        close(code = 1000) {
          if (closed) return;
          closed = true;
          if (sock && !sock.destroyed && handshakeDone) {
            const closePayload = Buffer.alloc(2);
            closePayload.writeUInt16BE(code, 0);
            try {
              sock.end(buildMaskedFrame(0x08, closePayload));
            } catch {
              sock.destroy();
            }
          } else if (sock && !sock.destroyed) {
            sock.destroy();
          }
          notifyClose(code, '');
        },
      };
      const notifyError = (err) => {
        if (typeof client.onerror === 'function') {
          client.onerror(err instanceof Error ? err : new Error(String(err)));
        }
      };
      const notifyClose = (code, reason) => {
        if (closeNotified) return;
        closeNotified = true;
        if (typeof client.onclose === 'function') {
          client.onclose({ code, reason });
        }
      };
      const parseFrames = () => {
        while (rxBuffer.length >= 2 && !closed) {
          const b0 = rxBuffer[0];
          const b1 = rxBuffer[1];
          const fin = (b0 & 0x80) !== 0;
          const opcode = b0 & 0x0f;
          const masked = (b1 & 0x80) !== 0;
          let payloadLen = b1 & 0x7f;
          let offset = 2;
          if (payloadLen === 126) {
            if (rxBuffer.length < 4) return;
            payloadLen = rxBuffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (rxBuffer.length < 10) return;
            const bigLen = rxBuffer.readBigUInt64BE(2);
            if (bigLen > BigInt(maxBufferBytes)) {
              notifyError(new Error('WebSocket frame exceeds maximum buffer size'));
              client.close(1009);
              return;
            }
            payloadLen = Number(bigLen);
            offset = 10;
          }
          const maskBytes = masked ? 4 : 0;
          const totalFrameLen = offset + maskBytes + payloadLen;
          if (totalFrameLen > maxBufferBytes) {
            notifyError(new Error('WebSocket frame exceeds maximum buffer size'));
            client.close(1009);
            return;
          }
          if (rxBuffer.length < totalFrameLen) return;
          let payload = Buffer.from(rxBuffer.subarray(offset + maskBytes, totalFrameLen));
          if (masked) {
            const maskKey = rxBuffer.subarray(offset, offset + 4);
            for (let i = 0; i < payload.length; i += 1) {
              payload[i] ^= maskKey[i & 3];
            }
          }
          rxBuffer = rxBuffer.subarray(totalFrameLen);
          if (opcode === 0x09) {
            if (sock && !sock.destroyed) {
              sock.write(buildMaskedFrame(0x0a, payload));
            }
            continue;
          }
          if (opcode === 0x0a) {
            continue;
          }
          if (opcode === 0x08) {
            const closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
            const closeReason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
            if (!closed && sock && !sock.destroyed) {
              closed = true;
              const replyPayload = Buffer.alloc(2);
              replyPayload.writeUInt16BE(closeCode, 0);
              try {
                sock.end(buildMaskedFrame(0x08, replyPayload));
              } catch {
                sock.destroy();
              }
            }
            notifyClose(closeCode, closeReason);
            return;
          }
          if (opcode === 0x01 || opcode === 0x02) {
            if (fin) {
              const text = payload.toString('utf8');
              if (typeof client.onmessage === 'function') {
                client.onmessage({ data: text });
              }
            } else {
              fragmentOpcode = opcode;
              fragmentChunks = [payload];
              fragmentTotalBytes = payload.length;
            }
          } else if (opcode === 0x00 && fragmentOpcode !== 0) {
            fragmentTotalBytes += payload.length;
            if (fragmentTotalBytes > maxBufferBytes) {
              notifyError(new Error('Fragmented WebSocket message exceeds maximum buffer size'));
              client.close(1009);
              return;
            }
            fragmentChunks.push(payload);
            if (fin) {
              const fullPayload = Buffer.concat(fragmentChunks);
              fragmentOpcode = 0;
              fragmentChunks = [];
              fragmentTotalBytes = 0;
              if (typeof client.onmessage === 'function') {
                client.onmessage({ data: fullPayload.toString('utf8') });
              }
            }
          }
        }
      };
      sock = net.connect({ host, port }, () => {
        const reqLines = [
          `GET ${reqPath} HTTP/1.1`,
          `Host: ${host}:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${secKey}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ];
        sock.write(reqLines.join('\r\n'));
      });
      sock.on('data', (chunk) => {
        if (closed) return;
        if (rxBuffer.length + chunk.length > maxBufferBytes) {
          notifyError(new Error('WebSocket receive buffer limit exceeded'));
          client.close(1009);
          return;
        }
        rxBuffer = rxBuffer.length === 0 ? chunk : Buffer.concat([rxBuffer, chunk]);
        if (!handshakeDone) {
          const headerEnd = rxBuffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;
          const headerStr = rxBuffer.subarray(0, headerEnd).toString('utf8');
          rxBuffer = rxBuffer.subarray(headerEnd + 4);
          const lines = headerStr.split('\r\n');
          const statusLine = lines[0] || '';
          if (!/^HTTP\/1\.1\s+101\b/i.test(statusLine)) {
            notifyError(new Error(`WebSocket upgrade failed: ${statusLine}`));
            client.close(1002);
            return;
          }
          let acceptHeader = '';
          for (let i = 1; i < lines.length; i += 1) {
            const m = lines[i].match(/^Sec-WebSocket-Accept:\s*(.+)$/i);
            if (m) {
              acceptHeader = m[1].trim();
              break;
            }
          }
          if (acceptHeader !== expectedAccept) {
            notifyError(new Error('Invalid Sec-WebSocket-Accept header'));
            client.close(1002);
            return;
          }
          handshakeDone = true;
          if (typeof client.onopen === 'function') {
            client.onopen();
          }
        }
        if (handshakeDone && rxBuffer.length > 0) {
          parseFrames();
        }
      });
      sock.on('error', (err) => {
        notifyError(err);
        closed = true;
        notifyClose(1006, err?.message || '');
      });
      sock.on('close', () => {
        closed = true;
        notifyClose(1000, '');
      });
      return client;
    }
    module.exports = {
      MAX_WS_BUFFER_BYTES,
      buildMaskedFrame,
      createRfc6455WebSocketClient,
    };
  },
  "./scripts/lib/cdp-injector": function(module, exports, require) {
    'use strict';
    const fs = require('fs');
    const http = require('http');
    const crypto = require('crypto');
    const { createRfc6455WebSocketClient } = require('./rfc6455-ws');
    function sha256Short(str) {
      return crypto.createHash('sha256').update(String(str || '')).digest('hex').slice(0, 16);
    }
    function readDevToolsEndpoint(devToolsPortFile) {
      try {
        if (!devToolsPortFile || !fs.existsSync(devToolsPortFile)) return null;
        const lines = fs.readFileSync(devToolsPortFile, 'utf8').trim().split(/\r?\n/);
        const port = parseInt(lines[0], 10);
        if (!port || Number.isNaN(port)) return null;
        const rawWsLine = (lines[1] || '').trim();
        const browserWsUrl = rawWsLine
          ? rawWsLine.startsWith('ws://') || rawWsLine.startsWith('wss://')
            ? rawWsLine
            : `ws://127.0.0.1:${port}${rawWsLine.startsWith('/') ? rawWsLine : `/${rawWsLine}`}`
          : null;
        return { port, browserWsUrl };
      } catch {
        return null;
      }
    }
    function httpGetJson(port, reqPath, timeoutMs = 1500) {
      return new Promise((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path: reqPath, timeout: timeoutMs }, (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            raw += chunk;
          });
          res.on('end', () => {
            try {
              resolve(JSON.parse(raw));
            } catch (err) {
              reject(err);
            }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy(new Error('HTTP timeout'));
        });
      });
    }
    function isEligiblePageTarget(target) {
      if (!target || target.type !== 'page') return false;
      const u = String(target.url || '');
      return (
        !u.startsWith('devtools://') &&
        !u.startsWith('chrome-devtools://') &&
        !u.startsWith('data:') &&
        !u.startsWith('about:')
      );
    }
    function evaluateOnPageWs(wsUrl, expression, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let ws = null;
        try {
          ws = createRfc6455WebSocketClient(wsUrl);
        } catch (err) {
          reject(err);
          return;
        }
        const done = (err, val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
          }
          if (err) reject(err);
          else resolve(val);
        };
        const timer = setTimeout(() => {
          done(new Error('CDP page evaluation timeout'));
        }, timeoutMs);
        ws.onopen = () => {
          try {
            ws.send(
              JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: { expression, returnByValue: true },
              })
            );
          } catch (err) {
            done(err);
          }
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data || ''));
            if (msg && msg.id === 1) {
              if (msg.error) {
                done(new Error(msg.error.message || 'CDP evaluation error'));
              } else if (msg.result?.exceptionDetails) {
                done(new Error(msg.result.exceptionDetails.text || 'CDP runtime exception'));
              } else {
                done(null, msg.result?.result?.value ?? null);
              }
            }
          } catch {
          }
        };
        ws.onerror = (err) => done(err);
        ws.onclose = () => done(new Error('CDP socket closed before response'));
      });
    }
    function evaluateAcrossBrowserTargets(browserWsUrl, expression, timeoutMs = 3500) {
      return new Promise((resolve, reject) => {
        let closed = false;
        let nextId = 1;
        const pending = new Map();
        let ws = null;
        try {
          ws = createRfc6455WebSocketClient(browserWsUrl);
        } catch (err) {
          reject(err);
          return;
        }
        const finish = (err, val) => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          for (const [, p] of pending) {
            p.reject(err || new Error('Browser CDP closed'));
          }
          pending.clear();
          try {
            ws.close();
          } catch {
          }
          if (err) reject(err);
          else resolve(val);
        };
        const timer = setTimeout(() => finish(new Error('Browser CDP timeout')), timeoutMs);
        const sendCmd = (method, params = {}, sessionId = undefined) =>
          new Promise((res, rej) => {
            if (closed) {
              rej(new Error('Browser CDP closed'));
              return;
            }
            const id = nextId++;
            pending.set(id, { resolve: res, reject: rej });
            const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
            try {
              ws.send(JSON.stringify(payload));
            } catch (err) {
              pending.delete(id);
              rej(err);
            }
          });
        ws.onmessage = (ev) => {
          if (closed) return;
          try {
            const msg = JSON.parse(String(ev.data || ''));
            if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
              const p = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.error) p.reject(new Error(msg.error.message || 'CDP command error'));
              else p.resolve(msg.result);
            }
          } catch {
          }
        };
        ws.onerror = (err) => finish(err);
        ws.onclose = () => finish(new Error('Browser CDP closed early'));
        ws.onopen = async () => {
          try {
            const targetsRes = await sendCmd('Target.getTargets', {});
            const infos = Array.isArray(targetsRes?.targetInfos) ? targetsRes.targetInfos : [];
            const pages = infos.filter((t) => t && t.targetId && isEligiblePageTarget(t));
            const values = [];
            for (let i = 0; i < pages.length; i += 1) {
              let sessionId = null;
              try {
                const attached = await sendCmd('Target.attachToTarget', {
                  targetId: pages[i].targetId,
                  flatten: true,
                });
                sessionId = attached?.sessionId || null;
                if (!sessionId) continue;
                const evalRes = await sendCmd(
                  'Runtime.evaluate',
                  { expression, returnByValue: true },
                  sessionId
                );
                if (!evalRes?.exceptionDetails) {
                  values.push(evalRes?.result?.value ?? null);
                }
              } catch {
              } finally {
                if (sessionId) {
                  await sendCmd('Target.detachFromTarget', { sessionId }).catch(() => {});
                }
              }
            }
            finish(null, { pageTargetCount: pages.length, values });
          } catch (err) {
            finish(err);
          }
        };
      });
    }
    async function runExpressionOnLiveTargets(devToolsPortFile, expression) {
      const endpoint = readDevToolsEndpoint(devToolsPortFile);
      if (!endpoint || !endpoint.port) {
        return { attempted: false, reason: 'devtools_port_missing', updatedCount: 0 };
      }
      const { port } = endpoint;
      let { browserWsUrl } = endpoint;
      let pageTargets = [];
      try {
        const list = await httpGetJson(port, '/json/list', 1200);
        pageTargets = (Array.isArray(list) ? list : []).filter(
          (t) => t && t.webSocketDebuggerUrl && isEligiblePageTarget(t)
        );
      } catch {
        pageTargets = [];
      }
      if (pageTargets.length > 0) {
        const settled = await Promise.allSettled(
          pageTargets.map((t) => evaluateOnPageWs(t.webSocketDebuggerUrl, expression, 1800))
        );
        let updatedCount = 0;
        for (let i = 0; i < settled.length; i += 1) {
          if (settled[i].status === 'fulfilled' && settled[i].value) {
            updatedCount += 1;
          }
        }
        return {
          attempted: true,
          mode: 'http_json_list',
          pageTargetCount: pageTargets.length,
          updatedCount,
        };
      }
      if (!browserWsUrl) {
        try {
          const ver = await httpGetJson(port, '/json/version', 1000);
          if (ver && typeof ver.webSocketDebuggerUrl === 'string') {
            browserWsUrl = ver.webSocketDebuggerUrl;
          }
        } catch {
          browserWsUrl = null;
        }
      }
      if (browserWsUrl) {
        try {
          const res = await evaluateAcrossBrowserTargets(browserWsUrl, expression, 3500);
          return {
            attempted: true,
            mode: 'browser_ws',
            pageTargetCount: res.pageTargetCount,
            updatedCount: res.values.filter(Boolean).length,
          };
        } catch (err) {
          return {
            attempted: true,
            mode: 'browser_ws_failed',
            updatedCount: 0,
            error: err?.message || String(err),
          };
        }
      }
      return { attempted: true, mode: 'none', pageTargetCount: 0, updatedCount: 0 };
    }
    async function injectViaCdpLive(paths) {
      if (!paths?.autoinjectPath || !fs.existsSync(paths.autoinjectPath)) {
        return { attempted: false, reason: 'autoinject_script_missing', updatedCount: 0 };
      }
      const code = fs.readFileSync(paths.autoinjectPath, 'utf8');
      const hash = sha256Short(code);
      const expr = `(() => {
    if (window.agyMcpManager && window.__agyStatusBarHash === ${JSON.stringify(hash)}) {
      return 'ALREADY_ACTIVE';
    }
    ${code}
    window.__agyStatusBarHash = ${JSON.stringify(hash)};
    return 'INJECTED_OK';
  })()`;
      return await runExpressionOnLiveTargets(paths.devToolsPortFile, expr);
    }
    async function destroyMcpManagerViaCdpLive(paths) {
      const expr = `(() => {
    if (window.agyMcpManager && typeof window.agyMcpManager.destroy === 'function') {
      window.agyMcpManager.destroy();
      delete window.__agyStatusBarHash;
      return 'DESTROYED_OK';
    }
    return '';
  })()`;
      return await runExpressionOnLiveTargets(paths?.devToolsPortFile, expr);
    }
    module.exports = {
      readDevToolsEndpoint,
      injectViaCdpLive,
      destroyMcpManagerViaCdpLive,
    };
  },
  "./scripts/patcher-entry": function(module, exports, require) {
    'use strict';
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { removeMcpManagerBlock } = require('../src/shared/marker-manifest');
    const {
      createLockToken,
      isFileLockHeld,
      acquireFileLock,
      releaseFileLock,
      writeFileAtomicSync,
      captureFileSnapshots,
      restoreFileSnapshots,
      syncAppStorageCode,
      removeAppStorageCodeKey,
    } = require('./lib/file-lock');
    const {
      PATCH_MARKER,
      isAsarPatchedFast,
      patchAsarOnDisk,
      restoreAsarOnDisk,
    } = require('./lib/asar-patcher');
    const { injectViaCdpLive, destroyMcpManagerViaCdpLive } = require('./lib/cdp-injector');
    const COMPANION_BUNDLE_FILENAMES = Object.freeze([
      'ko_thought_translator_autoinject.js',
      'ko_thought_autoinject.js',
      'statusbar_only_autoinject.js',
    ]);
    function resolveHostPatchPaths(overrides = {}) {
      const homeDir = overrides.homeDir || process.env.USERPROFILE || process.env.HOME || os.homedir();
      const localAppData = overrides.localAppData || process.env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
      const appData = overrides.appData || process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming');
      const agyDir = overrides.agyDir || path.join(homeDir, '.gemini', 'antigravity');
      return {
        homeDir,
        agyDir,
        asarPath: overrides.asarPath || path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
        asarBackupPath: overrides.asarBackupPath || path.join(agyDir, 'asar_v5_backup.json'),
        autoinjectPath: overrides.autoinjectPath || path.join(agyDir, 'statusbar_autoinject.js'),
        mcpAutoinjectPath: overrides.mcpAutoinjectPath || path.join(agyDir, 'mcp_manager_autoinject.js'),
        patcherScriptPath: overrides.patcherScriptPath || path.join(agyDir, 'ensure_statusbar_patch.js'),
        lockPath: overrides.lockPath || path.join(agyDir, 'statusbar_patch.lock'),
        appStorageLockPath: overrides.appStorageLockPath || path.join(agyDir, 'statusbar_app_storage.lock'),
        statusPath: overrides.statusPath || path.join(agyDir, 'statusbar_patch_status.json'),
        appStoragePath: overrides.appStoragePath || path.join(appData, 'Antigravity', 'app_storage.json'),
        devToolsPortFile: overrides.devToolsPortFile || path.join(appData, 'Antigravity', 'DevToolsActivePort'),
      };
    }
    function detectRemainingCompanions(agyDir, existingAutoinjectContent) {
      const remainingAutoinject = removeMcpManagerBlock(existingAutoinjectContent || '');
      let companionBundlePath = null;
      for (let i = 0; i < COMPANION_BUNDLE_FILENAMES.length; i += 1) {
        const candidate = path.join(agyDir, COMPANION_BUNDLE_FILENAMES[i]);
        if (fs.existsSync(candidate)) {
          companionBundlePath = candidate;
          break;
        }
      }
      const hasCompanionBundle = Boolean(companionBundlePath);
      const hasRemainingCompanions = remainingAutoinject.trim().length > 0 || hasCompanionBundle;
      return {
        remainingAutoinject,
        companionBundlePath,
        hasCompanionBundle,
        hasRemainingCompanions,
      };
    }
    function getPatchStatus(customPaths) {
      const paths = customPaths || resolveHostPatchPaths();
      const asarExists = fs.existsSync(paths.asarPath);
      const asarPatched = asarExists ? isAsarPatchedFast(paths.asarPath) : false;
      const backupExists = fs.existsSync(paths.asarBackupPath);
      const autoinjectExists = fs.existsSync(paths.autoinjectPath);
      const mcpAutoinjectExists = fs.existsSync(paths.mcpAutoinjectPath);
      const patcherExists = fs.existsSync(paths.patcherScriptPath);
      const existingAutoinject = autoinjectExists ? fs.readFileSync(paths.autoinjectPath, 'utf8') : '';
      const companionInfo = detectRemainingCompanions(paths.agyDir, existingAutoinject);
      return {
        ok: true,
        patchMarker: PATCH_MARKER,
        asarPath: paths.asarPath,
        asarExists,
        asarPatched,
        backupExists,
        autoinjectExists,
        mcpAutoinjectExists,
        patcherExists,
        hasRemainingCompanions: companionInfo.hasRemainingCompanions,
      };
    }
    function runDedicatedAsarRestore(customPaths) {
      const paths = customPaths || resolveHostPatchPaths();
      const lockToken = createLockToken('restore');
      if (!acquireFileLock(paths.lockPath, lockToken)) {
        return {
          ok: false,
          status: 'LOCK_BUSY',
          error: 'Another patch/install operation is currently in progress.',
        };
      }
      try {
        return restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
      } finally {
        releaseFileLock(paths.lockPath, lockToken);
      }
    }
    async function uninstallMcpManager(customPaths, options = {}) {
      const paths = customPaths || resolveHostPatchPaths();
      const lockToken = createLockToken('uninstall');
      if (!acquireFileLock(paths.lockPath, lockToken)) {
        return {
          ok: false,
          status: 'LOCK_BUSY',
          error: 'Another patch/install operation is currently in progress.',
        };
      }
      try {
        const existingAutoinject = fs.existsSync(paths.autoinjectPath)
          ? fs.readFileSync(paths.autoinjectPath, 'utf8')
          : '';
        const companionInfo = detectRemainingCompanions(paths.agyDir, existingAutoinject);
        if (companionInfo.hasRemainingCompanions) {
          const effectiveRemainingCode =
            companionInfo.remainingAutoinject.trim().length > 0
              ? companionInfo.remainingAutoinject
              : companionInfo.companionBundlePath
                ? fs.readFileSync(companionInfo.companionBundlePath, 'utf8')
                : '';
          const snapshots = captureFileSnapshots([
            paths.autoinjectPath,
            paths.mcpAutoinjectPath,
            paths.appStoragePath,
          ]);
          try {
            writeFileAtomicSync(paths.autoinjectPath, effectiveRemainingCode);
            const syncRes = syncAppStorageCode({
              autoinjectPath: paths.autoinjectPath,
              appStoragePath: paths.appStoragePath,
              appStorageLockPath: paths.appStorageLockPath,
              codeOverride: effectiveRemainingCode,
            });
            if (!syncRes.ok) {
              throw new Error(syncRes.error || 'Failed to resync app_storage.json with remaining companions');
            }
            if (typeof options.__injectStage2Failure === 'function') {
              options.__injectStage2Failure();
            }
            if (fs.existsSync(paths.mcpAutoinjectPath)) {
              fs.unlinkSync(paths.mcpAutoinjectPath);
            }
          } catch (stage2Err) {
            restoreFileSnapshots(snapshots);
            return {
              ok: false,
              branch: 'COMPANIONS_REMAINING',
              stage: 'STAGE_2_COMPANION_RESYNC',
              rolledBack: true,
              error: stage2Err?.message || String(stage2Err),
            };
          }
          const cdpRes = options.skipCdp
            ? { attempted: false, skipped: true }
            : await destroyMcpManagerViaCdpLive(paths);
          return {
            ok: true,
            status: 'UNINSTALLED_MCP_ONLY',
            branch: 'COMPANIONS_REMAINING',
            preservedAsarPatch: true,
            preservedBackup: true,
            cdp: cdpRes,
          };
        }
        let didRestoreAsarInThisRun = false;
        if (fs.existsSync(paths.asarPath) && isAsarPatchedFast(paths.asarPath)) {
          const restoreRes = restoreAsarOnDisk(paths.asarPath, paths.asarBackupPath);
          if (!restoreRes.ok) {
            return {
              ok: false,
              branch: 'SOLE_PLUGIN',
              stage: 'STAGE_1_ASAR_RESTORE',
              status: restoreRes.status,
              rolledBack: false,
              error: restoreRes.error,
            };
          }
          didRestoreAsarInThisRun = Boolean(restoreRes.didRestore);
        }
        const snapshots = captureFileSnapshots([
          paths.autoinjectPath,
          paths.mcpAutoinjectPath,
          paths.patcherScriptPath,
          paths.asarBackupPath,
          paths.appStoragePath,
        ]);
        try {
          const rmStorageRes = removeAppStorageCodeKey({
            appStoragePath: paths.appStoragePath,
            appStorageLockPath: paths.appStorageLockPath,
          });
          if (!rmStorageRes.ok) {
            throw new Error(rmStorageRes.error || 'Failed to remove agy-statusbar-code from app_storage.json');
          }
          if (typeof options.__injectStage2Failure === 'function') {
            options.__injectStage2Failure();
          }
          const filesToDelete = [
            paths.mcpAutoinjectPath,
            paths.autoinjectPath,
            paths.patcherScriptPath,
            paths.asarBackupPath,
          ];
          for (let i = 0; i < filesToDelete.length; i += 1) {
            if (fs.existsSync(filesToDelete[i])) {
              fs.unlinkSync(filesToDelete[i]);
            }
          }
        } catch (stage2Err) {
          restoreFileSnapshots(snapshots);
          let reversedAsarRestore = false;
          if (didRestoreAsarInThisRun) {
            const rePatch = patchAsarOnDisk(paths.asarPath, paths.asarBackupPath);
            reversedAsarRestore = Boolean(rePatch.ok);
          }
          return {
            ok: false,
            branch: 'SOLE_PLUGIN',
            stage: 'STAGE_2_CLEANUP',
            rolledBack: true,
            reversedAsarRestore,
            error: stage2Err?.message || String(stage2Err),
          };
        }
        const cdpRes = options.skipCdp
          ? { attempted: false, skipped: true }
          : await destroyMcpManagerViaCdpLive(paths);
        return {
          ok: true,
          status: 'UNINSTALLED_ALL',
          branch: 'SOLE_PLUGIN',
          didRestoreAsar: didRestoreAsarInThisRun,
          cdp: cdpRes,
        };
      } finally {
        releaseFileLock(paths.lockPath, lockToken);
      }
    }
    async function runHookCycle(customPaths, options = {}) {
      const paths = customPaths || resolveHostPatchPaths();
      if (isFileLockHeld(paths.lockPath)) {
        return { ok: true, status: 'YIELDED_LOCK_HELD' };
      }
      const syncRes = syncAppStorageCode({
        autoinjectPath: paths.autoinjectPath,
        appStoragePath: paths.appStoragePath,
        appStorageLockPath: paths.appStorageLockPath,
      });
      let asarResult = { ok: true, status: 'ALREADY_PATCHED' };
      if (fs.existsSync(paths.asarPath) && !isAsarPatchedFast(paths.asarPath)) {
        const lockToken = createLockToken('hook-patch');
        if (acquireFileLock(paths.lockPath, lockToken)) {
          try {
            asarResult = patchAsarOnDisk(paths.asarPath, paths.asarBackupPath);
            try {
              writeFileAtomicSync(
                paths.statusPath,
                `${JSON.stringify({ updatedAt: new Date().toISOString(), asarResult }, null, 2)}\n`
              );
            } catch {
            }
          } finally {
            releaseFileLock(paths.lockPath, lockToken);
          }
        } else {
          asarResult = { ok: true, status: 'YIELDED_LOCK_HELD' };
        }
      }
      const cdpResult = options.skipCdp
        ? { attempted: false, skipped: true }
        : await injectViaCdpLive(paths);
      return {
        ok: Boolean(asarResult.ok),
        status: asarResult.status,
        storageSynced: Boolean(syncRes.updated),
        asar: asarResult,
        cdp: cdpResult,
      };
    }
    async function runCli(argv = process.argv.slice(2), customPaths = undefined) {
      const args = Array.isArray(argv) ? argv : [];
      const paths = customPaths || resolveHostPatchPaths();
      if (args.includes('--status')) {
        const st = getPatchStatus(paths);
        process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
        return { exitCode: 0, result: st };
      }
      if (args.includes('--restore')) {
        const res = runDedicatedAsarRestore(paths);
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        return { exitCode: res.ok ? 0 : 1, result: res };
      }
      if (args.includes('--uninstall')) {
        const res = await uninstallMcpManager(paths);
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
        return { exitCode: res.ok ? 0 : 1, result: res };
      }
      const res = await runHookCycle(paths);
      if (args.includes('--json')) {
        process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
      }
      return { exitCode: res.ok ? 0 : 1, result: res };
    }
    if (require.main === module) {
      runCli().then(
        ({ exitCode }) => {
          if (exitCode !== 0) process.exitCode = exitCode;
        },
        (err) => {
          process.stderr.write(`${err?.stack || err}\n`);
          process.exitCode = 1;
        }
      );
    }
    module.exports = {
      COMPANION_BUNDLE_FILENAMES,
      resolveHostPatchPaths,
      detectRemainingCompanions,
      getPatchStatus,
      runDedicatedAsarRestore,
      uninstallMcpManager,
      runHookCycle,
      runCli,
    };
  }
  };
  const __cache = {};
  const __entryModule = { exports: {} };
  const __localMain = outerRequire.main === outerModule ? __entryModule : outerRequire.main;
  function __resolve(baseDir, spec) {
    const cleanSpec = spec.replace(/\.js$/, '');
    const parts = (baseDir + '/' + cleanSpec).split('/');
    const out = [];
    for (const p of parts) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return './' + out.join('/');
  }
  function __makeScopedRequire(baseDir) {
    const localRequire = (spec) => {
      if (!spec.startsWith('.')) return outerRequire(spec);
      return __loadModule(__resolve(baseDir, spec));
    };
    localRequire.main = __localMain;
    return localRequire;
  }
  function __loadModule(id) {
    if (__cache[id]) return __cache[id].exports;
    const fn = __modules[id];
    if (!fn) throw new Error('Patcher module not found: ' + id);
    const mod = id === "./scripts/patcher-entry" ? __entryModule : { exports: {} };
    __cache[id] = mod;
    const lastSlash = id.lastIndexOf('/');
    const dir = lastSlash > 0 ? id.slice(0, lastSlash) : '.';
    fn(mod, mod.exports, __makeScopedRequire(dir));
    return mod.exports;
  }
  outerModule.exports = __loadModule("./scripts/patcher-entry");
})(module, require);
