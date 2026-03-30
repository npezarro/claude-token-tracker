import { describe, it, expect } from 'vitest';
import { resolveComponent } from '../src/config/component-map.js';
import type { TrackerConfig } from '../src/storage/types.js';

const testConfig: TrackerConfig = {
  components: {
    backend: { patterns: ['/home/user/repos/backend'] },
    webapp: { patterns: ['**/webapp'] },
    interactive: { patterns: ['/mnt/c/Users/user'] },
  },
  defaultComponent: 'other',
};

describe('resolveComponent', () => {
  it('should match exact paths', () => {
    expect(resolveComponent('/home/user/repos/backend', testConfig))
      .toBe('backend');
  });

  it('should match glob suffix patterns', () => {
    expect(resolveComponent('/home/user/repos/webapp', testConfig))
      .toBe('webapp');
    expect(resolveComponent('/some/other/path/webapp', testConfig))
      .toBe('webapp');
  });

  it('should match prefix paths', () => {
    expect(resolveComponent('/mnt/c/Users/user', testConfig))
      .toBe('interactive');
    expect(resolveComponent('/mnt/c/Users/user/some/subdir', testConfig))
      .toBe('interactive');
  });

  it('should fall back to defaultComponent', () => {
    expect(resolveComponent('/unknown/path', testConfig))
      .toBe('other');
  });

  it('should handle empty CWD', () => {
    expect(resolveComponent('', testConfig))
      .toBe('other');
  });

  it('should auto-detect from repo name matching component name', () => {
    const config: TrackerConfig = {
      components: {
        myProject: { patterns: [] }, // no patterns, but name matches
      },
      defaultComponent: 'other',
    };
    expect(resolveComponent('/home/user/repos/myProject', config))
      .toBe('myProject');
  });
});
