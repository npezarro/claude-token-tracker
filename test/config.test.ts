import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { getConfigPath, loadConfig, saveConfig } from '../src/config/config.js';
import type { TrackerConfig } from '../src/storage/types.js';

const tmpDir = join(import.meta.dirname, '.tmp-config-test');

describe('config', () => {
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    process.env.CLAUDE_TRACKER_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.CLAUDE_TRACKER_DATA_DIR;
  });

  describe('getConfigPath', () => {
    it('should return config.json inside data dir', () => {
      expect(getConfigPath()).toBe(join(tmpDir, 'config.json'));
    });
  });

  describe('loadConfig', () => {
    it('should return defaults when config file does not exist', async () => {
      const config = await loadConfig();
      expect(config.components).toEqual({});
      expect(config.defaultComponent).toBe('other');
    });

    it('should load and merge with defaults', async () => {
      const saved: TrackerConfig = {
        components: { myApp: { patterns: ['/home/user/myApp'], description: 'My App' } },
        defaultComponent: 'untracked',
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(saved));

      const config = await loadConfig();
      expect(config.components).toEqual(saved.components);
      expect(config.defaultComponent).toBe('untracked');
    });

    it('should return defaults for malformed JSON', async () => {
      writeFileSync(join(tmpDir, 'config.json'), '{broken json');
      const config = await loadConfig();
      expect(config.defaultComponent).toBe('other');
      expect(config.components).toEqual({});
    });

    it('should merge partial config with defaults', async () => {
      writeFileSync(
        join(tmpDir, 'config.json'),
        JSON.stringify({ defaultComponent: 'custom' })
      );
      const config = await loadConfig();
      expect(config.defaultComponent).toBe('custom');
      expect(config.components).toEqual({});
    });
  });

  describe('saveConfig', () => {
    it('should write config to disk', async () => {
      const config: TrackerConfig = {
        components: {
          projectA: { patterns: ['/repos/a'], description: 'Project A' },
        },
        defaultComponent: 'other',
      };
      await saveConfig(config);

      const raw = readFileSync(join(tmpDir, 'config.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.components.projectA.patterns).toEqual(['/repos/a']);
      expect(parsed.defaultComponent).toBe('other');
    });

    it('should create parent directories if needed', async () => {
      rmSync(tmpDir, { recursive: true, force: true });
      const nestedDir = join(tmpDir, 'deep', 'nested');
      process.env.CLAUDE_TRACKER_DATA_DIR = nestedDir;

      await saveConfig({ components: {}, defaultComponent: 'test' });
      expect(existsSync(join(nestedDir, 'config.json'))).toBe(true);
    });

    it('should overwrite existing config', async () => {
      const initial: TrackerConfig = {
        components: { old: { patterns: ['/old'] } },
        defaultComponent: 'old-default',
      };
      writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(initial));

      const updated: TrackerConfig = {
        components: { new: { patterns: ['/new'] } },
        defaultComponent: 'new-default',
      };
      await saveConfig(updated);

      const raw = readFileSync(join(tmpDir, 'config.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.components).toEqual({ new: { patterns: ['/new'] } });
      expect(parsed.defaultComponent).toBe('new-default');
    });
  });
});
