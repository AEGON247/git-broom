import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { broom } from '../src/broom.js';

describe('broom integration tests', () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-e2e-'));
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

  it('safely untracks file, updates .gitignore, and commits without deleting local file', async () => {
    // 1. Setup tracked files
    await fs.promises.writeFile(path.join(tmpRepo, '.env'), 'SECRET_KEY=12345\n', 'utf8');
    await fs.promises.writeFile(path.join(tmpRepo, 'index.js'), 'console.log("hi");\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'feat: initial project setup'], { cwd: tmpRepo });

    // Verify .env is tracked
    const trackedBefore = execFileSync('git', ['ls-files', '--', '.env'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(trackedBefore).toBe('.env');

    // 2. Run broom
    const summary = await broom(['.env'], { commit: true }, {}, tmpRepo);

    expect(summary.committed).toBe(true);
    expect(summary.commitHash).toBeTruthy();
    expect(summary.commitMessage).toContain('untrack .env and add to .gitignore');

    // 3. Verify .env is NO LONGER tracked by Git
    const trackedAfter = execFileSync('git', ['ls-files', '--', '.env'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(trackedAfter).toBe('');

    // 4. Verify local .env file is COMPLETELY UNTOUCHED on disk
    expect(fs.existsSync(path.join(tmpRepo, '.env'))).toBe(true);
    const envContent = await fs.promises.readFile(path.join(tmpRepo, '.env'), 'utf8');
    expect(envContent).toBe('SECRET_KEY=12345\n');

    // 5. Verify .gitignore was created and contains .env
    const gitignoreContent = await fs.promises.readFile(path.join(tmpRepo, '.gitignore'), 'utf8');
    expect(gitignoreContent).toContain('.env');

    // 6. Verify Git status is clean
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(status).toBe('');
  });

  it('safely untracks directories recursively and ignores them', async () => {
    await fs.promises.mkdir(path.join(tmpRepo, 'build'));
    await fs.promises.writeFile(path.join(tmpRepo, 'build', 'bundle.js'), 'bundle content', 'utf8');
    await fs.promises.writeFile(path.join(tmpRepo, 'build', 'bundle.map'), 'sourcemap', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'build artifacts'], { cwd: tmpRepo });

    const summary = await broom(['build'], { commit: true }, {}, tmpRepo);

    expect(summary.untrackedFiles).toEqual(
      expect.arrayContaining(['build/bundle.js', 'build/bundle.map'])
    );

    // Verify files still on disk
    expect(fs.existsSync(path.join(tmpRepo, 'build', 'bundle.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpRepo, 'build', 'bundle.map'))).toBe(true);

    // Verify .gitignore contains build/
    const gitignoreContent = await fs.promises.readFile(path.join(tmpRepo, '.gitignore'), 'utf8');
    expect(gitignoreContent).toContain('build/');
  });

  it('leaves changes staged when --no-commit is used', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'secret.json'), '{}', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'add secret'], { cwd: tmpRepo });

    const summary = await broom(['secret.json'], { commit: false }, {}, tmpRepo);

    expect(summary.committed).toBe(false);

    // Staged changes must exist
    const diff = execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    });
    expect(diff).toContain('secret.json');
    expect(diff).toContain('.gitignore');
  });

  it('simulates actions without modifying repository under --dry-run', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'temp.log'), 'test', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'add temp.log'], { cwd: tmpRepo });

    const summary = await broom(['temp.log'], { dryRun: true }, {}, tmpRepo);

    expect(summary.dryRun).toBe(true);

    // temp.log must still be tracked in git index
    const tracked = execFileSync('git', ['ls-files', '--', 'temp.log'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('temp.log');

    // .gitignore must not exist
    expect(fs.existsSync(path.join(tmpRepo, '.gitignore'))).toBe(false);
  });

  it('removes file from disk when --hard-delete is specified', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'destroy-me.txt'), 'goodbye', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'add destroy-me'], { cwd: tmpRepo });

    const summary = await broom(
      ['destroy-me.txt'],
      { hardDelete: true, commit: true },
      {},
      tmpRepo
    );

    expect(summary.localFilesDeleted).toBe(true);

    // Must be deleted from disk
    expect(fs.existsSync(path.join(tmpRepo, 'destroy-me.txt'))).toBe(false);

    // Must be untracked from Git
    const tracked = execFileSync('git', ['ls-files', '--', 'destroy-me.txt'], {
      cwd: tmpRepo,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('');
  });

  it('deep purges file from Git history and preserves local file', async () => {
    // Commit 1: sensitive file added
    await fs.promises.writeFile(path.join(tmpRepo, '.env'), 'SUPER_SECRET_KEY=999\n', 'utf8');
    await fs.promises.writeFile(path.join(tmpRepo, 'readme.md'), '# Project\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: tmpRepo });
    execFileSync('git', ['commit', '-m', 'feat: initial commit with leak'], { cwd: tmpRepo });

    // Commit 2: another commit
    await fs.promises.writeFile(path.join(tmpRepo, 'readme.md'), '# Project Updated\n', 'utf8');
    execFileSync('git', ['commit', '-am', 'docs: update readme'], { cwd: tmpRepo });

    // Verify .env was in past commits
    const logBefore = execFileSync(
      'git',
      ['log', '--all', '--full-history', '--', '.env'],
      { cwd: tmpRepo, encoding: 'utf8' }
    ).trim();
    expect(logBefore).toBeTruthy();

    // Execute history purge
    const summary = await broom(
      ['.env'],
      { purgeHistory: true, commit: true, keepLocal: true },
      {},
      tmpRepo
    );

    expect(summary.historyPurged).toBe(true);

    // Verify .env is gone from past commits
    const logAfter = execFileSync(
      'git',
      ['log', '--all', '--full-history', '--', '.env'],
      { cwd: tmpRepo, encoding: 'utf8' }
    ).trim();
    expect(logAfter).toBe('');

    // Verify local .env file was RESTORED and still exists on disk!
    expect(fs.existsSync(path.join(tmpRepo, '.env'))).toBe(true);
    const content = await fs.promises.readFile(path.join(tmpRepo, '.env'), 'utf8');
    expect(content).toBe('SUPER_SECRET_KEY=999\n');

    // Verify .gitignore contains .env
    const gitignore = await fs.promises.readFile(path.join(tmpRepo, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
  });
});
