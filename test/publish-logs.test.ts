import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import {
  getSessionLogUrl,
  processTranscript,
  getPublishedSessions,
  saveManifest,
  publishLogs,
} from '../src/commands/publish-logs.js';

import { tmpdir } from 'node:os';
const tmpDir = join(tmpdir(), 'publish-logs-test-' + process.pid);
const dataDir = join(tmpDir, 'data');

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

describe('getSessionLogUrl', () => {
  it('builds URL with date prefix from startedAt', () => {
    const url = getSessionLogUrl('abc123', '2026-04-15T10:30:00Z', 'https://github.com/user/logs');
    expect(url).toBe('https://github.com/user/logs/blob/main/2026-04/abc123.md');
  });

  it('uses "unknown" when startedAt is empty', () => {
    const url = getSessionLogUrl('abc123', '', 'https://github.com/user/logs');
    expect(url).toBe('https://github.com/user/logs/blob/main/unknown/abc123.md');
  });

  it('handles short startedAt gracefully', () => {
    const url = getSessionLogUrl('abc123', '2026', 'https://github.com/user/logs');
    expect(url).toBe('https://github.com/user/logs/blob/main/2026/abc123.md');
  });
});

describe('getPublishedSessions', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns empty set when manifest does not exist', () => {
    const result = getPublishedSessions(join(tmpDir, 'nonexistent'));
    expect(result.size).toBe(0);
  });

  it('returns empty set when manifest has invalid JSON', () => {
    writeFileSync(join(tmpDir, '.manifest.json'), 'not json');
    const result = getPublishedSessions(tmpDir);
    expect(result.size).toBe(0);
  });

  it('returns session IDs from manifest', () => {
    writeFileSync(join(tmpDir, '.manifest.json'), JSON.stringify({ sessions: ['sess-1', 'sess-2'] }));
    const result = getPublishedSessions(tmpDir);
    expect(result.size).toBe(2);
    expect(result.has('sess-1')).toBe(true);
    expect(result.has('sess-2')).toBe(true);
  });

  it('returns empty set when manifest has no sessions key', () => {
    writeFileSync(join(tmpDir, '.manifest.json'), JSON.stringify({}));
    const result = getPublishedSessions(tmpDir);
    expect(result.size).toBe(0);
  });
});

describe('saveManifest', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('writes manifest JSON file with session IDs', () => {
    const sessions = new Set(['sess-a', 'sess-b']);
    saveManifest(tmpDir, sessions);

    const raw = readFileSync(join(tmpDir, '.manifest.json'), 'utf-8');
    const data = JSON.parse(raw);
    expect(data.sessions).toEqual(expect.arrayContaining(['sess-a', 'sess-b']));
    expect(data.sessions).toHaveLength(2);
  });

  it('overwrites existing manifest', () => {
    writeFileSync(join(tmpDir, '.manifest.json'), JSON.stringify({ sessions: ['old'] }));
    saveManifest(tmpDir, new Set(['new-1']));

    const data = JSON.parse(readFileSync(join(tmpDir, '.manifest.json'), 'utf-8'));
    expect(data.sessions).toEqual(['new-1']);
  });

  it('round-trips through getPublishedSessions', () => {
    const original = new Set(['aaa', 'bbb', 'ccc']);
    saveManifest(tmpDir, original);
    const loaded = getPublishedSessions(tmpDir);
    expect(loaded).toEqual(original);
  });
});

describe('processTranscript', () => {
  beforeEach(() => mkdirSync(tmpDir, { recursive: true }));
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('extracts session metadata into markdown header', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'test-sess-001', cwd: '/home/user/myapp', gitBranch: 'main', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'Hello' }, timestamp: '2026-04-15T10:00:01Z' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }], model: 'claude-opus-4-6' }, timestamp: '2026-04-15T10:00:02Z' },
    ]);
    const filePath = join(tmpDir, 'test.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('# Session test-ses');
    expect(md).toContain('**Date:** 2026-04-15');
    expect(md).toContain('**CWD:** `/home/user/myapp`');
    expect(md).toContain('**Branch:** main');
    expect(md).toContain('**Model:** claude-opus-4-6');
    expect(md).toContain('**Session ID:** test-sess-001');
  });

  it('renders user and assistant turns', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'Fix the login bug' }, timestamp: '2026-04-15T10:01:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'I will look at the auth module.' }] }, timestamp: '2026-04-15T10:01:30Z' },
    ]);
    const filePath = join(tmpDir, 'turns.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('### User');
    expect(md).toContain('Fix the login bug');
    expect(md).toContain('### Assistant');
    expect(md).toContain('I will look at the auth module.');
  });

  it('summarizes tool calls', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'Read', input: { file_path: '/home/user/app.ts' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/home/user/fix.ts' } },
        { type: 'tool_use', name: 'Write', input: { file_path: '/home/user/new.ts' } },
        { type: 'tool_use', name: 'Grep', input: { pattern: 'TODO', path: 'src/' } },
        { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.test.ts' } },
        { type: 'tool_use', name: 'WebSearch', input: { query: 'vitest config' } },
        { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com' } },
        { type: 'tool_use', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find auth code' } },
      ] }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'tools.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('**Read** `/home/user/app.ts`');
    expect(md).toContain('**Bash** `npm test`');
    expect(md).toContain('**Edit** `/home/user/fix.ts`');
    expect(md).toContain('**Write** `/home/user/new.ts`');
    expect(md).toContain('**Grep** `TODO`');
    expect(md).toContain('in src/');
    expect(md).toContain('**Glob** `**/*.test.ts`');
    expect(md).toContain('**WebSearch** `vitest config`');
    expect(md).toContain('**WebFetch** `https://example.com`');
    expect(md).toContain('**Agent** (Explore)');
  });

  it('handles tool_use with unknown name', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'tool_use', name: 'CustomTool', input: {} },
      ] }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'unknown-tool.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('**Tool: CustomTool**');
  });

  it('handles user messages with array content blocks', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: [
        { type: 'text', text: 'First block' },
        { type: 'image', source: {} },
        { type: 'text', text: 'Second block' },
      ] }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'array-content.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('First block\nSecond block');
  });

  it('skips tool result user messages', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'result text' }, toolUseResult: { stdout: 'some output', stderr: '' }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'tool-result.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('Tool result: some output');
    // Should NOT contain a "### User" turn for this
    expect(md).not.toContain('### User');
  });

  it('skips very short user messages', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'ok' }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'short-msg.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).not.toContain('### User');
  });

  it('handles empty/invalid JSON lines gracefully', async () => {
    const content = [
      JSON.stringify({ sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' }),
      '',
      'not valid json',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello world!' }, timestamp: '2026-04-15T10:00:01Z' }),
    ].join('\n') + '\n';
    const filePath = join(tmpDir, 'bad-lines.jsonl');
    writeFileSync(filePath, content);

    const md = await processTranscript(filePath);
    expect(md).toContain('Hello world!');
    expect(md).toContain('# Session sess-1');
  });

  it('handles empty assistant text blocks', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'assistant', message: { role: 'assistant', content: [
        { type: 'text', text: '' },
        { type: 'text', text: '   ' },
        { type: 'text', text: 'Actual content' },
      ] }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'empty-text.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('Actual content');
    // Should only have one Assistant heading for the non-empty block
    const assistantCount = (md.match(/### Assistant/g) || []).length;
    expect(assistantCount).toBe(1);
  });

  it('includes timestamps in turn headers', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'What time is it?' }, timestamp: '2026-04-15T14:23:45Z' },
    ]);
    const filePath = join(tmpDir, 'timestamps.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('### User (14:23:45)');
  });

  it('returns minimal markdown for transcript with only metadata', async () => {
    const jsonl = makeJsonl([
      { sessionId: 'sess-empty', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
    ]);
    const filePath = join(tmpDir, 'metadata-only.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('# Session sess-emp');
    expect(md).toContain('**CWD:** `/tmp`');
    expect(md).not.toContain('### User');
    expect(md).not.toContain('### Assistant');
  });

  it('truncates tool result previews longer than 200 chars', async () => {
    const longOutput = 'x'.repeat(250);
    const jsonl = makeJsonl([
      { sessionId: 'sess-1', cwd: '/tmp', timestamp: '2026-04-15T10:00:00Z' },
      { type: 'user', message: { role: 'user', content: 'result' }, toolUseResult: { stdout: longOutput, stderr: '' }, timestamp: '2026-04-15T10:00:01Z' },
    ]);
    const filePath = join(tmpDir, 'long-result.jsonl');
    writeFileSync(filePath, jsonl);

    const md = await processTranscript(filePath);
    expect(md).toContain('Tool result: ' + 'x'.repeat(200) + '...');
  });
});

describe('publishLogs', () => {
  const repoDir = join(tmpDir, 'session-logs');
  const transcriptsDir = join(tmpDir, 'claude-projects', '-home-user');

  beforeEach(() => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(transcriptsDir, { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = dataDir;
    // Write empty usage log
    writeFileSync(join(dataDir, 'usage.jsonl'), '');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  it('returns zero counts when usage log is empty', async () => {
    const result = await publishLogs({ repoPath: repoDir });
    expect(result.published).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips sessions with zero tokens', async () => {
    const usageRecord = {
      sessionId: 'sess-zero',
      label: 'test',
      component: 'test',
      cwd: '/tmp',
      repo: 'test',
      startedAt: '2026-04-15T10:00:00Z',
      endedAt: '2026-04-15T10:30:00Z',
      durationMinutes: 30,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      model: 'claude-opus-4-6',
      turnCount: 2,
    };
    writeFileSync(join(dataDir, 'usage.jsonl'), JSON.stringify(usageRecord) + '\n');

    const result = await publishLogs({ repoPath: repoDir });
    expect(result.published).toBe(0);
  });

  it('skips already-published sessions', async () => {
    const usageRecord = {
      sessionId: 'sess-already',
      label: 'test',
      component: 'test',
      cwd: '/tmp',
      repo: 'test',
      startedAt: '2026-04-15T10:00:00Z',
      endedAt: '2026-04-15T10:30:00Z',
      durationMinutes: 30,
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 150,
      model: 'claude-opus-4-6',
      turnCount: 2,
    };
    writeFileSync(join(dataDir, 'usage.jsonl'), JSON.stringify(usageRecord) + '\n');
    // Pre-populate manifest
    writeFileSync(join(repoDir, '.manifest.json'), JSON.stringify({ sessions: ['sess-already'] }));

    const result = await publishLogs({ repoPath: repoDir });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.published).toBe(0);
  });

  it('filters by since date', async () => {
    const oldRecord = {
      sessionId: 'sess-old',
      label: 'test',
      component: 'test',
      cwd: '/tmp',
      repo: 'test',
      startedAt: '2026-01-01T10:00:00Z',
      endedAt: '2026-01-01T10:30:00Z',
      durationMinutes: 30,
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 150,
      model: 'claude-opus-4-6',
      turnCount: 2,
    };
    writeFileSync(join(dataDir, 'usage.jsonl'), JSON.stringify(oldRecord) + '\n');

    const result = await publishLogs({ repoPath: repoDir, since: '2026-04-01' });
    expect(result.published).toBe(0);
  });
});
