import { describe, it, expect } from 'vitest';
import { formatTokens, truncate, splitChunksForDiscord } from '../src/commands/discord-report.js';

describe('formatTokens', () => {
  it('returns raw number for values under 1K', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands as K', () => {
    expect(formatTokens(1_000)).toBe('1.0K');
    expect(formatTokens(1_500)).toBe('1.5K');
    expect(formatTokens(999_999)).toBe('1000.0K');
  });

  it('formats millions as M', () => {
    expect(formatTokens(1_000_000)).toBe('1.0M');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formats billions as B', () => {
    expect(formatTokens(1_000_000_000)).toBe('1.0B');
    expect(formatTokens(3_700_000_000)).toBe('3.7B');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns string at max length unchanged', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates with ellipsis when over max', () => {
    expect(truncate('hello world', 5)).toBe('hell\u2026');
  });

  it('handles empty string', () => {
    expect(truncate('', 10)).toBe('');
  });
});

describe('splitChunksForDiscord', () => {
  it('passes through short chunks unchanged', () => {
    const chunks = ['short chunk', 'another one'];
    expect(splitChunksForDiscord(chunks)).toEqual(['short chunk', 'another one']);
  });

  it('passes through chunks at exactly 2000 chars', () => {
    const chunk = 'x'.repeat(2000);
    expect(splitChunksForDiscord([chunk])).toEqual([chunk]);
  });

  it('splits long chunks on double newlines', () => {
    const part1 = 'a'.repeat(500);
    const part2 = 'b'.repeat(500);
    const part3 = 'c'.repeat(500);
    const part4 = 'd'.repeat(500);
    const longChunk = [part1, part2, part3, part4].join('\n\n');

    const result = splitChunksForDiscord([longChunk]);
    // Each chunk should be under 1950 chars
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(1950);
    }
    // All content should be preserved
    expect(result.join('\n\n')).toBe(longChunk);
  });

  it('falls back to single newline splitting for huge paragraphs', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}: ${'x'.repeat(80)}`);
    const hugeParagraph = lines.join('\n');
    // This is one big paragraph (no \n\n), exceeds 2000

    const result = splitChunksForDiscord([hugeParagraph]);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(1950);
    }
    // All lines should be present across chunks
    const rejoined = result.join('\n');
    for (const line of lines) {
      expect(rejoined).toContain(line);
    }
  });

  it('handles mixed short and long chunks', () => {
    const short = 'Short message';
    const long = Array.from({ length: 10 }, (_, i) => `Section ${i}: ${'y'.repeat(300)}`).join('\n\n');

    const result = splitChunksForDiscord([short, long]);
    expect(result[0]).toBe(short);
    expect(result.length).toBeGreaterThan(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('handles empty chunks array', () => {
    expect(splitChunksForDiscord([])).toEqual([]);
  });

  it('respects custom maxLen parameter for oversized chunks', () => {
    // Build a chunk that exceeds 2000 chars so splitting kicks in
    const parts = Array.from({ length: 6 }, (_, i) => `Part${i}: ${'z'.repeat(400)}`);
    const longChunk = parts.join('\n\n');
    expect(longChunk.length).toBeGreaterThan(2000);

    // Custom maxLen of 500 should produce more chunks than default
    const defaultResult = splitChunksForDiscord([longChunk]);
    const customResult = splitChunksForDiscord([longChunk], 500);
    expect(customResult.length).toBeGreaterThan(defaultResult.length);
    for (const chunk of customResult) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  it('passes through chunks at or under 2000 chars regardless of maxLen', () => {
    // Chunks ≤2000 are passed through even if over maxLen
    const chunk = 'x'.repeat(1999);
    const result = splitChunksForDiscord([chunk], 100);
    expect(result).toEqual([chunk]);
  });

  it('does not produce empty chunks from whitespace-only parts', () => {
    const longChunk = 'a'.repeat(1000) + '\n\n' + '   \n\n' + 'b'.repeat(1000) + '\n\n' + 'c'.repeat(500);

    const result = splitChunksForDiscord([longChunk]);
    for (const chunk of result) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});
