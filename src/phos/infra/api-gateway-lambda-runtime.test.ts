import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CARD_ACTION_TARGET_ENDPOINT,
  CapacityScope,
  CapacityStatus,
  CardType,
  ClaimCandidateStatus,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  UserRole,
  VisitStatus,
  VisitStep,
  type ActionResponse,
  type CapacityResponse,
  type CardDetailResponse,
  type CardSearchResponse,
  type ClaimCandidateMutationResponse,
  type ClaimCandidateSearchResponse,
  type FeeRuleSearchResponse,
  type HandoffMutationResponse,
  type HandoffSearchResponse,
  type HandoffView,
  type NextActionView,
  type ReportDeliveryMutationResponse,
  type ReportDeliverySearchResponse,
  type ReportDeliveryView,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { isValidResponseContract } from '@/phos/api/client';
import {
  createCardDetailLambdaHandler,
  createCardSearchLambdaHandler,
  createExecuteCardActionLambdaHandler,
} from '@/phos/backend/cards-lambda';
import { createCapacityLambdaHandler } from '@/phos/backend/capacity-lambda';
import {
  createClaimCandidateSearchLambdaHandler,
  createExcludeClaimCandidateLambdaHandler,
} from '@/phos/backend/claim-candidates-lambda';
import { createEvidencePresignUploadLambdaHandler } from '@/phos/backend/evidence-lambda';
import { createFeeRuleSearchLambdaHandler } from '@/phos/backend/fee-rules-lambda';
import {
  createCreateHandoffLambdaHandler,
  createHandoffSearchLambdaHandler,
  createOpenHandoffLambdaHandler,
  createResolveHandoffLambdaHandler,
  createReturnHandoffLambdaHandler,
} from '@/phos/backend/handoffs-lambda';
import {
  createMarkReportActionDoneLambdaHandler,
  createRegisterReportReplyLambdaHandler,
  createReportDeliverySearchLambdaHandler,
} from '@/phos/backend/report-deliveries-lambda';
import { hashTenantId, hashUserId } from '@/phos/backend/observability';
import {
  createGetVisitModeLambdaHandler,
  createUpdateVisitStepLambdaHandler,
} from '@/phos/backend/visit-mode-lambda';
import type { PhosLambdaResponse } from '@/phos/backend/error-response';
import type { PhosHttpEvent } from '@/phos/backend/lambda-handler';
import { PHOS_API_ROUTES, type PhosApiRoute } from './api-gateway-routes';
import { bindPhosApiRouteForDeployment } from './api-gateway-lambda-template';

type PhosLambdaHandler = (event: PhosHttpEvent) => Promise<PhosLambdaResponse>;
type RuntimeSuccessCase = {
  handler: PhosLambdaHandler;
  overrides?: Partial<PhosHttpEvent>;
};

const serverTime = '2026-06-09T00:00:00.000Z';
const runtimeTenantId = 'tenant_abc123';
const runtimeUserId = 'user_1';
const runtimeTenantIdHash = hashTenantId(runtimeTenantId);
const runtimeUserIdHash = hashUserId(runtimeUserId);

const nextAction: NextActionView = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: CARD_ACTION_TARGET_ENDPOINT,
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
};

const card = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: '患者 山田太郎',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
};

const cardSearchResponse: CardSearchResponse = {
  items: [{ card, next_action: nextAction }],
  server_time: serverTime,
};

const cardDetailResponse: CardDetailResponse = {
  card,
  visible_tabs: ['OVERVIEW'],
  permissions: {
    can_read: true,
    can_write: true,
    allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
  },
  next_action: nextAction,
  blockers: [],
  source_refs: [],
  server_version: 1,
};

const cardActionResponse: ActionResponse = {
  card: { ...card, current_step: CurrentStep.DISPENSING, server_version: 2 },
  next_action: nextAction,
  display_status: DisplayStatus.READY,
  blockers: [],
  side_effects: [],
  server_version: 2,
};

const capacityResponse: CapacityResponse = {
  date: '2026-06-09',
  scope: CapacityScope.PHARMACY,
  status: CapacityStatus.AVAILABLE,
  total_planned_minutes: 120,
  total_available_minutes: 180,
  utilization_percent: 67,
  work_buckets: [],
  staff_loads: [],
  bottlenecks: [],
  server_time: serverTime,
};

const claimCandidate = {
  candidate_id: 'claim_1',
  card_id: 'card_1',
  patient_name: '患者 山田太郎',
  fee_code: 'M001',
  fee_label: '在宅患者訪問薬剤管理指導料',
  billing_month: '2026-06',
  status: ClaimCandidateStatus.READY,
  status_label: '請求候補',
  missing_evidence_keys: [],
  evidence_requirements: [],
  rule_version_id: 'rule_version_1',
  priority_rank: 1,
  source_refs: [],
  created_at: serverTime,
  updated_at: serverTime,
  server_version: 1,
};

const claimCandidateSearchResponse: ClaimCandidateSearchResponse = {
  items: [claimCandidate],
  server_time: serverTime,
};

const claimCandidateMutationResponse: ClaimCandidateMutationResponse = {
  candidate: { ...claimCandidate, status: ClaimCandidateStatus.EXCLUDED, server_version: 2 },
  side_effects: [],
  server_version: 2,
};

const feeRuleSearchResponse: FeeRuleSearchResponse = {
  items: [
    {
      rule_id: 'rule_1',
      rule_version_id: 'rule_version_1',
      fee_code: 'M001',
      fee_label: '在宅患者訪問薬剤管理指導料',
      tenant_scope: 'SYSTEM',
      revision_code: '2026',
      active_from: '2026-04-01',
      condition: { op: 'EXISTS', field: 'visit_record_id' },
      evidence_requirements: [],
      source_refs: [],
    },
  ],
  server_time: serverTime,
};

const visitMode: VisitModeView = {
  packet_id: 'packet_1',
  card_id: 'card_1',
  server_version: 4,
  patient_name: '患者 山田太郎',
  visit_status: VisitStatus.IN_PROGRESS,
  applicable_steps: [VisitStep.EVIDENCE_UPLOAD],
  required_steps: [VisitStep.EVIDENCE_UPLOAD],
  step_completed: Object.fromEntries(
    Object.values(VisitStep).map((step) => [step, step === VisitStep.EVIDENCE_UPLOAD]),
  ) as Record<VisitStep, boolean>,
  last_opened_step: VisitStep.EVIDENCE_UPLOAD,
  evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
  online: true,
};

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.HIGH,
    related_blocker_code: 'MISSING_EVIDENCE',
    created_by_user_id: 'user_clerk',
    assignee_user_id: 'user_1',
    created_at: serverTime,
    updated_at: serverTime,
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 12,
    ...overrides,
  };
}

const handoffSearchResponse: HandoffSearchResponse = {
  items: [handoff()],
  server_time: serverTime,
};

function handoffMutationResponse(overrides: Partial<HandoffView> = {}): HandoffMutationResponse {
  const next = handoff(overrides);
  return { handoff: next, side_effects: [], server_version: next.server_version };
}

const reportDelivery: ReportDeliveryView = {
  delivery_id: 'delivery_1',
  card_id: 'card_1',
  report_id: 'report_1',
  patient_name: '患者 山田太郎',
  target_label: '山田医師',
  sent_at: serverTime,
  stale_minutes: 0,
  status: ReportDeliveryStatus.WAITING_REPLY,
  delivery_method: 'FAX',
  server_version: 1,
  source_refs: [],
};

const reportDeliverySearchResponse: ReportDeliverySearchResponse = {
  items: [reportDelivery],
  server_time: serverTime,
};

const reportDeliveryMutationResponse: ReportDeliveryMutationResponse = {
  delivery: { ...reportDelivery, status: ReportDeliveryStatus.ACTION_DONE, server_version: 2 },
  side_effects: [{ type: 'REPORT_ACTION_DONE', delivery_id: 'delivery_1' }],
  server_version: 2,
};

function pathFor(route: PhosApiRoute): string {
  return route.path.replace(/\{([^}]+)\}/g, (_, name: string) => `${name}_1`);
}

function pathParametersFor(route: PhosApiRoute): Record<string, string> | undefined {
  const matches = [...route.path.matchAll(/\{([^}]+)\}/g)];
  if (matches.length === 0) return undefined;
  return Object.fromEntries(matches.map((match) => [match[1], `${match[1]}_1`]));
}

function apiGatewayEventFor(
  route: PhosApiRoute,
  overrides: Partial<PhosHttpEvent> = {},
): PhosHttpEvent {
  return {
    version: '2.0',
    routeKey: route.route_key,
    resource: route.path,
    httpMethod: route.method,
    rawPath: pathFor(route),
    headers: {
      authorization: 'Bearer test.jwt',
      'x-correlation-id': 'corr_runtime',
    },
    pathParameters: pathParametersFor(route),
    queryStringParameters: null,
    body: route.method === 'POST' ? '{}' : undefined,
    requestContext: {
      requestId: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_1',
            role: route.allowed_roles[0] ?? UserRole.ADMIN,
            scope: route.required_scopes.join(' '),
          },
        },
      },
    },
    ...overrides,
  };
}

function buildRuntimeSuccessCases(): Record<string, RuntimeSuccessCase> {
  const cardsRepository = {
    searchCards: vi.fn(async () => cardSearchResponse),
    getCardDetail: vi.fn(async () => cardDetailResponse),
    executeCardAction: vi.fn(async () => cardActionResponse),
  };
  const claimCandidatesRepository = {
    searchClaimCandidates: vi.fn(async () => claimCandidateSearchResponse),
    excludeClaimCandidate: vi.fn(async () => claimCandidateMutationResponse),
  };
  const handoffsRepository = {
    searchHandoffs: vi.fn(async () => handoffSearchResponse),
    createHandoff: vi.fn(async () => handoffMutationResponse()),
    openHandoff: vi.fn(async () => handoffMutationResponse({ status: HandoffStatus.IN_REVIEW })),
    resolveHandoff: vi.fn(async () =>
      handoffMutationResponse({
        status: HandoffStatus.RESOLVED,
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        server_version: 2,
      }),
    ),
    returnHandoff: vi.fn(async () =>
      handoffMutationResponse({
        status: HandoffStatus.RETURNED,
        return_reason_code: 'NEED_MORE_INFO',
        return_note: '施設連絡先を確認してください。',
        server_version: 2,
      }),
    ),
  };
  const reportDeliveriesRepository = {
    searchReportDeliveries: vi.fn(async () => reportDeliverySearchResponse),
    registerReportReply: vi.fn(async () => reportDeliveryMutationResponse),
    markReportActionDone: vi.fn(async () => reportDeliveryMutationResponse),
  };
  const visitModeRepository = {
    getVisitMode: vi.fn(async () => visitMode),
    updateVisitStep: vi.fn(async () => ({ ...visitMode, server_version: 5 })),
  };

  return {
    'GET /cards': {
      handler: createCardSearchLambdaHandler({ repository: cardsRepository }),
      overrides: { queryStringParameters: { limit: '25' } },
    },
    'GET /cards/{card_id}': {
      handler: createCardDetailLambdaHandler({ repository: cardsRepository }),
    },
    'POST /cards/{card_id}/actions': {
      handler: createExecuteCardActionLambdaHandler({ repository: cardsRepository }),
      overrides: {
        body: JSON.stringify({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_card_action',
          client_version: 1,
        }),
      },
    },
    'GET /capacity': {
      handler: createCapacityLambdaHandler({
        repository: { getCapacity: vi.fn(async () => capacityResponse) },
      }),
      overrides: {
        queryStringParameters: { date: '2026-06-09', scope: CapacityScope.PHARMACY },
      },
    },
    'GET /claim-candidates': {
      handler: createClaimCandidateSearchLambdaHandler({ repository: claimCandidatesRepository }),
      overrides: { queryStringParameters: { status: ClaimCandidateStatus.READY, limit: '25' } },
    },
    'POST /claim-candidates/{candidate_id}/exclude': {
      handler: createExcludeClaimCandidateLambdaHandler({ repository: claimCandidatesRepository }),
      overrides: {
        body: JSON.stringify({
          reason_code: 'NOT_ELIGIBLE',
          idempotency_key: 'idem_claim_exclude',
          client_version: 1,
        }),
      },
    },
    'GET /fee-rules': {
      handler: createFeeRuleSearchLambdaHandler({
        repository: { searchFeeRules: vi.fn(async () => feeRuleSearchResponse) },
      }),
      overrides: { queryStringParameters: { fee_code: 'M001', limit: '25' } },
    },
    'GET /visit-packets/{packet_id}/visit-mode': {
      handler: createGetVisitModeLambdaHandler({ repository: visitModeRepository }),
      overrides: { pathParameters: { packet_id: 'packet_1' } },
    },
    'POST /visit-packets/{packet_id}/visit-steps/{step}': {
      handler: createUpdateVisitStepLambdaHandler({ repository: visitModeRepository }),
      overrides: {
        pathParameters: { packet_id: 'packet_1', step: VisitStep.EVIDENCE_UPLOAD },
        body: JSON.stringify({
          idempotency_key: 'idem_visit_step',
          client_version: 4,
          payload: { evidence_key: 'evidence_1' },
        }),
      },
    },
    'POST /evidence/presign-upload': {
      handler: createEvidencePresignUploadLambdaHandler({
        presigner: {
          presignPut: vi.fn(async () => ({
            upload_url: 'https://s3.example/upload',
            headers: { 'Content-Type': 'image/jpeg' },
            expires_in_seconds: 300,
          })),
        },
        upload_authorizer: {
          authorizeEvidenceUpload: vi.fn(async () => undefined),
        },
        upload_intent_store: {
          recordUploadIntent: vi.fn(async () => undefined),
        },
        generateEvidenceId: () => 'evidence_1',
        now: () => new Date(serverTime),
      }),
      overrides: {
        body: JSON.stringify({
          idempotency_key: 'idem_evidence',
          card_id: 'card_1',
          evidence_type: 'PHOTO',
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          sha256: 'a'.repeat(64),
          size_bytes: 1024,
        }),
      },
    },
    'GET /handoffs': {
      handler: createHandoffSearchLambdaHandler({ repository: handoffsRepository }),
      overrides: { queryStringParameters: { status: HandoffStatus.OPEN, limit: '25' } },
    },
    'POST /handoffs': {
      handler: createCreateHandoffLambdaHandler({ repository: handoffsRepository }),
      overrides: {
        body: JSON.stringify({
          card_id: 'card_1',
          reason_code: 'DIFF_REVIEW',
          summary: '薬剤師確認が必要です。',
          source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
          urgency: HandoffUrgency.HIGH,
          related_blocker_code: 'MISSING_EVIDENCE',
          idempotency_key: 'idem_handoff_create',
          client_version: 1,
        }),
      },
    },
    'POST /handoffs/{handoff_id}/open': {
      handler: createOpenHandoffLambdaHandler({ repository: handoffsRepository }),
      overrides: {
        body: JSON.stringify({ idempotency_key: 'idem_handoff_open', client_version: 1 }),
      },
    },
    'POST /handoffs/{handoff_id}/resolve': {
      handler: createResolveHandoffLambdaHandler({ repository: handoffsRepository }),
      overrides: {
        body: JSON.stringify({
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_handoff_resolve',
          client_version: 1,
        }),
      },
    },
    'POST /handoffs/{handoff_id}/return': {
      handler: createReturnHandoffLambdaHandler({ repository: handoffsRepository }),
      overrides: {
        body: JSON.stringify({
          return_reason_code: 'NEED_MORE_INFO',
          return_note: '施設連絡先を確認してください。',
          idempotency_key: 'idem_handoff_return',
          client_version: 1,
        }),
      },
    },
    'GET /report-deliveries': {
      handler: createReportDeliverySearchLambdaHandler({ repository: reportDeliveriesRepository }),
      overrides: {
        queryStringParameters: { status: ReportDeliveryStatus.WAITING_REPLY, limit: '25' },
      },
    },
    'POST /report-deliveries/{delivery_id}/reply': {
      handler: createRegisterReportReplyLambdaHandler({ repository: reportDeliveriesRepository }),
      overrides: {
        body: JSON.stringify({
          result_status: ReportDeliveryStatus.ACTION_DONE,
          reply_summary: '問題ありません。',
          idempotency_key: 'idem_report_reply',
          client_version: 1,
        }),
      },
    },
    'POST /report-deliveries/{delivery_id}/action-done': {
      handler: createMarkReportActionDoneLambdaHandler({ repository: reportDeliveriesRepository }),
      overrides: {
        body: JSON.stringify({
          action_note: '折り返し確認済みです。',
          idempotency_key: 'idem_report_done',
          client_version: 1,
        }),
      },
    },
  };
}

function withJwtClaims(event: PhosHttpEvent, claims: Record<string, unknown>): PhosHttpEvent {
  const existingJwtClaims = event.requestContext?.authorizer?.jwt?.claims;
  const existingRestClaims = event.requestContext?.authorizer?.claims;
  return {
    ...event,
    requestContext: {
      ...event.requestContext,
      authorizer: {
        ...(existingJwtClaims
          ? {
              jwt: {
                claims: {
                  ...existingJwtClaims,
                  ...claims,
                },
              },
            }
          : {
              claims: {
                ...(existingRestClaims ?? {}),
                ...claims,
              },
            }),
      },
    },
  };
}

function disallowedRoleFor(route: PhosApiRoute): UserRole | undefined {
  return Object.values(UserRole).find((role) => !route.allowed_roles.includes(role));
}

async function importRouteHandler(route: PhosApiRoute): Promise<PhosLambdaHandler> {
  const [modulePath, exportName] = route.lambda_handler.split('#');
  expect(modulePath).toBeTruthy();
  expect(exportName).toBeTruthy();
  const lambdaModule = (await import(modulePath.replace('@/', '@/'))) as Record<string, unknown>;
  const handler = lambdaModule[exportName];
  expect(handler).toEqual(expect.any(Function));
  return handler as PhosLambdaHandler;
}

function parseBody(response: PhosLambdaResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

function parsedConsoleLogEntries(): Record<string, unknown>[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

function parsedConsoleErrorEntries(): Record<string, unknown>[] {
  return vi
    .mocked(console.error)
    .mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

function clearConsoleSpies() {
  vi.mocked(console.log).mockClear();
  vi.mocked(console.error).mockClear();
}

const phiLogForbiddenFragments = [
  '患者 山田太郎',
  '山田医師',
  '在宅患者訪問薬剤管理指導料',
  '薬剤師確認が必要です。',
  '施設連絡先を確認してください。',
  'photo.jpg',
  'https://s3.example/upload',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
];

function expectNoPhiInRuntimeLogs(routeKey: string) {
  const logPayload = JSON.stringify([...parsedConsoleLogEntries(), ...parsedConsoleErrorEntries()]);
  for (const fragment of phiLogForbiddenFragments) {
    expect(logPayload, `${routeKey} leaked ${fragment}`).not.toContain(fragment);
  }
}

describe('PH-OS API Gateway/Lambda runtime proof', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully handles an HTTP API proxy event for every manifest route with injected dependencies', async () => {
    const successCases = buildRuntimeSuccessCases();
    expect(Object.keys(successCases).sort()).toEqual(
      PHOS_API_ROUTES.map((route) => route.route_key).sort(),
    );

    for (const route of PHOS_API_ROUTES) {
      clearConsoleSpies();
      const testCase = successCases[route.route_key]!;
      const response = await testCase.handler(apiGatewayEventFor(route, testCase.overrides));

      expect(response.statusCode, route.route_key).toBe(200);
      expect(response.headers['Cache-Control'], route.route_key).toBe('no-store, max-age=0');
      expect(response.headers['Content-Type'], route.route_key).toBe('application/json');
      expect(response.headers.Pragma, route.route_key).toBe('no-cache');
      expect(response.headers['X-Request-Id'], route.route_key).toBe(
        `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      );
      const body = parseBody(response);
      expect(body, route.route_key).toEqual(expect.any(Object));
      expect(isValidResponseContract(body, route.response_contract), route.route_key).toBe(true);
      expect(parsedConsoleErrorEntries(), route.route_key).toEqual([]);
      expect(parsedConsoleLogEntries(), route.route_key).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            route_key: route.route_key,
            tenant_id_hash: runtimeTenantIdHash,
            user_id_hash: runtimeUserIdHash,
            RequestLatencyMs: expect.any(Number),
          }),
          expect.objectContaining({
            level: 'INFO',
            message: 'PH-OS lambda request completed',
            result: 'SUCCESS',
            status_code: 200,
            tenant_id_hash: runtimeTenantIdHash,
            user_id_hash: runtimeUserIdHash,
            route_key: route.route_key,
          }),
        ]),
      );
      expectNoPhiInRuntimeLogs(route.route_key);
    }
  });

  it('accepts scp-only HTTP API JWT route scopes for every manifest route', async () => {
    const successCases = buildRuntimeSuccessCases();

    for (const route of PHOS_API_ROUTES) {
      clearConsoleSpies();
      const testCase = successCases[route.route_key]!;
      const response = await testCase.handler(
        withJwtClaims(apiGatewayEventFor(route, testCase.overrides), {
          scope: undefined,
          scp: [...route.required_scopes],
        }),
      );

      expect(response.statusCode, route.route_key).toBe(200);
    }
  });

  it('invokes every manifest Lambda export and rejects external tenant_id with JWT attribution', async () => {
    for (const route of PHOS_API_ROUTES) {
      const binding = bindPhosApiRouteForDeployment(route);
      const handler = await importRouteHandler(route);
      expect(binding.cloudformation_handler).toBe(
        `${binding.lambda_handler_file}.${binding.lambda_handler_export}`,
      );

      const cases: Array<{
        source: 'query' | 'path' | 'body';
        overrides: Partial<PhosHttpEvent>;
      }> = [
        {
          source: 'query',
          overrides: { queryStringParameters: { tenant_id: 'tenant_other' } },
        },
        {
          source: 'path',
          overrides: {
            pathParameters: {
              ...(pathParametersFor(route) ?? {}),
              tenant_id: 'tenant_other',
            },
          },
        },
        ...(route.method === 'POST'
          ? [
              {
                source: 'body' as const,
                overrides: { body: JSON.stringify({ tenant_id: 'tenant_other' }) },
              },
            ]
          : []),
      ];

      for (const testCase of cases) {
        clearConsoleSpies();
        const response = await handler(apiGatewayEventFor(route, testCase.overrides));

        expect(response.statusCode).toBe(400);
        expect(parseBody(response)).toMatchObject({
          error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
          message_key: 'api.error.tenant_id_in_payload_forbidden',
          details: { source: testCase.source },
        });
        expect(parsedConsoleErrorEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              level: 'ERROR',
              message: 'PH-OS lambda boundary failed',
              result: 'ERROR',
              status_code: 400,
              tenant_id_hash: runtimeTenantIdHash,
              user_id_hash: runtimeUserIdHash,
              request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
              correlation_id: 'corr_runtime',
              route_key: route.route_key,
              error_code: 'TENANT_ID_IN_PAYLOAD_FORBIDDEN',
              details: { source: testCase.source },
            }),
          ]),
        );
        expect(parsedConsoleLogEntries()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              route_key: route.route_key,
              tenant_id_hash: runtimeTenantIdHash,
              user_id_hash: runtimeUserIdHash,
              TenantBoundaryRejectedCount: 1,
            }),
            expect.objectContaining({
              route_key: route.route_key,
              tenant_id_hash: runtimeTenantIdHash,
              user_id_hash: runtimeUserIdHash,
              CrossTenantAttemptCount: 1,
            }),
          ]),
        );
      }
    }
  });

  it('fails closed for every manifest route when API Gateway JWT claims are missing', async () => {
    for (const route of PHOS_API_ROUTES) {
      const handler = await importRouteHandler(route);
      const response = await handler(
        apiGatewayEventFor(route, {
          requestContext: { requestId: 'req_missing_claims' },
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(parseBody(response)).toMatchObject({
        request_id: 'req_missing_claims',
        error_code: 'TENANT_CONTEXT_MISSING',
      });
    }
  });

  it('fails closed for every manifest route when only legacy custom Cognito tenant claims are present', async () => {
    for (const route of PHOS_API_ROUTES) {
      const handler = await importRouteHandler(route);
      const response = await handler(
        withJwtClaims(apiGatewayEventFor(route), {
          tenant_id: undefined,
          role: undefined,
          'custom:tenant_id': 'tenant_legacy',
          'custom:role': route.allowed_roles[0] ?? UserRole.ADMIN,
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(parseBody(response)).toMatchObject({
        request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        error_code: 'TENANT_CONTEXT_MISSING',
        message_key: 'api.error.tenant_context_missing',
      });
    }
  });

  it('rejects malformed JSON before any route repository can run', async () => {
    const postRoutes = PHOS_API_ROUTES.filter((route) => route.method === 'POST');

    for (const route of postRoutes) {
      const handler = await importRouteHandler(route);
      const response = await handler(apiGatewayEventFor(route, { body: '{' }));

      expect(response.statusCode).toBe(400);
      expect(parseBody(response)).toMatchObject({
        error_code: 'VALIDATION_ERROR',
        message_key: 'api.error.invalid_json',
      });
    }
  });

  it('returns canonical 403 responses for every manifest route when required scopes are missing', async () => {
    for (const route of PHOS_API_ROUTES) {
      const handler = await importRouteHandler(route);
      const response = await handler(
        withJwtClaims(apiGatewayEventFor(route), {
          scope: 'phos/unrelated.read',
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(parseBody(response)).toMatchObject({
        request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
        details: { missing_scopes: [...route.required_scopes] },
      });
      expect(parsedConsoleErrorEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'ERROR',
            message: 'PH-OS lambda request completed',
            result: 'ERROR',
            status_code: 403,
            tenant_id_hash: runtimeTenantIdHash,
            user_id_hash: runtimeUserIdHash,
            route_key: route.route_key,
            error_code: 'FORBIDDEN',
          }),
        ]),
      );
      clearConsoleSpies();
    }
  });

  it('returns canonical 403 responses for manifest routes when the caller role is not allowed', async () => {
    for (const route of PHOS_API_ROUTES) {
      const disallowedRole = disallowedRoleFor(route);
      if (!disallowedRole) continue;

      const handler = await importRouteHandler(route);
      const response = await handler(
        withJwtClaims(apiGatewayEventFor(route), {
          role: disallowedRole,
        }),
      );

      expect(response.statusCode).toBe(403);
      expect(parseBody(response)).toMatchObject({
        request_id: `req_${route.route_key.replace(/[^a-zA-Z0-9]+/g, '_')}`,
        error_code: 'FORBIDDEN',
        message_key: 'api.error.forbidden',
        details: {
          role: disallowedRole,
          allowed_roles: [...route.allowed_roles],
        },
      });
      expect(parsedConsoleErrorEntries()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'ERROR',
            message: 'PH-OS lambda request completed',
            result: 'ERROR',
            status_code: 403,
            tenant_id_hash: runtimeTenantIdHash,
            user_id_hash: runtimeUserIdHash,
            route_key: route.route_key,
            error_code: 'FORBIDDEN',
          }),
        ]),
      );
      clearConsoleSpies();
    }
  });
});
