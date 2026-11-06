import * as p from '@clack/prompts';
import ora, { type Ora } from 'ora';
import pc from 'picocolors';
import type { BroomSummary, PathTrackStatus } from './types.js';
import type { MergeCommit } from './undo.js';

export function printBanner(version = '1.0.0'): void {
  console.log();
  console.log(
    pc.bold(pc.cyan('  🧹 git-broom')) +
      pc.dim(` v${version}`) +
      pc.dim(' — Clean up mistakenly tracked files safely')
  );
  console.log();
}

export function createSpinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots',
  });
}

export async function promptForPaths(): Promise<string[]> {
  const result = await p.text({
    message: 'Enter the file or directory path to untrack and ignore:',
    placeholder: '.env, build, dist, secret.key',
    validate(value) {
      if (!value || !value.trim()) return 'Please enter at least one file or folder path.';
      return undefined;
    },
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }

  return (result as string)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function confirmHistoryPurge(paths: string[]): Promise<boolean> {
  console.log();
  console.log(
    pc.bgRed(pc.bold(pc.white(' ⚠️  CRITICAL WARNING: HISTORY PURGE ')))
  );
  console.log(
    pc.red(
      `You are about to expunge [${pc.bold(paths.join(', '))}] from your entire Git commit history!`
    )
  );
  console.log(
    pc.yellow(
      '• This will rewrite past commit hashes across all branches and tags.\n' +
      '• Any collaborator with a cloned copy will need to rebase or re-clone.\n' +
      '• Unpushed commits might be rewritten.'
    )
  );
  console.log();

  const confirmed = await p.confirm({
    message: pc.bold('Are you absolutely sure you want to rewrite history?'),
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }

  return true;
}

export async function confirmHardDelete(paths: string[]): Promise<boolean> {
  console.log();
  console.log(
    pc.bgRed(pc.bold(pc.white(' ⚠️  HARD DELETE REQUESTED ')))
  );
  console.log(
    pc.red(
      `Files at [${pc.bold(paths.join(', '))}] will be PERMANENTLY DELETED from your filesystem.`
    )
  );
  console.log();

  const confirmed = await p.confirm({
    message: pc.bold('Do you want to permanently delete these local files from disk?'),
    initialValue: false,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }

  return true;
}

export async function confirmAddToIgnoreUntracked(pathName: string): Promise<boolean> {
  const confirmed = await p.confirm({
    message: `"${pathName}" is already untracked by Git. Do you want to add it to .gitignore anyway?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed) || !confirmed) {
    return false;
  }

  return true;
}

export async function promptForMergeCommit(commits: MergeCommit[]): Promise<string | undefined> {
  const selected = await p.select({
    message: 'Select a merge commit to undo:',
    options: commits.map((commit) => ({
      value: commit.sha,
      label: `${commit.sha.slice(0, 7)} ${commit.subject}`,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel('Undo cancelled.');
    return undefined;
  }

  return selected;
}

export async function confirmUndoMerge(commitSha: string): Promise<boolean> {
  const confirmed = await p.confirm({
    message: `Undo merge commit ${commitSha}?`,
    initialValue: false,
  });
  return !p.isCancel(confirmed) && confirmed;
}

export async function confirmUndoPush(branch: string): Promise<boolean> {
  const confirmed = await p.confirm({
    message: `Push the undo commit to origin/${branch}?`,
    initialValue: false,
  });
  return !p.isCancel(confirmed) && confirmed;
}

export function printDryRunSimulation(params: {
  repoRoot: string;
  statuses: PathTrackStatus[];
  commitMessage: string;
  willCommit: boolean;
  purgeHistory: boolean;
  hardDelete: boolean;
}): void {
  console.log(pc.bold(pc.magenta('🔍 DRY-RUN MODE: No changes will be applied to your repository.')));
  console.log();
  console.log(pc.bold('Repository Root: ') + pc.dim(params.repoRoot));
  console.log();

  console.log(pc.bold('Planned Operations:'));
  for (const status of params.statuses) {
    console.log(
      `  • Target: ${pc.cyan(status.normalizedRelative)} ${
        status.isDirectory ? pc.dim('(directory)') : pc.dim('(file)')
      }`
    );
    if (status.isTracked) {
      console.log(
        `    - Git Index: ${pc.yellow('git rm --cached -r')} (${status.matchedFiles.length} file(s) currently indexed)`
      );
    } else {
      console.log(`    - Git Index: ${pc.dim('Already untracked in Git')}`);
    }
    console.log(`    - .gitignore: Appending pattern "${pc.green(status.normalizedRelative + (status.isDirectory ? '/' : ''))}"`);
    if (params.hardDelete) {
      console.log(`    - Local Disk: ${pc.red('PERMANENTLY DELETE from filesystem')}`);
    } else {
      console.log(`    - Local Disk: ${pc.green('PRESERVE untouched on filesystem')}`);
    }
  }

  console.log();
  if (params.purgeHistory) {
    console.log(
      `  • History Purge: ${pc.red('EXPUNGE from all commits across all branches')}`
    );
  }

  if (params.willCommit) {
    console.log(`  • Git Commit: ${pc.cyan(`"${params.commitMessage}"`)}`);
  } else {
    console.log(`  • Git Commit: ${pc.dim('Skipped (--no-commit flag set)')}`);
  }

  console.log();
  console.log(pc.dim('Run again without --dry-run to execute these changes.'));
  console.log();
}

export function printSummary(summary: BroomSummary): void {
  console.log();
  console.log(pc.bold(pc.green('✨ git-broom completed successfully!')));
  console.log();

  console.log(pc.bold('Summary:'));
  if (summary.historyPurged) {
    console.log(
      `  • Git History:      ${pc.red('Expunged across all commits')} ${pc.dim(`(via ${summary.purgeTool})`)}`
    );
  } else {
    console.log(
      `  • Untracked Files:  ${pc.cyan(summary.untrackedFiles.length.toString())} file(s) removed from Git index`
    );
  }

  for (const gi of summary.gitignoreResults) {
    if (gi.alreadyIgnored) {
      console.log(`  • .gitignore:       ${pc.yellow(gi.pattern)} ${pc.dim('(already present)')}`);
    } else {
      console.log(`  • .gitignore:       ${pc.green(`+ ${gi.pattern}`)} ${pc.dim('(added & staged)')}`);
    }
  }

  if (summary.localFilesDeleted) {
    console.log(`  • Local Files:      ${pc.red('Permanently deleted from disk (--hard-delete)')}`);
  } else {
    console.log(`  • Local Files:      ${pc.green('Untouched & safe on your filesystem')}`);
  }

  if (summary.committed) {
    console.log(
      `  • Git Commit:       ${pc.cyan(summary.commitHash || 'HEAD')} ${pc.dim(`"${summary.commitMessage}"`)}`
    );
  } else {
    console.log(`  • Git Commit:       ${pc.dim('Changes staged without commit (--no-commit)')}`);
  }

  if (summary.historyPurged) {
    console.log();
    console.log(
      pc.bgYellow(pc.bold(pc.black(' NEXT STEPS FOR HISTORY REWRITE ')))
    );
    console.log(
      pc.yellow(
        'Because commit hashes have changed, to update your remote repository, run:\n'
      ) +
        pc.bold(pc.cyan('  git push --force-with-lease --all && git push --force-with-lease --tags\n')) +
        pc.dim('Note: Notify all team members to re-clone or rebase their local branches.')
    );
  }

  console.log();
}
