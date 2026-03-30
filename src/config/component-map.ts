import type { TrackerConfig } from '../storage/types.js';
import { extractRepoName } from '../parser/project-path.js';

/**
 * Resolve a CWD path to a component name using config patterns.
 *
 * Resolution order:
 * 1. Exact path match (highest priority)
 * 2. Glob suffix match (double-star/something)
 * 3. Prefix match (longest pattern wins - more specific paths beat shorter ones)
 * 4. Auto-detect from repo basename matching a component name
 * 5. Fall back to defaultComponent
 */
export function resolveComponent(cwd: string, config: TrackerConfig): string {
  if (!cwd) return config.defaultComponent;

  // Pass 1: exact matches
  for (const [name, comp] of Object.entries(config.components)) {
    for (const pattern of comp.patterns) {
      if (cwd === pattern) return name;
    }
  }

  // Pass 2: glob suffix matches (**/something)
  for (const [name, comp] of Object.entries(config.components)) {
    for (const pattern of comp.patterns) {
      if (pattern.startsWith('**/')) {
        const suffix = pattern.slice(3);
        // Match as a path segment: /suffix at end, or /suffix/ in middle
        if (cwd.endsWith('/' + suffix)) return name;
        if (cwd.includes('/' + suffix + '/')) return name;
      }
    }
  }

  // Pass 3: prefix matches — collect all, pick longest (most specific)
  let bestMatch: { name: string; length: number } | null = null;

  for (const [name, comp] of Object.entries(config.components)) {
    for (const pattern of comp.patterns) {
      if (pattern.startsWith('**/')) continue; // already handled
      if (cwd.startsWith(pattern + '/') || cwd === pattern) {
        if (!bestMatch || pattern.length > bestMatch.length) {
          bestMatch = { name, length: pattern.length };
        }
      }
    }
  }

  if (bestMatch) return bestMatch.name;

  // Pass 4: auto-detect from repo basename
  const repoName = extractRepoName(cwd);
  if (repoName) {
    for (const name of Object.keys(config.components)) {
      if (name.toLowerCase() === repoName.toLowerCase()) return name;
    }
  }

  return config.defaultComponent;
}
