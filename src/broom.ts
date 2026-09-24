import fs from 'node:fs';
import { createLocalBackup } from './backup.js';
import {
  checkPathTracked,
  commitChanges,
  getPurgeTool,
  getRepoRoot,
  hasStagedChanges,
  isInsideGitRepo,
  purgeHistory,
  stageFile,
  untrackPath,
} from './git.js';
import { appendToGitIgnore } from './ignore.js';
import type { BroomOptions, BroomSummary, GitIgnoreResult, PathTrackStatus } from './types.js';

export interface BroomCallbacks {
  onProgress?: (message: string) => void;
}

/**
 * Programmatic API for git-broom.
 * Untracks target paths, updates .gitignore, and optionally creates a commit or purges history.
 */
export async function broom(
  rawPaths: string[],
  options: BroomOptions = {},
  callbacks: BroomCallbacks = {},
  cwd: string = process.cwd()
): Promise<BroomSummary> {
  const isGit = await isInsideGitRepo(cwd);
  if (!isGit) {
    throw new Error('Current directory is not a Git repository (or any parent directory).');
  }

  const repoRoot = await getRepoRoot(cwd);

  if (rawPaths.length === 0) {
    throw new Error('No target paths provided to broom.');
  }

  const statuses: PathTrackStatus[] = [];
  for (const rawPath of rawPaths) {
    const status = await checkPathTracked(rawPath, repoRoot, cwd);
    if (!status.isTracked && !status.existsOnDisk) {
      throw new Error(`Path "${rawPath}" does not exist on disk and is not tracked by Git.`);
    }
    statuses.push(status);
  }

  const normalizedPaths = statuses.map((s) => s.normalizedRelative);
  const defaultCommitMsg = options.purgeHistory
    ? `chore: purge ${normalizedPaths.join(', ')} from history and add to .gitignore`
    : `chore: untrack ${normalizedPaths.join(', ')} and add to .gitignore`;
  const commitMessage = options.message || defaultCommitMsg;
  const shouldCommit = options.commit !== false;
  const keepLocal = options.keepLocal !== false && !options.hardDelete;
  const hardDelete = Boolean(options.hardDelete);

  let purgeTool: 'git-filter-repo' | 'git-filter-branch' | undefined;
  if (options.purgeHistory) {
    const detected = await getPurgeTool();
    if (!detected) {
      throw new Error(
        'History purge requested, but neither git-filter-repo nor git-filter-branch is available.'
      );
    }
    purgeTool = detected;
  }

  // Dry run short-circuit
  if (options.dryRun) {
    const gitignoreResults: GitIgnoreResult[] = statuses.map((s) => ({
      updated: true,
      alreadyIgnored: false,
      pattern: s.normalizedRelative + (s.isDirectory ? '/' : ''),
      gitignorePath: `${repoRoot}/.gitignore`,
    }));

    return {
      repoRoot,
      paths: statuses,
      untrackedFiles: statuses.flatMap((s) => s.matchedFiles),
      gitignoreResults,
      committed: shouldCommit,
      commitHash: shouldCommit ? 'DRY_RUN_COMMIT' : undefined,
      commitMessage: shouldCommit ? commitMessage : undefined,
      historyPurged: Boolean(options.purgeHistory),
      purgeTool,
      localFilesDeleted: hardDelete,
      dryRun: true,
    };
  }

  const allUntrackedFiles: string[] = [];
  const gitignoreResults: GitIgnoreResult[] = [];
  let committed = false;
  let commitHash: string | undefined;

  if (options.purgeHistory && purgeTool) {
    callbacks.onProgress?.(`Backing up local files before history purge...`);
    let backup: Awaited<ReturnType<typeof createLocalBackup>> | null = null;
    if (keepLocal) {
      backup = await createLocalBackup(statuses);
    }

    callbacks.onProgress?.(`Expunging ${normalizedPaths.join(', ')} from Git history with ${purgeTool}...`);
    await purgeHistory(normalizedPaths, repoRoot, purgeTool);

    if (backup && keepLocal) {
      callbacks.onProgress?.(`Restoring local files to disk...`);
      await backup.restore();
      await backup.cleanup();
    }

    if (hardDelete) {
      callbacks.onProgress?.(`Deleting files from disk (--hard-delete)...`);
      for (const status of statuses) {
        if (fs.existsSync(status.absolutePath)) {
          await fs.promises.rm(status.absolutePath, { recursive: true, force: true });
        }
      }
    }

    callbacks.onProgress?.(`Updating .gitignore...`);
    for (const status of statuses) {
      const gi = await appendToGitIgnore(
        status.normalizedRelative,
        repoRoot,
        status.isDirectory
      );
      gitignoreResults.push(gi);
    }

    await stageFile('.gitignore', repoRoot);

    if (shouldCommit) {
      const hasChanges = await hasStagedChanges(repoRoot);
      if (hasChanges) {
        callbacks.onProgress?.(`Creating Git commit...`);
        const commitRes = await commitChanges(commitMessage, repoRoot);
        committed = true;
        commitHash = commitRes.commitHash;
      }
    }
  } else {
    // Normal untrack
    callbacks.onProgress?.('Untracking files from Git index...');
    for (const status of statuses) {
      if (status.isTracked) {
        const files = await untrackPath(status.normalizedRelative, repoRoot);
        allUntrackedFiles.push(...files);
      }
    }

    if (hardDelete) {
      callbacks.onProgress?.('Deleting files from disk (--hard-delete)...');
      for (const status of statuses) {
        if (fs.existsSync(status.absolutePath)) {
          await fs.promises.rm(status.absolutePath, { recursive: true, force: true });
        }
      }
    }

    callbacks.onProgress?.('Updating .gitignore...');
    for (const status of statuses) {
      const gi = await appendToGitIgnore(
        status.normalizedRelative,
        repoRoot,
        status.isDirectory
      );
      gitignoreResults.push(gi);
    }

    await stageFile('.gitignore', repoRoot);

    if (shouldCommit) {
      const hasChanges = await hasStagedChanges(repoRoot);
      if (hasChanges) {
        callbacks.onProgress?.('Creating structured Git commit...');
        const commitRes = await commitChanges(commitMessage, repoRoot);
        committed = true;
        commitHash = commitRes.commitHash;
      }
    }
  }

  return {
    repoRoot,
    paths: statuses,
    untrackedFiles: allUntrackedFiles,
    gitignoreResults,
    committed,
    commitHash,
    commitMessage: committed ? commitMessage : undefined,
    historyPurged: Boolean(options.purgeHistory),
    purgeTool,
    localFilesDeleted: hardDelete,
    dryRun: false,
  };
}
