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

mkdirSync(projectNodeModules, { recursive: true });

if (existsSync(rootPrismaDir)) {
  const stat = lstatSync(rootPrismaDir);
  if (stat.isSymbolicLink()) {
    const linkedPath = resolve(projectNodeModules, readlinkSync(rootPrismaDir));
    if (linkedPath === generatedPrismaDir) {
      console.log(`[link-prisma-client] Reusing existing link ${rootPrismaDir}`);
      process.exit(0);
    }
  }

  rmSync(rootPrismaDir, { recursive: true, force: true });
}

symlinkSync(generatedPrismaDir, rootPrismaDir, 'dir');
console.log(`[link-prisma-client] Linked ${rootPrismaDir} -> ${generatedPrismaDir}`);
