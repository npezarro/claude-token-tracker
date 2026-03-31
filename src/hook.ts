#!/usr/bin/env node

/**
 * Stop hook entry point for Claude Code.
 * Reads hook JSON from stdin, parses the session transcript, and records usage.
 * Must complete in <5s.
 */

import { recordSession } from './commands/record.js';
import { publishLogs } from './commands/publish-logs.js';
import { loadConfig } from './config/config.js';

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

  let hookData: any;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const result = await recordSession({
    session_id: hookData.session_id,
    transcript_path: hookData.transcript_path,
    cwd: hookData.cwd,
  });

  if (result) {
    // Output approve decision for the hook system
    console.log(JSON.stringify({ decision: 'approve' }));

    // Fire-and-forget: publish this session's log to the git repo
    // Don't await — the hook must finish fast
    loadConfig().then(config => {
      if (config.sessionLogsPath) {
        publishLogs({ repoPath: config.sessionLogsPath, since: result.startedAt }).catch(() => {});
      }
    }).catch(() => {});
  }
}

main().catch(() => process.exit(0));
