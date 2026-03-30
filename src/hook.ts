#!/usr/bin/env node

/**
 * Stop hook entry point for Claude Code.
 * Reads hook JSON from stdin, parses the session transcript, and records usage.
 * Must complete in <5s.
 */

import { recordSession } from './commands/record.js';

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
  }
}

main().catch(() => process.exit(0));
