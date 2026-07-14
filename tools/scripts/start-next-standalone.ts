import { spawn } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareNextStandaloneRuntime(root = process.cwd()) {
  const standaloneRoot = path.join(root, '.next/standalone');
  const serverPath = path.join(standaloneRoot, 'server.js');

  if (!existsSync(serverPath)) {
    throw new Error('Next.js standalone server is missing. Run pnpm build first.');
  }

  const assetCopies = [
    [path.join(root, 'public'), path.join(standaloneRoot, 'public')],
    [path.join(root, '.next/static'), path.join(standaloneRoot, '.next/static')],
  ] as const;

  for (const [source, destination] of assetCopies) {
    if (!existsSync(source)) {
      throw new Error(`Next.js standalone asset source is missing: ${path.relative(root, source)}`);
    }
    cpSync(source, destination, { recursive: true, force: true });
  }

  return serverPath;
}

export async function startNextStandalone(root = process.cwd()) {
  const serverPath = prepareNextStandaloneRuntime(root);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') {
        resolve();
        return;
      }
      reject(new Error(`Next.js standalone server exited with code ${code ?? 'unknown'}`));
    });
  });
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  startNextStandalone().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Failed to start Next.js standalone');
    process.exitCode = 1;
  });
}
