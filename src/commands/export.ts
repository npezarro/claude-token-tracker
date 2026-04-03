import { readUsageLog } from '../storage/usage-log.js';
import { estimateCost } from '../pricing.js';
import { writeFile } from 'node:fs/promises';

interface ExportOptions {
  format?: 'json' | 'csv';
  output?: string;
  since?: string;
  until?: string;
  component?: string;
}

export async function exportData(options: ExportOptions = {}): Promise<string> {
  const { format = 'json', output, since, until, component } = options;

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

  let content: string;

  if (format === 'csv') {
    const headers = [
      'sessionId', 'label', 'component', 'cwd', 'repo', 'gitBranch',
      'startedAt', 'endedAt', 'durationMinutes',
      'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'totalTokens',
      'model', 'claudeCodeVersion', 'turnCount', 'subagentCount', 'estimatedCostUsd',
    ];
    const rows = records.map(r => {
      const cost = estimateCost(r.model, r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens);
      return [
      r.sessionId, r.label || '', r.component, r.cwd, r.repo || '', r.gitBranch || '',
      r.startedAt, r.endedAt, r.durationMinutes,
      r.inputTokens, r.outputTokens, r.cacheCreationTokens, r.cacheReadTokens, r.totalTokens,
      r.model, r.claudeCodeVersion, r.turnCount, r.subagents?.length || 0, cost.totalCost.toFixed(4),
    ];}).map(row => row.map(v => {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(','));

    content = [headers.join(','), ...rows].join('\n');
  } else {
    content = JSON.stringify(records, null, 2);
  }

  if (output) {
    await writeFile(output, content, 'utf-8');
    return `Exported ${records.length} records to ${output}`;
  }

  return content;
}
