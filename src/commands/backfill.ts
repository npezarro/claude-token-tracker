import { discoverTranscripts, loadSessionMetadata, loadHistory } from '../parser/session-resolver.js';
import { parseTranscript } from '../parser/transcript.js';
import { parseSubagents } from '../parser/subagent.js';
import { resolveComponent } from '../config/component-map.js';
import { loadConfig } from '../config/config.js';
import { appendUsageRecord, getLoggedSessionIds } from '../storage/usage-log.js';
import { decodeProjectPath, extractRepoName } from '../parser/project-path.js';
import type { UsageRecord } from '../storage/types.js';

interface BackfillOptions {
  since?: string;
  project?: string;
  claudeDir?: string;
  verbose?: boolean;
}

export async function backfill(options: BackfillOptions = {}): Promise<{ recorded: number; skipped: number; errors: number }> {
  const { since, project, claudeDir, verbose } = options;

  // Load existing session IDs to avoid duplicates
  const loggedIds = await getLoggedSessionIds();

  // Load supplementary metadata
  const [sessionMeta, history, config] = await Promise.all([
    loadSessionMetadata(claudeDir),
    loadHistory(claudeDir),
    loadConfig(),
  ]);

  // Discover all transcripts
  const transcripts = await discoverTranscripts(claudeDir);

  let recorded = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i];

    // Skip already logged
    if (loggedIds.has(t.sessionId)) {
      skipped++;
      continue;
    }

    // Filter by project if specified
    if (project) {
      const decodedPath = decodeProjectPath(t.projectDir);
      const repoName = extractRepoName(decodedPath);
      if (repoName?.toLowerCase() !== project.toLowerCase() &&
          t.projectDir !== project) {
        skipped++;
        continue;
      }
    }

    try {
      const parsed = await parseTranscript(t.filePath);

      if (parsed.turnCount === 0) {
        skipped++;
        continue;
      }

      // Filter by date if specified
      if (since && parsed.startedAt) {
        const sessionDate = new Date(parsed.startedAt);
        const sinceDate = new Date(since);
        if (sessionDate < sinceDate) {
          skipped++;
          continue;
        }
      }

      // Resolve CWD: transcript -> session meta -> history -> decoded project path
      let cwd = parsed.cwd;
      if (!cwd) {
        const meta = sessionMeta.get(t.sessionId);
        if (meta) cwd = meta.cwd;
      }
      if (!cwd) {
        const hist = history.get(t.sessionId);
        if (hist) cwd = hist.project;
      }
      if (!cwd) {
        cwd = decodeProjectPath(t.projectDir);
      }

      // Parse subagents
      const subagents = t.sessionDir
        ? await parseSubagents(t.sessionDir)
        : [];

      // Resolve component
      const component = resolveComponent(cwd, config);

      // Get startedAt from session meta if transcript doesn't have it
      let startedAt = parsed.startedAt;
      if (!startedAt) {
        const meta = sessionMeta.get(t.sessionId);
        if (meta) startedAt = new Date(meta.startedAt).toISOString();
      }

      const start = startedAt ? new Date(startedAt) : new Date();
      const end = parsed.endedAt ? new Date(parsed.endedAt) : new Date();
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

      const record: UsageRecord = {
        sessionId: t.sessionId,
        label: parsed.firstPrompt || `${component}/${t.sessionId.slice(0, 8)}`,
        component,
        cwd,
        repo: extractRepoName(cwd),
        gitBranch: parsed.gitBranch,
        startedAt: startedAt || '',
        endedAt: parsed.endedAt || '',
        durationMinutes: Math.max(0, durationMinutes),
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheCreationTokens: parsed.cacheCreationTokens,
        cacheReadTokens: parsed.cacheReadTokens,
        totalTokens: parsed.totalTokens,
        model: parsed.model,
        claudeCodeVersion: parsed.version,
        turnCount: parsed.turnCount,
        subagents,
      };

      await appendUsageRecord(record);
      recorded++;
      loggedIds.add(t.sessionId);

      if (verbose) {
        process.stderr.write(`\r[${i + 1}/${transcripts.length}] ${component}/${t.sessionId.slice(0, 8)}...`);
      }
    } catch (err) {
      errors++;
      if (verbose) {
        process.stderr.write(`\nError parsing ${t.filePath}: ${err}\n`);
      }
    }
  }

  if (verbose) {
    process.stderr.write('\n');
  }

  return { recorded, skipped, errors };
}
