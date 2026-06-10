#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const PRETTIER_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
]);

const EXCLUDED_PREFIXES = [
  '.codex/',
  '.harness-mem/',
  '.omx/',
  '.playwright-mcp/',
  'artifacts/',
  'audits/',
  'reports/',
  'tmp/',
];

function run(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function git(args) {
  const result = run('git', args);
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function isAllZeroSha(value) {
  return /^0+$/.test(value);
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot);
}

function isPrettierTarget(path) {
  if (!PRETTIER_EXTENSIONS.has(extensionOf(path))) return false;
  return !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function readChangedFiles() {
  const explicit = process.argv.slice(2);
  if (explicit.length > 0) return explicit;

  const files = new Set();
  const baseRef = process.env.GITHUB_BASE_REF?.trim();
  const beforeSha = process.env.GITHUB_EVENT_BEFORE?.trim();

  if (baseRef) {
    for (const file of git([
      'diff',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      `origin/${baseRef}...HEAD`,
      '--',
    ])) {
      files.add(file);
    }
  } else if (beforeSha && !isAllZeroSha(beforeSha)) {
    for (const file of git([
      'diff',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      beforeSha,
      'HEAD',
      '--',
    ])) {
      files.add(file);
    }
  } else {
    for (const file of git(['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--'])) {
      files.add(file);
    }
    for (const file of git(['ls-files', '--others', '--exclude-standard'])) {
      files.add(file);
    }
  }

  return [...files];
}

const files = readChangedFiles().filter(isPrettierTarget);
if (files.length === 0) {
  console.log('No changed files require Prettier check.');
  process.exit(0);
}

let failed = false;
for (let index = 0; index < files.length; index += 50) {
  const batch = files.slice(index, index + 50);
  const result = spawnSync('pnpm', ['exec', 'prettier', '--check', ...batch], {
    stdio: 'inherit',
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
