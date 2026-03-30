import { readdir, readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';

interface SessionMeta {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
}

interface HistoryEntry {
  sessionId: string;
  project: string;
  timestamp: number;
}

/**
 * Load session metadata from ~/.claude/sessions/*.json
 * Returns a map of sessionId -> SessionMeta
 */
export async function loadSessionMetadata(claudeDir?: string): Promise<Map<string, SessionMeta>> {
  const sessionsDir = join(claudeDir || join(homedir(), '.claude'), 'sessions');
  const map = new Map<string, SessionMeta>();

  if (!existsSync(sessionsDir)) return map;

  const files = await readdir(sessionsDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const data = JSON.parse(await readFile(join(sessionsDir, file), 'utf-8'));
      if (data.sessionId) {
        map.set(data.sessionId, data);
      }
    } catch {
      // skip malformed
    }
  }

  return map;
}

/**
 * Load history entries from ~/.claude/history.jsonl
 * Returns a map of sessionId -> { project (CWD), earliest timestamp }
 */
export async function loadHistory(claudeDir?: string): Promise<Map<string, HistoryEntry>> {
  const historyPath = join(claudeDir || join(homedir(), '.claude'), 'history.jsonl');
  const map = new Map<string, HistoryEntry>();

  if (!existsSync(historyPath)) return map;

  const rl = createInterface({
    input: createReadStream(historyPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.sessionId && entry.project) {
        // Keep earliest entry per session
        if (!map.has(entry.sessionId)) {
          map.set(entry.sessionId, {
            sessionId: entry.sessionId,
            project: entry.project,
            timestamp: entry.timestamp,
          });
        }
      }
    } catch {
      // skip
    }
  }

  return map;
}

/**
 * Discover all transcript files across all projects.
 * Returns array of { filePath, projectDir, sessionId }
 */
export async function discoverTranscripts(claudeDir?: string): Promise<Array<{
  filePath: string;
  projectDir: string;
  sessionId: string;
  sessionDir: string | null; // directory with subagents, if exists
}>> {
  const projectsDir = join(claudeDir || join(homedir(), '.claude'), 'projects');
  if (!existsSync(projectsDir)) return [];

  const projects = await readdir(projectsDir);
  const results: Array<{
    filePath: string;
    projectDir: string;
    sessionId: string;
    sessionDir: string | null;
  }> = [];

  for (const projectDir of projects) {
    const projectPath = join(projectsDir, projectDir);
    let entries: string[];
    try {
      entries = await readdir(projectPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;

      const sessionId = entry.replace('.jsonl', '');
      const sessionDir = join(projectPath, sessionId);
      const hasSessionDir = existsSync(sessionDir);

      results.push({
        filePath: join(projectPath, entry),
        projectDir,
        sessionId,
        sessionDir: hasSessionDir ? sessionDir : null,
      });
    }
  }

  return results;
}
