export interface BroomOptions {
  message?: string;
  commit?: boolean;
  purgeHistory?: boolean;
  scrub?: boolean;
  force?: boolean;
  dryRun?: boolean;
  keepLocal?: boolean;
  hardDelete?: boolean;
}

export interface PathTrackStatus {
  rawPath: string;
  normalizedRelative: string;
  absolutePath: string;
  isTracked: boolean;
  existsOnDisk: boolean;
  isDirectory: boolean;
  matchedFiles: string[];
}

export interface GitIgnoreResult {
  updated: boolean;
  alreadyIgnored: boolean;
  pattern: string;
  gitignorePath: string;
}

export interface BroomSummary {
  repoRoot: string;
  paths: PathTrackStatus[];
  untrackedFiles: string[];
  gitignoreResults: GitIgnoreResult[];
  committed: boolean;
  commitHash?: string;
  commitMessage?: string;
  historyPurged: boolean;
  purgeTool?: 'git-filter-repo' | 'git-filter-branch';
  localFilesDeleted: boolean;
  dryRun: boolean;
}
