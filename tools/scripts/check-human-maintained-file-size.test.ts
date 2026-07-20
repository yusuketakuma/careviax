import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkHumanMaintainedFileSize,
  FileSizeGateError,
  legacyBaselineCandidates,
  type FileSizeExclusion,
} from './check-human-maintained-file-size.mjs';

const temporaryRoots: string[] = [];
const approvedBootstrapCommits = new Map<string, string>();
const approvedExclusionSets = new Map<string, FileSizeExclusion[]>();

function temporaryRepo(initialFiles: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'file-size-gate-'));
  temporaryRoots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  write(root, 'package.json', '{}\n');
  write(root, 'tools/human-maintained-file-size-exclusions.json', '[]\n');
  for (const [sourcePath, content] of Object.entries(initialFiles))
    write(root, sourcePath, content);
  execFileSync(
    'git',
    [
      'add',
      'package.json',
      'tools/human-maintained-file-size-exclusions.json',
      ...Object.keys(initialFiles),
    ],
    { cwd: root },
  );
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'bootstrap'],
    { cwd: root, stdio: 'ignore' },
  );
  approvedBootstrapCommits.set(
    root,
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  );
  approvedExclusionSets.set(root, []);
  writeBaseline(root, []);
  return root;
}

function write(root: string, relativePath: string, content: string) {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function lines(count: number, ending = '\n') {
  return `${Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n')}${ending}`;
}

function writeBaseline(
  root: string,
  entries: Array<{ path: string; max_lines: number; task_id: string }>,
) {
  write(
    root,
    'tools/human-maintained-file-size-baseline.json',
    `${JSON.stringify(
      {
        schema_version: 1,
        bootstrap_commit: approvedBootstrapCommits.get(root),
        entries,
      },
      null,
      2,
    )}\n`,
  );
}

function check(root: string) {
  return checkHumanMaintainedFileSize({
    repoRoot: root,
    approvedBootstrapCommit: approvedBootstrapCommits.get(root),
    approvedExclusions: approvedExclusionSets.get(root),
  });
}

function writeExclusions(
  root: string,
  entries: Array<{
    path: string;
    kind: string;
    reason: string;
    source_or_generator: string;
  }>,
) {
  write(
    root,
    'tools/human-maintained-file-size-exclusions.json',
    `${JSON.stringify(entries, null, 2)}\n`,
  );
}

function commit(root: string, message: string, paths: string[]) {
  if (paths.length > 0) execFileSync('git', ['add', ...paths], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message],
    { cwd: root, stdio: 'ignore' },
  );
}

function expectGateDetail(run: () => unknown, detail: RegExp) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(FileSizeGateError);
    expect((error as FileSizeGateError).details).toEqual(
      expect.arrayContaining([expect.stringMatching(detail)]),
    );
    return;
  }
  throw new Error('expected file-size gate to fail');
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()!;
    approvedBootstrapCommits.delete(root);
    approvedExclusionSets.delete(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe('check-human-maintained-file-size', () => {
  it('counts physical lines deterministically including no-final-newline files', () => {
    const root = temporaryRepo();
    write(root, 'src/within.ts', lines(1000, ''));
    expect(check(root)).toMatchObject({ baseline: 0 });
    write(root, 'src/too-large.ts', lines(1001));
    expect(() => check(root)).toThrowError(/human-maintained file-size gate failed/);
  });

  it('includes extensionless executable tools and conventional build files', () => {
    const root = temporaryRepo();
    write(root, 'tools/authz-audit', lines(1001));
    execFileSync('chmod', ['+x', 'tools/authz-audit'], { cwd: root });
    expectGateDetail(() => check(root), /tools\/authz-audit: 1001 lines/);

    write(root, 'tools/authz-audit', lines(1));
    write(root, 'Makefile', lines(1001));
    expectGateDetail(() => check(root), /Makefile: 1001 lines/);

    write(root, 'Makefile', lines(1));
    write(root, 'Dockerfile.release', lines(1001));
    expectGateDetail(() => check(root), /Dockerfile\.release: 1001 lines/);
  });

  it('includes common compiled, systems, and schema source formats', () => {
    const root = temporaryRepo();
    for (const sourcePath of ['over.go', 'code.rs', 'schema.proto']) {
      write(root, sourcePath, lines(1001));
      expectGateDetail(() => check(root), new RegExp(`${sourcePath.replace('.', '\\.')}.*1001`));
      write(root, sourcePath, lines(1));
    }
  });

  it('fails closed on textual files under source and tooling roots', () => {
    const root = temporaryRepo();
    for (const sourcePath of [
      'tools/audit.bash',
      'src/page.mdx',
      'src/gate.custom',
      '.agents/skills/example/SKILL.md',
    ]) {
      write(root, sourcePath, lines(1001));
      expectGateDetail(() => check(root), new RegExp(`${sourcePath.replace('.', '\\.')}.*1001`));
      write(root, sourcePath, lines(1));
    }
  });

  it('allows only tracked legacy debt without growth', () => {
    const root = temporaryRepo({ 'src/legacy.ts': lines(1100) });
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1100, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(check(root)).toMatchObject({ baseline: 1 });
    write(root, 'src/legacy.ts', lines(1101));
    expectGateDetail(() => check(root), /exceeds ratchet/);
    write(root, 'src/legacy.ts', lines(1050));
    expectGateDetail(() => check(root), /lower ratchet/);
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1050, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(check(root)).toMatchObject({ baseline: 1 });
    write(root, 'src/legacy.ts', lines(1100));
    expectGateDetail(() => check(root), /exceeds ratchet/);
    write(root, 'src/legacy.ts', lines(1000));
    expectGateDetail(() => check(root), /stale baseline/);
  });

  it('rejects an untracked file even when it is inserted into the legacy baseline', () => {
    const root = temporaryRepo();
    write(root, 'src/untracked.ts', lines(1100));
    writeBaseline(root, [
      { path: 'src/untracked.ts', max_lines: 1100, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline path did not exist at bootstrap commit/);
  });

  it('rejects a newly tracked file that did not exist at the bootstrap commit', () => {
    const root = temporaryRepo();
    write(root, 'src/new-debt.ts', lines(1100));
    execFileSync('git', ['add', 'src/new-debt.ts'], { cwd: root });
    writeBaseline(root, [
      { path: 'src/new-debt.ts', max_lines: 1100, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline path did not exist at bootstrap commit/);
  });

  it('rejects laundering growth from a bootstrap file that was not legacy debt', () => {
    const root = temporaryRepo({ 'src/small.ts': lines(10) });
    write(root, 'src/small.ts', lines(1100));
    writeBaseline(root, [
      { path: 'src/small.ts', max_lines: 1100, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline path was not legacy debt at bootstrap commit/);
  });

  it('pins the bootstrap commit and prevents ratchet inflation across commits', () => {
    const root = temporaryRepo({ 'src/legacy.ts': lines(1100) });
    write(root, 'src/legacy.ts', lines(1050));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1050, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    execFileSync(
      'git',
      ['add', 'src/legacy.ts', 'tools/human-maintained-file-size-baseline.json'],
      { cwd: root },
    );
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'ratchet'],
      { cwd: root, stdio: 'ignore' },
    );
    write(root, 'src/legacy.ts', lines(1075));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1075, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline ratchet cannot increase/);

    const baselinePath = 'tools/human-maintained-file-size-baseline.json';
    const baseline = JSON.parse(
      execFileSync('git', ['show', `HEAD:${baselinePath}`], { cwd: root, encoding: 'utf8' }),
    );
    baseline.bootstrap_commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    write(root, baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    expect(() => check(root)).toThrowError(/bootstrap commit is not the approved immutable root/);
  });

  it('rejects deleting and restoring the baseline with inflated ratchets', () => {
    const root = temporaryRepo({ 'src/legacy.ts': lines(1100) });
    write(root, 'src/legacy.ts', lines(1050));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1050, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    commit(root, 'adopt baseline', [
      'src/legacy.ts',
      'tools/human-maintained-file-size-baseline.json',
    ]);
    execFileSync('git', ['rm', 'tools/human-maintained-file-size-baseline.json'], {
      cwd: root,
      stdio: 'ignore',
    });
    commit(root, 'delete baseline', []);

    write(root, 'src/legacy.ts', lines(1075));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1075, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline history contains a deletion gap/);
  });

  it('rejects malformed historical baselines even after a valid-looking restore', () => {
    const root = temporaryRepo({ 'src/legacy.ts': lines(1100) });
    write(root, 'src/legacy.ts', lines(1050));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1050, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    commit(root, 'adopt baseline', [
      'src/legacy.ts',
      'tools/human-maintained-file-size-baseline.json',
    ]);
    write(root, 'tools/human-maintained-file-size-baseline.json', '{malformed\n');
    commit(root, 'corrupt baseline', ['tools/human-maintained-file-size-baseline.json']);

    write(root, 'src/legacy.ts', lines(1075));
    writeBaseline(root, [
      { path: 'src/legacy.ts', max_lines: 1075, task_id: 'MAINT-FILE-SIZE-1000-001' },
    ]);
    expect(() => check(root)).toThrowError(/baseline history contains malformed JSON/);
  });

  it('requires exact justified exclusions with an existing source', () => {
    const root = temporaryRepo();
    write(root, 'tools/generated.json', lines(1200));
    write(root, 'tools/generator.ts', 'export {};\n');
    const generatedExclusion = [
      {
        path: 'tools/generated.json',
        kind: 'generated',
        reason: 'Generated fixture data.',
        source_or_generator: 'tools/generator.ts',
      },
    ];
    approvedExclusionSets.set(root, generatedExclusion);
    writeExclusions(root, generatedExclusion);
    expect(check(root)).toMatchObject({ exclusions: 1 });
    const invalidKindExclusion = [
      {
        path: 'tools/generated.json',
        kind: 'unknown',
        reason: 'Invalid kind.',
        source_or_generator: 'tools/generator.ts',
      },
    ];
    approvedExclusionSets.set(root, invalidKindExclusion);
    writeExclusions(root, invalidKindExclusion);
    expect(() => check(root)).toThrow(FileSizeGateError);
    const missingGeneratorExclusion = [
      {
        path: 'tools/generated.json',
        kind: 'generated',
        reason: 'Missing generator evidence.',
        source_or_generator: 'tools/missing-generator.ts',
      },
    ];
    approvedExclusionSets.set(root, missingGeneratorExclusion);
    writeExclusions(root, missingGeneratorExclusion);
    expect(() => check(root)).toThrowError(/exclusion source or generator must be a file/);
  });

  it('rejects adding a new oversized path to the approved exclusion set', () => {
    const root = temporaryRepo();
    write(root, 'tools/laundered.ts', lines(1200));
    write(root, 'tools/generator.ts', 'export {};\n');
    writeExclusions(root, [
      {
        path: 'tools/laundered.ts',
        kind: 'generated',
        reason: 'Attempted laundering.',
        source_or_generator: 'tools/generator.ts',
      },
    ]);
    expect(() => check(root)).toThrowError(
      /file-size exclusions differ from the approved exact allowlist/,
    );
  });

  it('prints baseline candidates only for tracked nonexcluded legacy files', () => {
    const root = temporaryRepo();
    write(root, 'src/tracked.ts', lines(1005));
    write(root, 'src/untracked.ts', lines(1010));
    execFileSync('git', ['add', 'src/tracked.ts'], { cwd: root });
    expect(legacyBaselineCandidates(root, approvedExclusionSets.get(root))).toEqual([
      {
        path: 'src/tracked.ts',
        max_lines: 1005,
        task_id: 'MAINT-FILE-SIZE-1000-001',
      },
    ]);
  });

  it('rejects symlinked code paths instead of following them', () => {
    const root = temporaryRepo();
    write(root, 'outside.ts', 'export {};\n');
    mkdirSync(path.join(root, 'src'), { recursive: true });
    symlinkSync(path.join(root, 'outside.ts'), path.join(root, 'src/link.ts'));
    expect(() => check(root)).toThrowError(/code path must not be a symlink/);
  });
});
