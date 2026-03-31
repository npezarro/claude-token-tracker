import { createReadStream, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readUsageLog } from '../storage/usage-log.js';
import { getDataDir } from '../storage/usage-log.js';

interface ProcessedTurn {
  role: 'user' | 'assistant' | 'tool';
  timestamp: string;
  content: string;
}

/**
 * Process a JSONL transcript into readable markdown.
 * Extracts user/assistant dialogue and tool call summaries.
 */
async function processTranscript(filePath: string): Promise<string> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  const turns: ProcessedTurn[] = [];
  let sessionId = '';
  let cwd = '';
  let gitBranch = '';
  let startedAt = '';
  let model = '';

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
    if (entry.timestamp && !startedAt) startedAt = entry.timestamp;

    // User messages
    if (entry.type === 'user' && entry.message?.role === 'user') {
      const content = entry.message.content;
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((b: any) => b.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
      }
      // Skip tool results that appear as user messages
      if (entry.toolUseResult) {
        // Summarize tool result
        const stdout = entry.toolUseResult.stdout || '';
        const stderr = entry.toolUseResult.stderr || '';
        const preview = (stdout || stderr).slice(0, 200).replace(/\n/g, ' ');
        if (preview.trim()) {
          turns.push({
            role: 'tool',
            timestamp: entry.timestamp || '',
            content: `Tool result: ${preview}${(stdout + stderr).length > 200 ? '...' : ''}`,
          });
        }
        continue;
      }
      if (text.trim().length > 3) {
        turns.push({
          role: 'user',
          timestamp: entry.timestamp || '',
          content: text.trim(),
        });
      }
    }

    // Assistant messages
    if (entry.type === 'assistant' && entry.message?.content) {
      if (!model && entry.message.model) model = entry.message.model;

      for (const block of entry.message.content) {
        if (block.type === 'text' && block.text?.trim()) {
          turns.push({
            role: 'assistant',
            timestamp: entry.timestamp || '',
            content: block.text.trim(),
          });
        } else if (block.type === 'tool_use') {
          // Summarize tool call
          const name = block.name || 'unknown';
          let summary = `**Tool: ${name}**`;

          const input = block.input || {};
          if (name === 'Read' || name === 'read') {
            summary = `**Read** \`${input.file_path || input.path || '?'}\``;
          } else if (name === 'Edit' || name === 'edit') {
            summary = `**Edit** \`${input.file_path || '?'}\``;
          } else if (name === 'Write' || name === 'write') {
            summary = `**Write** \`${input.file_path || '?'}\``;
          } else if (name === 'Bash' || name === 'bash') {
            const cmd = (input.command || '').slice(0, 120);
            summary = `**Bash** \`${cmd}\``;
          } else if (name === 'Grep' || name === 'grep') {
            summary = `**Grep** \`${input.pattern || '?'}\`${input.path ? ` in ${input.path}` : ''}`;
          } else if (name === 'Glob' || name === 'glob') {
            summary = `**Glob** \`${input.pattern || '?'}\``;
          } else if (name === 'Agent' || name === 'agent') {
            summary = `**Agent** (${input.subagent_type || 'general'}): ${(input.description || input.prompt || '').slice(0, 80)}`;
          } else if (name === 'WebSearch') {
            summary = `**WebSearch** \`${input.query || '?'}\``;
          } else if (name === 'WebFetch') {
            summary = `**WebFetch** \`${input.url || '?'}\``;
          }

          turns.push({
            role: 'tool',
            timestamp: entry.timestamp || '',
            content: summary,
          });
        }
      }
    }
  }

  // Build markdown
  const lines: string[] = [];
  const date = startedAt ? startedAt.slice(0, 10) : 'unknown';
  lines.push(`# Session ${sessionId?.slice(0, 8) || 'unknown'}`);
  lines.push('');
  lines.push(`- **Date:** ${date}`);
  lines.push(`- **CWD:** \`${cwd}\``);
  if (gitBranch) lines.push(`- **Branch:** ${gitBranch}`);
  if (model) lines.push(`- **Model:** ${model}`);
  lines.push(`- **Session ID:** ${sessionId}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const turn of turns) {
    const time = turn.timestamp ? turn.timestamp.slice(11, 19) : '';

    if (turn.role === 'user') {
      lines.push(`### User ${time ? `(${time})` : ''}`);
      lines.push('');
      lines.push(turn.content);
      lines.push('');
    } else if (turn.role === 'assistant') {
      lines.push(`### Assistant ${time ? `(${time})` : ''}`);
      lines.push('');
      lines.push(turn.content);
      lines.push('');
    } else if (turn.role === 'tool') {
      lines.push(`> ${turn.content}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

interface PublishOptions {
  repoPath?: string;
  since?: string;
  force?: boolean;
  verbose?: boolean;
}

/**
 * Get the set of session IDs already published (from manifest file).
 */
function getPublishedSessions(repoPath: string): Set<string> {
  const manifestPath = join(repoPath, '.manifest.json');
  if (!existsSync(manifestPath)) return new Set();
  try {
    const data = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    return new Set(data.sessions || []);
  } catch {
    return new Set();
  }
}

function saveManifest(repoPath: string, sessions: Set<string>) {
  const manifestPath = join(repoPath, '.manifest.json');
  writeFileSync(manifestPath, JSON.stringify({ sessions: [...sessions] }, null, 2) + '\n');
}

export async function publishLogs(options: PublishOptions = {}): Promise<{ published: number; skipped: number }> {
  const repoPath = options.repoPath || join(getDataDir(), 'session-logs');
  const records = await readUsageLog();

  // Filter by date if specified
  let filtered = records;
  if (options.since) {
    const sinceDate = new Date(options.since);
    filtered = records.filter(r => new Date(r.startedAt) >= sinceDate);
  }

  // Skip sessions with zero tokens
  filtered = filtered.filter(r => r.totalTokens > 0);

  // Get already-published sessions
  const published = options.force ? new Set<string>() : getPublishedSessions(repoPath);

  let publishedCount = 0;
  let skipped = 0;

  // Find transcript files for each session
  const { homedir } = await import('node:os');
  const projectsDir = join(homedir(), '.claude', 'projects');

  for (const record of filtered) {
    if (published.has(record.sessionId)) {
      skipped++;
      continue;
    }

    // Find the transcript file
    let transcriptPath = '';
    if (existsSync(projectsDir)) {
      const { readdirSync } = await import('node:fs');
      for (const projectDir of readdirSync(projectsDir)) {
        const candidate = join(projectsDir, projectDir, `${record.sessionId}.jsonl`);
        if (existsSync(candidate)) {
          transcriptPath = candidate;
          break;
        }
      }
    }

    if (!transcriptPath) {
      skipped++;
      continue;
    }

    try {
      const markdown = await processTranscript(transcriptPath);
      if (markdown.length < 100) {
        skipped++;
        continue;
      }

      // Organize by date: YYYY-MM/session-id.md
      const date = record.startedAt ? record.startedAt.slice(0, 7) : 'unknown';
      const dir = join(repoPath, date);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const fileName = `${record.sessionId}.md`;
      writeFileSync(join(dir, fileName), markdown, 'utf-8');

      published.add(record.sessionId);
      publishedCount++;

      if (options.verbose) {
        process.stderr.write(`\r[${publishedCount}] ${record.component}/${record.sessionId.slice(0, 8)}...`);
      }
    } catch (err) {
      if (options.verbose) {
        process.stderr.write(`\nError processing ${record.sessionId}: ${err}\n`);
      }
      skipped++;
    }
  }

  if (options.verbose && publishedCount > 0) {
    process.stderr.write('\n');
  }

  // Save manifest
  saveManifest(repoPath, published);

  // Git commit and push if there are changes
  if (publishedCount > 0) {
    try {
      execFileSync('git', ['add', '-A'], { cwd: repoPath, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', `Add ${publishedCount} session logs`], {
        cwd: repoPath,
        stdio: 'pipe',
      });
      execFileSync('git', ['push'], { cwd: repoPath, stdio: 'pipe', timeout: 30000 });
    } catch (err: any) {
      // Git operations may fail if not a git repo — that's ok, files are still written
      if (options.verbose) {
        process.stderr.write(`Git push: ${err.message || err}\n`);
      }
    }
  }

  return { published: publishedCount, skipped };
}

/**
 * Get the GitHub URL for a session log.
 */
export function getSessionLogUrl(sessionId: string, startedAt: string, repoUrl: string): string {
  const date = startedAt ? startedAt.slice(0, 7) : 'unknown';
  return `${repoUrl}/blob/main/${date}/${sessionId}.md`;
}
