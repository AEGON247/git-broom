import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectMergeCommit, undoMerge } from '../src/undo.js';

describe('undoMerge', () => {
  let tmpRepo: string;
  let mergeSha: string;

  beforeEach(async () => {
    tmpRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-undo-test-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpRepo });
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: tmpRepo });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
    await fs.promises.writeFile(path.join(tmpRepo, 'base.txt'), 'base\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: tmpRepo });
    execFileSync('git', ['switch', '-c', 'feature'], { cwd: tmpRepo });
    await fs.promises.writeFile(path.join(tmpRepo, 'merged.txt'), 'feature\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'feature change'], { cwd: tmpRepo });
    execFileSync('git', ['switch', 'main'], { cwd: tmpRepo });
    await fs.promises.writeFile(path.join(tmpRepo, 'main.txt'), 'main\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'main change'], { cwd: tmpRepo });
    execFileSync('git', ['merge', '--no-ff', 'feature', '-m', 'merge feature'], { cwd: tmpRepo });
    mergeSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpRepo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  it('inspects merge parents and affected files', async () => {
    const inspected = await inspectMergeCommit(mergeSha, tmpRepo);
    expect(inspected.parents).toHaveLength(2);
    expect(inspected.affectedFiles).toEqual(['merged.txt']);
  });

  it('previews without modifying the repository', async () => {
    const preview = await undoMerge(mergeSha, { dryRun: true, cwd: tmpRepo });
    expect(preview.dryRun).toBe(true);
    expect(preview.affectedFiles).toEqual(['merged.txt']);
    expect(preview.commitMessage).toBe(
      `chore(revert): undo merge commit ${preview.shortSha} [PR/MR revert]`
    );
    expect(fs.existsSync(path.join(tmpRepo, 'merged.txt'))).toBe(true);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tmpRepo, encoding: 'utf8' }).trim()).toBe(
      mergeSha
    );
  });

  it('creates a mainline revert commit with the requested message', async () => {
    const result = await undoMerge(mergeSha, {
      message: 'chore: revert accidental merge',
      cwd: tmpRepo,
    });
    expect(result.committed).toBe(true);
    expect(result.pushed).toBe(false);
    expect(result.commitMessage).toBe('chore: revert accidental merge');
    expect(fs.existsSync(path.join(tmpRepo, 'merged.txt'))).toBe(false);
    expect(execFileSync('git', ['log', '-1', '--pretty=%B'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim()).toBe('chore: revert accidental merge');
  });

  it('rejects non-merge commits', async () => {
    const parentSha = execFileSync('git', ['rev-parse', `${mergeSha}^1`], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    await expect(undoMerge(parentSha, { dryRun: true, cwd: tmpRepo })).rejects.toThrow(
      'is not a merge commit'
    );
  });

  it('refuses to mutate a dirty working tree', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'uncommitted.txt'), 'keep me\n', 'utf8');
    await expect(undoMerge(mergeSha, { cwd: tmpRepo })).rejects.toThrow(
      'working tree must be clean'
    );
    expect(fs.existsSync(path.join(tmpRepo, 'merged.txt'))).toBe(true);
  });
});
