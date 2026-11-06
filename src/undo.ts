import { execGit, getRepoRoot } from './git.js';

export interface MergeCommit {
  sha: string;
  subject: string;
}

export interface UndoMergeOptions {
  message?: string;
  push?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

export interface UndoMergeResult {
  repoRoot: string;
  commitSha: string;
  shortSha: string;
  affectedFiles: string[];
  commitMessage: string;
  branch: string;
  dryRun: boolean;
  committed: boolean;
  pushed: boolean;
}

export interface InspectedMergeCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  affectedFiles: string[];
}

export async function listRecentMergeCommits(cwd?: string): Promise<MergeCommit[]> {
  const res = await execGit(['log', '--merges', '-n', '5', '--oneline'], cwd);
  if (res.exitCode !== 0) {
    throw new Error(`Failed to list merge commits: ${res.stderr || res.stdout}`);
  }

  return res.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{4,64})\s+(.+)$/i);
      if (!match || !match[1] || !match[2]) {
        throw new Error(`Unable to parse merge commit from git log output: "${line}"`);
      }
      return { sha: match[1], subject: match[2] };
    });
}

export async function inspectMergeCommit(
  commitSha: string,
  cwd?: string
): Promise<InspectedMergeCommit> {
  if (!/^[0-9a-f]{4,64}$/i.test(commitSha)) {
    throw new Error('Merge commit must be specified as a hexadecimal commit SHA.');
  }

  const commitRes = await execGit(['cat-file', '-p', commitSha], cwd);
  if (commitRes.exitCode !== 0) {
    throw new Error(`Unable to read commit "${commitSha}": ${commitRes.stderr || commitRes.stdout}`);
  }

  const parents = commitRes.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('parent '))
    .map((line) => line.slice('parent '.length).trim());
  if (parents.length < 2) {
    throw new Error(`Commit "${commitSha}" is not a merge commit (it has fewer than two parents).`);
  }

  const resolvedRes = await execGit(['rev-parse', '--verify', `${commitSha}^{commit}`], cwd);
  if (resolvedRes.exitCode !== 0 || !resolvedRes.stdout.trim()) {
    throw new Error(`Unable to resolve merge commit "${commitSha}": ${resolvedRes.stderr || resolvedRes.stdout}`);
  }
  const sha = resolvedRes.stdout.trim();

  const [shortRes, filesRes] = await Promise.all([
    execGit(['rev-parse', '--short', sha], cwd),
    execGit(['diff', '--name-only', `${sha}^1`, sha], cwd),
  ]);
  if (shortRes.exitCode !== 0) {
    throw new Error(`Unable to abbreviate merge commit "${sha}": ${shortRes.stderr || shortRes.stdout}`);
  }
  if (filesRes.exitCode !== 0) {
    throw new Error(`Unable to inspect changes for merge commit "${sha}": ${filesRes.stderr || filesRes.stdout}`);
  }

  return {
    sha,
    shortSha: shortRes.stdout.trim(),
    parents,
    affectedFiles: filesRes.stdout
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter(Boolean),
  };
}

export async function undoMerge(
  commitSha: string,
  options: UndoMergeOptions = {}
): Promise<UndoMergeResult> {
  if (options.message !== undefined && !options.message.trim()) {
    throw new Error('A custom commit message cannot be empty.');
  }

  const repoRoot = await getRepoRoot(options.cwd);
  const inspected = await inspectMergeCommit(commitSha, repoRoot);
  const commitMessage =
    options.message ?? `chore(revert): undo merge commit ${inspected.shortSha} [PR/MR revert]`;
  const branchRes = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  if (branchRes.exitCode !== 0 || !branchRes.stdout.trim()) {
    throw new Error(`Unable to determine the current branch: ${branchRes.stderr || branchRes.stdout}`);
  }
  const branch = branchRes.stdout.trim();

  if (options.push && branch === 'HEAD') {
    throw new Error('Cannot push the undo commit while in a detached HEAD state.');
  }

  if (options.dryRun) {
    return {
      repoRoot,
      commitSha: inspected.sha,
      shortSha: inspected.shortSha,
      affectedFiles: inspected.affectedFiles,
      commitMessage,
      branch,
      dryRun: true,
      committed: false,
      pushed: false,
    };
  }

  const statusRes = await execGit(['status', '--porcelain'], repoRoot);
  if (statusRes.exitCode !== 0) {
    throw new Error(`Unable to check repository status: ${statusRes.stderr || statusRes.stdout}`);
  }
  if (statusRes.stdout.trim()) {
    throw new Error('The working tree must be clean before undoing a merge commit.');
  }

  const revertRes = await execGit(
    ['revert', '-m', '1', inspected.sha, '--no-commit'],
    repoRoot
  );
  if (revertRes.exitCode !== 0) {
    throw new Error(`Git could not revert merge commit ${inspected.shortSha}: ${revertRes.stderr || revertRes.stdout}`);
  }

  const commitRes = await execGit(['commit', '-m', commitMessage], repoRoot);
  if (commitRes.exitCode !== 0) {
    throw new Error(
      `The merge revert was applied but its commit could not be created: ${commitRes.stderr || commitRes.stdout}`
    );
  }

  let pushed = false;
  if (options.push) {
    const pushRes = await execGit(['push', 'origin', branch], repoRoot);
    if (pushRes.exitCode !== 0) {
      throw new Error(
        `Undo commit ${inspected.shortSha} was created, but pushing to origin/${branch} failed: ${pushRes.stderr || pushRes.stdout}`
      );
    }
    pushed = true;
  }

  return {
    repoRoot,
    commitSha: inspected.sha,
    shortSha: inspected.shortSha,
    affectedFiles: inspected.affectedFiles,
    commitMessage,
    branch,
    dryRun: false,
    committed: true,
    pushed,
  };
}
