import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDataDir } from '../storage/usage-log.js';
import type { TrackerConfig } from '../storage/types.js';

const DEFAULT_CONFIG: TrackerConfig = {
  components: {},
  defaultComponent: 'other',
};

export function getConfigPath(): string {
  return join(getDataDir(), 'config.json');
}

export async function loadConfig(): Promise<TrackerConfig> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };

  try {
    const content = await readFile(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: TrackerConfig): Promise<void> {
  const configPath = getConfigPath();
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
