'use strict';

/**
 * Context-Aware JavaScript Lexer Utilities (`scripts/lib/js-lexer.js`).
 *
 * Shared by:
 * - `scripts/build.js` (`stripCommentsAndEmptyLines`)
 * - `scripts/lib/asar-patcher.js` (`stripPureCommentLinesLexical`)
 * - `test/core/boundary-purity.test.js` (`tokenizeJsSource` — `5095348c-F2`)
 */

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

/**
 * Strips pure comment lines and blank lines while preserving template literals,
 * string literals, regex literals, and optional `preserveMarker` lines.
 *
 * @param {string[]} lines
 * @param {{ indentPrefix?: string, preserveMarker?: string }} [options]
 * @returns {string[]}
 */
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

/**
 * Tokenizes JavaScript source into `{ type, value, line, prevWasDot }` tokens,
 * ignoring comments while separating identifiers from string/template literals.
 *
 * @param {string} source
 */
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
