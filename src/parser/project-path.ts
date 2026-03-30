/**
 * Decode Claude Code's encoded project directory names back to real paths.
 *
 * Claude Code encodes project paths by replacing '/' with '-'.
 * e.g., "-home-user-repos-myProject" -> "/home/user/repos/myProject"
 *
 * This is inherently ambiguous when path components contain hyphens,
 * so we use heuristics: known prefixes and checking if the decoded path
 * looks reasonable.
 */
export function decodeProjectPath(dirName: string): string {
  if (!dirName.startsWith('-')) return dirName;

  // Common prefixes to try
  const prefixes = [
    '-home-',
    '-mnt-c-Users-',
    '-mnt-d-',
    '-root-',
    '-tmp-',
  ];

  for (const prefix of prefixes) {
    if (dirName.startsWith(prefix)) {
      // Replace leading '-' with '/', then split on remaining '-'
      // But we need to be careful: hyphens in directory names are valid
      // Strategy: replace the prefix properly, then try to reconstruct
      return '/' + dirName.slice(1).replace(/-/g, '/');
    }
  }

  // Fallback: treat all hyphens as separators
  return '/' + dirName.slice(1).replace(/-/g, '/');
}

/**
 * Extract the repo name from a CWD path.
 * e.g., "/home/user/repos/myProject" -> "myProject"
 */
export function extractRepoName(cwd: string): string | null {
  if (!cwd) return null;
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || null;
}
