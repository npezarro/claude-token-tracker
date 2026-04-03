import { readUsageLog } from '../storage/usage-log.js';
import { estimateCost, formatCost } from '../pricing.js';
import type { UsageRecord } from '../storage/types.js';

type GroupBy = 'component' | 'day' | 'session' | 'model';

interface ReportOptions {
  groupBy?: GroupBy;
  since?: string;
  until?: string;
  component?: string;
  includeSubagents?: boolean;
  hideSessions?: boolean;
  topN?: number; // limit per-session detail to top N per component
}

function estimateRecordCost(r: UsageRecord): number {
  return estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens).totalCost;
}

interface ReportRow {
  label: string;
  sessions: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  durationMinutes: number;
  estimatedCost: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : ' '.repeat(len - s.length) + s;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function formatDuration(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

export async function report(options: ReportOptions = {}): Promise<string> {
  const { groupBy = 'component', since, until, component, includeSubagents, hideSessions, topN = 5 } = options;

  let records = await readUsageLog();

  // Apply filters
  if (since) {
    const sinceDate = new Date(since);
    records = records.filter(r => new Date(r.startedAt) >= sinceDate);
  }
  if (until) {
    const untilDate = new Date(until);
    records = records.filter(r => new Date(r.startedAt) <= untilDate);
  }
  if (component) {
    records = records.filter(r => r.component.toLowerCase() === component.toLowerCase());
  }

  if (records.length === 0) {
    return 'No usage records found for the specified filters.';
  }

  // Group records
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    let key: string;
    switch (groupBy) {
      case 'component':
        key = record.component;
        break;
      case 'day':
        key = record.startedAt ? record.startedAt.slice(0, 10) : 'unknown';
        break;
      case 'session':
        key = record.label || `${record.component}/${record.sessionId.slice(0, 8)}`;
        break;
      case 'model':
        key = record.model || 'unknown';
        break;
      default:
        key = record.component;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(record);
  }

  // Build rows
  const rows: ReportRow[] = [];
  for (const [label, recs] of groups) {
    rows.push({
      label,
      sessions: recs.length,
      turns: recs.reduce((s, r) => s + r.turnCount, 0),
      inputTokens: recs.reduce((s, r) => s + r.inputTokens, 0),
      outputTokens: recs.reduce((s, r) => s + r.outputTokens, 0),
      cacheCreationTokens: recs.reduce((s, r) => s + r.cacheCreationTokens, 0),
      cacheReadTokens: recs.reduce((s, r) => s + r.cacheReadTokens, 0),
      totalTokens: recs.reduce((s, r) => s + r.totalTokens, 0),
      durationMinutes: recs.reduce((s, r) => s + r.durationMinutes, 0),
      estimatedCost: recs.reduce((s, r) => s + estimateRecordCost(r), 0),
    });
  }

  // Sort by total tokens descending
  rows.sort((a, b) => b.totalTokens - a.totalTokens);

  // Calculate totals
  const totals: ReportRow = {
    label: 'Total',
    sessions: rows.reduce((s, r) => s + r.sessions, 0),
    turns: rows.reduce((s, r) => s + r.turns, 0),
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    cacheCreationTokens: rows.reduce((s, r) => s + r.cacheCreationTokens, 0),
    cacheReadTokens: rows.reduce((s, r) => s + r.cacheReadTokens, 0),
    totalTokens: rows.reduce((s, r) => s + r.totalTokens, 0),
    durationMinutes: rows.reduce((s, r) => s + r.durationMinutes, 0),
    estimatedCost: rows.reduce((s, r) => s + r.estimatedCost, 0),
  };

  // Render summary table
  const maxLabel = Math.max(20, ...rows.map(r => r.label.length));
  const header = [
    padRight(groupBy.charAt(0).toUpperCase() + groupBy.slice(1), maxLabel),
    padLeft('Sessions', 10),
    padLeft('Turns', 8),
    padLeft('Input', 10),
    padLeft('Output', 10),
    padLeft('Cache-W', 10),
    padLeft('Total', 12),
    padLeft('Est. Cost', 10),
  ].join('  ');

  const separator = '-'.repeat(header.length);
  const lines = [header, separator];

  for (const row of rows) {
    lines.push([
      padRight(row.label, maxLabel),
      padLeft(row.sessions.toString(), 10),
      padLeft(row.turns.toString(), 8),
      padLeft(formatTokens(row.inputTokens), 10),
      padLeft(formatTokens(row.outputTokens), 10),
      padLeft(formatTokens(row.cacheCreationTokens), 10),
      padLeft(formatTokens(row.totalTokens), 12),
      padLeft(formatCost(row.estimatedCost), 10),
    ].join('  '));
  }

  lines.push(separator);
  lines.push([
    padRight(totals.label, maxLabel),
    padLeft(totals.sessions.toString(), 10),
    padLeft(totals.turns.toString(), 8),
    padLeft(formatTokens(totals.inputTokens), 10),
    padLeft(formatTokens(totals.outputTokens), 10),
    padLeft(formatTokens(totals.cacheCreationTokens), 10),
    padLeft(formatTokens(totals.totalTokens), 12),
    padLeft(formatCost(totals.estimatedCost), 10),
  ].join('  '));

  // Date range
  const dates = records.map(r => r.startedAt).filter(Boolean).sort();
  if (dates.length > 0) {
    lines.push('');
    lines.push(`Period: ${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)}`);
  }

  // Per-session detail (default for component grouping)
  if (!hideSessions && groupBy === 'component') {
    lines.push('');
    lines.push('Session Detail');
    lines.push(separator);

    for (const [componentName, recs] of [...groups.entries()].sort(
      (a, b) => b[1].reduce((s, r) => s + r.totalTokens, 0) - a[1].reduce((s, r) => s + r.totalTokens, 0)
    )) {
      // Sort sessions within component by tokens descending
      const sorted = [...recs].sort((a, b) => b.totalTokens - a.totalTokens);
      const shown = sorted.slice(0, topN);
      const remaining = sorted.length - shown.length;

      lines.push('');
      lines.push(`  ${componentName} (${recs.length} sessions)`);

      for (const s of shown) {
        const label = truncate(s.label || s.sessionId.slice(0, 8), 48);
        const time = s.startedAt ? s.startedAt.slice(5, 16).replace('T', ' ') : '';
        const dur = formatDuration(s.durationMinutes);
        const cost = formatCost(estimateRecordCost(s));
        lines.push(
          `    ${padRight(label, 50)} ${padLeft(formatTokens(s.totalTokens), 8)}  ${padLeft(cost, 8)}  ${padLeft(String(s.turnCount), 4)} turns  ${padLeft(dur, 6)}  ${time}`
        );
      }

      if (remaining > 0) {
        const remainingTokens = sorted.slice(topN).reduce((s, r) => s + r.totalTokens, 0);
        lines.push(`    ... +${remaining} more sessions (${formatTokens(remainingTokens)} tokens)`);
      }
    }
  }

  // Subagent summary
  if (includeSubagents) {
    const allSubagents = records.flatMap(r => r.subagents || []);
    if (allSubagents.length > 0) {
      lines.push('');
      lines.push(`Subagents: ${allSubagents.length} total across ${records.filter(r => r.subagents?.length > 0).length} sessions`);

      const byType = new Map<string, { count: number; totalTokens: number }>();
      for (const sa of allSubagents) {
        const key = sa.agentType || 'unknown';
        const entry = byType.get(key) || { count: 0, totalTokens: 0 };
        entry.count++;
        entry.totalTokens += sa.totalTokens;
        byType.set(key, entry);
      }

      for (const [type, data] of [...byType.entries()].sort((a, b) => b[1].totalTokens - a[1].totalTokens)) {
        lines.push(`  ${type}: ${data.count} agents, ${formatTokens(data.totalTokens)} tokens`);
      }
    }
  }

  return lines.join('\n');
}
