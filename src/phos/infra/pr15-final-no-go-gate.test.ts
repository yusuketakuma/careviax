import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { PHOS_API_ROUTES } from './api-gateway-routes';

const repoRoot = process.cwd();
const canonicalRoot = join(repoRoot, 'src/phos');
const phosAppRoot = join(repoRoot, 'src/app/(phos)');

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function readRelative(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function expectEvidence(path: string, patterns: readonly RegExp[]) {
  const fullPath = join(repoRoot, path);
  expect(existsSync(fullPath), path).toBe(true);
  const content = readFileSync(fullPath, 'utf8');
  for (const pattern of patterns) {
    expect(content, path).toMatch(pattern);
  }
}

describe('PH-OS PR-15 E2E evidence gate', () => {
  it.each([
    [
      'E2E-01',
      'src/phos/backend/dynamo-card-action-store.test.ts',
      [/REVIEW_CLAIM_CANDIDATES/, /CLOSE_CARD/, /CurrentStep\.CLOSING/],
    ],
    [
      'E2E-02',
      'src/phos/backend/cards-handlers.test.ts',
      [/REJECT_SET_AUDIT/, /reason_required/, /reason_code/],
    ],
    [
      'E2E-03',
      'src/phos/ui/workspace/WorkspaceOverlay.test.tsx',
      [/onCreateHandoff/, /reason_code/, /source_refs/],
    ],
    [
      'E2E-04',
      'src/phos/ui/board/BoardClient.tsx',
      [/resolveHandoff/, /removeHandoff/, /setPharmacistHandoffs/],
    ],
    [
      'E2E-05',
      'src/phos/backend/visit-mode-lifecycle-repository.test.ts',
      [/ARRIVAL_CONFIRM/, /POST_VISIT_PENDING/, /VISIT_ABSENT_FOLLOWUP/],
    ],
    [
      'E2E-06',
      'src/phos/ui/visit/VisitMode.test.tsx',
      [/blocking_unsynced_count/, /COMPLETE_CHECK/, /mandatory local evidence/],
    ],
    [
      'E2E-07',
      'src/phos/ui/board/BoardClient.test.tsx',
      [/WAITING_REPLY/, /registerReportReply/, /markReportActionDone/],
    ],
    [
      'E2E-08',
      'src/phos/api/usePhosAction.test.tsx',
      [/STALE_VERSION/, /CONFLICT/, /response\)\.toBeUndefined/],
    ],
    [
      'E2E-09',
      'src/phos/domain/actions/resolveButtonState.test.ts',
      [/OFFLINE_BLOCKED/, /offline_allowed/],
    ],
    ['E2E-10', 'src/phos/ui/board/BoardClient.test.tsx', [/CapacityBar/, /manager or admin/]],
  ] as const)('%s has executable PH-OS coverage evidence', (_id, path, patterns) => {
    expectEvidence(path, patterns);
  });
});

describe('PH-OS Final No-Go gate', () => {
  it('has one transition matrix entry for every ActionCode value', () => {
    expect(Object.keys(ACTION_TRANSITION_MATRIX).sort()).toEqual(Object.values(ActionCode).sort());
  });

  it('keeps every mutating PH-OS business route on Lambda with replay or explicit presign semantics', () => {
    for (const route of PHOS_API_ROUTES) {
      expect(route.lambda_handler).toMatch(/^@\/phos\/backend\/.*-lambda#/);

      if (route.method !== 'POST') {
        expect(route.requires_idempotency_key).toBe(false);
        expect(route.requires_expected_version).toBe(false);
        continue;
      }

      if (route.route_key === 'POST /evidence/presign-upload') {
        expect(route.requires_idempotency_key).toBe(false);
        expect(route.requires_expected_version).toBe(false);
        continue;
      }

      expect(route.requires_idempotency_key).toBe(true);
      expect(route.requires_expected_version).toBe(true);
    }
  });

  it('does not keep obsolete PH-OS deployment/status concepts after the Lambda route manifest change', () => {
    const forbiddenMarkers = [
      ['PHOS_IMPLEMENTED', '_API_ROUTES'].join(''),
      ['PhosApiRoute', 'Status'].join(''),
      ['route.', 'status'].join(''),
      ['status !== ', "'IMPLEMENTED'"].join(''),
      ['PLAN', 'NED'].join(''),
      ['Planned', 'View'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const marker of forbiddenMarkers) {
        expect(content, relativePath).not.toContain(marker);
      }
    }
  });

  it('does not keep unused helper exports left behind by PH-OS route/client consolidation', () => {
    const obsoleteSymbols = [
      ['PhosApiError', 'Status'].join(''),
      ['handoffUrgency', 'Rank'].join(''),
      ['assigneeGsi', 'Sk'].join(''),
      ['patientGsi', 'Sk'].join(''),
      ['PhosTag', 'Label'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const symbol of obsoleteSymbols) {
        expect(content, relativePath).not.toContain(symbol);
      }
    }
  });

  it('keeps PH-OS UI and app code isolated from legacy Next API route calls', () => {
    const forbiddenApiPatterns = [
      /fetch\(\s*['"]\/api\//,
      /['"]\/api\/phos/,
      /baseUrl:\s*['"]\/api/,
    ];

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root)) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenApiPatterns) {
          expect(content, relativePath).not.toMatch(pattern);
        }
      }
    }
  });

  it('keeps final no-go UI logic outside presentation components', () => {
    const uiFiles = listFiles(join(canonicalRoot, 'ui')).filter((file) => file.endsWith('.tsx'));
    const forbiddenLogicPatterns = [
      /ACTION_TRANSITION_MATRIX/,
      /assertRouteAccess/,
      /client_version\s*[+<>=-]/,
      /blocking_unsynced_count\s*[<>=]/,
      /applicable_steps\s*=\s*\[/,
    ];

    for (const file of uiFiles) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenLogicPatterns) {
        expect(content, relativePath).not.toMatch(pattern);
      }
    }
  });

  it('keeps refactoring debt and legacy API isolation documented for PR review', () => {
    const doc = readRelative('docs/phos-legacy-api-isolation.md');

    expect(doc).toContain('PH-OS v1.1 business APIs');
    expect(doc).toContain('Current Legacy Next API Debt');
    expect(doc).toContain('/api/handoff-board');
    expect(doc).toContain('/api/care-reports');
    expect(doc).toContain('/api/billing-candidates');
  });

  it('keeps stale-version and guard-failure behavior non-optimistic in the action hook', () => {
    const hook = readRelative('src/phos/api/usePhosAction.ts');
    const singleLineHook = hook.replace(/\n/g, ' ');

    expect(hook).toMatch(/error\.status === 422/);
    expect(hook).toMatch(/ActionPhase\.GUARD_FAILED/);
    expect(hook).toMatch(/error\.status === 409/);
    expect(hook).toMatch(/ActionPhase\.CONFLICT/);
    expect(singleLineHook).not.toMatch(/setState\(\{\s*phase:\s*ActionPhase\.SUCCEEDED[^}]*catch/);
  });

  it('keeps toast feedback paired with inline errors and duplicate debounce evidence', () => {
    expectEvidence('src/phos/ui/feedback/PhosToastRegion.test.tsx', [
      /debounces duplicate toast messages/,
      /appendPhosToast/,
      /PH-OS toast notifications/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /renders successful action toasts/,
      /renders report delivery reply failures both inline and as a toast/,
      /getAllByText/,
      /PH-OS toast notifications/,
    ]);
  });
});
