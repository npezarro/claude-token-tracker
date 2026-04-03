/**
 * API-equivalent pricing for Claude models.
 * Rates are per million tokens (MTok) in USD.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 */

interface ModelRates {
  input: number;       // $ per MTok
  output: number;      // $ per MTok
  cacheWrite: number;  // $ per MTok (1h cache write — Claude Code uses 1h caching)
  cacheRead: number;   // $ per MTok
}

const MODEL_PRICING: Record<string, ModelRates> = {
  // Opus 4.6 / 4.5
  'claude-opus-4-6':   { input: 5,    output: 25,   cacheWrite: 10,    cacheRead: 0.50 },
  'claude-opus-4-5':   { input: 5,    output: 25,   cacheWrite: 10,    cacheRead: 0.50 },
  // Opus 4.1 / 4
  'claude-opus-4-1':   { input: 15,   output: 75,   cacheWrite: 30,    cacheRead: 1.50 },
  'claude-opus-4':     { input: 15,   output: 75,   cacheWrite: 30,    cacheRead: 1.50 },
  // Sonnet 4.6 / 4.5 / 4
  'claude-sonnet-4-6': { input: 3,    output: 15,   cacheWrite: 6,     cacheRead: 0.30 },
  'claude-sonnet-4-5': { input: 3,    output: 15,   cacheWrite: 6,     cacheRead: 0.30 },
  'claude-sonnet-4':   { input: 3,    output: 15,   cacheWrite: 6,     cacheRead: 0.30 },
  // Haiku 4.5
  'claude-haiku-4-5':  { input: 1,    output: 5,    cacheWrite: 2,     cacheRead: 0.10 },
  // Haiku 3.5
  'claude-haiku-3-5':  { input: 0.80, output: 4,    cacheWrite: 1.60,  cacheRead: 0.08 },
};

/**
 * Normalize model strings from transcripts to pricing keys.
 * Transcripts may use "claude-opus-4-6", "claude-opus-4-6[1m]",
 * "claude-haiku-4-5-20251001", etc.
 */
function normalizeModel(model: string): string {
  if (!model) return '';

  // Strip context window suffix like [1m]
  let normalized = model.replace(/\[.*?\]/, '');

  // Strip date suffix like -20251001
  normalized = normalized.replace(/-\d{8}$/, '');

  // Try exact match first
  if (MODEL_PRICING[normalized]) return normalized;

  // Try prefix matching (e.g., "claude-opus-4-6" matches "claude-opus-4-6")
  for (const key of Object.keys(MODEL_PRICING)) {
    if (normalized.startsWith(key)) return key;
  }

  // Fallback heuristic: extract model family
  if (normalized.includes('opus')) {
    if (normalized.includes('4-6') || normalized.includes('4.6')) return 'claude-opus-4-6';
    if (normalized.includes('4-5') || normalized.includes('4.5')) return 'claude-opus-4-5';
    if (normalized.includes('4-1') || normalized.includes('4.1')) return 'claude-opus-4-1';
    return 'claude-opus-4-6'; // default to latest
  }
  if (normalized.includes('sonnet')) {
    if (normalized.includes('4-6') || normalized.includes('4.6')) return 'claude-sonnet-4-6';
    return 'claude-sonnet-4-6';
  }
  if (normalized.includes('haiku')) {
    if (normalized.includes('4-5') || normalized.includes('4.5')) return 'claude-haiku-4-5';
    if (normalized.includes('3-5') || normalized.includes('3.5')) return 'claude-haiku-3-5';
    return 'claude-haiku-4-5';
  }

  return '';
}

export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  totalCost: number;
}

/**
 * Estimate API-equivalent cost for a set of token counts.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): CostEstimate {
  const key = normalizeModel(model);
  const rates = MODEL_PRICING[key];

  if (!rates) {
    return { inputCost: 0, outputCost: 0, cacheWriteCost: 0, cacheReadCost: 0, totalCost: 0 };
  }

  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  const cacheWriteCost = (cacheCreationTokens / 1_000_000) * rates.cacheWrite;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * rates.cacheRead;

  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalCost: inputCost + outputCost + cacheWriteCost + cacheReadCost,
  };
}

export function formatCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  if (usd > 0) return `<$0.01`;
  return '$0';
}
