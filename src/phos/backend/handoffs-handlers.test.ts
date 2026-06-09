import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type {
  HandoffMutationResponse,
  HandoffSearchResponse,
  HandoffView,
} from '@/phos/contracts/phos_contracts';
import { withTenantContext } from './lambda-handler';
import type { PhosHttpEvent } from './lambda-handler';
import type { PhosHandoffsRepository } from './handoffs-repository';
import {
  createCreateHandoffHandler,
  createHandoffSearchHandler,
  createOpenHandoffHandler,
  createResolveHandoffHandler,
  createReturnHandoffHandler,
} from './handoffs-handlers';
import { createInMemoryObservabilitySink } from './observability';

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
    side_effects:
      next.status === HandoffStatus.RESOLVED
        ? [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }]
        : [],
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

describe('PH-OS handoffs Lambda handlers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches handoffs with bounded query params', async () => {
    const repo = repository();
    const handler = withTenantContext(createHandoffSearchHandler(repo));

    const response = await handler(
      event({
        queryStringParameters: {
          status: HandoffStatus.OPEN,
          assignee: 'ME',
          cursor: 'cursor_1',
          limit: '25',
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.searchHandoffs).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', user_id: 'user_001' }),
      { status: HandoffStatus.OPEN, assignee: 'ME', cursor: 'cursor_1', limit: 25 },
    );
  });

  it('rejects invalid handoff status', async () => {
    const handler = withTenantContext(createHandoffSearchHandler(repository()));
    const response = await handler(event({ queryStringParameters: { status: 'DONE' } }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'status' },
    });
  });

  it('rejects malformed handoff search limits before repository access', async () => {
    const repo = repository();
    const handler = withTenantContext(createHandoffSearchHandler(repo));

    const response = await handler(event({ queryStringParameters: { limit: '1.5' } }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'limit' },
    });
    expect(repo.searchHandoffs).not.toHaveBeenCalled();
  });

  it('allows clerks to create handoffs with idempotency and expected version', async () => {
    const repo = repository();
    const handler = withTenantContext(createCreateHandoffHandler(repo));
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
          requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          related_blocker_code: 'MISSING_EVIDENCE',
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.createHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user_clerk' }),
      expect.objectContaining({
        card_id: 'card_1',
        idempotency_key: 'idem_1',
        client_version: 1,
        related_blocker_code: 'MISSING_EVIDENCE',
      }),
    );
  });

  it('rejects invalid handoff source ref captured_at before repository access', async () => {
    const repo = repository();
    const handler = withTenantContext(createCreateHandoffHandler(repo));
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
          source_refs: [
            {
              kind: 'PRESCRIPTION',
              ref_id: 'rx_1',
              label: '処方箋 1',
              captured_at: 'bad-date',
            },
          ],
          urgency: HandoffUrgency.HIGH,
          requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'source_refs.0.captured_at' },
    });
    expect(repo.createHandoff).not.toHaveBeenCalled();
  });

  it('lets pharmacists resolve handoffs and returns side effects', async () => {
    const repo = repository();
    const handler = withTenantContext(createResolveHandoffHandler(repo));
    const response = await handler(
      event({
        routeKey: 'POST /handoffs/{handoff_id}/resolve',
        pathParameters: { handoff_id: 'handoff_1' },
        body: JSON.stringify({
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_resolve',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.resolveHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PHARMACIST' }),
      'handoff_1',
      {
        resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_resolve',
        client_version: 1,
      },
    );
    expect(JSON.parse(response.body)).toMatchObject({
      side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }],
    });
  });

  it('lets pharmacists open handoffs for review', async () => {
    const repo = repository();
    const handler = withTenantContext(createOpenHandoffHandler(repo));
    const response = await handler(
      event({
        routeKey: 'POST /handoffs/{handoff_id}/open',
        pathParameters: { handoff_id: 'handoff_1' },
        body: JSON.stringify({
          idempotency_key: 'idem_open',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.openHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PHARMACIST' }),
      'handoff_1',
      {
        idempotency_key: 'idem_open',
        client_version: 1,
      },
    );
    expect(JSON.parse(response.body)).toMatchObject({
      handoff: { status: HandoffStatus.IN_REVIEW },
    });
  });

  it('requires reason and note when returning handoffs', async () => {
    const repo = repository();
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(createReturnHandoffHandler(repo), { observability });
    const invalid = await handler(
      event({
        routeKey: 'POST /handoffs/{handoff_id}/return',
        pathParameters: { handoff_id: 'handoff_1' },
        body: JSON.stringify({
          return_reason_code: 'NEED_MORE_INFO',
          return_note: '',
          idempotency_key: 'idem_return',
          client_version: 1,
        }),
      }),
    );

    expect(invalid.statusCode).toBe(400);
    expect(repo.returnHandoff).not.toHaveBeenCalled();

    const valid = await handler(
      event({
        routeKey: 'POST /handoffs/{handoff_id}/return',
        pathParameters: { handoff_id: 'handoff_1' },
        body: JSON.stringify({
          return_reason_code: 'NEED_MORE_INFO',
          return_note: '施設連絡先を確認してください。',
          idempotency_key: 'idem_return',
          client_version: 1,
        }),
      }),
    );

    expect(valid.statusCode).toBe(200);
    expect(repo.returnHandoff).toHaveBeenCalledWith(expect.anything(), 'handoff_1', {
      return_reason_code: 'NEED_MORE_INFO',
      return_note: '施設連絡先を確認してください。',
      idempotency_key: 'idem_return',
      client_version: 1,
    });
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'HandoffReturnedCount',
        route_key: 'POST /handoffs/{handoff_id}/return',
        tenant_id: 'tenant_abc123',
      }),
    );
  });
});
