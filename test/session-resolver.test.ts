import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  loadSessionMetadata,
  loadHistory,
  discoverTranscripts,
} from '../src/parser/session-resolver.js';

const tmpDir = join(import.meta.dirname, '.tmp-session-resolver-test');

describe('session-resolver', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadSessionMetadata', () => {
    it('should return empty map when sessions dir does not exist', async () => {
      const result = await loadSessionMetadata(join(tmpDir, 'nonexistent'));
      expect(result.size).toBe(0);
    });

    it('should load session metadata from JSON files', async () => {
      const sessionsDir = join(tmpDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      writeFileSync(
        join(sessionsDir, 'abc123.json'),
        JSON.stringify({
          pid: 12345,
          sessionId: 'abc123',
          cwd: '/home/user/repos/project',
          startedAt: 1711612800000,
        })
      );
      writeFileSync(
        join(sessionsDir, 'def456.json'),
        JSON.stringify({
          pid: 67890,
          sessionId: 'def456',
          cwd: '/home/user/repos/other',
          startedAt: 1711616400000,
        })
      );

      const result = await loadSessionMetadata(tmpDir);
      expect(result.size).toBe(2);
      expect(result.get('abc123')).toEqual({
        pid: 12345,
        sessionId: 'abc123',
        cwd: '/home/user/repos/project',
        startedAt: 1711612800000,
      });
      expect(result.get('def456')?.pid).toBe(67890);
    });

    it('should skip non-JSON files', async () => {
      const sessionsDir = join(tmpDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      writeFileSync(
        join(sessionsDir, 'valid.json'),
        JSON.stringify({ sessionId: 'valid-session', pid: 1, cwd: '/test', startedAt: 0 })
      );
      writeFileSync(join(sessionsDir, 'notes.txt'), 'not a session file');
      writeFileSync(join(sessionsDir, 'data.jsonl'), '{"line": 1}');

      const result = await loadSessionMetadata(tmpDir);
      expect(result.size).toBe(1);
      expect(result.has('valid-session')).toBe(true);
    });

    it('should skip malformed JSON files', async () => {
      const sessionsDir = join(tmpDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      writeFileSync(join(sessionsDir, 'broken.json'), '{not valid json');
      writeFileSync(
        join(sessionsDir, 'good.json'),
        JSON.stringify({ sessionId: 'good-one', pid: 1, cwd: '/x', startedAt: 0 })
      );

      const result = await loadSessionMetadata(tmpDir);
      expect(result.size).toBe(1);
      expect(result.has('good-one')).toBe(true);
    });

    it('should skip JSON files without sessionId', async () => {
      const sessionsDir = join(tmpDir, 'sessions');
      mkdirSync(sessionsDir, { recursive: true });

      writeFileSync(
        join(sessionsDir, 'no-id.json'),
        JSON.stringify({ pid: 1, cwd: '/test' })
      );

      const result = await loadSessionMetadata(tmpDir);
      expect(result.size).toBe(0);
    });
  });

  describe('loadHistory', () => {
    it('should return empty map when history file does not exist', async () => {
      const result = await loadHistory(join(tmpDir, 'nonexistent'));
      expect(result.size).toBe(0);
    });

    it('should parse JSONL history entries', async () => {
      const entries = [
        { sessionId: 'sess-1', project: '-home-user-project1', timestamp: 1000 },
        { sessionId: 'sess-2', project: '-home-user-project2', timestamp: 2000 },
      ];
      writeFileSync(
        join(tmpDir, 'history.jsonl'),
        entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      );

      const result = await loadHistory(tmpDir);
      expect(result.size).toBe(2);
      expect(result.get('sess-1')?.project).toBe('-home-user-project1');
      expect(result.get('sess-2')?.timestamp).toBe(2000);
    });

    it('should keep earliest entry per session', async () => {
      const entries = [
        { sessionId: 'sess-dup', project: '-home-first', timestamp: 100 },
        { sessionId: 'sess-dup', project: '-home-second', timestamp: 200 },
        { sessionId: 'sess-dup', project: '-home-third', timestamp: 300 },
      ];
      writeFileSync(
        join(tmpDir, 'history.jsonl'),
        entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      );

      const result = await loadHistory(tmpDir);
      expect(result.size).toBe(1);
      expect(result.get('sess-dup')?.project).toBe('-home-first');
      expect(result.get('sess-dup')?.timestamp).toBe(100);
    });

    it('should skip entries without sessionId or project', async () => {
      const entries = [
        { sessionId: 'valid', project: '-home-valid', timestamp: 100 },
        { sessionId: 'no-project', timestamp: 200 },
        { project: '-home-no-session', timestamp: 300 },
        { other: 'data' },
      ];
      writeFileSync(
        join(tmpDir, 'history.jsonl'),
        entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
      );

      const result = await loadHistory(tmpDir);
      expect(result.size).toBe(1);
      expect(result.has('valid')).toBe(true);
    });

    it('should skip malformed JSON lines', async () => {
      writeFileSync(
        join(tmpDir, 'history.jsonl'),
        [
          JSON.stringify({ sessionId: 'ok', project: '-home-ok', timestamp: 1 }),
          'not json',
          '',
          '{"broken":',
        ].join('\n') + '\n'
      );

      const result = await loadHistory(tmpDir);
      expect(result.size).toBe(1);
      expect(result.has('ok')).toBe(true);
    });
  });

  describe('discoverTranscripts', () => {
    it('should return empty array when projects dir does not exist', async () => {
      const result = await discoverTranscripts(join(tmpDir, 'nonexistent'));
      expect(result).toEqual([]);
    });

    it('should discover JSONL transcript files', async () => {
      const projectsDir = join(tmpDir, 'projects');
      const projectDir = join(projectsDir, '-home-user-myProject');
      mkdirSync(projectDir, { recursive: true });

      writeFileSync(join(projectDir, 'session-abc.jsonl'), '{"type":"user"}');
      writeFileSync(join(projectDir, 'session-def.jsonl'), '{"type":"user"}');

      const result = await discoverTranscripts(tmpDir);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.sessionId).sort()).toEqual(['session-abc', 'session-def']);
      expect(result[0].projectDir).toBe('-home-user-myProject');
    });

    it('should detect session directories with subagents', async () => {
      const projectsDir = join(tmpDir, 'projects');
      const projectDir = join(projectsDir, '-home-user-project');
      mkdirSync(projectDir, { recursive: true });

      // Session with a subagent directory
      writeFileSync(join(projectDir, 'sess-with-subs.jsonl'), '{}');
      const sessionDir = join(projectDir, 'sess-with-subs', 'subagents');
      mkdirSync(sessionDir, { recursive: true });

      // Session without a subagent directory
      writeFileSync(join(projectDir, 'sess-no-subs.jsonl'), '{}');

      const result = await discoverTranscripts(tmpDir);
      expect(result).toHaveLength(2);

      const withSubs = result.find((r) => r.sessionId === 'sess-with-subs');
      const noSubs = result.find((r) => r.sessionId === 'sess-no-subs');

      expect(withSubs?.sessionDir).toBeTruthy();
      expect(noSubs?.sessionDir).toBeNull();
    });

    it('should scan multiple project directories', async () => {
      const projectsDir = join(tmpDir, 'projects');
      const proj1 = join(projectsDir, '-home-user-projA');
      const proj2 = join(projectsDir, '-home-user-projB');
      mkdirSync(proj1, { recursive: true });
      mkdirSync(proj2, { recursive: true });

      writeFileSync(join(proj1, 'sess-1.jsonl'), '{}');
      writeFileSync(join(proj2, 'sess-2.jsonl'), '{}');
      writeFileSync(join(proj2, 'sess-3.jsonl'), '{}');

      const result = await discoverTranscripts(tmpDir);
      expect(result).toHaveLength(3);

      const fromProjA = result.filter((r) => r.projectDir === '-home-user-projA');
      const fromProjB = result.filter((r) => r.projectDir === '-home-user-projB');
      expect(fromProjA).toHaveLength(1);
      expect(fromProjB).toHaveLength(2);
    });

    it('should ignore non-JSONL files', async () => {
      const projectsDir = join(tmpDir, 'projects');
      const projectDir = join(projectsDir, '-home-user-proj');
      mkdirSync(projectDir, { recursive: true });

      writeFileSync(join(projectDir, 'transcript.jsonl'), '{}');
      writeFileSync(join(projectDir, 'notes.txt'), 'text file');
      writeFileSync(join(projectDir, 'config.json'), '{}');

      const result = await discoverTranscripts(tmpDir);
      expect(result).toHaveLength(1);
      expect(result[0].sessionId).toBe('transcript');
    });
  });
});
