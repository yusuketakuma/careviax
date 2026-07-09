import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-plans-active-board.mjs');

function createFixtureRepo(plansContent: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-plans-board-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-plans-active-board.mjs'));
  writeFileSync(path.join(root, 'Plans.md'), plansContent);
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-plans-active-board.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fixturePlans(
  overrides: Partial<Record<'counts' | 'implementationRows' | 'archiveNote', string>> = {},
) {
  const counts =
    overrides.counts ??
    `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Done / frozen | 1 | done |
| Partial / residual track | 1 | partial |
| Implementation queue | 2 | implementation |
| Frontend queue | 1 | frontend |
| Archive / reference | - | archive |`;

  const implementationRows =
    overrides.implementationRows ??
    `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`INBOUND-002-REVIEW-DETAIL\` | Partial | P0/P1 | Inbound | Review detail | tests |
| \`PLANS-ACTIVE-LINT-001\` | Not started | P2 | Plan hygiene | Check active board | tests |`;

  const archiveNote =
    overrides.archiveNote ??
    `> v3 内の Implementation-ready queue は履歴として残すが、active backlog として数えない。`;

  return `# PH-OS Pharmacy — Implementation Plan

### 2026-07-09 Active Plan Board v9 — 実装済み / 未実装分類 \`cc:ACTIVE\`

**現在の分類サマリー**:

${counts}

**Done / frozen — active backlog から削除するもの**:

| Area | 実装済みとみなす範囲 | 今後の扱い |
| --- | --- | --- |
| Dashboard summary rail | done | 再実装しない |

**Partial — 残スコープだけを実装するもの**:

| Track | 実装済み土台 | 未実装の残スコープ |
| --- | --- | --- |
| \`INB-001/002\` | base | review detail |

**Implementation-ready queue — 未実装 / Partial 残スコープのみ**:

${implementationRows}

**未実装Plan拡充 — 次PRへ切るサブスライス**:

| Parent ID | 先に切るPR / artifact | 再実装しないもの | 追加 acceptance / validation |
| --- | --- | --- | --- |
| \`INBOUND-002-REVIEW-DETAIL\` | detail | schema | tests |

**Frontend implementation queue — 未実装だけ**:

| ID | Status | Screen | Entrypoints / existing contract | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`FE-INBOUND-001\` | Partial | 他職種受信 | inbound | detail | tests |

**今回完了した派生タスク（再実装しない）**:

- \`DASH-SUMMARY-RAIL-001\`: done.
- \`DASH-PROCESS-TILE-LINKS-001\`: done.

### 2026-07-09 Archived Plan Board — 旧分類証跡 \`cc:REFERENCE\`

${archiveNote}

| ID | Status |
| --- | --- |
| \`DASH-P1-010-RAIL\` | Not started |
`;
}

describe('check-plans-active-board', () => {
  it('passes when active counts match and archive tasks are reference-only', () => {
    const root = createFixtureRepo(fixturePlans());

    expect(runCheck(root)).toContain('Plans active board check passed');
  });

  it('rejects classification summary count drift', () => {
    const root = createFixtureRepo(
      fixturePlans({
        counts: `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Done / frozen | 1 | done |
| Partial / residual track | 1 | partial |
| Implementation queue | 3 | implementation |
| Frontend queue | 1 | frontend |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/Implementation queue count mismatch/);
  });

  it('rejects completed derived task IDs that re-enter active queues', () => {
    const root = createFixtureRepo(
      fixturePlans({
        implementationRows: `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`DASH-SUMMARY-RAIL-001\` | Not started | P1 | Dashboard | stale | tests |
| \`PLANS-ACTIVE-LINT-001\` | Not started | P2 | Plan hygiene | Check active board | tests |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/completed derived task IDs/);
  });

  it('rejects active-board references to the old dashboard rail task ID', () => {
    const root = createFixtureRepo(
      fixturePlans({
        implementationRows: `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`DASH-P1-010-RAIL\` | Not started | P1 | Dashboard | stale | tests |
| \`PLANS-ACTIVE-LINT-001\` | Not started | P2 | Plan hygiene | Check active board | tests |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/DASH-P1-010-RAIL/);
  });

  it('rejects archived plan boards without an explicit non-active note', () => {
    const root = createFixtureRepo(
      fixturePlans({
        archiveNote: '> this archive can be used as active backlog.',
      }),
    );

    expect(() => runCheck(root)).toThrow(/not counted as active backlog/);
  });
});
