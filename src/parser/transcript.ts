import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { ParsedTranscript } from '../storage/types.js';

export async function parseTranscript(filePath: string): Promise<ParsedTranscript> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  let sessionId = '';
  let firstPrompt = '';
  let cwd = '';
  let gitBranch: string | null = null;
  let version = '';
  let model = '';
  let userType = '';
  let startedAt = '';
  let endedAt = '';

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let turnCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    // Capture metadata from first entry that has it
    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;
    if (entry.cwd && !cwd) cwd = entry.cwd;
    if (entry.gitBranch && !gitBranch) gitBranch = entry.gitBranch;
    if (entry.version && !version) version = entry.version;

    // Track timestamps
    if (entry.timestamp) {
      if (!startedAt) startedAt = entry.timestamp;
      endedAt = entry.timestamp;
    }

    // Sum usage from assistant turns
    if (entry.type === 'assistant' && entry.message?.usage) {
      const usage = entry.message.usage;
      inputTokens += usage.input_tokens || 0;
      outputTokens += usage.output_tokens || 0;
      cacheCreationTokens += usage.cache_creation_input_tokens || 0;
      cacheReadTokens += usage.cache_read_input_tokens || 0;
      turnCount++;

      // Capture model from first real assistant turn
      if (!model && entry.message.model) {
        model = entry.message.model;
      }
    }

    // Capture first user prompt as session label
    if (!firstPrompt && entry.type === 'user' && entry.message?.role === 'user') {
      const content = entry.message.content;
      if (typeof content === 'string' && content.length > 3) {
        firstPrompt = content.replace(/\s+/g, ' ').trim().slice(0, 100);
      }
    }

    // Capture userType
    if (entry.userType && !userType) userType = entry.userType;
  }

  return {
    sessionId,
    firstPrompt,
    cwd,
    gitBranch,
    version,
    model,
    userType,
    startedAt,
    endedAt,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationTokens,
    turnCount,
  };
}
