/**
 * Domain constants, error codes, and transport types (`src/core/model.mjs`).
 * 100% vendor-independent and runtime-agnostic (zero Node/DOM/host imports).
 */

export const TRANSPORT_KINDS = Object.freeze({
  STDIO: 'stdio',
  STREAMABLE_HTTP: 'streamable_http',
  LEGACY_SSE: 'legacy_sse',
});

export const ERROR_CODES = Object.freeze({
  MALFORMED_JSON: 'MALFORMED_JSON',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  COLLISION: 'COLLISION',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  WRITE_JAIL_VIOLATION: 'WRITE_JAIL_VIOLATION',
  LOCK_BUSY: 'LOCK_BUSY',
  IO_ERROR: 'IO_ERROR',
});

export const FORBIDDEN_OBJECT_KEYS = Object.freeze(
  new Set(['__proto__', 'constructor', 'prototype'])
);

/**
 * Environment variables that hijack dynamic linkers, interpreters, or command resolution.
 * Hard-blocked or flagged before persistence.
 */
export const DANGEROUS_ENV_KEYS = Object.freeze(
  new Set([
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_LIBRARY_PATH',
    'NODE_OPTIONS',
    'NODE_EXTRA_CA_CERTS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'RUBYOPT',
    'PERL5OPT',
    'BASH_ENV',
    'ENV',
    'IFS',
    'COMSPEC',
    'PATHEXT',
    'PROMPT_COMMAND',
  ])
);

export const CAUTION_ENV_KEYS = Object.freeze(new Set(['PATH']));

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createSafeRecord() {
  return Object.create(null);
}
