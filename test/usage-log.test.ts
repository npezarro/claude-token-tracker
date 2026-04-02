import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  getDataDir,
  getUsageLogPath,
  appendUsageRecord,
  readUsageLog,
  getLoggedSessionIds,
} from '../src/storage/usage-log.js';
import type { UsageRecord } from '../src/storage/types.js';

const tmpDir = join(import.meta.dirname, '.tmp-usage-log-test');

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

describe('usage-log', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  describe('getDataDir', () => {
    it('should return CLAUDE_TRACKER_DATA_DIR when set', () => {
      expect(getDataDir()).toBe(tmpDir);
    });

    it('should fall back to ~/.claude-token-tracker when env not set', () => {
      delete process.env.CLAUDE_TRACKER_DATA_DIR;
      const result = getDataDir();
      expect(result).toContain('.claude-token-tracker');
    });
  });

  describe('getUsageLogPath', () => {
    it('should return usage.jsonl inside data dir', () => {
      expect(getUsageLogPath()).toBe(join(tmpDir, 'usage.jsonl'));
    });
  });

  describe('appendUsageRecord', () => {
    it('should create file and append a record', async () => {
      const record = makeRecord({ sessionId: 'append-test-1' });
      await appendUsageRecord(record);

      const content = await readFile(join(tmpDir, 'usage.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.sessionId).toBe('append-test-1');
    });

    it('should append multiple records on separate lines', async () => {
      await appendUsageRecord(makeRecord({ sessionId: 'multi-1' }));
      await appendUsageRecord(makeRecord({ sessionId: 'multi-2' }));
      await appendUsageRecord(makeRecord({ sessionId: 'multi-3' }));

      const content = await readFile(join(tmpDir, 'usage.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).sessionId).toBe('multi-1');
      expect(JSON.parse(lines[2]).sessionId).toBe('multi-3');
    });

    it('should create parent directories if they do not exist', async () => {
      rmSync(tmpDir, { recursive: true, force: true });
      const nestedDir = join(tmpDir, 'nested', 'deep');
      process.env.CLAUDE_TRACKER_DATA_DIR = nestedDir;

      await appendUsageRecord(makeRecord({ sessionId: 'nested-test' }));
      expect(existsSync(join(nestedDir, 'usage.jsonl'))).toBe(true);
    });
  });

  describe('readUsageLog', () => {
    it('should return empty array when file does not exist', async () => {
      rmSync(join(tmpDir, 'usage.jsonl'), { force: true });
      const records = await readUsageLog();
      expect(records).toEqual([]);
    });

    it('should return empty array for empty file', async () => {
      writeFileSync(join(tmpDir, 'usage.jsonl'), '');
      const records = await readUsageLog();
      expect(records).toEqual([]);
    });

    it('should parse valid JSONL records', async () => {
      const r1 = makeRecord({ sessionId: 'read-1', inputTokens: 100 });
      const r2 = makeRecord({ sessionId: 'read-2', inputTokens: 200 });
      writeFileSync(
        join(tmpDir, 'usage.jsonl'),
        [JSON.stringify(r1), JSON.stringify(r2)].join('\n') + '\n'
      );

      const records = await readUsageLog();
      expect(records).toHaveLength(2);
      expect(records[0].sessionId).toBe('read-1');
      expect(records[0].inputTokens).toBe(100);
      expect(records[1].sessionId).toBe('read-2');
    });

    it('should skip malformed JSON lines', async () => {
      const valid = makeRecord({ sessionId: 'valid-line' });
      writeFileSync(
        join(tmpDir, 'usage.jsonl'),
        [JSON.stringify(valid), 'not json', '', '{"broken: true'].join('\n') + '\n'
      );

      const records = await readUsageLog();
      expect(records).toHaveLength(1);
      expect(records[0].sessionId).toBe('valid-line');
    });

    it('should preserve all record fields', async () => {
      const record = makeRecord({
        sessionId: 'full-fields',
        label: 'My Label',
        component: 'myComponent',
        repo: 'myRepo',
        gitBranch: 'feature/test',
        inputTokens: 999,
        outputTokens: 111,
        cacheCreationTokens: 222,
        cacheReadTokens: 333,
        totalTokens: 1332,
        turnCount: 7,
        subagents: [
          {
            agentId: 'sub-1',
            agentType: 'Explore',
            description: 'test sub',
            inputTokens: 50,
            outputTokens: 10,
            cacheCreationTokens: 20,
            cacheReadTokens: 30,
            totalTokens: 80,
            turnCount: 1,
            model: 'claude-haiku-4-5-20251001',
          },
        ],
      });
      writeFileSync(join(tmpDir, 'usage.jsonl'), JSON.stringify(record) + '\n');

      const records = await readUsageLog();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });
  });

  describe('getLoggedSessionIds', () => {
    it('should return empty set when no log exists', async () => {
      const ids = await getLoggedSessionIds();
      expect(ids.size).toBe(0);
    });

    it('should return set of all session IDs', async () => {
      const records = [
        makeRecord({ sessionId: 'session-a' }),
        makeRecord({ sessionId: 'session-b' }),
        makeRecord({ sessionId: 'session-c' }),
      ];
      writeFileSync(
        join(tmpDir, 'usage.jsonl'),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      );

      const ids = await getLoggedSessionIds();
      expect(ids.size).toBe(3);
      expect(ids.has('session-a')).toBe(true);
      expect(ids.has('session-b')).toBe(true);
      expect(ids.has('session-c')).toBe(true);
    });

    it('should handle duplicate session IDs', async () => {
      const records = [
        makeRecord({ sessionId: 'dup-session' }),
        makeRecord({ sessionId: 'dup-session' }),
        makeRecord({ sessionId: 'unique-session' }),
      ];
      writeFileSync(
        join(tmpDir, 'usage.jsonl'),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      );

      const ids = await getLoggedSessionIds();
      expect(ids.size).toBe(2);
      expect(ids.has('dup-session')).toBe(true);
      expect(ids.has('unique-session')).toBe(true);
    });
  });
});
