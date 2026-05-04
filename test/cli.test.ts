import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getFlag, hasFlag, printHelp } from '../src/cli.js';

// --- Pure helper tests ---

describe('getFlag', () => {
  it('returns the value after the named flag', () => {
    expect(getFlag(['backfill', '--since', '2026-01-01'], 'since')).toBe('2026-01-01');
  });

  it('returns undefined when flag is absent', () => {
    expect(getFlag(['backfill', '--verbose'], 'since')).toBeUndefined();
  });

  it('returns the value for a flag at the end of args', () => {
    expect(getFlag(['report', '--by', 'day'], 'by')).toBe('day');
  });

  it('returns undefined when flag is last arg with no value', () => {
    expect(getFlag(['report', '--by'], 'by')).toBeUndefined();
  });

  it('handles multiple flags correctly', () => {
    const args = ['report', '--since', '2026-01-01', '--until', '2026-02-01', '--by', 'model'];
    expect(getFlag(args, 'since')).toBe('2026-01-01');
    expect(getFlag(args, 'until')).toBe('2026-02-01');
    expect(getFlag(args, 'by')).toBe('model');
  });

  it('returns first occurrence when flag appears multiple times', () => {
    expect(getFlag(['--by', 'day', '--by', 'model'], 'by')).toBe('day');
  });

  it('does not match partial flag names', () => {
    expect(getFlag(['--since-date', '2026-01-01'], 'since')).toBeUndefined();
  });

  it('returns undefined for empty args', () => {
    expect(getFlag([], 'since')).toBeUndefined();
  });
});

describe('hasFlag', () => {
  it('returns true when flag is present', () => {
    expect(hasFlag(['backfill', '--verbose'], 'verbose')).toBe(true);
  });

  it('returns false when flag is absent', () => {
    expect(hasFlag(['backfill'], 'verbose')).toBe(false);
  });

  it('returns true regardless of position', () => {
    expect(hasFlag(['--verbose', 'backfill', '--since', '2026-01-01'], 'verbose')).toBe(true);
  });

  it('returns false for empty args', () => {
    expect(hasFlag([], 'verbose')).toBe(false);
  });

  it('returns false for partial match', () => {
    expect(hasFlag(['--verbose-mode'], 'verbose')).toBe(false);
  });
});

describe('printHelp', () => {
  it('outputs help text with all commands listed', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    expect(spy).toHaveBeenCalledOnce();
    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain('record');
    expect(output).toContain('backfill');
    expect(output).toContain('report');
    expect(output).toContain('export');
    expect(output).toContain('config');
    expect(output).toContain('discord-report');
    spy.mockRestore();
  });
});

// --- Command routing tests ---
// These test runCli by mocking all command dependencies

vi.mock('../src/commands/record.js', () => ({
  recordSession: vi.fn(),
}));

vi.mock('../src/commands/backfill.js', () => ({
  backfill: vi.fn(),
}));

vi.mock('../src/commands/report.js', () => ({
  report: vi.fn(),
}));

vi.mock('../src/commands/export.js', () => ({
  exportData: vi.fn(),
}));

vi.mock('../src/config/config.js', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
  getConfigPath: vi.fn(),
}));

vi.mock('../src/storage/usage-log.js', () => ({
  getUsageLogPath: vi.fn(),
}));

vi.mock('../src/commands/discord-report.js', () => ({
  generateDiscordReport: vi.fn(),
  postDiscordReport: vi.fn(),
}));

vi.mock('../src/commands/publish-logs.js', () => ({
  publishLogs: vi.fn(),
}));

import { runCli } from '../src/cli.js';
import { recordSession } from '../src/commands/record.js';
import { backfill } from '../src/commands/backfill.js';
import { report } from '../src/commands/report.js';
import { exportData } from '../src/commands/export.js';
import { loadConfig, saveConfig, getConfigPath } from '../src/config/config.js';
import { getUsageLogPath } from '../src/storage/usage-log.js';
import { generateDiscordReport, postDiscordReport } from '../src/commands/discord-report.js';
import { publishLogs } from '../src/commands/publish-logs.js';

const mockRecordSession = vi.mocked(recordSession);
const mockBackfill = vi.mocked(backfill);
const mockReport = vi.mocked(report);
const mockExportData = vi.mocked(exportData);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSaveConfig = vi.mocked(saveConfig);
const mockGetConfigPath = vi.mocked(getConfigPath);
const mockGetUsageLogPath = vi.mocked(getUsageLogPath);
const mockGenerateDiscordReport = vi.mocked(generateDiscordReport);
const mockPostDiscordReport = vi.mocked(postDiscordReport);
const mockPublishLogs = vi.mocked(publishLogs);

describe('runCli', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    // Default: stdin is a TTY (manual mode)
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  });

  // --- help ---

  describe('help', () => {
    it('prints help for "help" command', async () => {
      await runCli(['help']);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][0]).toContain('claude-token-tracker');
    });

    it('prints help for --help flag', async () => {
      await runCli(['--help']);
      expect(logSpy).toHaveBeenCalled();
    });

    it('prints help for -h flag', async () => {
      await runCli(['-h']);
      expect(logSpy).toHaveBeenCalled();
    });
  });

  // --- unknown command ---

  describe('unknown command', () => {
    it('prints error and exits 1 for unknown command', async () => {
      await runCli(['foobar']);
      expect(errorSpy).toHaveBeenCalledWith('Unknown command: foobar');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('prints help and exits 0 when no command given', async () => {
      await runCli([]);
      expect(logSpy).toHaveBeenCalled(); // help text
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  // --- record (manual mode) ---

  describe('record (manual mode)', () => {
    it('calls recordSession with flags and logs result', async () => {
      mockRecordSession.mockResolvedValueOnce({
        component: 'myApp',
        turnCount: 5,
        totalTokens: 1200,
      } as any);

      await runCli(['record', '--transcript-path', '/tmp/t.jsonl', '--session-id', 'abc', '--cwd', '/home/user']);

      expect(mockRecordSession).toHaveBeenCalledWith({
        session_id: 'abc',
        transcript_path: '/tmp/t.jsonl',
        cwd: '/home/user',
      });
      expect(logSpy).toHaveBeenCalledWith('Recorded: myApp — 5 turns, 1200 tokens');
    });

    it('logs "Nothing to record" when recordSession returns null', async () => {
      mockRecordSession.mockResolvedValueOnce(null);

      await runCli(['record', '--transcript-path', '/tmp/t.jsonl']);

      expect(logSpy).toHaveBeenCalledWith('Nothing to record (empty session or already logged).');
    });

    it('exits 1 when --transcript-path is missing', async () => {
      await runCli(['record']);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('--transcript-path')
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // --- backfill ---

  describe('backfill', () => {
    it('calls backfill with correct options', async () => {
      mockBackfill.mockResolvedValueOnce({ recorded: 10, skipped: 3, errors: 1 });

      await runCli(['backfill', '--since', '2026-01-01', '--project', 'myApp', '--verbose']);

      expect(mockBackfill).toHaveBeenCalledWith({
        since: '2026-01-01',
        project: 'myApp',
        verbose: true,
      });
      expect(logSpy).toHaveBeenCalledWith('Backfill complete: 10 recorded, 3 skipped, 1 errors');
    });

    it('passes undefined for optional flags when absent', async () => {
      mockBackfill.mockResolvedValueOnce({ recorded: 0, skipped: 0, errors: 0 });

      await runCli(['backfill']);

      expect(mockBackfill).toHaveBeenCalledWith({
        since: undefined,
        project: undefined,
        verbose: false,
      });
    });
  });

  // --- report ---

  describe('report', () => {
    it('calls report with all flags', async () => {
      mockReport.mockResolvedValueOnce('report output');

      await runCli([
        'report', '--by', 'day', '--since', '2026-01-01', '--until', '2026-02-01',
        '--component', 'tracker', '--subagents', '--no-sessions', '--top', '5',
      ]);

      expect(mockReport).toHaveBeenCalledWith({
        groupBy: 'day',
        since: '2026-01-01',
        until: '2026-02-01',
        component: 'tracker',
        includeSubagents: true,
        hideSessions: true,
        topN: 5,
      });
      expect(logSpy).toHaveBeenCalledWith('report output');
    });

    it('defaults topN to undefined when --top not provided', async () => {
      mockReport.mockResolvedValueOnce('');

      await runCli(['report']);

      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ topN: undefined })
      );
    });
  });

  // --- export ---

  describe('export', () => {
    it('calls exportData with all flags', async () => {
      mockExportData.mockResolvedValueOnce('exported data');

      await runCli([
        'export', '--format', 'csv', '--output', '/tmp/out.csv',
        '--since', '2026-01-01', '--until', '2026-02-01', '--component', 'tracker',
      ]);

      expect(mockExportData).toHaveBeenCalledWith({
        format: 'csv',
        output: '/tmp/out.csv',
        since: '2026-01-01',
        until: '2026-02-01',
        component: 'tracker',
      });
      expect(logSpy).toHaveBeenCalledWith('exported data');
    });

    it('defaults to undefined for all optional flags', async () => {
      mockExportData.mockResolvedValueOnce('{}');

      await runCli(['export']);

      expect(mockExportData).toHaveBeenCalledWith({
        format: undefined,
        output: undefined,
        since: undefined,
        until: undefined,
        component: undefined,
      });
    });
  });

  // --- config ---

  describe('config', () => {
    const baseConfig = { components: {}, sessionLogsPath: '' };

    it('shows config for "config show"', async () => {
      mockLoadConfig.mockResolvedValueOnce(baseConfig as any);

      await runCli(['config', 'show']);

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(baseConfig, null, 2));
    });

    it('shows config when no subcommand given', async () => {
      mockLoadConfig.mockResolvedValueOnce(baseConfig as any);

      await runCli(['config']);

      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(baseConfig, null, 2));
    });

    it('adds a pattern for "config set"', async () => {
      const config = { components: {}, sessionLogsPath: '' };
      mockLoadConfig.mockResolvedValueOnce(config as any);

      await runCli(['config', 'set', '/home/user/repos/myApp', 'myApp']);

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          components: { myApp: { patterns: ['/home/user/repos/myApp'] } },
        })
      );
      expect(logSpy).toHaveBeenCalledWith('Added pattern "/home/user/repos/myApp" to component "myApp"');
    });

    it('appends pattern to existing component', async () => {
      const config = {
        components: { myApp: { patterns: ['/existing'] } },
        sessionLogsPath: '',
      };
      mockLoadConfig.mockResolvedValueOnce(config as any);

      await runCli(['config', 'set', '/new-path', 'myApp']);

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          components: { myApp: { patterns: ['/existing', '/new-path'] } },
        })
      );
    });

    it('does not duplicate existing pattern', async () => {
      const config = {
        components: { myApp: { patterns: ['/existing'] } },
        sessionLogsPath: '',
      };
      mockLoadConfig.mockResolvedValueOnce(config as any);

      await runCli(['config', 'set', '/existing', 'myApp']);

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          components: { myApp: { patterns: ['/existing'] } },
        })
      );
    });

    it('exits 1 when path missing in config set', async () => {
      mockLoadConfig.mockResolvedValueOnce(baseConfig as any);

      await runCli(['config', 'set']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('config set'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when component name missing in config set', async () => {
      mockLoadConfig.mockResolvedValueOnce(baseConfig as any);

      await runCli(['config', 'set', '/some/path']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('config set'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('shows paths for "config paths"', async () => {
      mockLoadConfig.mockResolvedValueOnce(baseConfig as any);
      mockGetConfigPath.mockReturnValueOnce('/home/.ctt/config.json');
      mockGetUsageLogPath.mockReturnValueOnce('/home/.ctt/usage.jsonl');

      await runCli(['config', 'paths']);

      expect(logSpy).toHaveBeenCalledWith('Config: /home/.ctt/config.json');
      expect(logSpy).toHaveBeenCalledWith('Usage log: /home/.ctt/usage.jsonl');
    });
  });

  // --- discord-report ---

  describe('discord-report', () => {
    it('generates dry-run report', async () => {
      mockGenerateDiscordReport.mockResolvedValueOnce('discord report content');

      await runCli(['discord-report', '--dry-run', '--period', '24h']);

      expect(mockGenerateDiscordReport).toHaveBeenCalledWith({ period: '24h' });
      expect(logSpy).toHaveBeenCalledWith('discord report content');
      expect(mockPostDiscordReport).not.toHaveBeenCalled();
    });

    it('posts report when not dry-run', async () => {
      mockPostDiscordReport.mockResolvedValueOnce(true);

      await runCli(['discord-report', '--webhook', 'https://hooks.example.com/abc', '--period', '7d']);

      expect(mockPostDiscordReport).toHaveBeenCalledWith({
        webhookUrl: 'https://hooks.example.com/abc',
        period: '7d',
      });
      expect(logSpy).toHaveBeenCalledWith('Report posted to #usage');
    });

    it('exits 1 when post fails', async () => {
      mockPostDiscordReport.mockResolvedValueOnce(false);

      await runCli(['discord-report']);

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // --- publish-logs ---

  describe('publish-logs', () => {
    it('calls publishLogs with flag overrides', async () => {
      mockLoadConfig.mockResolvedValueOnce({ sessionLogsPath: '/default/path' } as any);
      mockPublishLogs.mockResolvedValueOnce({ published: 5, skipped: 2 });

      await runCli(['publish-logs', '--repo-path', '/custom/path', '--since', '2026-01-01', '--force', '--verbose']);

      expect(mockPublishLogs).toHaveBeenCalledWith({
        repoPath: '/custom/path',
        since: '2026-01-01',
        force: true,
        verbose: true,
      });
      expect(logSpy).toHaveBeenCalledWith('Published 5 session logs, 2 skipped');
    });

    it('falls back to config sessionLogsPath when --repo-path absent', async () => {
      mockLoadConfig.mockResolvedValueOnce({ sessionLogsPath: '/default/path' } as any);
      mockPublishLogs.mockResolvedValueOnce({ published: 0, skipped: 0 });

      await runCli(['publish-logs']);

      expect(mockPublishLogs).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: '/default/path' })
      );
    });
  });
});
