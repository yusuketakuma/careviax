import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ActionCode } from '@/phos/contracts/phos_contracts';
import { ACTION_TRANSITION_MATRIX } from '@/phos/domain/actions/actionTransitionMatrix';
import {
  buildCloudWatchEmbeddedMetric,
  P0_REQUIRED_METRIC_NAMES,
} from '@/phos/backend/observability';
import { CARD_ACTION_ROUTE_ACTION_CODES } from '@/phos/backend/card-action-executor';
import { PHOS_API_ROUTES } from './api-gateway-routes';
import {
  bindPhosApiRouteForDeployment,
  buildPhosApiGatewayLambdaTemplate,
} from './api-gateway-lambda-template';

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

  it('maps every ActionCode to either the card action route or a canonical detached route handler', () => {
    const cardRouteOwned = new Set<ActionCode>(CARD_ACTION_ROUTE_ACTION_CODES);
    const detachedRouteOwners = new Map<ActionCode, readonly string[]>([
      [ActionCode.EXCLUDE_CLAIM_CANDIDATE, ['POST /claim-candidates/{candidate_id}/exclude']],
      [ActionCode.UPLOAD_EVIDENCE, ['POST /evidence/presign-upload']],
      [ActionCode.CREATE_HANDOFF_TO_PHARMACIST, ['POST /handoffs']],
      [
        ActionCode.MARK_REPORT_WAITING_REPLY,
        ['POST /cards/{card_id}/actions', 'GET /report-deliveries'],
      ],
      [ActionCode.REGISTER_REPORT_REPLY, ['POST /report-deliveries/{delivery_id}/reply']],
      [ActionCode.MARK_REPORT_ACTION_DONE, ['POST /report-deliveries/{delivery_id}/action-done']],
    ]);
    const routeKeys = new Set<string>(PHOS_API_ROUTES.map((route) => route.route_key));

    for (const actionCode of Object.values(ActionCode)) {
      const routeOwners = detachedRouteOwners.get(actionCode);
      if (cardRouteOwned.has(actionCode)) {
        expect(routeKeys.has('POST /cards/{card_id}/actions'), actionCode).toBe(true);
        expect(routeOwners, actionCode).toBeUndefined();
        continue;
      }
      expect(routeOwners, actionCode).toBeDefined();
      for (const routeOwner of routeOwners ?? []) {
        expect(routeKeys.has(routeOwner), `${actionCode} -> ${routeOwner}`).toBe(true);
      }
    }
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

  it('keeps the API Gateway to Lambda template deployable with parameters and execution roles', () => {
    const template = buildPhosApiGatewayLambdaTemplate();

    for (const parameter of Object.values(template.Parameters)) {
      expect(parameter).not.toHaveProperty('Properties');
      expect(parameter.Type).toBe('String');
    }
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      expect(template.Resources[binding.function_logical_id]).toMatchObject({
        Type: 'AWS::Lambda::Function',
        Properties: {
          Role: { 'Fn::GetAtt': ['PhosLambdaExecutionRole', 'Arn'] },
        },
      });
    }
    expect(template.Resources.PhosLambdaExecutionRole).toMatchObject({
      Type: 'AWS::IAM::Role',
      Properties: {
        Policies: [
          {
            PolicyDocument: {
              Statement: expect.arrayContaining([
                expect.objectContaining({ Action: expect.arrayContaining(['logs:PutLogEvents']) }),
                expect.objectContaining({
                  Action: expect.arrayContaining(['xray:PutTraceSegments']),
                }),
                expect.objectContaining({
                  Action: expect.arrayContaining(['dynamodb:TransactWriteItems']),
                }),
                expect.objectContaining({ Action: ['s3:PutObject'] }),
              ]),
            },
          },
        ],
      },
    });
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

  it('keeps CloudWatch metric logs correlated and X-Ray annotation adapter wired', () => {
    const metric = buildCloudWatchEmbeddedMetric({
      name: 'ActionGuardFailedCount',
      value: 1,
      unit: 'Count',
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      action_code: ActionCode.COMPLETE_VISIT,
      error_code: 'ACTION_GUARD_FAILED',
    });
    const lambdaObservability = readRelative('src/phos/backend/lambda-observability.ts');

    expect(metric).toMatchObject({
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
    });
    expect(metric._aws.CloudWatchMetrics[0].Dimensions.flat()).not.toEqual(
      expect.arrayContaining(['tenant_id', 'user_id', 'request_id', 'correlation_id']),
    );
    expect(lambdaObservability).toContain('aws-xray-sdk-core');
    expect(lambdaObservability).toContain('createXRayTraceAnnotationSink');
    expect(lambdaObservability).toContain('addAnnotation');
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
      /getAttribute\('aria-disabled'\)/,
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

  it('keeps Workspace deep links, opened card tabs, and focus return covered', () => {
    expectEvidence('src/app/(phos)/board/page.tsx', [
      /searchParams/,
      /initialSelectedCardId/,
      /<BoardClient/,
    ]);
    expectEvidence('src/phos/ui/board/BoardClient.test.tsx', [
      /opens a deep-linked card from the server-provided initial card id/,
      /syncs selected card state when the server-provided card query changes/,
      /opens a deep-linked card from the current URL/,
      /returns focus to the board root when a deep-linked source card is not in the current list/,
      /keeps opened card tabs and switches selected cards/,
      /returns focus to the source tile/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /OpenedCardTabs/,
      /delegates card switching/,
      /aria-pressed/,
      /closes on Escape/,
    ]);
  });

  it('keeps Source Drawer as a focus-returning sheet with source kind copy', () => {
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.tsx', [
      /SheetContent/,
      /side="right"/,
      /triggerRef\.current\?\.focus/,
    ]);
    expectEvidence('src/phos/ui/source/SourceRefList.tsx', [
      /PhosSourceRefKindLabel/,
      /safeSourceHref/,
      /!normalized\.startsWith\('\/\/'\)/,
      /parsed\.protocol === 'https:'/,
    ]);
    expectEvidence('src/phos/ui/workspace/SourceDrawerTrigger.test.tsx', [
      /keeps focus inside the source drawer/,
      /getByRole\('dialog'/,
      /queryByText\('rx_1'\)/,
      /\/\/evil\.example\/source/,
      /data:text\/html/,
      /fireEvent\.keyDown\(document, \{ key: 'Tab' \}\)/,
      /drawer\.contains\(document\.activeElement\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/workspace/HandoffPanel.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
  });

  it('keeps PharmacistBrief rendering copy-driven, source-backed, and action-safe', () => {
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.tsx', [
      /PhosPharmacistBriefCopy/,
      /PhosClinicalSignalCodeLabel/,
      /PhosDecisionReasonLabel/,
      /PhosCommunicationIntentLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosClaimCandidateStatusLabel/,
      /SourceRefList/,
      /fieldset/,
      /data-enabled/,
      /unavailableAriaField/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /PharmacistBriefPanel/,
      /detail\.pharmacist_brief/,
    ]);
    expectEvidence('src/phos/ui/workspace/PharmacistBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('DOSE_INCREASE'\)/,
      /queryByText\('RESIDUAL_ADJUSTMENT'\)/,
      /queryByText\('ASK_PRESCRIBER'\)/,
      /queryByText\('MISSING_EVIDENCE'\)/,
      /hasAttribute\('disabled'\)/,
      /toHaveBeenCalledWith\('card_1', ActionCode\.CREATE_REPORT_DRAFT\)/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.test.tsx', [
      /pharmacist brief details/,
      /getByRole\('heading', \{ name: '薬剤師判断' \}\)/,
      /queryByText\('ADR_SUSPECT'\)/,
    ]);
  });

  it('keeps queue source ref displays on the shared safe source component', () => {
    expectEvidence('src/phos/ui/handoff/HandoffQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.tsx', [/SourceRefList/]);
    expectEvidence('src/phos/ui/handoff/HandoffQueue.test.tsx', [
      /getAllByText\('処方原文'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
    ]);
    expectEvidence('src/phos/ui/report/ReportDeliveryQueue.test.tsx', [
      /getAllByText\('写真・証跡'\)/,
      /queryByText\('EVIDENCE_FILE'\)/,
      /queryByText\('report_1'\)/,
    ]);
  });

  it('keeps SupportBrief and returned handoff displays clerk-safe and copy-driven', () => {
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.tsx', [
      /PhosSupportBriefCopy/,
      /PhosSupportTaskCodeLabel/,
      /PhosDeliveryMethodLabel/,
      /PhosCommunicationTargetTypeLabel/,
      /PhosDecisionReasonLabel/,
      /SourceRefList/,
    ]);
    expectEvidence('src/phos/ui/workspace/WorkspaceOverlay.tsx', [
      /SupportBriefPanel/,
      /detail\.support_brief/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.tsx', [
      /PhosHandoffReturnReasonLabel/,
      /RETURNED_DETAIL_PREFIX/,
    ]);
    expectEvidence('src/phos/ui/workspace/SupportBriefPanel.test.tsx', [
      /without raw enum display/,
      /queryByText\('CONTACT_SETUP'\)/,
      /queryByText\('DIFF_REVIEW'\)/,
      /queryByText\('PRESCRIPTION'\)/,
      /queryByText\('rx_1'\)/,
      /queryByText\('phone'\)/,
    ]);
    expectEvidence('src/phos/ui/handoff/ClerkSupportWorkbench.test.tsx', [
      /情報の追加が必要です/,
      /追加すること/,
      /queryByText\('NEED_MORE_INFO'\)/,
    ]);
  });
});
