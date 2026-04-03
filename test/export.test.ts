import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { exportData } from '../src/commands/export.js';
import type { UsageRecord } from '../src/storage/types.js';

const tmpDir = join(import.meta.dirname, '.tmp-export-test');

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

function writeRecords(records: UsageRecord[]): void {
  writeFileSync(join(tmpDir, 'usage.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n');
}

describe('exportData', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  it('exports empty array as JSON when no records', async () => {
    writeFileSync(join(tmpDir, 'usage.jsonl'), '');
    const result = await exportData({ format: 'json' });
    expect(JSON.parse(result)).toEqual([]);
  });

  it('exports records as JSON by default', async () => {
    const records = [makeRecord({ sessionId: 'sess-1' }), makeRecord({ sessionId: 'sess-2' })];
    writeRecords(records);

    const result = await exportData();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].sessionId).toBe('sess-1');
    expect(parsed[1].sessionId).toBe('sess-2');
  });

  it('exports records as CSV', async () => {
    const records = [makeRecord({ sessionId: 'sess-csv', component: 'myApp', inputTokens: 999 })];
    writeRecords(records);

    const result = await exportData({ format: 'csv' });
    const lines = result.split('\n');
    expect(lines[0]).toContain('sessionId');
    expect(lines[0]).toContain('component');
    expect(lines[0]).toContain('inputTokens');
    expect(lines[1]).toContain('sess-csv');
    expect(lines[1]).toContain('myApp');
    expect(lines[1]).toContain('999');
  });

  it('CSV escapes values containing commas', async () => {
    const records = [makeRecord({ label: 'fix auth, add tests' })];
    writeRecords(records);

    const result = await exportData({ format: 'csv' });
    expect(result).toContain('"fix auth, add tests"');
  });

  it('CSV escapes values containing double quotes', async () => {
    const records = [makeRecord({ label: 'fix "auth" bug' })];
    writeRecords(records);

    const result = await exportData({ format: 'csv' });
    expect(result).toContain('"fix ""auth"" bug"');
  });

  it('CSV escapes values containing newlines', async () => {
    const records = [makeRecord({ label: 'line1\nline2' })];
    writeRecords(records);

    const result = await exportData({ format: 'csv' });
    expect(result).toContain('"line1\nline2"');
  });

  it('filters by since date', async () => {
    const records = [
      makeRecord({ sessionId: 'old', startedAt: '2026-03-01T10:00:00.000Z' }),
      makeRecord({ sessionId: 'new', startedAt: '2026-03-28T10:00:00.000Z' }),
    ];
    writeRecords(records);

    const result = await exportData({ since: '2026-03-15' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe('new');
  });

  it('filters by until date', async () => {
    const records = [
      makeRecord({ sessionId: 'early', startedAt: '2026-03-01T10:00:00.000Z' }),
      makeRecord({ sessionId: 'late', startedAt: '2026-03-28T10:00:00.000Z' }),
    ];
    writeRecords(records);

    const result = await exportData({ until: '2026-03-15' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe('early');
  });

  it('filters by component (case insensitive)', async () => {
    const records = [
      makeRecord({ sessionId: 'a', component: 'ProjectA' }),
      makeRecord({ sessionId: 'b', component: 'projectB' }),
    ];
    writeRecords(records);

    const result = await exportData({ component: 'projecta' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe('a');
  });

  it('combines multiple filters', async () => {
    const records = [
      makeRecord({ sessionId: 'match', component: 'myApp', startedAt: '2026-03-20T10:00:00.000Z' }),
      makeRecord({ sessionId: 'wrong-component', component: 'other', startedAt: '2026-03-20T10:00:00.000Z' }),
      makeRecord({ sessionId: 'too-old', component: 'myApp', startedAt: '2026-03-01T10:00:00.000Z' }),
    ];
    writeRecords(records);

    const result = await exportData({ component: 'myApp', since: '2026-03-15' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe('match');
  });

  it('writes to output file and returns message', async () => {
    const records = [makeRecord()];
    writeRecords(records);
    const outFile = join(tmpDir, 'output.json');

    const result = await exportData({ output: outFile });
    expect(result).toContain('Exported 1 records');
    expect(result).toContain(outFile);

    const fileContent = readFileSync(outFile, 'utf-8');
    const parsed = JSON.parse(fileContent);
    expect(parsed).toHaveLength(1);
  });

  it('writes CSV to output file', async () => {
    const records = [makeRecord({ sessionId: 'file-csv' })];
    writeRecords(records);
    const outFile = join(tmpDir, 'output.csv');

    await exportData({ format: 'csv', output: outFile });

    const fileContent = readFileSync(outFile, 'utf-8');
    expect(fileContent.split('\n')[0]).toContain('sessionId');
    expect(fileContent).toContain('file-csv');
  });

  it('CSV header has expected columns', async () => {
    writeRecords([makeRecord()]);

    const result = await exportData({ format: 'csv' });
    const header = result.split('\n')[0];
    const expectedCols = [
      'sessionId', 'label', 'component', 'cwd', 'repo', 'gitBranch',
      'startedAt', 'endedAt', 'durationMinutes',
      'inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'totalTokens',
      'model', 'claudeCodeVersion', 'turnCount', 'subagentCount',
    ];
    for (const col of expectedCols) {
      expect(header).toContain(col);
    }
  });

  it('CSV subagentCount reflects array length', async () => {
    const records = [makeRecord({
      subagents: [
        { agentId: 'a1', agentType: 'Explore', description: '', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15, turnCount: 1, model: 'opus' },
        { agentId: 'a2', agentType: 'Plan', description: '', inputTokens: 20, outputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 30, turnCount: 2, model: 'opus' },
      ],
    })];
    writeRecords(records);

    const result = await exportData({ format: 'csv' });
    const dataRow = result.split('\n')[1];
    // subagentCount is second-to-last column (estimatedCostUsd is last)
    expect(dataRow).toMatch(/,2,/);
  });
});
