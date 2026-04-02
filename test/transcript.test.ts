import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { parseTranscript } from '../src/parser/transcript.js';

const tmpDir = join(import.meta.dirname, '.tmp-transcript-test');

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

describe('parseTranscript', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses session metadata from first entry', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { sessionId: 'sess-123', cwd: '/home/user/repos/app', version: '1.0.0', timestamp: '2026-01-01T00:00:00Z' },
    ]));

    const result = await parseTranscript(file);
    expect(result.sessionId).toBe('sess-123');
    expect(result.cwd).toBe('/home/user/repos/app');
    expect(result.version).toBe('1.0.0');
  });

  it('sums token usage from assistant turns', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { timestamp: '2026-01-01T00:00:00Z' },
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:01:00Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 10 },
        },
      },
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:02:00Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 30 },
        },
      },
    ]));

    const result = await parseTranscript(file);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(130);
    expect(result.cacheCreationTokens).toBe(20);
    expect(result.cacheReadTokens).toBe(40);
    expect(result.totalTokens).toBe(300 + 130 + 20); // input + output + cacheCreation
    expect(result.turnCount).toBe(2);
  });

  it('captures model from first assistant turn', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      {
        type: 'assistant',
        message: { model: 'claude-opus-4-6', usage: { input_tokens: 10, output_tokens: 5 } },
      },
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ]));

    const result = await parseTranscript(file);
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('captures first user prompt as label', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { type: 'user', message: { role: 'user', content: 'Fix the login bug in auth.ts' } },
      { type: 'user', message: { role: 'user', content: 'Also update the tests' } },
    ]));

    const result = await parseTranscript(file);
    expect(result.firstPrompt).toBe('Fix the login bug in auth.ts');
  });

  it('truncates long user prompts to 100 chars', async () => {
    const file = join(tmpDir, 'session.jsonl');
    const longPrompt = 'x'.repeat(200);
    writeFileSync(file, makeJsonl([
      { type: 'user', message: { role: 'user', content: longPrompt } },
    ]));

    const result = await parseTranscript(file);
    expect(result.firstPrompt).toHaveLength(100);
  });

  it('skips very short user prompts (≤3 chars)', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { type: 'user', message: { role: 'user', content: 'hi' } },
      { type: 'user', message: { role: 'user', content: 'Please fix the test suite' } },
    ]));

    const result = await parseTranscript(file);
    expect(result.firstPrompt).toBe('Please fix the test suite');
  });

  it('collapses whitespace in user prompts', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { type: 'user', message: { role: 'user', content: 'Fix  the\n  login   bug' } },
    ]));

    const result = await parseTranscript(file);
    expect(result.firstPrompt).toBe('Fix the login bug');
  });

  it('captures git branch from metadata', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { gitBranch: 'feature/login', timestamp: '2026-01-01T00:00:00Z' },
    ]));

    const result = await parseTranscript(file);
    expect(result.gitBranch).toBe('feature/login');
  });

  it('captures userType from metadata', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { userType: 'max', timestamp: '2026-01-01T00:00:00Z' },
    ]));

    const result = await parseTranscript(file);
    expect(result.userType).toBe('max');
  });

  it('tracks startedAt and endedAt from timestamps', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { timestamp: '2026-01-01T10:00:00Z' },
      { timestamp: '2026-01-01T10:05:00Z' },
      { timestamp: '2026-01-01T10:15:00Z' },
    ]));

    const result = await parseTranscript(file);
    expect(result.startedAt).toBe('2026-01-01T10:00:00Z');
    expect(result.endedAt).toBe('2026-01-01T10:15:00Z');
  });

  it('handles empty file gracefully', async () => {
    const file = join(tmpDir, 'empty.jsonl');
    writeFileSync(file, '');

    const result = await parseTranscript(file);
    expect(result.sessionId).toBe('');
    expect(result.inputTokens).toBe(0);
    expect(result.turnCount).toBe(0);
  });

  it('skips malformed JSON lines', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, 'not valid json\n' + JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 50, output_tokens: 25 } },
    }) + '\n');

    const result = await parseTranscript(file);
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(25);
    expect(result.turnCount).toBe(1);
  });

  it('handles assistant turns with missing usage fields', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } },
      },
    ]));

    const result = await parseTranscript(file);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
  });

  it('ignores non-assistant entries for token counting', async () => {
    const file = join(tmpDir, 'session.jsonl');
    writeFileSync(file, makeJsonl([
      { type: 'user', message: { role: 'user', content: 'hello there' } },
      { type: 'system', message: { content: 'system info' } },
      {
        type: 'assistant',
        message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50 } },
      },
    ]));

    const result = await parseTranscript(file);
    expect(result.turnCount).toBe(1);
    expect(result.inputTokens).toBe(100);
  });
});
