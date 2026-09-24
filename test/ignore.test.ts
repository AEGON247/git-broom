import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendToGitIgnore,
  formatIgnorePattern,
  getGitIgnorePath,
  isPatternIgnored,
  readGitIgnore,
} from '../src/ignore.js';

describe('ignore.ts', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-test-ignore-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('correctly resolves root .gitignore path', () => {
    const gitignorePath = getGitIgnorePath(tmpDir);
    expect(gitignorePath).toBe(path.join(tmpDir, '.gitignore'));
  });

  it('reads empty string if .gitignore does not exist', async () => {
    const content = await readGitIgnore(tmpDir);
    expect(content).toBe('');
  });

  it('correctly formats ignore patterns for files and directories', () => {
    expect(formatIgnorePattern('node_modules', true)).toBe('node_modules/');
    expect(formatIgnorePattern('dist/', true)).toBe('dist/');
    expect(formatIgnorePattern('.env', false)).toBe('.env');
    expect(formatIgnorePattern('config/.env.local', false)).toBe('config/.env.local');
    expect(formatIgnorePattern('/src/build', true)).toBe('src/build/');
  });

  it('checks if a pattern is already ignored', () => {
    const gitignoreContent = `
# Environment variables
.env
.env.*
node_modules/
/dist/
config/keys.json
`;

    expect(isPatternIgnored('.env', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('/.env', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('node_modules', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('node_modules/', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('dist', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('dist/', gitignoreContent)).toBe(true);
    expect(isPatternIgnored('config/keys.json', gitignoreContent)).toBe(true);

    // Non-ignored patterns
    expect(isPatternIgnored('secret.pem', gitignoreContent)).toBe(false);
    expect(isPatternIgnored('build', gitignoreContent)).toBe(false);
  });

  it('appends pattern to new .gitignore with guaranteed trailing newline', async () => {
    const res = await appendToGitIgnore('.env', tmpDir, false);
    expect(res.updated).toBe(true);
    expect(res.alreadyIgnored).toBe(false);
    expect(res.pattern).toBe('.env');

    const content = await fs.promises.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('.env\n');
  });

  it('does not duplicate existing patterns in .gitignore', async () => {
    await fs.promises.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n.env\n', 'utf8');

    const res = await appendToGitIgnore('.env', tmpDir, false);
    expect(res.updated).toBe(false);
    expect(res.alreadyIgnored).toBe(true);

    const content = await fs.promises.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules/\n.env\n');
  });

  it('handles existing .gitignore without trailing newline cleanly', async () => {
    await fs.promises.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules', 'utf8');

    const res = await appendToGitIgnore('.env', tmpDir, false);
    expect(res.updated).toBe(true);

    const content = await fs.promises.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules\n.env\n');
  });

  it('does not modify file if dryRun is true', async () => {
    const res = await appendToGitIgnore('.env', tmpDir, false, true);
    expect(res.updated).toBe(true);
    expect(res.alreadyIgnored).toBe(false);

    const exists = fs.existsSync(path.join(tmpDir, '.gitignore'));
    expect(exists).toBe(false);
  });
});
