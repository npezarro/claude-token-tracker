import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { recordSession } from '../src/commands/record.js';

const tmpDir = join(import.meta.dirname, '.tmp-record-test');
const dataDir = join(tmpDir, 'data');

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function makeTranscript(overrides: {
  sessionId?: string;
  cwd?: string;
  turns?: number;
  startedAt?: string;
  endedAt?: string;
} = {}): string {
  const {
    sessionId = 'test-sess-1',
    cwd = '/home/user/repos/myApp',
    turns = 2,
    startedAt = '2026-03-28T10:00:00Z',
    endedAt = '2026-03-28T10:30:00Z',
  } = overrides;

  const entries: object[] = [
    { sessionId, cwd, version: '2.1.77', timestamp: startedAt },
  ];

  for (let i = 0; i < turns; i++) {
    entries.push(
      { type: 'user', message: { role: 'user', content: i === 0 ? 'Help me fix the login bug' : 'Continue' }, timestamp: startedAt },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Here is the fix',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 10 },
          model: 'claude-opus-4-6',
        },
        timestamp: endedAt,
      }
    );
  }

  return makeJsonl(entries);
}

describe('recordSession', () => {
  beforeEach(() => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(tmpDir, 'transcripts'), { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = dataDir;
    // Write empty config so loadConfig doesn't fail
    writeFileSync(join(dataDir, 'config.json'), JSON.stringify({
      components: {},
      defaultComponent: 'unknown',
    }));
    // Start with empty usage log
    writeFileSync(join(dataDir, 'usage.jsonl'), '');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  it('returns null when transcript_path is not provided', async () => {
    const result = await recordSession({});
    expect(result).toBeNull();
  });

  it('returns null when transcript_path does not exist', async () => {
    const result = await recordSession({ transcript_path: join(tmpDir, 'nonexistent.jsonl') });
    expect(result).toBeNull();
  });

  it('returns null when transcript has no assistant turns', async () => {
    const file = join(tmpDir, 'transcripts', 'empty.jsonl');
    writeFileSync(file, makeJsonl([
      { sessionId: 'empty-sess', cwd: '/test', version: '1.0', timestamp: '2026-01-01T00:00:00Z' },
    ]));

    const result = await recordSession({ transcript_path: file });
    expect(result).toBeNull();
  });

  it('records a valid session and returns UsageRecord', async () => {
    const file = join(tmpDir, 'transcripts', 'valid.jsonl');
    writeFileSync(file, makeTranscript({ sessionId: 'sess-valid' }));

    const result = await recordSession({ transcript_path: file, session_id: 'sess-valid' });
    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('sess-valid');
    expect(result!.inputTokens).toBe(200); // 100 * 2 turns
    expect(result!.outputTokens).toBe(100); // 50 * 2 turns
    expect(result!.turnCount).toBe(2);
    expect(result!.model).toBe('claude-opus-4-6');
  });

  it('uses transcript sessionId over input session_id', async () => {
    const file = join(tmpDir, 'transcripts', 'meta.jsonl');
    writeFileSync(file, makeTranscript({ sessionId: 'from-transcript' }));

    const result = await recordSession({ transcript_path: file, session_id: 'from-input' });
    expect(result!.sessionId).toBe('from-transcript');
  });

  it('falls back to input session_id when transcript has none', async () => {
    const file = join(tmpDir, 'transcripts', 'no-sid.jsonl');
    const entries = [
      { cwd: '/test', version: '1.0', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'test' }, timestamp: '2026-01-01T00:01:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'ok', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, model: 'opus' }, timestamp: '2026-01-01T00:02:00Z' },
    ];
    writeFileSync(file, makeJsonl(entries));

    const result = await recordSession({ transcript_path: file, session_id: 'fallback-id' });
    expect(result!.sessionId).toBe('fallback-id');
  });

  it('skips duplicate sessions', async () => {
    const file = join(tmpDir, 'transcripts', 'dup.jsonl');
    writeFileSync(file, makeTranscript({ sessionId: 'dup-sess' }));

    // Record once
    const first = await recordSession({ transcript_path: file, session_id: 'dup-sess' });
    expect(first).not.toBeNull();

    // Try recording same session again
    const second = await recordSession({ transcript_path: file, session_id: 'dup-sess' });
    expect(second).toBeNull();
  });

  it('appends record to usage log file', async () => {
    const file = join(tmpDir, 'transcripts', 'log.jsonl');
    writeFileSync(file, makeTranscript({ sessionId: 'log-sess' }));

    await recordSession({ transcript_path: file, session_id: 'log-sess' });

    const logContent = readFileSync(join(dataDir, 'usage.jsonl'), 'utf-8');
    expect(logContent).toContain('log-sess');
  });

  it('uses hook cwd when transcript has none', async () => {
    const file = join(tmpDir, 'transcripts', 'no-cwd.jsonl');
    const entries = [
      { sessionId: 'no-cwd-sess', version: '1.0', timestamp: '2026-01-01T00:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'test' }, timestamp: '2026-01-01T00:01:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: 'ok', usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, model: 'opus' }, timestamp: '2026-01-01T00:02:00Z' },
    ];
    writeFileSync(file, makeJsonl(entries));

    const result = await recordSession({ transcript_path: file, cwd: '/fallback/path' });
    expect(result!.cwd).toBe('/fallback/path');
  });

  it('captures first user prompt as label', async () => {
    const file = join(tmpDir, 'transcripts', 'label.jsonl');
    writeFileSync(file, makeTranscript({ sessionId: 'label-sess' }));

    const result = await recordSession({ transcript_path: file });
    expect(result!.label).toContain('Help me fix the login bug');
  });

  it('calculates duration from timestamps', async () => {
    const file = join(tmpDir, 'transcripts', 'dur.jsonl');
    writeFileSync(file, makeTranscript({
      sessionId: 'dur-sess',
      startedAt: '2026-03-28T10:00:00Z',
      endedAt: '2026-03-28T10:45:00Z',
    }));

    const result = await recordSession({ transcript_path: file });
    expect(result!.durationMinutes).toBe(45);
  });

  it('duration is non-negative even with equal timestamps', async () => {
    const file = join(tmpDir, 'transcripts', 'zero-dur.jsonl');
    writeFileSync(file, makeTranscript({
      sessionId: 'zero-dur',
      startedAt: '2026-03-28T10:00:00Z',
      endedAt: '2026-03-28T10:00:00Z',
    }));

    const result = await recordSession({ transcript_path: file });
    expect(result!.durationMinutes).toBeGreaterThanOrEqual(0);
  });
});
