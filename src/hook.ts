#!/usr/bin/env node

/**
 * Stop hook entry point for Claude Code.
 * Reads hook JSON from stdin, parses the session transcript, and records usage.
 * Must complete in <15s (timeout set in settings.json).
 */

import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordSession } from './commands/record.js';
import { publishLogs } from './commands/publish-logs.js';
import { loadConfig } from './config/config.js';
import { getDataDir } from './storage/usage-log.js';

function getErrorLogPath(): string {
  return join(getDataDir(), 'errors.log');
}

async function logError(context: string, error: unknown): Promise<void> {
  const ts = new Date().toISOString();
  const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
  const line = `[${ts}] ${context}: ${msg}\n`;
  try {
    await appendFile(getErrorLogPath(), line, 'utf-8');
  } catch {
    // Last resort: write to stderr so it shows up in hook output
    process.stderr.write(line);
  }
}

async function main() {
  // Read stdin (non-blocking, with timeout)
  let input = '';

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks).toString('utf-8');
  }

  if (!input.trim()) {
    process.exit(0);
  }

  let hookData: Record<string, unknown>;
  try {
    hookData = JSON.parse(input) as Record<string, unknown>;
  } catch (err) {
    await logError('JSON parse failed', err);
    process.exit(0);
  }

  const result = await recordSession({
    session_id: hookData.session_id as string,
    transcript_path: hookData.transcript_path as string,
    cwd: hookData.cwd as string,
  });

  if (result) {
    // Output approve decision for the hook system
    console.log(JSON.stringify({ decision: 'approve' }));

    // Fire-and-forget: publish this session's log to the git repo
    // Don't await — the hook must finish fast
    loadConfig().then(config => {
      if (config.sessionLogsPath) {
        publishLogs({ repoPath: config.sessionLogsPath, since: result.startedAt }).catch((err) => {
          logError('publishLogs failed', err);
        });
      }
    }).catch((err) => {
      logError('loadConfig for publish failed', err);
    });
  }
}

main().catch(async (err) => {
  await logError('hook main() failed', err);
  process.exit(0);
});
