import { describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
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
  ErrorResponse,
  HandoffMutationResponse,
  NextActionView,
  ReportDeliveryMutationResponse,
  ReportDeliverySearchResponse,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import { createPhosApiClient } from './client';
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
