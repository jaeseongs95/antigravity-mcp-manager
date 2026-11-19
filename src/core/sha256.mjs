/**
 * Standard Web Crypto API SHA-256 over UTF-8 (`src/core/sha256.mjs`).
 * Uses runtime-standard `TextEncoder` + `globalThis.crypto.subtle.digest('SHA-256', ...)`
 * (available natively in Node 22+, Deno, Bun, and modern browsers) with zero hand-rolled
 * cryptography and zero `node:*` imports.
 */

const UTF8_ENCODER = new TextEncoder();

export async function sha256Hex(input) {
  const bytes = UTF8_ENCODER.encode(String(input ?? ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
