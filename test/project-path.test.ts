import { describe, it, expect } from 'vitest';
import { decodeProjectPath, extractRepoName } from '../src/parser/project-path.js';

describe('decodeProjectPath', () => {
  it('returns directory name unchanged when it does not start with -', () => {
    expect(decodeProjectPath('myProject')).toBe('myProject');
  });

  it('decodes -home- prefix to /home/', () => {
    expect(decodeProjectPath('-home-user-repos-myProject'))
      .toBe('/home/user/repos/myProject');
  });

  it('decodes -mnt-c-Users- prefix for WSL paths', () => {
    expect(decodeProjectPath('-mnt-c-Users-npezarro-repos-app'))
      .toBe('/mnt/c/Users/npezarro/repos/app');
  });

  it('decodes -mnt-d- prefix', () => {
    expect(decodeProjectPath('-mnt-d-projects-web'))
      .toBe('/mnt/d/projects/web');
  });

  it('decodes -root- prefix', () => {
    expect(decodeProjectPath('-root-app'))
      .toBe('/root/app');
  });

  it('decodes -tmp- prefix', () => {
    expect(decodeProjectPath('-tmp-scratch'))
      .toBe('/tmp/scratch');
  });

  it('decodes unknown prefixes starting with - using fallback', () => {
    expect(decodeProjectPath('-var-www-html'))
      .toBe('/var/www/html');
  });

  it('handles single component after prefix', () => {
    expect(decodeProjectPath('-home-user'))
      .toBe('/home/user');
  });

  it('handles deeply nested paths', () => {
    expect(decodeProjectPath('-home-user-a-b-c-d-e'))
      .toBe('/home/user/a/b/c/d/e');
  });

  it('returns empty string input unchanged', () => {
    expect(decodeProjectPath('')).toBe('');
  });
});

describe('extractRepoName', () => {
  it('extracts last path component', () => {
    expect(extractRepoName('/home/user/repos/myProject')).toBe('myProject');
  });

  it('handles single component path', () => {
    expect(extractRepoName('/myProject')).toBe('myProject');
  });

  it('handles trailing slash', () => {
    expect(extractRepoName('/home/user/repos/app/')).toBe('app');
  });

  it('returns null for empty string', () => {
    expect(extractRepoName('')).toBeNull();
  });

  it('handles path with hyphens in repo name', () => {
    expect(extractRepoName('/home/user/repos/my-awesome-project'))
      .toBe('my-awesome-project');
  });

  it('handles Windows-style WSL paths', () => {
    expect(extractRepoName('/mnt/c/Users/user/repos/app'))
      .toBe('app');
  });
});
