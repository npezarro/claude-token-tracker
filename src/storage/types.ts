export interface SubagentUsage {
  agentId: string;
  agentType: string;
  description: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turnCount: number;
  model: string;
}

export interface UsageRecord {
  sessionId: string;
  label: string; // human-readable session summary (first user prompt, truncated)
  component: string;
  cwd: string;
  repo: string | null;
  gitBranch: string | null;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number; // input + output + cacheCreation (cache reads are free)
  model: string;
  claudeCodeVersion: string;
  turnCount: number;
  subagents: SubagentUsage[];
}

export interface TranscriptTurnUsage {
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  output_tokens: number;
}

export interface ParsedTranscript {
  sessionId: string;
  firstPrompt: string; // first user message, truncated
  cwd: string;
  gitBranch: string | null;
  version: string;
  model: string;
  userType: string;
  startedAt: string;
  endedAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  turnCount: number;
}

export interface TrackerConfig {
  components: Record<string, { patterns: string[]; description?: string }>;
  defaultComponent: string;
  dataDir?: string;
  sessionLogsRepo?: string; // GitHub repo URL for session logs (e.g., https://github.com/user/repo)
  sessionLogsPath?: string; // Local path to the session logs git repo
}
