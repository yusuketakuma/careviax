import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-plans-active-board.mjs');

function createFixtureRepo(
  plansContent: string,
  allowlistDebt = 109,
  completedArchiveContent = '# Completed plan archive\n',
) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-plans-board-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-plans-active-board.mjs'));
  writeFileSync(
    path.join(root, 'tools/api-response-shape-allowlist.json'),
    JSON.stringify({ entries: [{ route: '/api/test', expectedCount: allowlistDebt }] }),
  );
  writeFileSync(path.join(root, 'Plans.md'), plansContent);
  writeFileSync(path.join(root, 'docs/plans-archive.md'), completedArchiveContent);
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
  overrides: Partial<Record<'counts' | 'implementationRows' | 'debtNote', string>> = {},
) {
  const counts =
    overrides.counts ??
    `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Partial / residual track | 1 | partial |
| FHIR child queue | 1 | child |
| Implementation queue | 2 | implementation |
| Frontend queue | 1 | frontend |
| Archive / reference | - | archive |`;

  const implementationRows =
    overrides.implementationRows ??
    `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`INBOUND-002-REVIEW-DETAIL\` | Partial | P0/P1 | Inbound | Review detail | tests |
| \`FHIR-NATIVE-P0-FOUNDATION-001\` | In progress | P0 | FHIR | Roll-up only | tests |`;

  const debtNote =
    overrides.debtNote ?? `> 追加照合: \`api-response-shape\` allowlist debt は実測 **109**。`;

  return `# PH-OS Pharmacy — Implementation Plan

### 2026-07-09 Active Plan Board v9 — 未完了タスクのみ \`cc:ACTIVE\`

${debtNote}

**現在の分類サマリー**:

${counts}

直接claim可能な正本queueは、Implementation queueの非FHIR親1件 + FHIR child 1件 + Frontend 1件 = **3件**。

**実装ディスパッチボード（fixture）**:

| Dispatch class | Count | Status内訳 | 扱い |
| --- | ---: | --- | --- |
| Continue / ready to cut | 2 | In progress 0 / Validating 0 / Partial 2 / Not started 0 | ready |
| Human approval required | 0 | Human gate 0 | gated |
| Dependency blocked | 1 | Blocked 1 | blocked |
| Residual track | 1 | Partial track 1 | residual |
| Investigation / verify | 1 | Unresolved / verification 1 | verify |
| Long-term / external | 2 | Program 1 / External prerequisite 1 | long term |

**FHIR Native child execution registry — PR-sized active tasks（2026-07-15）**:

| WP | Task ID | Status | Priority | Seat | Depends on | Scope | Validation / Stop |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | \`FHIR-NATIVE-CHILD-001\` | Blocked | P0 | codex1 | gate | child | tests |

**Partial — 残スコープだけを実装するもの**:

| Track | 実装済み土台 | 未実装の残スコープ |
| --- | --- | --- |
| \`INB-001/002\` | base | review detail |

**Current unresolved / verification tasks**:

- \`VERIFY-001\`: verify one item.

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

**Program backlog — 長期プログラム残スコープ（sprint queue に数えない。着手時に小IDで queue へ昇格）**:

| Program | Status |
| --- | --- |
| \`PROGRAM-001\` | Not started |

**External prerequisites — 外部・人間作業（\`cc:blocked\`。Codex 単独で完了扱いにしない）**:

- \`EXTERNAL-001\`: external approval.
`;
}

describe('check-plans-active-board', () => {
  it('passes when only unfinished work remains and active counts match', () => {
    const root = createFixtureRepo(fixturePlans());

    expect(runCheck(root)).toContain('Plans active board check passed');
  });

  it('rejects classification summary count drift', () => {
    const root = createFixtureRepo(
      fixturePlans({
        counts: `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Partial / residual track | 1 | partial |
| Implementation queue | 3 | implementation |
| Frontend queue | 1 | frontend |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/Implementation queue count mismatch/);
  });

  it('rejects direct-claim total and status breakdown drift', () => {
    const totalDrift = createFixtureRepo(fixturePlans().replace('= **3件**。', '= **4件**。'));
    expect(() => runCheck(totalDrift)).toThrow(/direct claimable task total mismatch/);

    const statusDrift = createFixtureRepo(
      fixturePlans().replace(
        'In progress 0 / Validating 0 / Partial 2 / Not started 0',
        'In progress 0 / Validating 0 / Partial 1 / Not started 1',
      ),
    );
    expect(() => runCheck(statusDrift)).toThrow(/status breakdown mismatch/);
  });

  it('rejects duplicate direct task IDs within and across queues', () => {
    const crossQueueDuplicate = createFixtureRepo(
      fixturePlans().replace('`FE-INBOUND-001` | Partial', '`INBOUND-002-REVIEW-DETAIL` | Partial'),
    );
    expect(() => runCheck(crossQueueDuplicate)).toThrow(/task IDs must be unique/);

    const sameQueueDuplicate = createFixtureRepo(
      fixturePlans({
        counts: `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Partial / residual track | 1 | partial |
| FHIR child queue | 1 | child |
| Implementation queue | 3 | implementation |
| Frontend queue | 1 | frontend |`,
        implementationRows: `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`INBOUND-002-REVIEW-DETAIL\` | Partial | P0/P1 | Inbound | Review detail | tests |
| \`INBOUND-002-REVIEW-DETAIL\` | Partial | P0/P1 | Inbound | Duplicate | tests |
| \`FHIR-NATIVE-P0-FOUNDATION-001\` | In progress | P0 | FHIR | Roll-up only | tests |`,
      }),
    );
    expect(() => runCheck(sameQueueDuplicate)).toThrow(/task IDs must be unique/);
  });

  it('rejects FHIR child duplication and enforces exact parent roll-up classification', () => {
    const childDuplicatedInImplementation = createFixtureRepo(
      fixturePlans().replace(
        '`INBOUND-002-REVIEW-DETAIL` | Partial',
        '`FHIR-NATIVE-CHILD-001` | Partial',
      ),
    );
    expect(() => runCheck(childDuplicatedInImplementation)).toThrow(/task IDs must be unique/);

    const parentInChildRegistry = createFixtureRepo(
      fixturePlans().replace(
        '`FHIR-NATIVE-CHILD-001` | Blocked',
        '`FHIR-NATIVE-P0-FOUNDATION-001` | Blocked',
      ),
    );
    expect(() => runCheck(parentInChildRegistry)).toThrow(/task IDs must be unique/);

    const unknownFhirImplementation = createFixtureRepo(
      fixturePlans().replace(
        '`FHIR-NATIVE-P0-FOUNDATION-001` | In progress',
        '`FHIR-NATIVE-UNKNOWN-ROLLUP-001` | In progress',
      ),
    );
    expect(() => runCheck(unknownFhirImplementation)).toThrow(/only exact FHIR parent roll-up IDs/);
  });

  it('rejects residual and long-term dispatch breakdown drift', () => {
    const residualDrift = createFixtureRepo(
      fixturePlans().replace(
        '| Residual track | 1 | Partial track 1 |',
        '| Residual track | 999 | Partial track 999 |',
      ),
    );
    expect(() => runCheck(residualDrift)).toThrow(/Residual track count mismatch/);

    const longTermDrift = createFixtureRepo(
      fixturePlans().replace(
        'Program 1 / External prerequisite 1',
        'Program 2 / External prerequisite 0',
      ),
    );
    expect(() => runCheck(longTermDrift)).toThrow(/status breakdown mismatch/);
  });

  it('rejects a Done / frozen bucket even when its count is zero', () => {
    const root = createFixtureRepo(
      fixturePlans({
        counts: `| Bucket | Count | 入口 |
| --- | ---: | --- |
| Done / frozen | 0 | completed history |
| Partial / residual track | 1 | partial |
| Implementation queue | 2 | implementation |
| Frontend queue | 1 | frontend |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/must not include a Done \/ frozen summary bucket/);
  });

  it('rejects the legacy Done / frozen section', () => {
    const plans = fixturePlans().replace(
      '**Partial — 残スコープだけを実装するもの**:',
      `**Done / frozen — active backlog から削除するもの**:

**Partial — 残スコープだけを実装するもの**:`,
    );
    const root = createFixtureRepo(plans);

    expect(() => runCheck(root)).toThrow(/must not include completed-history sections/);
  });

  it('rejects the legacy completed-derived section', () => {
    const plans = fixturePlans().replace(
      '**Frontend implementation queue — 未実装だけ**:',
      `**今回完了した派生タスク（再実装しない）**:

- \`RECENTLY-FINISHED-001\`: done.

**Frontend implementation queue — 未実装だけ**:`,
    );
    const root = createFixtureRepo(plans);

    expect(() => runCheck(root)).toThrow(/must not include completed-history sections/);
  });

  it('rejects explicit completed task bullets outside active queues', () => {
    const plans = fixturePlans().replace(
      '**Partial — 残スコープだけを実装するもの**:',
      `- \`RECENTLY-FINISHED-001\`: **DONE**. Keep this out of Plans.

**Partial — 残スコープだけを実装するもの**:`,
    );
    const root = createFixtureRepo(plans);

    expect(() => runCheck(root)).toThrow(/must not include completed task entries/);
  });

  it('rejects completed statuses even when the active queue count is updated', () => {
    const root = createFixtureRepo(
      fixturePlans({
        implementationRows: `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`RECENTLY-FINISHED-001\` | Done | P1 | API | implemented | tests |
| \`PLANS-ACTIVE-LINT-001\` | Not started | P2 | Plan hygiene | Check active board | tests |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(
      /completed statuses must not remain in active implementation queues/,
    );
  });

  it('rejects completed language in residual table cells', () => {
    const root = createFixtureRepo(
      fixturePlans().replace('| \`INB-001/002\` | base |', '| \`INB-001/002\` | **Done** base |'),
    );

    expect(() => runCheck(root)).toThrow(/completed residual rows/);
  });

  it('rejects completed program rows and external prerequisite bullets', () => {
    const completedProgram = createFixtureRepo(
      fixturePlans().replace('| `PROGRAM-001` | Not started |', '| `PROGRAM-001` | Completed |'),
    );
    expect(() => runCheck(completedProgram)).toThrow(/completed program rows/);

    const completedExternal = createFixtureRepo(
      fixturePlans().replace(
        '- `EXTERNAL-001`: external approval.',
        '- **Completed** external approval.',
      ),
    );
    expect(() => runCheck(completedExternal)).toThrow(/completed external prerequisites/);
  });

  it('rejects an active task that is already recorded in the completed archive', () => {
    const root = createFixtureRepo(
      fixturePlans(),
      109,
      `# Completed plan archive

- [x] \`INBOUND-002-REVIEW-DETAIL\`
`,
    );

    expect(() => runCheck(root)).toThrow(
      /completed archive IDs must not remain in active implementation queues/,
    );
  });

  it('rejects an archived FHIR child that remains active', () => {
    const root = createFixtureRepo(
      fixturePlans(),
      109,
      `# Completed plan archive

- [x] \`FHIR-NATIVE-CHILD-001\`
`,
    );

    expect(() => runCheck(root)).toThrow(/FHIR-NATIVE-CHILD-001/);
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

  it('rejects active-board references to the completed dashboard split task ID', () => {
    const root = createFixtureRepo(
      fixturePlans({
        implementationRows: `| ID | Status | Priority | Lane | Plan / DoD | Validation / Stop |
| --- | --- | --- | --- | --- | --- |
| \`DASH-P1-005-SPLIT-001\` | Not started | P1 | Dashboard | stale | tests |
| \`PLANS-ACTIVE-LINT-001\` | Not started | P2 | Plan hygiene | Check active board | tests |`,
      }),
    );

    expect(() => runCheck(root)).toThrow(/DASH-P1-005-SPLIT-001/);
  });

  it('rejects stale v8 wording inside the active board', () => {
    const root = createFixtureRepo(
      fixturePlans({
        debtNote:
          '> 追加照合: `api-response-shape` allowlist debt は実測 **109**。Active Plan Board v8 is stale here.',
      }),
    );

    expect(() => runCheck(root)).toThrow(/must not describe its active entrypoint as v8/);
  });

  it('rejects api response allowlist debt drift', () => {
    const root = createFixtureRepo(
      fixturePlans({
        debtNote: '> 追加照合: `api-response-shape` allowlist debt は実測 **108**。',
      }),
    );

    expect(() => runCheck(root)).toThrow(/api-response-shape allowlist debt in Plans.md is stale/);
  });

  it('rejects api response allowlist debt drift when the allowlist changes', () => {
    const root = createFixtureRepo(fixturePlans(), 110);

    expect(() => runCheck(root)).toThrow(/expected 110/);
  });
});
