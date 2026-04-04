import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const projectNodeModules = resolve(process.cwd(), 'node_modules');
const prismaClientPackageDir = dirname(require.resolve('@prisma/client/package.json'));
const generatedPrismaDir = resolve(prismaClientPackageDir, '..', '..', '.prisma');
const rootPrismaDir = resolve(projectNodeModules, '.prisma');

if (!existsSync(generatedPrismaDir)) {
  console.warn(`[link-prisma-client] Skipping: generated client not found at ${generatedPrismaDir}`);
  process.exit(0);
}

function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

mkdirSync(projectNodeModules, { recursive: true });

const existingStat = lstatIfExists(rootPrismaDir);
if (existingStat) {
  if (existingStat.isSymbolicLink()) {
    const linkedPath = resolve(projectNodeModules, readlinkSync(rootPrismaDir));
    if (linkedPath === generatedPrismaDir) {
      console.log(`[link-prisma-client] Reusing existing link ${rootPrismaDir}`);
      process.exit(0);
    }
  }

  rmSync(rootPrismaDir, { recursive: true, force: true });
}

try {
  symlinkSync(generatedPrismaDir, rootPrismaDir, 'dir');
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST' &&
    existsSync(rootPrismaDir)
  ) {
    const stat = lstatIfExists(rootPrismaDir);
    if (stat?.isSymbolicLink()) {
      const linkedPath = resolve(projectNodeModules, readlinkSync(rootPrismaDir));
      if (linkedPath === generatedPrismaDir) {
        console.log(`[link-prisma-client] Reusing concurrently created link ${rootPrismaDir}`);
        process.exit(0);
      }
    }

    rmSync(rootPrismaDir, { recursive: true, force: true });
    symlinkSync(generatedPrismaDir, rootPrismaDir, 'dir');
  } else {
    throw error;
  }
}

console.log(`[link-prisma-client] Linked ${rootPrismaDir} -> ${generatedPrismaDir}`);
