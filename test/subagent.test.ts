import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { parseSubagents } from '../src/parser/subagent.js';

const tmpDir = join(import.meta.dirname, '.tmp-subagent-test');

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
}

function makeTranscript(overrides: { inputTokens?: number; outputTokens?: number; turns?: number } = {}): string {
  const { inputTokens = 100, outputTokens = 50, turns = 1 } = overrides;
  const entries: object[] = [
    { sessionId: 'sub-1', cwd: '/test', version: '1.0', timestamp: '2026-01-01T00:00:00Z' },
  ];
  for (let i = 0; i < turns; i++) {
    entries.push(
      { type: 'user', message: { role: 'user', content: 'test' }, timestamp: '2026-01-01T00:01:00Z' },
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'response',
          usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          model: 'claude-opus-4-6',
        },
        timestamp: '2026-01-01T00:02:00Z',
      }
    );
  }
  return makeJsonl(entries);
}

describe('parseSubagents', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when session dir does not exist', async () => {
    const result = await parseSubagents(join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('returns empty array when subagents dir does not exist', async () => {
    // tmpDir exists but has no subagents/ subdirectory
    const result = await parseSubagents(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when subagents dir has no jsonl files', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'readme.txt'), 'not a jsonl file');
    const result = await parseSubagents(tmpDir);
    expect(result).toEqual([]);
  });

  it('parses a single subagent jsonl file', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-abc.jsonl'), makeTranscript({ inputTokens: 200, outputTokens: 100 }));

    const result = await parseSubagents(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('agent-abc');
    expect(result[0].inputTokens).toBe(200);
    expect(result[0].outputTokens).toBe(100);
  });

  it('sets agentType to unknown when no meta file exists', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-xyz.jsonl'), makeTranscript());

    const result = await parseSubagents(tmpDir);
    expect(result[0].agentType).toBe('unknown');
    expect(result[0].description).toBe('');
  });

  it('reads agentType and description from meta file', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-meta.jsonl'), makeTranscript());
    writeFileSync(join(subDir, 'agent-meta.meta.json'), JSON.stringify({
      agentType: 'Explore',
      description: 'Search codebase',
    }));

    const result = await parseSubagents(tmpDir);
    expect(result[0].agentType).toBe('Explore');
    expect(result[0].description).toBe('Search codebase');
  });

  it('handles malformed meta file gracefully', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-bad.jsonl'), makeTranscript());
    writeFileSync(join(subDir, 'agent-bad.meta.json'), 'not valid json{{{');

    const result = await parseSubagents(tmpDir);
    expect(result[0].agentType).toBe('unknown');
    expect(result[0].description).toBe('');
  });

  it('handles meta file with missing fields', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-partial.jsonl'), makeTranscript());
    writeFileSync(join(subDir, 'agent-partial.meta.json'), JSON.stringify({}));

    const result = await parseSubagents(tmpDir);
    expect(result[0].agentType).toBe('unknown');
    expect(result[0].description).toBe('');
  });

  it('parses multiple subagent files', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-1.jsonl'), makeTranscript({ inputTokens: 100 }));
    writeFileSync(join(subDir, 'agent-2.jsonl'), makeTranscript({ inputTokens: 200 }));
    writeFileSync(join(subDir, 'agent-3.jsonl'), makeTranscript({ inputTokens: 300 }));

    const result = await parseSubagents(tmpDir);
    expect(result).toHaveLength(3);
    const ids = result.map(r => r.agentId).sort();
    expect(ids).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('includes token totals from transcript parsing', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-tok.jsonl'), makeTranscript({ inputTokens: 500, outputTokens: 250, turns: 3 }));

    const result = await parseSubagents(tmpDir);
    expect(result[0].inputTokens).toBe(1500); // 500 * 3 turns
    expect(result[0].outputTokens).toBe(750);  // 250 * 3 turns
    expect(result[0].turnCount).toBe(3);
  });

  it('includes model from transcript', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-model.jsonl'), makeTranscript());

    const result = await parseSubagents(tmpDir);
    expect(result[0].model).toBe('claude-opus-4-6');
  });

  it('strips .jsonl extension to derive agentId', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'my-custom-agent-id.jsonl'), makeTranscript());

    const result = await parseSubagents(tmpDir);
    expect(result[0].agentId).toBe('my-custom-agent-id');
  });

  it('ignores non-jsonl files in subagents dir', async () => {
    const subDir = join(tmpDir, 'subagents');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'agent-ok.jsonl'), makeTranscript());
    writeFileSync(join(subDir, 'agent-ok.meta.json'), JSON.stringify({ agentType: 'test' }));
    writeFileSync(join(subDir, 'notes.txt'), 'some notes');
    writeFileSync(join(subDir, 'data.json'), '{}');

    const result = await parseSubagents(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('agent-ok');
  });
});
