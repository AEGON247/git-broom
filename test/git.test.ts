import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkPathTracked,
  commitChanges,
  getPurgeTool,
  getRepoRoot,
  hasStagedChanges,
  isInsideGitRepo,
  normalizeGitPath,
  stageFile,
  untrackPath,
} from '../src/git.js';

describe('git.ts', () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-test-git-'));
    // Initialize git repository
    execFileSync('git', ['init'], { cwd: tmpRepo });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: tmpRepo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpRepo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  it('detects git repo presence accurately', async () => {
    const isGit = await isInsideGitRepo(tmpRepo);
    expect(isGit).toBe(true);

    const nonGitDir = os.tmpdir();
    // Non-git dir (unless tmpdir happens to be a git root)
    const isTmpGit = await isInsideGitRepo(nonGitDir);
    expect(typeof isTmpGit).toBe('boolean');
  });

  it('retrieves git root directory', async () => {
    const root = await getRepoRoot(tmpRepo);
    expect(root.toLowerCase()).toBe(fs.realpathSync.native(tmpRepo).toLowerCase());
  });

  it('normalizes paths relative to repository root with POSIX slashes', () => {
    const norm = normalizeGitPath(path.join(tmpRepo, 'sub', 'file.txt'), tmpRepo);
    expect(norm).toBe('sub/file.txt');
  });

  it('identifies tracked files and directories correctly', async () => {
    // Create initial commit
    await fs.promises.writeFile(path.join(tmpRepo, '.env'), 'SECRET=key', 'utf8');
    await fs.promises.mkdir(path.join(tmpRepo, 'dist'));
    await fs.promises.writeFile(path.join(tmpRepo, 'dist', 'bundle.js'), 'code', 'utf8');

    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpRepo });

    const statusEnv = await checkPathTracked('.env', tmpRepo, tmpRepo);
    expect(statusEnv.isTracked).toBe(true);
    expect(statusEnv.existsOnDisk).toBe(true);
    expect(statusEnv.isDirectory).toBe(false);
    expect(statusEnv.matchedFiles).toContain('.env');

    const statusDist = await checkPathTracked('dist', tmpRepo, tmpRepo);
    expect(statusDist.isTracked).toBe(true);
    expect(statusDist.existsOnDisk).toBe(true);
    expect(statusDist.isDirectory).toBe(true);
    expect(statusDist.matchedFiles).toContain('dist/bundle.js');
  });

  it('identifies untracked files properly', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'untracked.txt'), 'hello', 'utf8');
    // We need at least one commit in git repo so git commands work
    await fs.promises.writeFile(path.join(tmpRepo, 'tracked.txt'), 'hello', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpRepo });

    const status = await checkPathTracked('untracked.txt', tmpRepo, tmpRepo);
    expect(status.isTracked).toBe(false);
    expect(status.existsOnDisk).toBe(true);
  });

  it('untracks path from index while leaving local copy intact', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'app.log'), 'data', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'add log'], { cwd: tmpRepo });

    const untracked = await untrackPath('app.log', tmpRepo);
    expect(untracked).toContain('app.log');

    // Verify file still exists on disk
    expect(fs.existsSync(path.join(tmpRepo, 'app.log'))).toBe(true);

    // Verify git shows it as deleted in index
    const diff = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    });
    expect(diff.trim()).toBe('app.log');
  });

  it('stages and commits changes', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'file.txt'), '1', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'first'], { cwd: tmpRepo });

    await fs.promises.writeFile(path.join(tmpRepo, '.gitignore'), 'file.txt\n', 'utf8');
    await stageFile('.gitignore', tmpRepo);

    const staged = await hasStagedChanges(tmpRepo);
    expect(staged).toBe(true);

    const commitResult = await commitChanges('chore: add .gitignore', tmpRepo);
    expect(commitResult.commitHash).toBeTruthy();

    const notStaged = await hasStagedChanges(tmpRepo);
    expect(notStaged).toBe(false);
  });

  it('finds purge tool (git-filter-repo or git filter-branch)', async () => {
    const tool = await getPurgeTool();
    expect(['git-filter-repo', 'git-filter-branch', null]).toContain(tool);
  });
});
