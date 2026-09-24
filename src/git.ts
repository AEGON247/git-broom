import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { PathTrackStatus } from './types.js';

export interface ExecGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Execute a Git command and return stdout, stderr, and exit code.
 */
export function execGit(args: string[], cwd?: string): Promise<ExecGitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        env: {
          ...process.env,
          // Squelch git-filter-branch deprecation warning banner to prevent noisy output
          FILTER_BRANCH_SQUELCH_WARNING: '1',
        },
        maxBuffer: 20 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        if (error && exitCode !== 0) {
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode,
          });
        } else {
          resolve({
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
          });
        }
      }
    );
  });
}

/**
 * Check whether the current working directory is inside a Git repository.
 */
export async function isInsideGitRepo(cwd?: string): Promise<boolean> {
  try {
    const res = await execGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return res.exitCode === 0 && res.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Get the top-level root directory of the current Git repository.
 */
export async function getRepoRoot(cwd?: string): Promise<string> {
  const res = await execGit(['rev-parse', '--show-toplevel'], cwd);
  if (res.exitCode !== 0 || !res.stdout.trim()) {
    throw new Error('Not inside a Git repository or unable to locate repository root.');
  }
  const rawPath = path.resolve(res.stdout.trim());
  try {
    return fs.realpathSync.native(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * Resolve a path to its real canonical path where possible.
 * If the path or subdirectories do not exist yet on disk,
 * walks up until an existing parent directory is found.
 */
export function getCanonicalPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  let curr = resolved;
  const parts: string[] = [];

  while (!fs.existsSync(curr)) {
    const parent = path.dirname(curr);
    if (parent === curr) break;
    parts.unshift(path.basename(curr));
    curr = parent;
  }

  try {
    const canonicalBase = fs.realpathSync.native(curr);
    return parts.length > 0 ? path.join(canonicalBase, ...parts) : canonicalBase;
  } catch {
    return resolved;
  }
}

/**
 * Normalize a given path relative to the Git repository root using POSIX slashes.
 */
export function normalizeGitPath(rawPath: string, repoRoot: string, cwd: string = process.cwd()): string {
  const resolved = path.resolve(cwd, rawPath);
  const canonicalResolved = getCanonicalPath(resolved);
  const canonicalRepoRoot = getCanonicalPath(repoRoot);

  const rel = path.relative(canonicalRepoRoot, canonicalResolved);

  // Normalize Windows backslashes to forward slashes
  const posix = rel.split(path.sep).join('/');

  return posix;
}

/**
 * Check whether a target path is tracked by Git and get details on matching files.
 */
export async function checkPathTracked(
  rawPath: string,
  repoRoot: string,
  cwd: string = process.cwd()
): Promise<PathTrackStatus> {
  const absolutePath = path.resolve(cwd, rawPath);
  const normalizedRelative = normalizeGitPath(rawPath, repoRoot, cwd);

  if (normalizedRelative.startsWith('..')) {
    throw new Error(`Target path "${rawPath}" is outside the Git repository root.`);
  }

  if (normalizedRelative === '' || normalizedRelative === '.') {
    throw new Error('Cannot untrack the entire repository root directory.');
  }

  const existsOnDisk = fs.existsSync(absolutePath);
  let isDirectory = false;
  if (existsOnDisk) {
    try {
      isDirectory = fs.statSync(absolutePath).isDirectory();
    } catch {
      isDirectory = false;
    }
  } else {
    // If not on disk, check if user provided a trailing slash or if git knows it as directory
    isDirectory = rawPath.endsWith('/') || rawPath.endsWith('\\');
  }

  // Query git ls-files for this path
  const lsRes = await execGit(['ls-files', '--', normalizedRelative], repoRoot);
  let matchedFiles = lsRes.stdout
    .trim()
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Also query git ls-files --error-unmatch directly
  const unmatchRes = await execGit(['ls-files', '--error-unmatch', '--', normalizedRelative], repoRoot);
  const isTracked = unmatchRes.exitCode === 0 || matchedFiles.length > 0;

  if (matchedFiles.length === 0 && unmatchRes.exitCode === 0) {
    matchedFiles = unmatchRes.stdout
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    rawPath,
    normalizedRelative,
    absolutePath,
    isTracked,
    existsOnDisk,
    isDirectory,
    matchedFiles,
  };
}

/**
 * Untrack a file or directory from the Git index without removing local files.
 * Uses `git rm --cached -r -- <path>`.
 */
export async function untrackPath(normalizedRelative: string, repoRoot: string): Promise<string[]> {
  const res = await execGit(['rm', '--cached', '-r', '--', normalizedRelative], repoRoot);
  if (res.exitCode !== 0) {
    throw new Error(
      `Failed to untrack "${normalizedRelative}" from Git index: ${res.stderr || res.stdout}`
    );
  }

  // Parse lines: rm 'path/to/file'
  const lines = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const untracked: string[] = [];
  for (const line of lines) {
    const match = line.match(/^rm\s+['"]?(.+?)['"]?$/);
    if (match && match[1]) {
      untracked.push(match[1]);
    } else {
      untracked.push(line);
    }
  }

  return untracked.length > 0 ? untracked : [normalizedRelative];
}

/**
 * Stage a file in Git (e.g. .gitignore).
 */
export async function stageFile(relativeFilePath: string, repoRoot: string): Promise<void> {
  const res = await execGit(['add', '--', relativeFilePath], repoRoot);
  if (res.exitCode !== 0) {
    throw new Error(`Failed to stage "${relativeFilePath}": ${res.stderr || res.stdout}`);
  }
}

/**
 * Check if there are staged changes ready to be committed.
 */
export async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  const res = await execGit(['diff', '--cached', '--quiet'], repoRoot);
  return res.exitCode !== 0;
}

/**
 * Commit currently staged changes with a message.
 */
export async function commitChanges(
  message: string,
  repoRoot: string
): Promise<{ commitHash: string; branch: string }> {
  const res = await execGit(['commit', '-m', message], repoRoot);
  if (res.exitCode !== 0) {
    throw new Error(`Git commit failed: ${res.stderr || res.stdout}`);
  }

  const hashRes = await execGit(['rev-parse', '--short', 'HEAD'], repoRoot);
  const branchRes = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);

  return {
    commitHash: hashRes.stdout.trim() || 'HEAD',
    branch: branchRes.stdout.trim() || 'HEAD',
  };
}

/**
 * Determine which history purge tool is available on the user's system.
 * Prefers git-filter-repo, falls back to git-filter-branch.
 */
export async function getPurgeTool(): Promise<'git-filter-repo' | 'git-filter-branch' | null> {
  // Check git-filter-repo first
  const filterRepoRes = await execGit(['filter-repo', '--version']);
  if (filterRepoRes.exitCode === 0) {
    return 'git-filter-repo';
  }

  // Check git-filter-branch fallback
  const filterBranchRes = await execGit(['filter-branch', '--help']);
  if (filterBranchRes.exitCode === 0 || filterBranchRes.stdout.includes('filter-branch') || filterBranchRes.stderr.includes('filter-branch')) {
    return 'git-filter-branch';
  }

  return null;
}

/**
 * Execute deep Git history purging for specified paths.
 */
export async function purgeHistory(
  normalizedPaths: string[],
  repoRoot: string,
  tool: 'git-filter-repo' | 'git-filter-branch'
): Promise<void> {
  if (normalizedPaths.length === 0) return;

  if (tool === 'git-filter-repo') {
    const args = ['filter-repo', '--invert-paths', ...normalizedPaths.flatMap((p) => ['--path', p]), '--force'];
    const res = await execGit(args, repoRoot);
    if (res.exitCode !== 0) {
      throw new Error(`git-filter-repo failed: ${res.stderr || res.stdout}`);
    }
  } else {
    // Fallback to git filter-branch
    // Shell command inside index-filter: git rm --cached --ignore-unmatch -r -- <paths...>
    const pathArgs = normalizedPaths.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(' ');
    const filterCmd = `git rm --cached --ignore-unmatch -r -- ${pathArgs}`;
    const args = [
      'filter-branch',
      '--force',
      '--index-filter',
      filterCmd,
      '--prune-empty',
      '--tag-name-filter',
      'cat',
      '--',
      '--all',
    ];
    const res = await execGit(args, repoRoot);
    if (res.exitCode !== 0) {
      throw new Error(`git filter-branch failed: ${res.stderr || res.stdout}`);
    }
  }
}
