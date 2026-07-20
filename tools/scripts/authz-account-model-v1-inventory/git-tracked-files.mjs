import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';

import { assert, safePath } from './core.mjs';

export function collectGitTrackedPaths(repoRoot) {
  try {
    const output = execFileSync('git', ['ls-files', '-z', '--'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(output.split('\0').filter(Boolean));
  } catch {
    // Standalone fixtures intentionally have no Git metadata.
    return undefined;
  }
}

export function collectTrackedRegularFiles(repoRoot, trackedPaths, label) {
  const files = [];
  for (const relativePath of [...trackedPaths].sort()) {
    const resolved = safePath(repoRoot, relativePath, label);
    if (!existsSync(resolved.absolute)) continue;
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), `${label} must not be a symlink`, [relativePath]);
    if (stat.isFile()) files.push(resolved.normalized);
  }
  return files;
}
