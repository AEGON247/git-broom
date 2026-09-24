import fs from 'node:fs';
import path from 'node:path';
import type { GitIgnoreResult } from './types.js';

/**
 * Get the path to the root .gitignore file.
 */
export function getGitIgnorePath(repoRoot: string): string {
  return path.join(repoRoot, '.gitignore');
}

/**
 * Read the root .gitignore file, or return empty string if it does not exist.
 */
export async function readGitIgnore(repoRoot: string): Promise<string> {
  const gitignorePath = getGitIgnorePath(repoRoot);
  try {
    return await fs.promises.readFile(gitignorePath, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

/**
 * Clean a pattern string for normalized comparison.
 * Strips leading/trailing slashes and whitespace.
 */
function cleanPattern(p: string): string {
  return p.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Check whether a target pattern or path is already effectively covered in .gitignore.
 */
export function isPatternIgnored(pattern: string, gitignoreContent: string): boolean {
  const cleanedTarget = cleanPattern(pattern);
  if (!cleanedTarget) return false;

  const lines = gitignoreContent.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip empty lines and comment lines
    if (!line || line.startsWith('#')) {
      continue;
    }

    const cleanedLine = cleanPattern(line);

    // Exact pattern match (e.g. "dist" matches "dist", "dist/", "/dist/")
    if (cleanedLine === cleanedTarget) {
      return true;
    }

    // Direct string match against raw line
    if (line === pattern || line === `/${pattern}`) {
      return true;
    }
  }

  return false;
}

/**
 * Formats a relative path into a canonical .gitignore pattern.
 * If isDirectory is true, appends a trailing slash.
 */
export function formatIgnorePattern(normalizedRelativePath: string, isDirectory: boolean): string {
  let pattern = normalizedRelativePath.replace(/^\/+/, '');
  if (isDirectory && !pattern.endsWith('/')) {
    pattern = `${pattern}/`;
  }
  return pattern;
}

/**
 * Append a path or pattern to the root .gitignore file.
 * Avoids duplicate entries and guarantees a trailing newline.
 */
export async function appendToGitIgnore(
  normalizedRelativePath: string,
  repoRoot: string,
  isDirectory: boolean,
  dryRun: boolean = false
): Promise<GitIgnoreResult> {
  const gitignorePath = getGitIgnorePath(repoRoot);
  const pattern = formatIgnorePattern(normalizedRelativePath, isDirectory);
  const content = await readGitIgnore(repoRoot);

  if (isPatternIgnored(pattern, content)) {
    return {
      updated: false,
      alreadyIgnored: true,
      pattern,
      gitignorePath,
    };
  }

  if (dryRun) {
    return {
      updated: true,
      alreadyIgnored: false,
      pattern,
      gitignorePath,
    };
  }

  // Detect line ending (CRLF vs LF) from existing content if present
  const eol = content.includes('\r\n') ? '\r\n' : '\n';

  let newContent = content;
  if (newContent.length > 0 && !newContent.endsWith('\n') && !newContent.endsWith('\r')) {
    newContent += eol;
  }

  newContent += pattern + eol;

  await fs.promises.writeFile(gitignorePath, newContent, 'utf8');

  return {
    updated: true,
    alreadyIgnored: false,
    pattern,
    gitignorePath,
  };
}
