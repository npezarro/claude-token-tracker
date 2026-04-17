import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ParsedTranscript, SubagentUsage, TrackerConfig } from '../src/storage/types.js';

// Mock all dependencies
vi.mock('../src/parser/session-resolver.js', () => ({
  discoverTranscripts: vi.fn(),
  loadSessionMetadata: vi.fn(),
  loadHistory: vi.fn(),
}));

vi.mock('../src/parser/transcript.js', () => ({
  parseTranscript: vi.fn(),
}));

vi.mock('../src/parser/subagent.js', () => ({
  parseSubagents: vi.fn(),
}));

vi.mock('../src/config/component-map.js', () => ({
  resolveComponent: vi.fn(),
}));

vi.mock('../src/config/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../src/storage/usage-log.js', () => ({
  appendUsageRecord: vi.fn(),
  getLoggedSessionIds: vi.fn(),
}));

import { backfill } from '../src/commands/backfill.js';
import { discoverTranscripts, loadSessionMetadata, loadHistory } from '../src/parser/session-resolver.js';
import { parseTranscript } from '../src/parser/transcript.js';
import { parseSubagents } from '../src/parser/subagent.js';
import { resolveComponent } from '../src/config/component-map.js';
import { loadConfig } from '../src/config/config.js';
import { appendUsageRecord, getLoggedSessionIds } from '../src/storage/usage-log.js';

const mockDiscoverTranscripts = vi.mocked(discoverTranscripts);
const mockLoadSessionMetadata = vi.mocked(loadSessionMetadata);
const mockLoadHistory = vi.mocked(loadHistory);
const mockParseTranscript = vi.mocked(parseTranscript);
const mockParseSubagents = vi.mocked(parseSubagents);
const mockResolveComponent = vi.mocked(resolveComponent);
const mockLoadConfig = vi.mocked(loadConfig);
const mockAppendUsageRecord = vi.mocked(appendUsageRecord);
const mockGetLoggedSessionIds = vi.mocked(getLoggedSessionIds);

function makeParsedTranscript(overrides: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    sessionId: 'sess-1',
    firstPrompt: 'Help me fix the bug',
    cwd: '/home/user/repos/myApp',
    gitBranch: 'main',
    version: '2.1.77',
    model: 'claude-opus-4-6',
    userType: 'max',
    startedAt: '2026-04-01T10:00:00Z',
    endedAt: '2026-04-01T10:30:00Z',
    inputTokens: 200,
    outputTokens: 100,
    cacheCreationTokens: 40,
    cacheReadTokens: 20,
    totalTokens: 340,
    turnCount: 3,
    ...overrides,
  };
}

function makeTranscriptEntry(overrides: Partial<{
  filePath: string;
  projectDir: string;
  sessionId: string;
  sessionDir: string | null;
}> = {}) {
  return {
    filePath: '/home/user/.claude/projects/-home-user-repos-myApp/sess-1.jsonl',
    projectDir: '-home-user-repos-myApp',
    sessionId: 'sess-1',
    sessionDir: null,
    ...overrides,
  };
}

const defaultConfig: TrackerConfig = {
  components: {},
  defaultComponent: 'unknown',
};

describe('backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns
    mockGetLoggedSessionIds.mockResolvedValue(new Set());
    mockLoadSessionMetadata.mockResolvedValue(new Map());
    mockLoadHistory.mockResolvedValue(new Map());
    mockLoadConfig.mockResolvedValue(defaultConfig);
    mockDiscoverTranscripts.mockResolvedValue([]);
    mockParseSubagents.mockResolvedValue([]);
    mockResolveComponent.mockReturnValue('unknown');
    mockAppendUsageRecord.mockResolvedValue(undefined);
  });

  it('returns zeroes when no transcripts exist', async () => {
    const result = await backfill();
    expect(result).toEqual({ recorded: 0, skipped: 0, errors: 0 });
  });

  it('records a valid transcript', async () => {
    const entry = makeTranscriptEntry();
    mockDiscoverTranscripts.mockResolvedValue([entry]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());
    mockResolveComponent.mockReturnValue('myApp');

    const result = await backfill();

    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockAppendUsageRecord).toHaveBeenCalledOnce();
    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        component: 'myApp',
        inputTokens: 200,
        outputTokens: 100,
        turnCount: 3,
      })
    );
  });

  it('skips already-logged sessions', async () => {
    mockGetLoggedSessionIds.mockResolvedValue(new Set(['sess-1']));
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);

    const result = await backfill();

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockParseTranscript).not.toHaveBeenCalled();
  });

  it('skips transcripts with zero turns', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({ turnCount: 0 }));

    const result = await backfill();

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockAppendUsageRecord).not.toHaveBeenCalled();
  });

  // --- Project filtering ---

  it('filters by project name (repo match)', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ sessionId: 'sess-1', projectDir: '-home-user-repos-myApp' }),
      makeTranscriptEntry({ sessionId: 'sess-2', projectDir: '-home-user-repos-otherApp' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    const result = await backfill({ project: 'myApp' });

    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('project filter is case-insensitive', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ projectDir: '-home-user-repos-MyApp' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    const result = await backfill({ project: 'myapp' });

    expect(result.recorded).toBe(1);
  });

  it('project filter matches raw projectDir as fallback', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ projectDir: 'custom-dir-name' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    const result = await backfill({ project: 'custom-dir-name' });

    expect(result.recorded).toBe(1);
  });

  // --- Date filtering ---

  it('filters by since date (skips older sessions)', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      startedAt: '2026-03-01T10:00:00Z',
    }));

    const result = await backfill({ since: '2026-04-01' });

    expect(result.recorded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('includes sessions on or after since date', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      startedAt: '2026-04-15T10:00:00Z',
    }));

    const result = await backfill({ since: '2026-04-01' });

    expect(result.recorded).toBe(1);
  });

  it('skips since filter when session has no startedAt', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      startedAt: '',
    }));

    // since filter requires startedAt to be truthy; empty string is falsy so filter is skipped
    const result = await backfill({ since: '2026-04-01' });

    expect(result.recorded).toBe(1);
  });

  // --- CWD resolution fallback chain ---

  it('uses transcript cwd when available', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      cwd: '/from/transcript',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/from/transcript' })
    );
  });

  it('falls back to session metadata cwd', async () => {
    const sessionMeta = new Map([
      ['sess-1', { pid: 1, sessionId: 'sess-1', cwd: '/from/session-meta', startedAt: 0 }],
    ]);
    mockLoadSessionMetadata.mockResolvedValue(sessionMeta);
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({ cwd: '' }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/from/session-meta' })
    );
  });

  it('falls back to history project path', async () => {
    const history = new Map([
      ['sess-1', { sessionId: 'sess-1', project: '/from/history', timestamp: 0 }],
    ]);
    mockLoadHistory.mockResolvedValue(history);
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({ cwd: '' }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/from/history' })
    );
  });

  it('falls back to decoded projectDir when all else fails', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ projectDir: '-home-user-repos-fallbackProject' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({ cwd: '' }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/home/user/repos/fallbackProject' })
    );
  });

  // --- startedAt fallback ---

  it('uses session metadata startedAt when transcript has none', async () => {
    const sessionMeta = new Map([
      ['sess-1', { pid: 1, sessionId: 'sess-1', cwd: '/test', startedAt: 1711612800000 }],
    ]);
    mockLoadSessionMetadata.mockResolvedValue(sessionMeta);
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      cwd: '/test',
      startedAt: '',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        startedAt: new Date(1711612800000).toISOString(),
      })
    );
  });

  // --- Subagents ---

  it('parses subagents when sessionDir is present', async () => {
    const subagents: SubagentUsage[] = [{
      agentId: 'agent-1',
      agentType: 'explore',
      description: 'Search codebase',
      inputTokens: 50,
      outputTokens: 25,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 75,
      turnCount: 1,
      model: 'claude-opus-4-6',
    }];
    mockParseSubagents.mockResolvedValue(subagents);
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ sessionDir: '/home/user/.claude/projects/test/sessions/sess-1' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    await backfill();

    expect(mockParseSubagents).toHaveBeenCalledWith(
      '/home/user/.claude/projects/test/sessions/sess-1'
    );
    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ subagents })
    );
  });

  it('skips subagent parsing when sessionDir is null', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry({ sessionDir: null })]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    await backfill();

    expect(mockParseSubagents).not.toHaveBeenCalled();
    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ subagents: [] })
    );
  });

  // --- Record fields ---

  it('computes durationMinutes from timestamps', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      startedAt: '2026-04-01T10:00:00Z',
      endedAt: '2026-04-01T10:45:00Z',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 45 })
    );
  });

  it('duration is non-negative for same timestamps', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      startedAt: '2026-04-01T10:00:00Z',
      endedAt: '2026-04-01T10:00:00Z',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ durationMinutes: 0 })
    );
  });

  it('uses firstPrompt as label', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      firstPrompt: 'Add dark mode toggle',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'Add dark mode toggle' })
    );
  });

  it('falls back to component/sessionId label when no firstPrompt', async () => {
    mockResolveComponent.mockReturnValue('myApp');
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      firstPrompt: '',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'myApp/sess-1' })
    );
  });

  it('extracts repo name from cwd', async () => {
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({
      cwd: '/home/user/repos/groceryGenius',
    }));

    await backfill();

    expect(mockAppendUsageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'groceryGenius' })
    );
  });

  // --- Error handling ---

  it('counts parse errors and continues to next transcript', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ sessionId: 'sess-fail' }),
      makeTranscriptEntry({ sessionId: 'sess-ok', filePath: '/ok.jsonl' }),
    ]);
    mockParseTranscript
      .mockRejectedValueOnce(new Error('corrupt file'))
      .mockResolvedValueOnce(makeParsedTranscript({ sessionId: 'sess-ok' }));

    const result = await backfill();

    expect(result.errors).toBe(1);
    expect(result.recorded).toBe(1);
  });

  // --- Deduplication within a single run ---

  it('adds session to logged set after recording (prevents in-run duplicates)', async () => {
    // Two transcript entries with same sessionId
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ sessionId: 'dup-sess' }),
      makeTranscriptEntry({ sessionId: 'dup-sess', filePath: '/dup2.jsonl' }),
    ]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript({ sessionId: 'dup-sess' }));

    const result = await backfill();

    // First is recorded, second is skipped because the Set is updated in-place
    expect(result.recorded).toBe(1);
    expect(result.skipped).toBe(1);
  });

  // --- Multiple transcripts ---

  it('processes multiple transcripts correctly', async () => {
    mockDiscoverTranscripts.mockResolvedValue([
      makeTranscriptEntry({ sessionId: 'sess-1' }),
      makeTranscriptEntry({ sessionId: 'sess-2', projectDir: '-home-user-repos-other' }),
      makeTranscriptEntry({ sessionId: 'sess-3', projectDir: '-home-user-repos-third' }),
    ]);
    mockParseTranscript
      .mockResolvedValueOnce(makeParsedTranscript({ sessionId: 'sess-1', turnCount: 5 }))
      .mockResolvedValueOnce(makeParsedTranscript({ sessionId: 'sess-2', turnCount: 0 }))
      .mockResolvedValueOnce(makeParsedTranscript({ sessionId: 'sess-3', turnCount: 2 }));

    const result = await backfill();

    expect(result.recorded).toBe(2); // sess-1 and sess-3
    expect(result.skipped).toBe(1); // sess-2 (zero turns)
    expect(mockAppendUsageRecord).toHaveBeenCalledTimes(2);
  });

  // --- claudeDir passthrough ---

  it('passes claudeDir to discovery and metadata functions', async () => {
    const customDir = '/custom/.claude';
    await backfill({ claudeDir: customDir });

    expect(mockDiscoverTranscripts).toHaveBeenCalledWith(customDir);
    expect(mockLoadSessionMetadata).toHaveBeenCalledWith(customDir);
    expect(mockLoadHistory).toHaveBeenCalledWith(customDir);
  });

  // --- Config usage ---

  it('passes config to resolveComponent', async () => {
    const config: TrackerConfig = {
      components: { myApp: { patterns: ['/home/user/repos/myApp'] } },
      defaultComponent: 'other',
    };
    mockLoadConfig.mockResolvedValue(config);
    mockDiscoverTranscripts.mockResolvedValue([makeTranscriptEntry()]);
    mockParseTranscript.mockResolvedValue(makeParsedTranscript());

    await backfill();

    expect(mockResolveComponent).toHaveBeenCalledWith(
      expect.any(String),
      config
    );
  });
});
