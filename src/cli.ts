#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { broom } from './broom.js';
import {
  checkPathTracked,
  getPurgeTool,
  getRepoRoot,
  isInsideGitRepo,
} from './git.js';
import type { BroomOptions, PathTrackStatus } from './types.js';
import {
  confirmAddToIgnoreUntracked,
  confirmHardDelete,
  confirmHistoryPurge,
  createSpinner,
  printBanner,
  printDryRunSimulation,
  printSummary,
  promptForPaths,
} from './ui.js';

const VERSION = '1.0.0';

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name('git-broom')
    .description(
      'Clean up mistakenly tracked files in Git: untrack, ignore, and commit safely in a single command.'
    )
    .version(VERSION, '-v, --version', 'Output the version number')
    .argument('[paths...]', 'File or directory paths to untrack and ignore')
    .option('-m, --message <msg>', 'Custom Git commit message')
    .option('--no-commit', 'Stage changes in Git index without creating a commit')
    .option('--purge-history', 'Expunge target paths from entire Git commit history across all branches')
    .option('--scrub', 'Alias for --purge-history')
    .option('-f, --force', 'Bypass all interactive confirmation prompts')
    .option('-y, --yes', 'Alias for --force')
    .option('--dry-run', 'Simulate actions and output planned changes without modifying repository')
    .option('--keep-local', 'Ensure local copies on disk are preserved (default: true)', true)
    .option('--hard-delete', 'Permanently delete files from filesystem in addition to Git')
    .helpOption('-h, --help', 'Display help for command');

  program.parse(argv);

  const opts = program.opts();
  const rawPaths: string[] = program.args;

  const options: BroomOptions = {
    message: opts.message,
    commit: opts.commit !== false,
    purgeHistory: Boolean(opts.purgeHistory || opts.scrub),
    force: Boolean(opts.force || opts.yes),
    dryRun: Boolean(opts.dryRun),
    keepLocal: opts.keepLocal !== false && !opts.hardDelete,
    hardDelete: Boolean(opts.hardDelete),
  };

  if (!options.dryRun) {
    printBanner(VERSION);
  }

  // 1. Verify Git repository workspace
  const isGit = await isInsideGitRepo();
  if (!isGit) {
    console.error(
      pc.red('Fatal error: Current directory is not a Git repository (or any parent directory).')
    );
    process.exit(1);
  }

  const repoRoot = await getRepoRoot();

  // 2. Resolve target paths (interactively prompt if not supplied)
  let targetPaths = rawPaths;
  if (targetPaths.length === 0) {
    if (process.stdin.isTTY) {
      targetPaths = await promptForPaths();
    } else {
      console.error(
        pc.red('Fatal error: No target paths specified. Use "git-broom <path>" or "git broom --help".')
      );
      process.exit(1);
    }
  }

  // 3. Inspect tracking status for all provided paths
  const statuses: PathTrackStatus[] = [];
  const pathsToProcess: string[] = [];

  for (const rawPath of targetPaths) {
    try {
      const status = await checkPathTracked(rawPath, repoRoot);
      if (!status.isTracked && !status.existsOnDisk) {
        console.error(
          pc.red(`Error: Path "${rawPath}" does not exist on disk and is not tracked by Git.`)
        );
        process.exit(1);
      }

      if (!status.isTracked && status.existsOnDisk) {
        let shouldAdd = options.force;
        if (!options.force && process.stdin.isTTY && !options.dryRun) {
          shouldAdd = await confirmAddToIgnoreUntracked(rawPath);
        } else if (!options.force && !options.dryRun) {
          console.log(
            pc.yellow(`Notice: "${rawPath}" is not tracked by Git. Adding to .gitignore.`)
          );
          shouldAdd = true;
        } else if (options.dryRun) {
          shouldAdd = true;
        }

        if (shouldAdd) {
          statuses.push(status);
          pathsToProcess.push(rawPath);
        }
      } else {
        statuses.push(status);
        pathsToProcess.push(rawPath);
      }
    } catch (err: any) {
      console.error(pc.red(`Error processing "${rawPath}": ${err.message}`));
      process.exit(1);
    }
  }

  if (pathsToProcess.length === 0) {
    console.log(pc.yellow('No matching files or paths to process.'));
    return;
  }

  const pathDisplayList = statuses.map((s) => s.normalizedRelative);

  // 4. Confirm destructive actions if requested
  if (options.hardDelete && !options.force && !options.dryRun) {
    if (!process.stdin.isTTY) {
      console.error(
        pc.red('Fatal: --hard-delete requires interactive confirmation or the -y/--force flag.')
      );
      process.exit(1);
    }
    const proceed = await confirmHardDelete(pathDisplayList);
    if (!proceed) {
      console.log(pc.yellow('Aborted: Hard delete was not confirmed.'));
      return;
    }
  }

  if (options.purgeHistory) {
    const purgeTool = await getPurgeTool();
    if (!purgeTool) {
      console.error(
        pc.red(
          'Fatal: History purge requested, but neither "git-filter-repo" nor "git filter-branch" was found.\n' +
            'Recommendation: Install git-filter-repo (e.g. "pip install git-filter-repo").'
        )
      );
      process.exit(1);
    }

    if (!options.force && !options.dryRun) {
      if (!process.stdin.isTTY) {
        console.error(
          pc.red(
            'Fatal: --purge-history rewrites Git history and requires confirmation or the -y/--force flag.'
          )
        );
        process.exit(1);
      }
      const proceed = await confirmHistoryPurge(pathDisplayList);
      if (!proceed) {
        console.log(pc.yellow('Aborted: History purge was not confirmed.'));
        return;
      }
    }
  }

  // 5. Handle Dry-Run Simulation
  if (options.dryRun) {
    const defaultCommitMsg = options.purgeHistory
      ? `chore: purge ${pathDisplayList.join(', ')} from history and add to .gitignore`
      : `chore: untrack ${pathDisplayList.join(', ')} and add to .gitignore`;
    const commitMessage = options.message || defaultCommitMsg;

    printDryRunSimulation({
      repoRoot,
      statuses,
      commitMessage,
      willCommit: Boolean(options.commit),
      purgeHistory: Boolean(options.purgeHistory),
      hardDelete: Boolean(options.hardDelete),
    });
    return;
  }

  // 6. Execute operations
  const spinner = createSpinner('Starting git-broom operations...').start();

  try {
    const summary = await broom(
      pathsToProcess,
      options,
      {
        onProgress: (msg) => {
          spinner.text = msg;
        },
      },
      repoRoot
    );

    spinner.succeed(
      pc.green(
        options.purgeHistory
          ? 'History successfully purged!'
          : 'Untrack and ignore complete!'
      )
    );

    printSummary(summary);
  } catch (error: any) {
    spinner.fail(pc.red(`Failed: ${error.message}`));
    process.exit(1);
  }
}

// Automatically invoke if executed directly as a script
runCli().catch((err) => {
  console.error(pc.red(`Unexpected fatal error: ${err.message}`));
  process.exit(1);
});
