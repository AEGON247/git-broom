import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalBackup } from '../src/backup.js';
import type { PathTrackStatus } from '../src/types.js';

describe('backup.ts', () => {
  let tmpRepo: string;

  beforeEach(async () => {
    tmpRepo = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-broom-test-backup-'));
  });

  afterEach(async () => {
    await fs.promises.rm(tmpRepo, { recursive: true, force: true });
  });

  it('backs up and restores files safely', async () => {
    const filePath = path.join(tmpRepo, '.env');
    await fs.promises.writeFile(filePath, 'SECRET=12345', 'utf8');

    const statuses: PathTrackStatus[] = [
      {
        rawPath: '.env',
        normalizedRelative: '.env',
        absolutePath: filePath,
        isTracked: true,
        existsOnDisk: true,
        isDirectory: false,
        matchedFiles: ['.env'],
      },
    ];

    const backup = await createLocalBackup(statuses);
    expect(fs.existsSync(backup.backupDir)).toBe(true);

    // Simulate file deletion during Git purge
    await fs.promises.unlink(filePath);
    expect(fs.existsSync(filePath)).toBe(false);

    // Restore from backup
    await backup.restore();
    expect(fs.existsSync(filePath)).toBe(true);
    const restoredContent = await fs.promises.readFile(filePath, 'utf8');
    expect(restoredContent).toBe('SECRET=12345');

    // Cleanup backup
    await backup.cleanup();
    expect(fs.existsSync(backup.backupDir)).toBe(false);
  });
});
