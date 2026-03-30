import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { parseTranscript } from '../src/parser/transcript.js';
import { parseSubagents } from '../src/parser/subagent.js';
import { decodeProjectPath, extractRepoName } from '../src/parser/project-path.js';

const fixturesDir = join(import.meta.dirname, 'fixtures');

describe('parseTranscript', () => {
  it('should parse token usage from a transcript', async () => {
    const result = await parseTranscript(join(fixturesDir, 'sample-transcript.jsonl'));

    expect(result.sessionId).toBe('test-session-001');
    expect(result.cwd).toBe('/home/user/repos/myProject');
    expect(result.gitBranch).toBe('main');
    expect(result.version).toBe('2.1.77');
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.userType).toBe('external');
    expect(result.turnCount).toBe(3);

    // Token sums: 1500+2000+800 = 4300 input
    expect(result.inputTokens).toBe(4300);
    // 200+500+50 = 750 output
    expect(result.outputTokens).toBe(750);
    // 3000+1000+0 = 4000 cache creation
    expect(result.cacheCreationTokens).toBe(4000);
    // 500+4000+6000 = 10500 cache read
    expect(result.cacheReadTokens).toBe(10500);
    // total = input + output + cacheCreation (cache reads are free)
    expect(result.totalTokens).toBe(4300 + 750 + 4000);

    expect(result.startedAt).toBe('2026-03-28T10:00:00.000Z');
    expect(result.endedAt).toBe('2026-03-28T10:03:30.000Z');
  });

  it('should handle empty/missing files gracefully', async () => {
    // Create a temp empty file
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const tmpPath = join(fixturesDir, 'empty.jsonl');
    writeFileSync(tmpPath, '');

    const result = await parseTranscript(tmpPath);
    expect(result.turnCount).toBe(0);
    expect(result.totalTokens).toBe(0);

    unlinkSync(tmpPath);
  });
});

describe('parseSubagents', () => {
  it('should parse subagent usage and metadata', async () => {
    // Set up a temp subagent directory structure
    const { mkdirSync, copyFileSync, rmSync } = await import('node:fs');
    const tmpDir = join(fixturesDir, 'test-session-subagents');
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });

    copyFileSync(
      join(fixturesDir, 'sample-subagent.jsonl'),
      join(subDir, 'agent-abc123.jsonl')
    );
    copyFileSync(
      join(fixturesDir, 'sample-subagent.meta.json'),
      join(subDir, 'agent-abc123.meta.json')
    );

    const result = await parseSubagents(tmpDir);

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('agent-abc123');
    expect(result[0].agentType).toBe('Explore');
    expect(result[0].description).toBe('Search for auth patterns');
    expect(result[0].inputTokens).toBe(500);
    expect(result[0].outputTokens).toBe(100);
    expect(result[0].cacheCreationTokens).toBe(200);
    expect(result[0].totalTokens).toBe(800); // 500 + 100 + 200
    expect(result[0].turnCount).toBe(1);
    expect(result[0].model).toBe('claude-haiku-4-5-20251001');

    rmSync(tmpDir, { recursive: true });
  });

  it('should return empty array when no subagents directory', async () => {
    const result = await parseSubagents('/nonexistent/path');
    expect(result).toEqual([]);
  });
});

describe('decodeProjectPath', () => {
  it('should decode encoded project directory names', () => {
    expect(decodeProjectPath('-home-user-repos-myProject'))
      .toBe('/home/user/repos/myProject');
    expect(decodeProjectPath('-mnt-c-Users-user'))
      .toBe('/mnt/c/Users/user');
    expect(decodeProjectPath('-home-user'))
      .toBe('/home/user');
  });
});

describe('extractRepoName', () => {
  it('should extract repo name from CWD', () => {
    expect(extractRepoName('/home/user/repos/myProject')).toBe('myProject');
    expect(extractRepoName('/mnt/c/Users/user')).toBe('user');
    expect(extractRepoName('')).toBeNull();
  });
});
