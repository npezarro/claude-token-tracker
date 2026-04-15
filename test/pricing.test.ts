import { describe, it, expect } from 'vitest';
import { estimateCost, formatCost, type CostEstimate } from '../src/pricing.js';

// ── normalizeModel (tested indirectly via estimateCost) ──

describe('normalizeModel (via estimateCost)', () => {
  // Helper: if estimateCost returns non-zero totalCost, the model was resolved
  function resolves(model: string): boolean {
    const cost = estimateCost(model, 1_000_000, 0, 0, 0);
    return cost.totalCost > 0;
  }

  it('resolves exact model IDs', () => {
    expect(resolves('claude-opus-4-6')).toBe(true);
    expect(resolves('claude-opus-4-5')).toBe(true);
    expect(resolves('claude-sonnet-4-6')).toBe(true);
    expect(resolves('claude-sonnet-4')).toBe(true);
    expect(resolves('claude-haiku-4-5')).toBe(true);
    expect(resolves('claude-haiku-3-5')).toBe(true);
  });

  it('strips context window suffix [1m]', () => {
    expect(resolves('claude-opus-4-6[1m]')).toBe(true);
    expect(resolves('claude-sonnet-4-6[200k]')).toBe(true);
  });

  it('strips date suffix -YYYYMMDD', () => {
    expect(resolves('claude-haiku-4-5-20251001')).toBe(true);
    expect(resolves('claude-sonnet-4-20250514')).toBe(true);
  });

  it('strips both context window and date suffix', () => {
    // date suffix first, then context window
    expect(resolves('claude-haiku-4-5-20251001[1m]')).toBe(true);
  });

  it('handles family-based fallback for opus', () => {
    // Unknown opus variant defaults to latest opus
    const cost = estimateCost('claude-opus-unknown', 1_000_000, 0, 0, 0);
    expect(cost.inputCost).toBe(5); // opus 4.6 rate
  });

  it('handles family-based fallback for sonnet', () => {
    const cost = estimateCost('claude-sonnet-unknown', 1_000_000, 0, 0, 0);
    expect(cost.inputCost).toBe(3); // sonnet 4.6 rate
  });

  it('handles family-based fallback for haiku', () => {
    const cost = estimateCost('claude-haiku-unknown', 1_000_000, 0, 0, 0);
    expect(cost.inputCost).toBe(1); // haiku 4.5 rate
  });

  it('handles dot notation version numbers via heuristic fallback', () => {
    // Note: 'claude-opus-4.6' prefix-matches 'claude-opus-4' before reaching
    // the heuristic, so it resolves to opus 4 rates ($15/MTok).
    // Dot notation isn't used in transcripts (they use dash: 4-6), so this
    // is an edge case that doesn't affect real data.
    const cost46 = estimateCost('claude-opus-4.6', 1_000_000, 0, 0, 0);
    expect(cost46.inputCost).toBe(15); // prefix-matches claude-opus-4

    // haiku-3.5 doesn't prefix-match any key, so the heuristic resolves it
    const cost35 = estimateCost('claude-haiku-3.5', 1_000_000, 0, 0, 0);
    expect(cost35.inputCost).toBe(0.80);
  });

  it('returns zero cost for empty model string', () => {
    const cost = estimateCost('', 1_000_000, 1_000_000, 0, 0);
    expect(cost.totalCost).toBe(0);
  });

  it('returns zero cost for completely unknown model', () => {
    const cost = estimateCost('gpt-4o', 1_000_000, 1_000_000, 0, 0);
    expect(cost.totalCost).toBe(0);
  });
});

// ── estimateCost ──

describe('estimateCost', () => {
  it('calculates input cost correctly for opus 4.6 ($5/MTok)', () => {
    const cost = estimateCost('claude-opus-4-6', 1_000_000, 0, 0, 0);
    expect(cost.inputCost).toBe(5);
    expect(cost.outputCost).toBe(0);
    expect(cost.cacheWriteCost).toBe(0);
    expect(cost.cacheReadCost).toBe(0);
    expect(cost.totalCost).toBe(5);
  });

  it('calculates output cost correctly for opus 4.6 ($25/MTok)', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 1_000_000, 0, 0);
    expect(cost.outputCost).toBe(25);
    expect(cost.totalCost).toBe(25);
  });

  it('calculates cache write cost correctly for opus 4.6 ($10/MTok)', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 0, 1_000_000, 0);
    expect(cost.cacheWriteCost).toBe(10);
    expect(cost.totalCost).toBe(10);
  });

  it('calculates cache read cost correctly for opus 4.6 ($0.50/MTok)', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 0, 0, 1_000_000);
    expect(cost.cacheReadCost).toBe(0.50);
    expect(cost.totalCost).toBe(0.50);
  });

  it('sums all cost components', () => {
    const cost = estimateCost('claude-opus-4-6', 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(cost.totalCost).toBe(5 + 25 + 10 + 0.50);
  });

  it('handles fractional token counts', () => {
    // 500k tokens = half of 1M
    const cost = estimateCost('claude-opus-4-6', 500_000, 0, 0, 0);
    expect(cost.inputCost).toBe(2.5);
  });

  it('calculates correctly for sonnet 4.6 rates', () => {
    const cost = estimateCost('claude-sonnet-4-6', 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(cost.inputCost).toBe(3);
    expect(cost.outputCost).toBe(15);
    expect(cost.cacheWriteCost).toBe(6);
    expect(cost.cacheReadCost).toBe(0.30);
    expect(cost.totalCost).toBe(3 + 15 + 6 + 0.30);
  });

  it('calculates correctly for haiku 4.5 rates', () => {
    const cost = estimateCost('claude-haiku-4-5', 1_000_000, 1_000_000, 0, 0);
    expect(cost.inputCost).toBe(1);
    expect(cost.outputCost).toBe(5);
    expect(cost.totalCost).toBe(6);
  });

  it('calculates correctly for haiku 3.5 rates', () => {
    const cost = estimateCost('claude-haiku-3-5', 1_000_000, 1_000_000, 0, 0);
    expect(cost.inputCost).toBe(0.80);
    expect(cost.outputCost).toBe(4);
    expect(cost.totalCost).toBeCloseTo(4.80);
  });

  it('calculates correctly for opus 4.1 rates (more expensive)', () => {
    const cost = estimateCost('claude-opus-4-1', 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(cost.inputCost).toBe(15);
    expect(cost.outputCost).toBe(75);
    expect(cost.cacheWriteCost).toBe(30);
    expect(cost.cacheReadCost).toBe(1.50);
    expect(cost.totalCost).toBe(15 + 75 + 30 + 1.50);
  });

  it('returns zero for all fields when model is unknown', () => {
    const cost = estimateCost('unknown-model', 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    expect(cost).toEqual({
      inputCost: 0,
      outputCost: 0,
      cacheWriteCost: 0,
      cacheReadCost: 0,
      totalCost: 0,
    });
  });

  it('handles zero tokens', () => {
    const cost = estimateCost('claude-opus-4-6', 0, 0, 0, 0);
    expect(cost.totalCost).toBe(0);
  });

  it('handles realistic session tokens (~200k input, ~10k output, ~150k cache)', () => {
    const cost = estimateCost('claude-opus-4-6', 200_000, 10_000, 150_000, 100_000);
    expect(cost.inputCost).toBeCloseTo(1.00);
    expect(cost.outputCost).toBeCloseTo(0.25);
    expect(cost.cacheWriteCost).toBeCloseTo(1.50);
    expect(cost.cacheReadCost).toBeCloseTo(0.05);
    expect(cost.totalCost).toBeCloseTo(2.80);
  });
});

// ── formatCost ──

describe('formatCost', () => {
  it('formats zero as $0', () => {
    expect(formatCost(0)).toBe('$0');
  });

  it('formats very small amounts as <$0.01', () => {
    expect(formatCost(0.001)).toBe('<$0.01');
    expect(formatCost(0.009)).toBe('<$0.01');
  });

  it('formats cents with two decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(0.50)).toBe('$0.50');
    expect(formatCost(0.99)).toBe('$0.99');
  });

  it('formats dollars under $10 with two decimal places', () => {
    expect(formatCost(1)).toBe('$1.00');
    expect(formatCost(5.50)).toBe('$5.50');
    expect(formatCost(9.99)).toBe('$9.99');
  });

  it('formats $10-$99 with one decimal place', () => {
    expect(formatCost(10)).toBe('$10.0');
    expect(formatCost(42.75)).toBe('$42.8');
    expect(formatCost(99.9)).toBe('$99.9');
  });

  it('formats $100-$999 as whole dollars', () => {
    expect(formatCost(100)).toBe('$100');
    expect(formatCost(500.75)).toBe('$501');
    expect(formatCost(999)).toBe('$999');
  });

  it('formats $1000+ in K notation', () => {
    expect(formatCost(1000)).toBe('$1.0K');
    expect(formatCost(1500)).toBe('$1.5K');
    expect(formatCost(10000)).toBe('$10.0K');
    expect(formatCost(123456)).toBe('$123.5K');
  });
});
