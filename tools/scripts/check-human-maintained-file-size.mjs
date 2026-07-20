import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_BASELINE = 'tools/human-maintained-file-size-baseline.json';
const DEFAULT_EXCLUSIONS = 'tools/human-maintained-file-size-exclusions.json';
const APPROVED_BASELINE_BOOTSTRAP = 'bf5addc9d96d3af26c3935ff95a9a368dd2e7edf';
const APPROVED_EXCLUSIONS = [
  {
    path: 'pnpm-lock.yaml',
    kind: 'lockfile',
    reason: 'Package-manager generated lockfile.',
    source_or_generator: 'package.json',
  },
  {
    path: 'tools/authz-account-model-v1/inventory.json',
    kind: 'data_asset',
    reason: 'Machine-validated authorization and browser freeze data asset.',
    source_or_generator: 'tools/scripts/check-authz-account-model-v1-inventory.mjs',
  },
  {
    path: 'tools/human-maintained-file-size-baseline.json',
    kind: 'data_asset',
    reason: 'Machine-generated exact-path line-count ratchet baseline.',
    source_or_generator: 'tools/scripts/check-human-maintained-file-size.mjs',
  },
];
const MAX_LINES = 1000;
const CODE_EXTENSIONS = new Set([
  '.bash',
  '.c',
  '.cc',
  '.cjs',
  '.clj',
  '.cljs',
  '.conf',
  '.cpp',
  '.cs',
  '.cts',
  '.css',
  '.dart',
  '.erl',
  '.erb',
  '.ex',
  '.exs',
  '.fs',
  '.fsx',
  '.gql',
  '.go',
  '.gradle',
  '.graphql',
  '.groovy',
  '.h',
  '.hcl',
  '.hpp',
  '.hrl',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.jsx',
  '.json',
  '.kt',
  '.kts',
  '.lua',
  '.mdx',
  '.mjs',
  '.mts',
  '.nim',
  '.php',
  '.properties',
  '.prisma',
  '.proto',
  '.ps1',
  '.py',
  '.rb',
  '.rake',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.swift',
  '.tf',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zsh',
  '.zig',
]);
const SOURCE_TREE_PATTERN =
  /^(?:src|app|client|config|lib|prisma|scripts|server|test|tests|tools)(?:\/|$)|^\.(?:agents\/skills|github)\//;
const CODE_BASENAME_PATTERN =
  /^(?:Makefile|Dockerfile|Containerfile|Procfile|Justfile|Taskfile|Rakefile|Gemfile)(?:\.[^/]+)?$/i;
const CONFIG_BASENAMES = new Set([
  '.babelrc',
  '.browserslistrc',
  '.dockerignore',
  '.editorconfig',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.eslintignore',
  '.eslintrc',
  '.npmrc',
  '.prettierignore',
  '.prettierrc',
]);

export class FileSizeGateError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'FileSizeGateError';
    this.details = details;
  }
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function resolveInside(repoRoot, relativePath) {
  const normalized = posix(path.posix.normalize(relativePath));
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('../') ||
    path.isAbsolute(normalized)
  ) {
    throw new FileSizeGateError('unsafe file-size gate path', [relativePath]);
  }
  const absolute = path.resolve(repoRoot, normalized);
  const root = `${realpathSync(repoRoot)}${path.sep}`;
  const parent = `${realpathSync(path.dirname(absolute))}${path.sep}`;
  if (!parent.startsWith(root))
    throw new FileSizeGateError('file-size path escapes repository', [normalized]);
  return { normalized, absolute };
}

function gitPaths(repoRoot, args) {
  const output = execFileSync('git', args, { cwd: repoRoot, encoding: 'buffer' });
  return output
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(posix)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function physicalLines(buffer) {
  if (buffer.length === 0) return 0;
  let lines = 0;
  for (const byte of buffer) if (byte === 10) lines += 1;
  return lines + (buffer.at(-1) === 10 ? 0 : 1);
}

function readJson(repoRoot, sourcePath) {
  const { absolute } = resolveInside(repoRoot, sourcePath);
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

function validateExclusions(repoRoot, exclusions, approvedExclusions = APPROVED_EXCLUSIONS) {
  if (!Array.isArray(exclusions))
    throw new FileSizeGateError('file-size exclusions must be an array');
  if (JSON.stringify(exclusions) !== JSON.stringify(approvedExclusions)) {
    throw new FileSizeGateError('file-size exclusions differ from the approved exact allowlist');
  }
  const allowedKinds = new Set(['data_asset', 'generated', 'lockfile', 'snapshot', 'vendored']);
  const paths = new Set();
  for (const entry of exclusions) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      typeof entry.reason !== 'string' ||
      typeof entry.source_or_generator !== 'string' ||
      !allowedKinds.has(entry.kind)
    ) {
      throw new FileSizeGateError('invalid file-size exclusion', [JSON.stringify(entry)]);
    }
    if (paths.has(entry.path))
      throw new FileSizeGateError('duplicate file-size exclusion', [entry.path]);
    paths.add(entry.path);
    const { absolute } = resolveInside(repoRoot, entry.path);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new FileSizeGateError('excluded path must be a real file', [entry.path]);
    }
    const source = resolveInside(repoRoot, entry.source_or_generator);
    if (!existsSync(source.absolute) || !lstatSync(source.absolute).isFile()) {
      throw new FileSizeGateError('exclusion source or generator must be a file', [
        entry.source_or_generator,
      ]);
    }
  }
  return paths;
}

function baselineHistory(repoRoot, bootstrapCommit, baselinePath) {
  const revisions = execFileSync(
    'git',
    ['rev-list', '--reverse', `${bootstrapCommit}..HEAD`, '--', baselinePath],
    { cwd: repoRoot, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const history = [];
  for (const revision of revisions) {
    let raw;
    try {
      raw = execFileSync('git', ['show', `${revision}:${baselinePath}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      throw new FileSizeGateError('file-size baseline history contains a deletion gap', [revision]);
    }
    try {
      history.push({ revision, baseline: JSON.parse(raw) });
    } catch {
      throw new FileSizeGateError('file-size baseline history contains malformed JSON', [revision]);
    }
  }
  return history;
}

function validatedHistoricalEntries(baseline, approvedBootstrapCommit, revision) {
  if (
    !baseline ||
    baseline.schema_version !== 1 ||
    baseline.bootstrap_commit !== approvedBootstrapCommit ||
    !Array.isArray(baseline.entries)
  ) {
    throw new FileSizeGateError('committed file-size baseline history is invalid', [revision]);
  }
  const entries = new Map();
  for (const entry of baseline.entries) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !Number.isInteger(entry.max_lines) ||
      entry.max_lines <= MAX_LINES ||
      typeof entry.task_id !== 'string' ||
      !entry.task_id ||
      entries.has(entry.path)
    ) {
      throw new FileSizeGateError('committed file-size baseline history is invalid', [
        revision,
        JSON.stringify(entry),
      ]);
    }
    entries.set(entry.path, entry.max_lines);
  }
  return entries;
}

function validateBaseline(
  repoRoot,
  baseline,
  baselinePath,
  approvedBootstrapCommit = APPROVED_BASELINE_BOOTSTRAP,
) {
  if (
    !baseline ||
    baseline.schema_version !== 1 ||
    !/^[0-9a-f]{40}$/.test(baseline.bootstrap_commit) ||
    !Array.isArray(baseline.entries)
  ) {
    throw new FileSizeGateError('invalid file-size baseline envelope');
  }
  if (baseline.bootstrap_commit !== approvedBootstrapCommit) {
    throw new FileSizeGateError('file-size bootstrap commit is not the approved immutable root', [
      baseline.bootstrap_commit,
    ]);
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseline.bootstrap_commit, 'HEAD'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  } catch {
    throw new FileSizeGateError('file-size bootstrap commit must be an ancestor of HEAD', [
      baseline.bootstrap_commit,
    ]);
  }
  const entries = new Map();
  for (const entry of baseline.entries) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !Number.isInteger(entry.max_lines) ||
      entry.max_lines <= MAX_LINES ||
      typeof entry.task_id !== 'string' ||
      !entry.task_id
    ) {
      throw new FileSizeGateError('invalid file-size baseline entry', [JSON.stringify(entry)]);
    }
    if (entries.has(entry.path))
      throw new FileSizeGateError('duplicate file-size baseline', [entry.path]);
    resolveInside(repoRoot, entry.path);
    let bootstrapLines;
    try {
      bootstrapLines = physicalLines(
        execFileSync('git', ['show', `${baseline.bootstrap_commit}:${entry.path}`], {
          cwd: repoRoot,
          encoding: 'buffer',
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      );
    } catch {
      throw new FileSizeGateError('baseline path did not exist at bootstrap commit', [entry.path]);
    }
    if (bootstrapLines <= MAX_LINES) {
      throw new FileSizeGateError('baseline path was not legacy debt at bootstrap commit', [
        entry.path,
      ]);
    }
    if (entry.max_lines > bootstrapLines) {
      throw new FileSizeGateError('baseline ratchet exceeds bootstrap line count', [entry.path]);
    }
    entries.set(entry.path, entry);
  }

  let previousEntries;
  for (const { revision, baseline: historicalBaseline } of baselineHistory(
    repoRoot,
    approvedBootstrapCommit,
    baselinePath,
  )) {
    const historicalEntries = validatedHistoricalEntries(
      historicalBaseline,
      approvedBootstrapCommit,
      revision,
    );
    if (previousEntries) {
      for (const [sourcePath, maxLines] of historicalEntries) {
        if (!previousEntries.has(sourcePath)) {
          throw new FileSizeGateError('baseline history cannot add or restore paths', [
            revision,
            sourcePath,
          ]);
        }
        if (maxLines > previousEntries.get(sourcePath)) {
          throw new FileSizeGateError('baseline history ratchet cannot increase', [
            revision,
            sourcePath,
          ]);
        }
      }
    }
    previousEntries = historicalEntries;
  }
  if (previousEntries) {
    for (const entry of entries.values()) {
      if (!previousEntries.has(entry.path)) {
        throw new FileSizeGateError('new paths cannot be added to the legacy baseline', [
          entry.path,
        ]);
      }
      if (entry.max_lines > previousEntries.get(entry.path)) {
        throw new FileSizeGateError('baseline ratchet cannot increase', [entry.path]);
      }
    }
  }
  return entries;
}

export function scanHumanMaintainedFiles(repoRoot) {
  const tracked = new Set(gitPaths(repoRoot, ['ls-files', '-z']));
  return gitPaths(repoRoot, ['ls-files', '-co', '--exclude-standard', '-z'])
    .map((sourcePath) => {
      const { absolute } = resolveInside(repoRoot, sourcePath);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new FileSizeGateError('code path must not be a symlink', [sourcePath]);
      if (!stat.isFile()) return undefined;
      const content = readFileSync(absolute);
      const basename = path.basename(sourcePath);
      const included =
        CODE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) ||
        CODE_BASENAME_PATTERN.test(basename) ||
        CONFIG_BASENAMES.has(basename.toLowerCase()) ||
        (stat.mode & 0o111) !== 0 ||
        (SOURCE_TREE_PATTERN.test(sourcePath) && !content.includes(0));
      if (!included) return undefined;
      return {
        path: sourcePath,
        lines: physicalLines(content),
        tracked: tracked.has(sourcePath),
      };
    })
    .filter(Boolean);
}

export function checkHumanMaintainedFileSize({
  repoRoot = process.cwd(),
  baselinePath = DEFAULT_BASELINE,
  exclusionsPath = DEFAULT_EXCLUSIONS,
  approvedBootstrapCommit = APPROVED_BASELINE_BOOTSTRAP,
  approvedExclusions = APPROVED_EXCLUSIONS,
} = {}) {
  const exclusions = validateExclusions(
    repoRoot,
    readJson(repoRoot, exclusionsPath),
    approvedExclusions,
  );
  const baseline = validateBaseline(
    repoRoot,
    readJson(repoRoot, baselinePath),
    baselinePath,
    approvedBootstrapCommit,
  );
  const files = scanHumanMaintainedFiles(repoRoot);
  const violations = [];
  const seenBaseline = new Set();
  for (const file of files) {
    if (exclusions.has(file.path)) continue;
    const debt = baseline.get(file.path);
    if (debt) {
      seenBaseline.add(file.path);
      if (!file.tracked)
        violations.push(`${file.path}: untracked files cannot use legacy baseline`);
      if (file.lines <= MAX_LINES)
        violations.push(`${file.path}: stale baseline; now ${file.lines} lines`);
      if (file.lines > debt.max_lines) {
        violations.push(`${file.path}: ${file.lines} lines exceeds ratchet ${debt.max_lines}`);
      } else if (file.lines < debt.max_lines && file.lines > MAX_LINES) {
        violations.push(`${file.path}: lower ratchet to current ${file.lines} lines`);
      }
    } else if (file.lines > MAX_LINES) {
      violations.push(`${file.path}: ${file.lines} lines exceeds ${MAX_LINES}`);
    }
  }
  for (const sourcePath of baseline.keys()) {
    if (!seenBaseline.has(sourcePath))
      violations.push(`${sourcePath}: stale or excluded baseline path`);
  }
  if (violations.length > 0)
    throw new FileSizeGateError('human-maintained file-size gate failed', violations);
  return {
    files: files.length,
    baseline: baseline.size,
    exclusions: exclusions.size,
  };
}

export function legacyBaselineCandidates(
  repoRoot = process.cwd(),
  approvedExclusions = APPROVED_EXCLUSIONS,
) {
  const exclusions = validateExclusions(
    repoRoot,
    readJson(repoRoot, DEFAULT_EXCLUSIONS),
    approvedExclusions,
  );
  return scanHumanMaintainedFiles(repoRoot)
    .filter((file) => file.tracked && !exclusions.has(file.path) && file.lines > MAX_LINES)
    .map((file) => ({
      path: file.path,
      max_lines: file.lines,
      task_id: 'MAINT-FILE-SIZE-1000-001',
    }));
}

function main() {
  const repoRoot = process.cwd();
  if (process.argv.includes('--print-baseline')) {
    process.stdout.write(`${JSON.stringify(legacyBaselineCandidates(repoRoot), null, 2)}\n`);
    return;
  }
  const result = checkHumanMaintainedFileSize({ repoRoot });
  process.stdout.write(
    `human-maintained file-size gate passed: files=${result.files}, baseline=${result.baseline}, exclusions=${result.exclusions}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    if (error instanceof FileSizeGateError) {
      console.error(error.message);
      for (const detail of error.details) console.error(`- ${detail}`);
      process.exitCode = 1;
    } else throw error;
  }
}
