import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_LAMBDA_ARTIFACT_ROOT,
  collectPhosCloudFormationLambdaHandlers,
} from './validate-phos-deploy-template';

export type PhosLambdaArtifactBuildReport = {
  ok: true;
  output_root: string;
  entry_points: string[];
};

export function buildPhosLambdaArtifact(
  outputRoot = DEFAULT_LAMBDA_ARTIFACT_ROOT,
): PhosLambdaArtifactBuildReport {
  const entryPoints = [
    ...new Set(collectPhosCloudFormationLambdaHandlers().map((handler) => handler.source_file)),
  ].sort();
  rmSync(outputRoot, { recursive: true, force: true });

  const result = spawnSync(
    'node_modules/.bin/esbuild',
    [
      ...entryPoints,
      '--bundle',
      '--platform=node',
      '--target=node24',
      '--format=cjs',
      '--outbase=.',
      '--entry-names=[dir]/[name]',
      `--outdir=${outputRoot}`,
      '--log-level=warning',
    ],
    {
      encoding: 'utf8',
      shell: false,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      [`esbuild failed with exit code ${result.status ?? 'unknown'}`, result.stderr, result.stdout]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return {
    ok: true,
    output_root: outputRoot,
    entry_points: entryPoints,
  };
}

async function main() {
  const outputArgIndex = process.argv.indexOf('--output');
  const outputRoot =
    outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
      ? process.argv[outputArgIndex + 1]
      : DEFAULT_LAMBDA_ARTIFACT_ROOT;
  console.log(JSON.stringify(buildPhosLambdaArtifact(outputRoot), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
