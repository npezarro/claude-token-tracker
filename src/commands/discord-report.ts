import { readUsageLog } from '../storage/usage-log.js';
import type { UsageRecord } from '../storage/types.js';

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

interface ComponentSummary {
  name: string;
  sessions: number;
  turns: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  subagentCount: number;
}

function summarizeByComponent(records: UsageRecord[]): ComponentSummary[] {
  const map = new Map<string, ComponentSummary>();
  for (const r of records) {
    const existing = map.get(r.component) || {
      name: r.component,
      sessions: 0,
      turns: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      subagentCount: 0,
    };
    existing.sessions++;
    existing.turns += r.turnCount;
    existing.totalTokens += r.totalTokens;
    existing.inputTokens += r.inputTokens;
    existing.outputTokens += r.outputTokens;
    existing.cacheCreationTokens += r.cacheCreationTokens;
    existing.subagentCount += r.subagents?.length || 0;
    map.set(r.component, existing);
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

/**
 * Build the top-level summary (component table).
 */
function buildSummary(label: string, records: UsageRecord[]): string {
  if (records.length === 0) return `**${label}:** No sessions recorded.\n`;

  const components = summarizeByComponent(records);
  const totalTokens = components.reduce((s, c) => s + c.totalTokens, 0);
  const totalSessions = components.reduce((s, c) => s + c.sessions, 0);
  const totalTurns = components.reduce((s, c) => s + c.turns, 0);
  const totalSubagents = components.reduce((s, c) => s + c.subagentCount, 0);

  const lines: string[] = [];
  lines.push(`**${label}** \u2014 ${formatTokens(totalTokens)} tokens, ${totalSessions} sessions, ${totalTurns} turns`);
  lines.push('```');

  const maxName = Math.max(16, ...components.map(c => c.name.length));

  for (const c of components) {
    const pct = totalTokens > 0 ? Math.round((c.totalTokens / totalTokens) * 100) : 0;
    const bar = '\u2588'.repeat(Math.max(1, Math.round(pct / 5)));
    lines.push(
      `${c.name.padEnd(maxName)}  ${formatTokens(c.totalTokens).padStart(8)}  ${String(c.sessions).padStart(4)} sess  ${bar} ${pct}%`
    );
  }

  lines.push('```');

  if (totalSubagents > 0) {
    lines.push(`_${totalSubagents} subagents spawned across ${components.filter(c => c.subagentCount > 0).length} components_`);
  }

  return lines.join('\n');
}

/**
 * Build the per-session detail for all components (all sessions, no truncation).
 */
function buildSessionDetail(label: string, records: UsageRecord[]): string {
  if (records.length === 0) return '';

  const byComponent = new Map<string, UsageRecord[]>();
  for (const r of records) {
    if (!byComponent.has(r.component)) byComponent.set(r.component, []);
    byComponent.get(r.component)!.push(r);
  }

  const components = summarizeByComponent(records);
  const lines: string[] = [];
  lines.push(`**${label} \u2014 Session Detail**`);

  for (const comp of components) {
    const sessions = byComponent.get(comp.name) || [];
    const sorted = [...sessions]
      .filter(s => s.totalTokens > 0)
      .sort((a, b) => b.totalTokens - a.totalTokens);
    if (sorted.length === 0) continue;

    lines.push('');
    lines.push(`__${comp.name}__ (${sorted.length} sessions, ${formatTokens(comp.totalTokens)} total)`);

    for (const s of sorted) {
      const sessionLabel = truncate(s.label || s.sessionId.slice(0, 8), 65);
      const time = s.startedAt ? s.startedAt.slice(5, 16).replace('T', ' ') : '';
      lines.push(`\u2003\u2022 \`${formatTokens(s.totalTokens).padStart(7)}\` ${time} \u2014 ${sessionLabel}`);
    }
  }

  return lines.join('\n');
}

const REPORT_FOOTER = `_Use \`!usage help\` for available commands_`;

export interface DiscordReportOptions {
  webhookUrl?: string;
  period?: '24h' | '7d' | 'both';
}

/**
 * Generate report as an array of chunks suitable for Discord threading.
 * First chunk is the top-level summary, subsequent chunks are session detail.
 */
export async function generateDiscordReportChunks(options: DiscordReportOptions = {}): Promise<string[]> {
  const { period = 'both' } = options;
  const records = await readUsageLog();

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const last24h = records.filter(r => r.startedAt && new Date(r.startedAt) >= oneDayAgo);
  const last7d = records.filter(r => r.startedAt && new Date(r.startedAt) >= sevenDaysAgo);

  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Build top-level summary (first message)
  const summaryParts: string[] = [];
  if (period === '24h' || period === 'both') {
    summaryParts.push(buildSummary('Last 24 hours', last24h));
  }
  if (period === '7d' || period === 'both') {
    summaryParts.push(buildSummary('Last 7 days', last7d));
  }
  summaryParts.push(`_Report generated ${timestamp}_`);
  summaryParts.push(REPORT_FOOTER);

  const chunks: string[] = [summaryParts.join('\n\n')];

  // Build session detail (threaded messages)
  if (period === '24h' || period === 'both') {
    const detail24h = buildSessionDetail('Last 24 hours', last24h);
    if (detail24h) chunks.push(detail24h);
  }
  if (period === '7d' || period === 'both') {
    const detail7d = buildSessionDetail('Last 7 days', last7d);
    if (detail7d) chunks.push(detail7d);
  }

  // Split any chunk that exceeds 2000 chars
  const finalChunks: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= 2000) {
      finalChunks.push(chunk);
    } else {
      // Split on double newlines, respecting the limit
      const parts = chunk.split('\n\n');
      let current = '';
      for (const part of parts) {
        if (current.length + part.length + 2 > 1950) {
          if (current.trim()) finalChunks.push(current.trim());
          // If a single part exceeds the limit, split on single newlines
          if (part.length > 1950) {
            const sublines = part.split('\n');
            let sub = '';
            for (const line of sublines) {
              if (sub.length + line.length + 1 > 1950) {
                if (sub.trim()) finalChunks.push(sub.trim());
                sub = line;
              } else {
                sub += (sub ? '\n' : '') + line;
              }
            }
            current = sub;
          } else {
            current = part;
          }
        } else {
          current += (current ? '\n\n' : '') + part;
        }
      }
      if (current.trim()) finalChunks.push(current.trim());
    }
  }

  return finalChunks;
}

/** Backwards-compatible: return all chunks joined (for --dry-run CLI) */
export async function generateDiscordReport(options: DiscordReportOptions = {}): Promise<string> {
  const chunks = await generateDiscordReportChunks(options);
  return chunks.join('\n\n---\n\n');
}

export async function postDiscordReport(options: DiscordReportOptions = {}): Promise<boolean> {
  let webhookUrl = options.webhookUrl || process.env.DISCORD_USAGE_WEBHOOK_URL;

  if (!webhookUrl) {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const envPath = join(homedir(), '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf-8');
      const match = envContent.match(/DISCORD_USAGE_WEBHOOK_URL=["']?([^\s"']+)/);
      if (match) webhookUrl = match[1];
    }
    if (!webhookUrl) {
      console.error('No webhook URL found. Set DISCORD_USAGE_WEBHOOK_URL or pass --webhook.');
      return false;
    }
  }

  const chunks = await generateDiscordReportChunks(options);
  if (chunks.length === 0) return false;

  // Post first chunk as top-level message
  const firstResp = await fetch(webhookUrl + '?wait=true', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Token Tracker', content: chunks[0] }),
  });

  if (!firstResp.ok) {
    console.error(`Discord webhook failed: ${firstResp.status} ${firstResp.statusText}`);
    return false;
  }

  // If there are additional chunks, thread them under the first message
  if (chunks.length > 1) {
    const firstMsg = await firstResp.json() as { id: string; channel_id: string };
    const threadUrl = `https://discord.com/api/v10/channels/${firstMsg.channel_id}/messages/${firstMsg.id}/threads`;

    // Create a thread
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');

    // Need bot token for thread creation (webhooks can't create threads)
    // Fall back to posting as separate webhook messages referencing the thread
    // Actually, webhooks can post to threads if we pass thread_id
    // But we need to create the thread first via bot token

    let botToken = '';
    const tokenPath = join(homedir(), '.cache/discord-bot-token');
    if (existsSync(tokenPath)) {
      botToken = readFileSync(tokenPath, 'utf-8').trim();
    }

    if (botToken) {
      // Create thread on the message
      const threadResp = await fetch(threadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bot ${botToken}`,
        },
        body: JSON.stringify({ name: 'Session Detail' }),
      });

      if (threadResp.ok) {
        const thread = await threadResp.json() as { id: string };

        // Post remaining chunks to the thread via webhook
        for (const chunk of chunks.slice(1)) {
          await fetch(webhookUrl + `?thread_id=${thread.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: 'Token Tracker', content: chunk }),
          });
        }
      }
    } else {
      // No bot token — fall back to separate top-level messages
      for (const chunk of chunks.slice(1)) {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'Token Tracker', content: chunk }),
        });
      }
    }
  }

  return true;
}
