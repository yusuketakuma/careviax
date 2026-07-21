import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

export function walkFiles(repoRoot, relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!existsSync(absoluteRoot)) return [];

  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current).sort().reverse()) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (stats.isFile()) files.push(toPosix(path.relative(repoRoot, current)));
  }
  return files.sort();
}
