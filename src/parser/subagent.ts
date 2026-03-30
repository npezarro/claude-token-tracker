import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseTranscript } from './transcript.js';
import type { SubagentUsage } from '../storage/types.js';

export async function parseSubagents(sessionDir: string): Promise<SubagentUsage[]> {
  const subagentDir = join(sessionDir, 'subagents');
  if (!existsSync(subagentDir)) return [];

  const files = await readdir(subagentDir);
  const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
  const results: SubagentUsage[] = [];

  for (const jsonlFile of jsonlFiles) {
    const agentId = jsonlFile.replace('.jsonl', '');
    const metaFile = join(subagentDir, `${agentId}.meta.json`);

    let agentType = 'unknown';
    let description = '';

    if (existsSync(metaFile)) {
      try {
        const meta = JSON.parse(await readFile(metaFile, 'utf-8'));
        agentType = meta.agentType || 'unknown';
        description = meta.description || '';
      } catch {
        // ignore malformed meta
      }
    }

    const parsed = await parseTranscript(join(subagentDir, jsonlFile));

    results.push({
      agentId,
      agentType,
      description,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      cacheCreationTokens: parsed.cacheCreationTokens,
      cacheReadTokens: parsed.cacheReadTokens,
      totalTokens: parsed.totalTokens,
      turnCount: parsed.turnCount,
      model: parsed.model,
    });
  }

  return results;
}
