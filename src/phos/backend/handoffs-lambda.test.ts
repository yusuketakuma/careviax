import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type {
  HandoffMutationResponse,
  HandoffSearchResponse,
  HandoffView,
} from '@/phos/contracts/phos_contracts';
import type { PhosHandoffsRepository } from './handoffs-repository';
import {
  createCreateHandoffLambdaHandler,
  createDynamoHandoffStoreClient,
  createHandoffSearchLambdaHandler,
  createOpenHandoffLambdaHandler,
} from './handoffs-lambda';
import type { PhosHttpEvent } from './lambda-handler';

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
    assignee_user_id: 'user_pharmacist',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 12,
    ...overrides,
  };
}

function searchResponse(): HandoffSearchResponse {
  return {
    items: [handoff()],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function mutationResponse(overrides: Partial<HandoffView> = {}): HandoffMutationResponse {
  const next = handoff(overrides);
  return {
    handoff: next,
    side_effects: [],
    server_version: next.server_version,
  };
}

function repository(overrides: Partial<PhosHandoffsRepository> = {}): PhosHandoffsRepository {
  return {
    searchHandoffs: vi.fn(async () => searchResponse()),
    createHandoff: vi.fn(async () => mutationResponse()),
    openHandoff: vi.fn(async () => mutationResponse({ status: HandoffStatus.IN_REVIEW })),
    resolveHandoff: vi.fn(async () =>
      mutationResponse({
        status: HandoffStatus.RESOLVED,
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        server_version: 2,
      }),
    ),
    returnHandoff: vi.fn(async () =>
      mutationResponse({
        status: HandoffStatus.RETURNED,
        return_reason_code: 'NEED_MORE_INFO',
        return_note: '施設連絡先を確認してください。',
        server_version: 2,
      }),
    ),
    ...overrides,
  };
}

function event(overrides: Partial<PhosHttpEvent> = {}): PhosHttpEvent {
  return {
    routeKey: 'GET /handoffs',
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_001',
            role: 'PHARMACIST',
            scope: 'phos/handoffs.read phos/handoffs.write',
          },
        },
      },
    },
    ...overrides,
  };
}

describe('PH-OS handoffs Lambda composition', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires GET /handoffs through tenant context into the repository', async () => {
    const repo = repository();
    const handler = createHandoffSearchLambdaHandler({ repository: repo });

    const response = await handler(
      event({
        queryStringParameters: { status: HandoffStatus.OPEN, assignee: 'ME', limit: '25' },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.searchHandoffs).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', user_id: 'user_001' }),
      { status: HandoffStatus.OPEN, assignee: 'ME', limit: 25 },
    );
  });

  it('returns validation error for malformed Dynamo cursors in the composed handoff search handler', async () => {
    const send = vi.fn(async () => ({ Items: [] }));
    const handler = createHandoffSearchLambdaHandler({ dynamo_client: { send } });

    const response = await handler(
      event({ queryStringParameters: { status: HandoffStatus.OPEN, cursor: 'not-base64-json' } }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('wires POST /handoffs through the composed create handler', async () => {
    const repo = repository();
    const handler = createCreateHandoffLambdaHandler({ repository: repo });

    const response = await handler(
      event({
        routeKey: 'POST /handoffs',
        requestContext: {
          requestId: 'req_1',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_clerk',
                role: 'PHARMACY_CLERK',
                scope: 'phos/handoffs.write',
              },
            },
          },
        },
        body: JSON.stringify({
          card_id: 'card_1',
          reason_code: 'DIFF_REVIEW',
          summary: '薬剤師確認が必要です。',
          source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
          urgency: HandoffUrgency.HIGH,
          related_blocker_code: 'MISSING_EVIDENCE',
          idempotency_key: 'idem_create',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user_clerk' }),
      expect.objectContaining({
        card_id: 'card_1',
        idempotency_key: 'idem_create',
        client_version: 1,
      }),
    );
  });

  it('wires POST /handoffs/{handoff_id}/open through the composed open handler', async () => {
    const repo = repository();
    const handler = createOpenHandoffLambdaHandler({ repository: repo });

    const response = await handler(
      event({
        routeKey: 'POST /handoffs/{handoff_id}/open',
        pathParameters: { handoff_id: 'handoff_1' },
        body: JSON.stringify({ idempotency_key: 'idem_open', client_version: 1 }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.openHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PHARMACIST' }),
      'handoff_1',
      { idempotency_key: 'idem_open', client_version: 1 },
    );
  });

  it('rejects malformed Dynamo cursors before querying handoffs', async () => {
    const send = vi.fn(async () => ({ Items: [] }));
    const client = createDynamoHandoffStoreClient({ client: { send } });

    await expect(
      client.queryHandoffs({
        table_name: 'phos_core',
        key_type: 'GSI',
        index_name: 'GSI1',
        partition_key: 'TENANT#tenant_abc123#HANDOFF_STATUS#OPEN',
        limit: 25,
        cursor: 'not-base64-json',
      }),
    ).rejects.toMatchObject({
      status: 400,
      error_code: 'VALIDATION_ERROR',
      details: { field: 'cursor' },
    });

    expect(send).not.toHaveBeenCalled();
  });
});
