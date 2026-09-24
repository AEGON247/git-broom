import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PathTrackStatus } from './types.js';

export interface FileBackup {
  backupDir: string;
  items: Array<{ relativePath: string; absolutePath: string }>;
  restore: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * Backup target files and folders to a temporary directory outside the repo
 * so they are never lost during history rewrites or index modifications.
 */
export async function createLocalBackup(
  statuses: PathTrackStatus[]
): Promise<FileBackup> {
  const backupDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'git-broom-backup-')
  );
  const items: Array<{ relativePath: string; absolutePath: string }> = [];

  for (const status of statuses) {
    if (status.existsOnDisk) {
      const destPath = path.join(backupDir, status.normalizedRelative);
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      await fs.promises.cp(status.absolutePath, destPath, {
        recursive: true,
      });
      items.push({
        relativePath: status.normalizedRelative,
        absolutePath: status.absolutePath,
      });
    }
  }

  const restore = async () => {
    for (const item of items) {
      const srcPath = path.join(backupDir, item.relativePath);
      if (fs.existsSync(srcPath)) {
        await fs.promises.mkdir(path.dirname(item.absolutePath), {
          recursive: true,
        });
        await fs.promises.cp(srcPath, item.absolutePath, {
          recursive: true,
          force: true,
        });
      }
    }
  };

  const cleanup = async () => {
    try {
      await fs.promises.rm(backupDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in tmp
    }
  };

  return {
    backupDir,
    items,
    restore,
    cleanup,
  };
}
