# 🧹 git-broom

> Production-ready CLI to safely untrack Git files, update `.gitignore`, and optionally purge sensitive leaks from commit history.

[![npm version](https://img.shields.io/npm/v/@sachin-dev/git-broom.svg)](https://www.npmjs.com/package/@sachin-dev/git-broom)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
![NPM](https://img.shields.io/npm/dt/@sachin-dev/git-broom)

Have you ever accidentally committed a `.env`, API credentials, `dist/`, or `node_modules/` to your Git repository?

Fixing it normally requires multiple error-prone steps:
1. Remembering the exact syntax for `git rm --cached -r <path>`.
2. Hoping you didn't accidentally delete your local working copy on disk.
3. Remembering to add the pattern to `.gitignore` and format it properly without duplicates.
4. Staging `.gitignore` and crafting a commit.
5. Realizing your secrets are still visible in past commits anyway!

**`git-broom` automates all of this in a single, safe, beautiful command.**

---

## ⚡ Quick Start

Install globally:

```bash
npm install -g @sachin-dev/git-broom
```

Because of Git's plugin architecture, you can now run it either directly or as a native Git subcommand:

```bash
# As a native Git subcommand
git broom .env

# Or directly as a standalone CLI
git-broom .env

# Or execute on demand with npx
npx @sachin-dev/git-broom .env
```

---

## ✨ Features

- 🛡️ **Non-Destructive by Default:** Uses `git rm --cached -r` to remove items from the Git index while keeping your local files on disk 100% intact.
- 📝 **Smart `.gitignore` Integration:** Locates the repository root `.gitignore`, deduplicates entries, handles trailing slashes for directories, and guarantees valid newline termination.
- 📦 **Automated Commits:** Stages `.gitignore` alongside untracked files and generates a structured commit message automatically (customizable with `-m`).
- 🔥 **Deep History Purge (`--purge-history` / `--scrub`):** Expunges sensitive files from every past commit across all branches using `git-filter-repo` (or `git filter-branch` fallback).
- ↩️ **Instant Merge Reverts (`undo`):** Undo accidental merge requests directly from the terminal without opening a secondary pull request.
- 💾 **Local File Protection on Purge:** Even during history rewrites, `git-broom` backs up your local files before purging and restores them to disk afterwards.
- 🔍 **Dry-Run Simulation (`--dry-run`):** Inspect exact planned Git index removals, `.gitignore` entries, and commit messages before executing any mutations.
- 🗑️ **Opt-In Hard Deletion (`--hard-delete`):** Need the file completely wiped from both Git and your filesystem? Pass `--hard-delete` with safety confirmation.
- 🎨 **Modern Interactive Terminal UI:** Built with `@clack/prompts`, `picocolors`, and `ora` spinners with graceful fallback for CI/non-interactive terminals.

---

## 🚀 Usage Examples

### 1. Safe Untrack & Ignore (Default)

Untracks `.env` from Git tracking, appends `.env` to `.gitignore`, stages both, and creates a clean commit:

```bash
git broom .env
```

### 2. Untrack Directories

Recursively removes build artifacts or folders:

```bash
git broom dist/ build/
```

### 3. Custom Commit Message

Override the default commit message (`chore: untrack <path> and add to .gitignore`):

```bash
git broom .env -m "chore(security): untrack local environment config"
```

### 4. Stage Only (No Commit)

Prepare index and `.gitignore` changes without creating a commit:

```bash
git broom .env --no-commit
```

### 5. Dry-Run Preview

Simulate operations without touching your repository:

```bash
git broom secret-keys.json --dry-run
```

```text
🔍 DRY-RUN MODE: No changes will be applied to your repository.

Repository Root: C:/dev/my-project

Planned Operations:
  • Target: secret-keys.json (file)
    - Git Index: git rm --cached -r (1 file(s) currently indexed)
    - .gitignore: Appending pattern "secret-keys.json"
    - Local Disk: PRESERVE untouched on filesystem

  • Git Commit: "chore: untrack secret-keys.json and add to .gitignore"

Run again without --dry-run to execute these changes.
```

### 6. Deep History Purge (`--purge-history` / `--scrub`)

Expunge sensitive leaks (e.g. `.env`, passwords, private keys) from all past commits and tags:

```bash
git broom .env --purge-history
```

> [!WARNING]
> Purging history rewrites all past commit hashes. `git-broom` will display an explicit confirmation prompt with details before proceeding (unless `-y` / `--force` is passed).
>
> After purging history, push your rewritten branches with:
> ```bash
> git push origin --force-with-lease --all && git push origin --force-with-lease --tags
> ```

### 7. Revert Accidental Merge Requests (Undo)

Undo the latest merge commit interactively, or provide its commit SHA directly:

```bash
git broom undo
git broom undo <sha>
```

Add `--push` to automatically push the resulting revert commit to the current branch on `origin`:

```bash
git broom undo <sha> --push
```

Use `--dry-run` to preview changed files and the planned commit, `-m` / `--message` to override its message, and `-y` / `--yes` to bypass confirmation prompts.

---

## ⚙️ Options & Flags

| Flag | Shorthand | Description | Default |
| :--- | :--- | :--- | :--- |
| `-m, --message <msg>` | `-m` | Custom Git commit message | `chore: untrack <path> and add to .gitignore` |
| `--no-commit` | | Stage changes in Git index without creating a commit | `false` |
| `--purge-history` | `--scrub` | Expunge target paths from entire Git commit history across all branches | `false` |
| `undo [commit-sha]` | `revert` | Revert a merge commit using its first parent as the mainline | |
| `--push` | | Push the undo commit to `origin/<current-branch>` | `false` |
| `--dry-run` | | Simulate actions and display planned changes without modifying repository | `false` |
| `--keep-local` | | Explicitly preserve local files on disk | `true` |
| `--hard-delete` | | Permanently delete target files from disk in addition to Git index | `false` |
| `-y, --yes`, `--force` | `-f` | Bypass interactive confirmation prompts (useful for scripts & CI) | `false` |
| `-v, --version` | | Output version number | |
| `-h, --help` | | Display help and usage information | |

---

## 💻 Programmatic API

`git-broom` exports fully-typed TypeScript functions for programmatic usage in custom scripts and developer toolchains:

```typescript
import { broom, undoMerge, untrackPath, appendToGitIgnore } from 'git-broom';

// Run broom programmatically
const result = await broom(['.env', 'build/'], {
  commit: true,
  message: 'chore: untrack build and secrets',
  keepLocal: true,
});

console.log(result.commitHash);
console.log(result.untrackedFiles);

// Revert a merge commit programmatically
const undo = await undoMerge('merge-commit-sha', {
  message: 'chore: undo accidental merge',
  dryRun: true,
});
console.log(undo.affectedFiles);
```

### Exported Functions

- `broom(paths, options, callbacks, cwd)`: Main orchestration function.
- `isInsideGitRepo(cwd)`: Check if target path is in a Git workspace.
- `getRepoRoot(cwd)`: Retrieve canonical repository root path.
- `checkPathTracked(path, repoRoot, cwd)`: Inspect tracking status of a file or directory.
- `untrackPath(path, repoRoot)`: Remove path from Git cache (`git rm --cached -r`).
- `appendToGitIgnore(path, repoRoot, isDirectory)`: Smart, deduplicated `.gitignore` appending.
- `purgeHistory(paths, repoRoot, tool)`: Deep history rewrite.
- `undoMerge(commitSha, options)`: Revert a merge commit with mainline parent 1; supports a custom message, dry-run preview, and optional push.
- `getPurgeTool()`: Check for `git-filter-repo` or `git filter-branch`.

---

## 🔧 Troubleshooting

### 1. `Notice: "<path>" is not tracked by Git`
If the file is not currently tracked by Git, `git-broom` will detect this and ask if you would like to add it to `.gitignore` anyway. This avoids unnecessary index removal errors while ensuring your file remains ignored in future commits.

### 2. History Purge Requirements
`--purge-history` prefers `git-filter-repo` (recommended by the Git project):
```bash
# Install git-filter-repo via pip
pip install git-filter-repo
```
If `git-filter-repo` is not installed, `git-broom` automatically falls back to Git's built-in `git filter-branch`.

### 3. Pushing After History Purge
Because purging history rewrites commit SHAs, a regular `git push` will be rejected by the remote. Always use:
```bash
git push --force-with-lease --all && git push --force-with-lease --tags
```
Ensure you notify collaborators so they can rebase or re-clone their local copies.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
To run tests locally:

```bash
git clone https://github.com/your-username/git-broom.git
cd git-broom
npm install
npm test
npm run build
```

---

## 📄 License

[MIT](LICENSE) © Sachin Mehta
