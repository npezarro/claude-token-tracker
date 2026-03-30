import { existsSync } from 'node:fs';
import { parseTranscript } from '../parser/transcript.js';
import { parseSubagents } from '../parser/subagent.js';
import { resolveComponent } from '../config/component-map.js';
import { loadConfig } from '../config/config.js';
import { appendUsageRecord, getLoggedSessionIds } from '../storage/usage-log.js';
import { extractRepoName } from '../parser/project-path.js';
import type { UsageRecord } from '../storage/types.js';

interface RecordInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

export async function recordSession(input: RecordInput): Promise<UsageRecord | null> {
  const { transcript_path, cwd: hookCwd } = input;

  if (!transcript_path || !existsSync(transcript_path)) {
    return null;
  }

  // Parse the transcript
  const parsed = await parseTranscript(transcript_path);

  if (parsed.turnCount === 0) {
    return null; // no assistant turns = nothing to record
  }

  // Check for duplicates
  const logged = await getLoggedSessionIds();
  const sessionId = parsed.sessionId || input.session_id || '';
  if (logged.has(sessionId)) {
    return null;
  }

  // Resolve CWD (prefer transcript data over hook input)
  const cwd = parsed.cwd || hookCwd || '';

  // Parse subagents if session directory exists
  const sessionDir = transcript_path.replace('.jsonl', '');
  const subagents = existsSync(sessionDir)
    ? await parseSubagents(sessionDir)
    : [];

  // Resolve component
  const config = await loadConfig();
  const component = resolveComponent(cwd, config);

  // Calculate duration
  const start = parsed.startedAt ? new Date(parsed.startedAt) : new Date();
  const end = parsed.endedAt ? new Date(parsed.endedAt) : new Date();
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

  const record: UsageRecord = {
    sessionId,
    label: parsed.firstPrompt || `${component}/${sessionId.slice(0, 8)}`,
    component,
    cwd,
    repo: extractRepoName(cwd),
    gitBranch: parsed.gitBranch,
    startedAt: parsed.startedAt,
    endedAt: parsed.endedAt,
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
  return record;
}
