import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { report } from '../src/commands/report.js';
import type { UsageRecord } from '../src/storage/types.js';

const tmpDir = join(import.meta.dirname, '.tmp-report-test');

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    sessionId: 'test-' + Math.random().toString(36).slice(2, 8),
    label: 'Test session',
    component: 'testComponent',
    cwd: '/test/path',
    repo: 'testRepo',
    gitBranch: 'main',
    startedAt: '2026-03-28T10:00:00.000Z',
    endedAt: '2026-03-28T10:30:00.000Z',
    durationMinutes: 30,
    inputTokens: 1000,
    outputTokens: 500,
    cacheCreationTokens: 2000,
    cacheReadTokens: 3000,
    totalTokens: 3500,
    model: 'claude-opus-4-6',
    claudeCodeVersion: '2.1.77',
    turnCount: 5,
    subagents: [],
    ...overrides,
  };
}

describe('report', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  it('should show "no records" when log is empty', async () => {
    writeFileSync(join(tmpDir, 'usage.jsonl'), '');
    const output = await report();
    expect(output).toContain('No usage records');
  });

  it('should group by component and show totals', async () => {
    const records = [
      makeRecord({ component: 'projectA', inputTokens: 1000, outputTokens: 200, cacheCreationTokens: 500, totalTokens: 1700, turnCount: 3 }),
      makeRecord({ component: 'projectA', inputTokens: 2000, outputTokens: 300, cacheCreationTokens: 800, totalTokens: 3100, turnCount: 5 }),
      makeRecord({ component: 'projectB', inputTokens: 500, outputTokens: 100, cacheCreationTokens: 200, totalTokens: 800, turnCount: 2 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'component' });
    expect(output).toContain('projectA');
    expect(output).toContain('projectB');
    expect(output).toContain('Total');
  });

  it('should filter by component', async () => {
    const records = [
      makeRecord({ component: 'projectA' }),
      makeRecord({ component: 'projectB' }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ component: 'projectA' });
    expect(output).toContain('projectA');
    expect(output).not.toContain('projectB');
  });
});
