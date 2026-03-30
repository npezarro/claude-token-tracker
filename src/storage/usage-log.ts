import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { UsageRecord } from './types.js';

export function getDataDir(): string {
  return process.env.CLAUDE_TRACKER_DATA_DIR || join(homedir(), '.claude-token-tracker');
}

export function getUsageLogPath(): string {
  return join(getDataDir(), 'usage.jsonl');
}

export async function appendUsageRecord(record: UsageRecord): Promise<void> {
  const logPath = getUsageLogPath();
  const dir = dirname(logPath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await appendFile(logPath, JSON.stringify(record) + '\n', 'utf-8');
}

export async function readUsageLog(): Promise<UsageRecord[]> {
  const logPath = getUsageLogPath();
  if (!existsSync(logPath)) return [];

  const content = await readFile(logPath, 'utf-8');
  const records: UsageRecord[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip malformed
    }
  }

  return records;
}

export async function getLoggedSessionIds(): Promise<Set<string>> {
  const records = await readUsageLog();
  return new Set(records.map(r => r.sessionId));
}
