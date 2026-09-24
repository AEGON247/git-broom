import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('dist/cli.js');

describe('CLI interface tests', () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-cli-test-'));
    await execFileAsync('git', ['init'], { cwd: tmpRepo });
    await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: tmpRepo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tmpRepo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Ignore cleanup error on Windows
    }
  });

  it('prints version with -v and --version', async () => {
    const { stdout } = await execFileAsync('node', [cliPath, '--version']);
    expect(stdout.trim()).toBe('1.0.0');
  });

  it('prints help information with -h and --help', async () => {
    const { stdout } = await execFileAsync('node', [cliPath, '--help']);
    expect(stdout).toContain('git-broom [options] [paths...]');
    expect(stdout).toContain('--purge-history');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--hard-delete');
  });

  it('fails with exit code 1 outside a git repository', async () => {
    const nonGitDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'non-git-'));
    try {
      await execFileAsync('node', [cliPath, '.env'], { cwd: nonGitDir });
      expect.fail('Should have failed');
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr || err.stdout).toContain('Fatal error: Current directory is not a Git repository');
    } finally {
      await fs.promises.rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it('executes dry-run without altering repo', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'config.json'), '{"key":"secret"}', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tmpRepo });
    await execFileAsync('git', ['commit', '-m', 'add config'], { cwd: tmpRepo });

    const { stdout } = await execFileAsync('node', [cliPath, 'config.json', '--dry-run'], {
      cwd: tmpRepo,
    });

    expect(stdout).toContain('DRY-RUN MODE');
    expect(stdout).toContain('Planned Operations');
    expect(stdout).toContain('PRESERVE untouched on filesystem');

    // Verify config.json is still tracked
    const { stdout: lsOut } = await execFileAsync('git', ['ls-files', '--', 'config.json'], {
      cwd: tmpRepo,
    });
    expect(lsOut.trim()).toBe('config.json');

    // Verify .gitignore does not exist
    expect(fs.existsSync(path.join(tmpRepo, '.gitignore'))).toBe(false);
  });

  it('untracks and commits with custom message and -y flag', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, '.env'), 'KEY=123', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tmpRepo });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: tmpRepo });

    const customMsg = 'chore(git): remove .env from git tracking';
    const { stdout } = await execFileAsync(
      'node',
      [cliPath, '.env', '-m', customMsg, '-y'],
      { cwd: tmpRepo }
    );

    expect(stdout).toContain('git-broom completed successfully');
    expect(stdout).toContain(customMsg);

    // Verify git log
    const { stdout: logOut } = await execFileAsync('git', ['log', '-1', '--pretty=%B'], {
      cwd: tmpRepo,
    });
    expect(logOut.trim()).toBe(customMsg);

    // Verify file still on disk
    expect(fs.existsSync(path.join(tmpRepo, '.env'))).toBe(true);

    // Verify .gitignore
    const gitignore = await fs.promises.readFile(path.join(tmpRepo, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.env');
  });

  it('untracks without committing when --no-commit is passed', async () => {
    await fs.promises.writeFile(path.join(tmpRepo, 'debug.log'), 'test log', 'utf8');
    await execFileAsync('git', ['add', '.'], { cwd: tmpRepo });
    await execFileAsync('git', ['commit', '-m', 'initial commit'], { cwd: tmpRepo });

    const { stdout } = await execFileAsync(
      'node',
      [cliPath, 'debug.log', '--no-commit', '-y'],
      { cwd: tmpRepo }
    );

    expect(stdout).toContain('Changes staged without commit (--no-commit)');

    // Verify changes are staged
    const { stdout: diffOut } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only'],
      { cwd: tmpRepo }
    );
    expect(diffOut).toContain('debug.log');
    expect(diffOut).toContain('.gitignore');
  });
});
