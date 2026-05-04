#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { recordSession } from './commands/record.js';
import { backfill } from './commands/backfill.js';
import { report } from './commands/report.js';
import { exportData } from './commands/export.js';
import { loadConfig, saveConfig, getConfigPath } from './config/config.js';
import { getUsageLogPath } from './storage/usage-log.js';
import { generateDiscordReport, postDiscordReport } from './commands/discord-report.js';
import { publishLogs } from './commands/publish-logs.js';

export function getFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

export function printHelp() {
  console.log(`claude-token-tracker — Per-component token usage tracking for Claude Code

Usage:
  claude-token-tracker <command> [options]

Commands:
  record              Record current session (used by Stop hook, reads stdin)
  backfill            Parse all existing transcripts into the usage log
  report              Show usage breakdown
  export              Export data as JSON or CSV
  config              Show or edit component mappings
  discord-report      Post usage report to Discord #usage channel

Options:
  backfill:
    --since <date>    Only process sessions after this date (ISO format)
    --project <name>  Only process sessions for this project
    --verbose         Show progress

  report:
    --by <grouping>   Group by: component (default), day, session, model
    --since <date>    Filter sessions after this date
    --until <date>    Filter sessions before this date
    --component <n>   Filter to specific component
    --subagents       Show subagent breakdown

  export:
    --format <fmt>    Output format: json (default), csv
    --output <file>   Write to file instead of stdout
    --since <date>    Filter sessions after this date
    --until <date>    Filter sessions before this date
    --component <n>   Filter to specific component

  config:
    config show       Print current configuration
    config set <path> <component>  Add a component mapping
    config paths      Show data directory and log file paths
`);
}

export async function runCli(args: string[]) {
  const command = args[0];

  switch (command) {
    case 'record': {
      // Read from stdin if piped
      if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const input = Buffer.concat(chunks).toString('utf-8');
        const hookData = JSON.parse(input);
        const result = await recordSession({
          session_id: hookData.session_id,
          transcript_path: hookData.transcript_path,
          cwd: hookData.cwd,
        });
        if (result) {
          console.log(`Recorded: ${result.component} — ${result.turnCount} turns, ${result.totalTokens} tokens`);
        }
      } else {
        // Manual mode with flags
        const sessionId = getFlag(args, 'session-id');
        const transcriptPath = getFlag(args, 'transcript-path');
        const cwd = getFlag(args, 'cwd');
        if (!transcriptPath) {
          console.error('Usage: claude-token-tracker record --transcript-path <path> [--session-id <id>] [--cwd <dir>]');
          process.exit(1);
        }
        const result = await recordSession({ session_id: sessionId, transcript_path: transcriptPath, cwd });
        if (result) {
          console.log(`Recorded: ${result.component} — ${result.turnCount} turns, ${result.totalTokens} tokens`);
        } else {
          console.log('Nothing to record (empty session or already logged).');
        }
      }
      break;
    }

    case 'backfill': {
      const result = await backfill({
        since: getFlag(args, 'since'),
        project: getFlag(args, 'project'),
        verbose: hasFlag(args, 'verbose'),
      });
      console.log(`Backfill complete: ${result.recorded} recorded, ${result.skipped} skipped, ${result.errors} errors`);
      break;
    }

    case 'report': {
      const groupBy = getFlag(args, 'by') as 'component' | 'day' | 'session' | 'model' | undefined;
      const topN = getFlag(args, 'top') ? parseInt(getFlag(args, 'top')!, 10) : undefined;
      const output = await report({
        groupBy,
        since: getFlag(args, 'since'),
        until: getFlag(args, 'until'),
        component: getFlag(args, 'component'),
        includeSubagents: hasFlag(args, 'subagents'),
        hideSessions: hasFlag(args, 'no-sessions'),
        topN,
      });
      console.log(output);
      break;
    }

    case 'export': {
      const output = await exportData({
        format: getFlag(args, 'format') as 'json' | 'csv' | undefined,
        output: getFlag(args, 'output'),
        since: getFlag(args, 'since'),
        until: getFlag(args, 'until'),
        component: getFlag(args, 'component'),
      });
      console.log(output);
      break;
    }

    case 'config': {
      const subcommand = args[1];
      const config = await loadConfig();

      if (subcommand === 'show') {
        console.log(JSON.stringify(config, null, 2));
      } else if (subcommand === 'set') {
        const path = args[2];
        const componentName = args[3];
        if (!path || !componentName) {
          console.error('Usage: claude-token-tracker config set <path-pattern> <component-name>');
          process.exit(1);
        }
        if (!config.components[componentName]) {
          config.components[componentName] = { patterns: [] };
        }
        if (!config.components[componentName].patterns.includes(path)) {
          config.components[componentName].patterns.push(path);
        }
        await saveConfig(config);
        console.log(`Added pattern "${path}" to component "${componentName}"`);
      } else if (subcommand === 'paths') {
        console.log(`Config: ${getConfigPath()}`);
        console.log(`Usage log: ${getUsageLogPath()}`);
      } else {
        console.log(JSON.stringify(config, null, 2));
      }
      break;
    }

    case 'discord-report': {
      const period = getFlag(args, 'period') as '24h' | '7d' | 'both' | undefined;
      const webhook = getFlag(args, 'webhook');
      const dryRun = hasFlag(args, 'dry-run');

      if (dryRun) {
        const content = await generateDiscordReport({ period });
        console.log(content);
      } else {
        const success = await postDiscordReport({ webhookUrl: webhook, period });
        if (success) {
          console.log('Report posted to #usage');
        } else {
          process.exit(1);
        }
      }
      break;
    }

    case 'publish-logs': {
      const config = await loadConfig();
      const result = await publishLogs({
        repoPath: getFlag(args, 'repo-path') || config.sessionLogsPath,
        since: getFlag(args, 'since'),
        force: hasFlag(args, 'force'),
        verbose: hasFlag(args, 'verbose'),
      });
      console.log(`Published ${result.published} session logs, ${result.skipped} skipped`);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}`);
      }
      printHelp();
      process.exit(command ? 1 : 0);
  }
}

// Only auto-execute when run as the main script (not when imported for testing)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
