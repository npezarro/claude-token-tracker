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

  it('should group by day', async () => {
    const records = [
      makeRecord({ startedAt: '2026-03-28T10:00:00.000Z', totalTokens: 1000 }),
      makeRecord({ startedAt: '2026-03-28T14:00:00.000Z', totalTokens: 2000 }),
      makeRecord({ startedAt: '2026-03-29T10:00:00.000Z', totalTokens: 500 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'day' });
    expect(output).toContain('2026-03-28');
    expect(output).toContain('2026-03-29');
  });

  it('should group by model', async () => {
    const records = [
      makeRecord({ model: 'claude-opus-4-6', totalTokens: 5000 }),
      makeRecord({ model: 'claude-sonnet-4-6', totalTokens: 3000 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'model' });
    expect(output).toContain('claude-opus-4-6');
    expect(output).toContain('claude-sonnet-4-6');
  });

  it('should group by session', async () => {
    const records = [
      makeRecord({ label: 'Fix auth bug', totalTokens: 1000 }),
      makeRecord({ label: 'Add tests', totalTokens: 2000 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'session' });
    expect(output).toContain('Fix auth bug');
    expect(output).toContain('Add tests');
  });

  it('should filter by since date', async () => {
    const records = [
      makeRecord({ sessionId: 'old', startedAt: '2026-03-01T10:00:00.000Z' }),
      makeRecord({ sessionId: 'new', startedAt: '2026-03-28T10:00:00.000Z' }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ since: '2026-03-15' });
    // Only the new session should contribute
    expect(output).toContain('Total');
    expect(output).toContain('1'); // 1 session
  });

  it('should filter by until date', async () => {
    const records = [
      makeRecord({ startedAt: '2026-03-01T10:00:00.000Z', component: 'early' }),
      makeRecord({ startedAt: '2026-03-28T10:00:00.000Z', component: 'late' }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ until: '2026-03-15' });
    expect(output).toContain('early');
    expect(output).not.toContain('late');
  });

  it('should sort rows by total tokens descending', async () => {
    const records = [
      makeRecord({ component: 'small', totalTokens: 100 }),
      makeRecord({ component: 'large', totalTokens: 10000 }),
      makeRecord({ component: 'medium', totalTokens: 5000 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'component' });
    const largeIdx = output.indexOf('large');
    const mediumIdx = output.indexOf('medium');
    const smallIdx = output.indexOf('small');
    // large should appear before medium, medium before small
    expect(largeIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(smallIdx);
  });

  it('should show period date range', async () => {
    const records = [
      makeRecord({ startedAt: '2026-03-20T10:00:00.000Z' }),
      makeRecord({ startedAt: '2026-03-28T10:00:00.000Z' }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report();
    expect(output).toContain('Period: 2026-03-20 to 2026-03-28');
  });

  it('should show session detail for component grouping', async () => {
    const records = [
      makeRecord({ component: 'myProject', label: 'Fix login flow', totalTokens: 5000, turnCount: 10 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ groupBy: 'component' });
    expect(output).toContain('Session Detail');
    expect(output).toContain('myProject');
    expect(output).toContain('Fix login flow');
  });

  it('should hide session detail when hideSessions is true', async () => {
    const records = [makeRecord({ label: 'Should not appear' })];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ hideSessions: true });
    expect(output).not.toContain('Session Detail');
  });

  it('should show subagent summary when includeSubagents is true', async () => {
    const records = [makeRecord({
      subagents: [
        { agentId: 'a1', agentType: 'Explore', description: '', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, turnCount: 1, model: 'opus' },
        { agentId: 'a2', agentType: 'Explore', description: '', inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 300, turnCount: 2, model: 'opus' },
        { agentId: 'a3', agentType: 'Plan', description: '', inputTokens: 50, outputTokens: 25, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 75, turnCount: 1, model: 'opus' },
      ],
    })];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ includeSubagents: true });
    expect(output).toContain('Subagents: 3 total');
    expect(output).toContain('Explore: 2 agents');
    expect(output).toContain('Plan: 1 agents');
  });

  it('should not show subagent section when includeSubagents is false', async () => {
    const records = [makeRecord({
      subagents: [
        { agentId: 'a1', agentType: 'Explore', description: '', inputTokens: 100, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 150, turnCount: 1, model: 'opus' },
      ],
    })];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report();
    expect(output).not.toContain('Subagents:');
  });

  it('should limit session detail to topN', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord({ component: 'proj', label: `Session ${i}`, totalTokens: (10 - i) * 1000 })
    );
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ topN: 3 });
    expect(output).toContain('Session 0'); // highest tokens
    expect(output).toContain('Session 1');
    expect(output).toContain('Session 2');
    expect(output).toContain('+7 more sessions');
  });

  it('should format large token values with K/M suffixes', async () => {
    const records = [
      makeRecord({ component: 'bigProject', totalTokens: 1_500_000, inputTokens: 1_000_000, outputTokens: 500_000, cacheCreationTokens: 250_000 }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report();
    expect(output).toMatch(/1\.5M/); // totalTokens
    expect(output).toMatch(/1\.0M/); // inputTokens
  });

  it('should handle component filter case insensitively', async () => {
    const records = [
      makeRecord({ component: 'MyProject' }),
      makeRecord({ component: 'other' }),
    ];
    writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');

    const output = await report({ component: 'myproject' });
    expect(output).toContain('MyProject');
    expect(output).not.toContain('other');
  });
});
