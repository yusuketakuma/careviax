import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import { P0_REQUIRED_METRIC_NAMES } from '@/phos/backend/observability';
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
  it('keeps E2E-01 through E2E-10 in one executable final workflow spec', () => {
    const spec = readRelative('src/phos/infra/phos-final-e2e.test.tsx');

    for (let index = 1; index <= 10; index++) {
      const id = `E2E-${String(index).padStart(2, '0')}`;
      expect(spec, id).toContain(`it('${id}`);
    }
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

  it('keeps every P0 CloudWatch metric from the final spec in the observability contract', () => {
    expect([...P0_REQUIRED_METRIC_NAMES].sort()).toEqual(
      [
        'ActionLatencyMs',
        'ActionGuardFailedCount',
        'TenantBoundaryRejectedCount',
        'CrossTenantAttemptCount',
        'VisitCompleteGuardBlockedCount',
        'EvidenceUploadFailedCount',
        'OfflineSyncConflictCount',
        'HandoffReturnedCount',
        'ReportSendFailedCount',
      ].sort(),
    );
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

  it('keeps PH-OS feedback colors on design tokens instead of direct Tailwind color classes', () => {
    const feedbackClassPattern =
      /\b(?:border|bg|text)-(?:red|amber|emerald|sky)(?:-\d{2,3})?(?:\/\d{2,3})?\b/;

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root).filter((path) => path.endsWith('.tsx'))) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        expect(content, relativePath).not.toMatch(feedbackClassPattern);
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

  it('keeps reason-required actions executable only with UI-provided reason codes', () => {
    expectEvidence('src/phos/ui/workspace/NextActionPanel.test.tsx', [
      /requires reason_code before executing reason-required actions/,
      /reason_required/,
      /PHOTO_INSUFFICIENT/,
      /getAttribute\('disabled'\)/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /sends workspace reason input for reason-required actions/,
      /reason_code: 'PHOTO_INSUFFICIENT'/,
      /reason_note: '写真が不鮮明です。'/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /clears stale reason input when the selected card action changes/,
      /カードをキャンセルする（実行不可）/,
    ]);
  });
});
