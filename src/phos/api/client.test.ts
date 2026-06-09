import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BoardQuickFilter,
  BoardSortKey,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  VisitStatus,
  VisitStep,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionRequest,
  ActionResponse,
  CapacityResponse,
  CardSearchResponse,
  CardSummaryView,
  ClaimCandidateMutationResponse,
  ClaimCandidateSearchResponse,
  ErrorResponse,
  FeeRuleSearchResponse,
  HandoffMutationResponse,
  NextActionView,
  ReportDeliveryMutationResponse,
  ReportDeliverySearchResponse,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { PHOS_API_ROUTES } from '@/phos/infra/api-gateway-routes';
import { createPhosApiClient } from './client';
import type { PhosApiClient } from './types';
import { PhosApiError } from './types';

const readyCard = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: 'Test Patient',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
} satisfies CardSummaryView;

const nextAction = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
} satisfies NextActionView;

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function actionRequest(): ActionRequest {
  return {
    action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    idempotency_key: 'idem_1',
    client_version: 1,
  };
}

function actionResponse(): ActionResponse {
  return {
    card: {
      ...readyCard,
      display_status: DisplayStatus.IN_PROGRESS,
      server_version: 2,
    },
    next_action: nextAction,
    display_status: DisplayStatus.IN_PROGRESS,
    blockers: [],
    side_effects: [],
    server_version: 2,
  };
}

function capacityResponse(): CapacityResponse {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    status: CapacityStatus.TIGHT,
    total_planned_minutes: 420,
    total_available_minutes: 480,
    utilization_percent: 88,
    work_buckets: [
      {
        bucket_code: 'DISPENSING',
        label: '調剤',
        planned_minutes: 180,
        available_minutes: 210,
        utilization_percent: 86,
      },
    ],
    staff_loads: [],
    bottlenecks: [],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function claimCandidateSearchResponse(): ClaimCandidateSearchResponse {
  return {
    items: [
      {
        candidate_id: 'claim_1',
        card_id: 'card_1',
        patient_name: '患者 山田太郎',
        fee_code: 'M001',
        fee_label: '在宅患者訪問薬剤管理指導料',
        billing_month: '2026-06-01',
        status: 'MISSING_EVIDENCE',
        status_label: '根拠不足',
        missing_evidence_keys: ['management_plan'],
        evidence_requirements: [],
        rule_version_id: 'rv_2026',
        priority_rank: 10,
        source_refs: [],
        created_at: '2026-06-09T00:00:00.000Z',
        updated_at: '2026-06-09T00:00:00.000Z',
        server_version: 1,
      },
    ],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function claimCandidateMutationResponse(): ClaimCandidateMutationResponse {
  const candidate = {
    ...claimCandidateSearchResponse().items[0],
    status: 'EXCLUDED' as const,
    status_label: '除外済み',
    excluded_reason_code: 'NOT_ELIGIBLE',
    server_version: 2,
  };
  return {
    candidate,
    side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: candidate.card_id }],
    server_version: 2,
  };
}

function feeRuleSearchResponse(): FeeRuleSearchResponse {
  return {
    items: [
      {
        rule_id: 'rule_1',
        rule_version_id: 'rv_2026',
        fee_code: 'M001',
        fee_label: '在宅患者訪問薬剤管理指導料',
        tenant_scope: 'SYSTEM',
        revision_code: '2026',
        active_from: '2026-04-01',
        condition: { op: 'EXISTS', field: 'visit_record_id' },
        evidence_requirements: [],
        source_refs: [{ kind: 'RULE_DOCUMENT', ref_id: 'rule_doc_1', label: '2026改定' }],
      },
    ],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function visitModeResponse(): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    step_completed: Object.fromEntries(
      Object.values(VisitStep).map((step) => [step, false]),
    ) as Record<VisitStep, boolean>,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
  };
}

function handoffResponse(): HandoffMutationResponse {
  return {
    handoff: {
      handoff_id: 'handoff_1',
      card_id: 'card_1',
      status: HandoffStatus.RESOLVED,
      reason_code: 'DIFF_REVIEW',
      summary: '薬剤師確認が必要です。',
      source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
      requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      urgency: HandoffUrgency.HIGH,
      related_blocker_code: 'MISSING_EVIDENCE',
      created_by_user_id: 'user_clerk',
      created_at: '2026-06-09T00:00:00.000Z',
      updated_at: '2026-06-09T00:00:00.000Z',
      server_version: 2,
      patient_name: '患者 山田太郎',
      age_minutes: 12,
      resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    },
    side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }],
    server_version: 2,
  };
}

function reportDeliverySearchResponse(): ReportDeliverySearchResponse {
  return {
    items: [
      {
        delivery_id: 'delivery_1',
        card_id: 'card_1',
        report_id: 'report_1',
        patient_name: '患者 山田太郎',
        target_label: '山田医師',
        status: ReportDeliveryStatus.WAITING_REPLY,
        delivery_method: 'FAX',
        sent_at: '2026-06-09T00:00:00.000Z',
        stale_minutes: 90,
        server_version: 1,
        source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
      },
    ],
    server_time: '2026-06-09T01:30:00.000Z',
  };
}

function reportDeliveryMutationResponse(): ReportDeliveryMutationResponse {
  const delivery = {
    ...reportDeliverySearchResponse().items[0],
    status: ReportDeliveryStatus.ACTION_DONE,
    reply_summary: '問題ありません。',
    reply_received_at: '2026-06-09T02:00:00.000Z',
    action_done_at: '2026-06-09T02:00:00.000Z',
    stale_minutes: 0,
    server_version: 2,
  };
  return {
    delivery,
    side_effects: [
      {
        type: 'REPORT_REPLY_REGISTERED',
        delivery_id: delivery.delivery_id,
        status: ReportDeliveryStatus.ACTION_DONE,
      },
      { type: 'REPORT_ACTION_DONE', delivery_id: delivery.delivery_id },
    ],
    server_version: 2,
  };
}

describe('createPhosApiClient', () => {
  it('keeps the frontend API client operation surface aligned with the route manifest', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });
    const operations = [
      {
        route_key: 'GET /cards',
        path: '/prod/cards',
        invoke: (api: PhosApiClient) =>
          api.getCards({ filter: BoardQuickFilter.TODAY, sort: BoardSortKey.UPDATED }),
      },
      {
        route_key: 'GET /cards/{card_id}',
        path: '/prod/cards/card_1',
        invoke: (api: PhosApiClient) => api.getCardDetail('card_1'),
      },
      {
        route_key: 'POST /cards/{card_id}/actions',
        path: '/prod/cards/card_1/actions',
        invoke: (api: PhosApiClient) => api.executeCardAction('card_1', actionRequest()),
      },
      {
        route_key: 'GET /capacity',
        path: '/prod/capacity',
        invoke: (api: PhosApiClient) =>
          api.getCapacity({ date: '2026-06-09', scope: CapacityScope.PHARMACY }),
      },
      {
        route_key: 'GET /claim-candidates',
        path: '/prod/claim-candidates',
        invoke: (api: PhosApiClient) => api.getClaimCandidates({ limit: 25 }),
      },
      {
        route_key: 'POST /claim-candidates/{candidate_id}/exclude',
        path: '/prod/claim-candidates/claim_1/exclude',
        invoke: (api: PhosApiClient) =>
          api.excludeClaimCandidate('claim_1', {
            reason_code: 'NOT_ELIGIBLE',
            idempotency_key: 'idem_claim',
            client_version: 1,
          }),
      },
      {
        route_key: 'GET /fee-rules',
        path: '/prod/fee-rules',
        invoke: (api: PhosApiClient) => api.getFeeRules({ fee_code: 'M001' }),
      },
      {
        route_key: 'GET /visit-packets/{packet_id}/visit-mode',
        path: '/prod/visit-packets/packet_1/visit-mode',
        invoke: (api: PhosApiClient) => api.getVisitMode('packet_1'),
      },
      {
        route_key: 'POST /visit-packets/{packet_id}/visit-steps/{step}',
        path: '/prod/visit-packets/packet_1/visit-steps/COMPLETE_CHECK',
        invoke: (api: PhosApiClient) =>
          api.updateVisitStep('packet_1', VisitStep.COMPLETE_CHECK, {
            idempotency_key: 'idem_visit',
            client_version: 1,
          }),
      },
      {
        route_key: 'POST /evidence/presign-upload',
        path: '/prod/evidence/presign-upload',
        invoke: (api: PhosApiClient) =>
          api.presignEvidenceUpload({
            idempotency_key: 'idem_evidence',
            card_id: 'card_1',
            evidence_type: 'VISIT_PHOTO',
            file_name: 'visit.jpg',
            mime_type: 'image/jpeg',
            sha256: 'a'.repeat(64),
            size_bytes: 1024,
          }),
      },
      {
        route_key: 'GET /handoffs',
        path: '/prod/handoffs',
        invoke: (api: PhosApiClient) => api.getHandoffs({ status: HandoffStatus.OPEN }),
      },
      {
        route_key: 'POST /handoffs',
        path: '/prod/handoffs',
        invoke: (api: PhosApiClient) =>
          api.createHandoff({
            card_id: 'card_1',
            reason_code: 'DIFF_REVIEW',
            summary: '薬剤師確認が必要です。',
            source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
            urgency: HandoffUrgency.HIGH,
            requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            idempotency_key: 'idem_create_handoff',
            client_version: 1,
          }),
      },
      {
        route_key: 'POST /handoffs/{handoff_id}/resolve',
        path: '/prod/handoffs/handoff_1/resolve',
        invoke: (api: PhosApiClient) =>
          api.resolveHandoff('handoff_1', {
            resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            idempotency_key: 'idem_resolve',
            client_version: 1,
          }),
      },
      {
        route_key: 'POST /handoffs/{handoff_id}/open',
        path: '/prod/handoffs/handoff_1/open',
        invoke: (api: PhosApiClient) =>
          api.openHandoff('handoff_1', { idempotency_key: 'idem_open', client_version: 1 }),
      },
      {
        route_key: 'POST /handoffs/{handoff_id}/return',
        path: '/prod/handoffs/handoff_1/return',
        invoke: (api: PhosApiClient) =>
          api.returnHandoff('handoff_1', {
            return_reason_code: 'NEED_MORE_INFO',
            return_note: '確認してください。',
            idempotency_key: 'idem_return',
            client_version: 1,
          }),
      },
      {
        route_key: 'GET /report-deliveries',
        path: '/prod/report-deliveries',
        invoke: (api: PhosApiClient) =>
          api.getReportDeliveries({ status: ReportDeliveryStatus.WAITING_REPLY }),
      },
      {
        route_key: 'POST /report-deliveries/{delivery_id}/reply',
        path: '/prod/report-deliveries/delivery_1/reply',
        invoke: (api: PhosApiClient) =>
          api.registerReportReply('delivery_1', {
            result_status: ReportDeliveryStatus.ACTION_DONE,
            reply_summary: '問題ありません。',
            idempotency_key: 'idem_reply',
            client_version: 1,
          }),
      },
      {
        route_key: 'POST /report-deliveries/{delivery_id}/action-done',
        path: '/prod/report-deliveries/delivery_1/action-done',
        invoke: (api: PhosApiClient) =>
          api.markReportActionDone('delivery_1', {
            action_note: '対応済み。',
            idempotency_key: 'idem_done',
            client_version: 1,
          }),
      },
    ] as const;

    expect(operations.map((operation) => operation.route_key).sort()).toEqual(
      PHOS_API_ROUTES.map((route) => route.route_key).sort(),
    );

    for (const operation of operations) {
      await operation.invoke(client);
    }

    expect(
      fetchImpl.mock.calls.map(([url, init]) => {
        const parsed = new URL(String(url));
        return {
          method: init?.method,
          path: parsed.pathname,
        };
      }),
    ).toEqual(
      operations.map((operation) => ({
        method: operation.route_key.startsWith('POST ') ? 'POST' : 'GET',
        path: operation.path,
      })),
    );
  });

  it('builds API Gateway URLs from the PH-OS route manifest and sends auth headers', async () => {
    const searchResponse = {
      items: [{ card: readyCard, next_action: nextAction }],
      next_cursor: 'cursor_2',
      server_time: '2026-06-09T00:00:00.000Z',
    } satisfies CardSearchResponse;
    const fetchImpl = vi.fn(async () => jsonResponse(searchResponse));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod/',
      fetchImpl,
      getAccessToken: async () => 'access-token',
      correlationId: () => 'corr_1',
    });

    await expect(client.getCards({ query: '山田', limit: 25 })).resolves.toEqual(searchResponse);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/cards?query=%E5%B1%B1%E7%94%B0&limit=25',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Accept: 'application/json',
          Authorization: 'Bearer access-token',
          'x-correlation-id': 'corr_1',
        }),
      }),
    );
  });

  it('rejects Next.js /api base URLs for PH-OS business operations', () => {
    expect(() => createPhosApiClient({ baseUrl: 'https://app.example.com/api' })).toThrow(
      'PH-OS business API must not use Next.js /api routes',
    );
  });

  it('rejects plaintext API base URLs outside local development', () => {
    expect(() => createPhosApiClient({ baseUrl: 'http://api.example.com/prod' })).toThrow(
      'PH-OS API baseUrl must use https outside local development',
    );
    expect(() =>
      createPhosApiClient({
        baseUrl: 'http://localhost:8787/prod',
        fetchImpl: vi.fn<typeof fetch>(),
      }),
    ).not.toThrow();
  });

  it('posts actions to API Gateway and returns the canonical ActionResponse', async () => {
    const response = actionResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.executeCardAction('card_1', actionRequest())).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/cards/card_1/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(actionRequest()),
      }),
    );
  });

  it('loads capacity from the API Gateway capacity route', async () => {
    const response = capacityResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(
      client.getCapacity({ date: '2026-06-09', scope: CapacityScope.PHARMACY }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/capacity?date=2026-06-09&scope=PHARMACY',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses API Gateway routes for claim candidate search and exclusion', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(claimCandidateSearchResponse()))
      .mockResolvedValueOnce(jsonResponse(claimCandidateMutationResponse()));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(
      client.getClaimCandidates({ status: 'MISSING_EVIDENCE', limit: 25 }),
    ).resolves.toEqual(claimCandidateSearchResponse());
    await expect(
      client.excludeClaimCandidate('claim_1', {
        reason_code: 'NOT_ELIGIBLE',
        idempotency_key: 'idem_1',
        client_version: 1,
      }),
    ).resolves.toEqual(claimCandidateMutationResponse());

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/prod/claim-candidates?status=MISSING_EVIDENCE&limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/prod/claim-candidates/claim_1/exclude',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason_code: 'NOT_ELIGIBLE',
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );
  });

  it('loads fee rules from the API Gateway route', async () => {
    const response = feeRuleSearchResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.getFeeRules({ fee_code: 'M001' })).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/fee-rules?fee_code=M001',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses API Gateway routes for handoff list and mutations', async () => {
    const response = handoffResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(
      client.openHandoff('handoff_1', {
        idempotency_key: 'idem_open',
        client_version: 1,
      }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/handoffs/handoff_1/open',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          idempotency_key: 'idem_open',
          client_version: 1,
        }),
      }),
    );

    await expect(
      client.resolveHandoff('handoff_1', {
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_resolve',
        client_version: 1,
      }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/handoffs/handoff_1/resolve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_resolve',
          client_version: 1,
        }),
      }),
    );

    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ items: [response.handoff], server_time: '2026-06-09T00:00:00.000Z' }),
    );
    await client.getHandoffs({ status: HandoffStatus.OPEN, assignee: 'ME' });

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://api.example.com/prod/handoffs?status=OPEN&assignee=ME',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses API Gateway routes for VisitMode reads and step mutations', async () => {
    const response = visitModeResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.getVisitMode('packet_1')).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/visit-packets/packet_1/visit-mode',
      expect.objectContaining({ method: 'GET' }),
    );

    await expect(
      client.updateVisitStep('packet_1', VisitStep.COMPLETE_CHECK, {
        idempotency_key: 'idem_visit',
        client_version: 3,
      }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://api.example.com/prod/visit-packets/packet_1/visit-steps/COMPLETE_CHECK',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ idempotency_key: 'idem_visit', client_version: 3 }),
      }),
    );
  });

  it('loads report delivery waiting replies from the API Gateway route', async () => {
    const response = reportDeliverySearchResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(
      client.getReportDeliveries({ status: ReportDeliveryStatus.WAITING_REPLY, limit: 25 }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/report-deliveries?status=WAITING_REPLY&limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses API Gateway routes for report delivery reply mutations', async () => {
    const response = reportDeliveryMutationResponse();
    const fetchImpl = vi.fn(async () => jsonResponse(response));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(
      client.registerReportReply('delivery_1', {
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        idempotency_key: 'idem_reply',
        client_version: 1,
      }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/report-deliveries/delivery_1/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          result_status: ReportDeliveryStatus.ACTION_DONE,
          reply_summary: '問題ありません。',
          idempotency_key: 'idem_reply',
          client_version: 1,
        }),
      }),
    );

    await expect(
      client.markReportActionDone('delivery_1', {
        action_note: '電話で確認済み。',
        idempotency_key: 'idem_done',
        client_version: 2,
      }),
    ).resolves.toEqual(response);

    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://api.example.com/prod/report-deliveries/delivery_1/action-done',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action_note: '電話で確認済み。',
          idempotency_key: 'idem_done',
          client_version: 2,
        }),
      }),
    );
  });

  it('throws PhosApiError for canonical ErrorResponse bodies', async () => {
    const error = {
      request_id: 'req_1',
      error_code: 'STALE_VERSION',
      message_key: 'api.error.stale_version',
    } satisfies ErrorResponse;
    const fetchImpl = vi.fn(async () => jsonResponse(error, { status: 409 }));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.executeCardAction('card_1', actionRequest())).rejects.toMatchObject({
      status: 409,
      response: error,
    } satisfies Partial<PhosApiError>);
  });

  it.each([
    {
      name: 'plain text',
      response: new Response('Forbidden', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      }),
      expected_status: 403,
      expected_content_type: 'text/plain',
    },
    {
      name: 'HTML',
      response: new Response('<html>Bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
      expected_status: 502,
      expected_content_type: 'text/html',
    },
  ])('normalizes non-JSON $name error responses as PhosApiError', async (testCase) => {
    const fetchImpl = vi.fn(async () => testCase.response);
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.getCards()).rejects.toMatchObject({
      status: testCase.expected_status,
      response: {
        request_id: '',
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.invalid_response',
        details: {
          status: testCase.expected_status,
          content_type: testCase.expected_content_type,
          invalid_json: true,
        },
      },
    } satisfies Partial<PhosApiError>);
  });

  it('normalizes non-canonical JSON error responses as PhosApiError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'upstream' }, { status: 500 }));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.getCards()).rejects.toMatchObject({
      status: 500,
      response: {
        request_id: '',
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.invalid_response',
        details: {
          status: 500,
          content_type: 'application/json',
        },
      },
    } satisfies Partial<PhosApiError>);
  });

  it('normalizes empty error responses as PhosApiError', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    await expect(client.getCards()).rejects.toMatchObject({
      status: 500,
      response: {
        request_id: '',
        error_code: 'INTERNAL_ERROR',
        message_key: 'api.error.invalid_response',
        details: {
          status: 500,
          content_type: null,
        },
      },
    } satisfies Partial<PhosApiError>);
  });

  it('rejects unsafe path segments before the request leaves the browser', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(actionResponse()));
    const client = createPhosApiClient({
      baseUrl: 'https://api.example.com/prod',
      fetchImpl,
    });

    expect(() => client.getCardDetail('../card_1')).toThrow(
      'card_id contains an unsafe path segment',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
