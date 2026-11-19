/**
 * Server Name Collision Detector (`src/core/collision-detector.mjs`).
 * Detects exact & case-insensitive duplicates inside global scope and across plugin scopes.
 */

export function detectCollisions(globalServerNames = [], pluginServers = []) {
  const globalCaseDuplicates = [];
  const seenGlobal = new Map();

  for (const name of globalServerNames) {
    const lower = String(name).toLowerCase();
    if (seenGlobal.has(lower)) {
      globalCaseDuplicates.push({
        existingName: seenGlobal.get(lower),
        conflictingName: name,
      });
    } else {
      seenGlobal.set(lower, name);
    }
  }

  const pluginCollisions = [];
  for (const entry of pluginServers) {
    const lower = String(entry.name || '').toLowerCase();
    if (seenGlobal.has(lower)) {
      pluginCollisions.push({
        serverName: entry.name,
        globalName: seenGlobal.get(lower),
        pluginName: entry.pluginName,
        pluginDir: entry.pluginDir,
        exactMatch: seenGlobal.get(lower) === entry.name,
      });
    }
  }

  return {
    globalCaseDuplicates,
    pluginCollisions,
  };
}

export function findCaseInsensitiveConflict(existingNames, candidateName, ignoreName = null) {
  const targetLower = String(candidateName || '').toLowerCase();
  const ignoreLower = ignoreName ? String(ignoreName).toLowerCase() : null;
  for (const existing of existingNames) {
    if (ignoreName && existing === ignoreName) continue;
    if (ignoreLower && existing.toLowerCase() === ignoreLower && existing === ignoreName) continue;
    if (existing.toLowerCase() === targetLower) {
      return existing;
    }
  }
  return null;
}
