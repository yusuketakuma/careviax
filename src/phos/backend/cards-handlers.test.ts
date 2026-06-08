import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  ButtonState,
  CardType,
  CurrentStep,
  DisplayStatus,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  CardSearchResponse,
  CardSummaryView,
  NextActionView,
} from '@/phos/contracts/phos_contracts';
import { withTenantContext } from './lambda-handler';
import {
  createCardDetailHandler,
  createCardSearchHandler,
  createExecuteCardActionHandler,
} from './cards-handlers';
import { PhosDomainError } from './cards-repository';
import type { PhosCardsRepository } from './cards-repository';
import type { PhosHttpEvent } from './lambda-handler';
import { createInMemoryObservabilitySink, hashTenantId } from './observability';

const cardHandlerFixtures = {
  actionableNextAction: {
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
  },
  readyCard: {
    card_id: 'card_1',
    card_type: CardType.PRESCRIPTION,
    patient_name: 'Test Patient',
    current_step: CurrentStep.DIFF_REVIEW,
    display_status: DisplayStatus.READY,
    server_version: 1,
    tags: [],
  },
} satisfies {
  actionableNextAction: NextActionView;
  readyCard: CardSummaryView;
};

function event(overrides: Partial<PhosHttpEvent> = {}): PhosHttpEvent {
  return {
    routeKey: 'GET /cards',
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_001',
            role: 'PHARMACIST',
            scope: 'phos/cards.read phos/cards.write',
          },
        },
      },
    },
    ...overrides,
  };
}

function repository(overrides: Partial<PhosCardsRepository> = {}): PhosCardsRepository {
  return {
    searchCards: vi.fn(async () => ({
      items: [
        {
          card: cardHandlerFixtures.readyCard,
          next_action: cardHandlerFixtures.actionableNextAction,
        },
      ],
      server_time: '2026-06-08T00:00:00.000Z',
    })) as PhosCardsRepository['searchCards'],
    getCardDetail: vi.fn(async () => ({
      card: cardHandlerFixtures.readyCard,
      visible_tabs: ['OVERVIEW'],
      permissions: {
        can_read: true,
        can_write: true,
        allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
      },
      next_action: cardHandlerFixtures.actionableNextAction,
      blockers: [],
      source_refs: [],
      server_version: 1,
    })) as PhosCardsRepository['getCardDetail'],
    executeCardAction: vi.fn(async () => ({
      card: { ...cardHandlerFixtures.readyCard, display_status: DisplayStatus.IN_PROGRESS },
      next_action: cardHandlerFixtures.actionableNextAction,
      display_status: DisplayStatus.IN_PROGRESS,
      blockers: [],
      side_effects: [],
      server_version: 2,
    })) as PhosCardsRepository['executeCardAction'],
    ...overrides,
  };
}

describe('PH-OS cards Lambda handlers', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('searches cards with tenant context and bounded query params', async () => {
    const repo = repository();
    const handler = withTenantContext(createCardSearchHandler(repo));

    const response = await handler(
      event({
        queryStringParameters: {
          query: 'card',
          filter: 'READY',
          sort: 'visit_time',
          cursor: 'cursor_1',
          limit: '25',
        },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.searchCards).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', user_id: 'user_001' }),
      {
        query: 'card',
        filter: 'READY',
        sort: 'visit_time',
        cursor: 'cursor_1',
        limit: 25,
      },
    );
    expect(JSON.parse(response.body)).toEqual({
      items: [
        {
          card: cardHandlerFixtures.readyCard,
          next_action: cardHandlerFixtures.actionableNextAction,
        },
      ],
      server_time: '2026-06-08T00:00:00.000Z',
    } satisfies CardSearchResponse);
  });

  it('rejects invalid card search limit with canonical ErrorResponse', async () => {
    const handler = withTenantContext(createCardSearchHandler(repository()));
    const response = await handler(event({ queryStringParameters: { limit: '99' } }));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: { field: 'limit', max: 50 },
    });
  });

  it('returns card detail or NOT_FOUND without leaking another tenant', async () => {
    const repo = repository({
      getCardDetail: vi.fn(async () => null),
    });
    const handler = withTenantContext(createCardDetailHandler(repo));

    const response = await handler(
      event({ routeKey: 'GET /cards/{card_id}', pathParameters: { card_id: 'missing' } }),
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'NOT_FOUND',
      message_key: 'api.error.card_not_found',
      details: { card_id: 'missing' },
    });
  });

  it('returns card detail for an existing card', async () => {
    const handler = withTenantContext(createCardDetailHandler(repository()));
    const response = await handler(
      event({ routeKey: 'GET /cards/{card_id}', pathParameters: { card_id: 'card_1' } }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      card: { card_id: 'card_1' },
      visible_tabs: ['OVERVIEW'],
    });
  });

  it('executes card actions with idempotency and client version', async () => {
    const repo = repository();
    const observability = createInMemoryObservabilitySink();
    const handler = withTenantContext(createExecuteCardActionHandler(repo), { observability });

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        body: JSON.stringify({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.executeCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123' }),
      'card_1',
      {
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        idempotency_key: 'idem_1',
        client_version: 1,
      },
    );
    expect(JSON.parse(response.body)).toMatchObject({
      display_status: DisplayStatus.IN_PROGRESS,
      server_version: 2,
    } satisfies Partial<ActionResponse>);
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'ActionLatencyMs',
        route_key: 'POST /cards/{card_id}/actions',
        tenant_id: 'tenant_abc123',
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
      }),
    );
    expect(observability.annotations).toContainEqual(
      expect.objectContaining({
        route_key: 'POST /cards/{card_id}/actions',
        tenant_id_hash: hashTenantId('tenant_abc123'),
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        current_step: CurrentStep.DIFF_REVIEW,
      }),
    );
  });

  it('rejects card actions when write scope is missing', async () => {
    const repo = repository();
    const handler = withTenantContext(createExecuteCardActionHandler(repo));

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        requestContext: {
          requestId: 'req_1',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_001',
                role: 'PHARMACIST',
                scope: 'phos/cards.read',
              },
            },
          },
        },
        body: JSON.stringify({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_1',
          client_version: 1,
        }),
      }),
    );

    expect(repo.executeCardAction).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'FORBIDDEN',
      message_key: 'api.error.forbidden',
      details: { missing_scopes: ['phos/cards.write'] },
    });
  });

  it('does not block matrix-permitted clerk actions at the coarse endpoint role gate', async () => {
    const repo = repository();
    const handler = withTenantContext(createExecuteCardActionHandler(repo));

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        requestContext: {
          requestId: 'req_1',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_001',
                role: 'PHARMACY_CLERK',
                scope: 'phos/cards.write',
              },
            },
          },
        },
        body: JSON.stringify({
          action_code: ActionCode.REGISTER_PRESCRIPTION,
          idempotency_key: 'idem_clerk_1',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(repo.executeCardAction).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PHARMACY_CLERK' }),
      'card_1',
      {
        action_code: ActionCode.REGISTER_PRESCRIPTION,
        idempotency_key: 'idem_clerk_1',
        client_version: 1,
      },
    );
  });

  it('requires reason_code for reason-required actions', async () => {
    const repo = repository();
    const handler = withTenantContext(createExecuteCardActionHandler(repo));

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        body: JSON.stringify({
          action_code: ActionCode.REJECT_SET_AUDIT,
          idempotency_key: 'idem_2',
          client_version: 1,
        }),
      }),
    );

    expect(repo.executeCardAction).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: {
        field: 'reason_code',
        action_code: ActionCode.REJECT_SET_AUDIT,
        reason_required: true,
      },
    });
  });

  it('maps repository stale version errors to 409 ErrorResponse', async () => {
    const observability = createInMemoryObservabilitySink();
    const repo = repository({
      executeCardAction: vi.fn(async () => {
        throw new PhosDomainError({
          status: 409,
          error_code: 'STALE_VERSION',
          message_key: 'api.error.stale_version',
          details: { server_version: 2 },
        });
      }),
    });
    const handler = withTenantContext(createExecuteCardActionHandler(repo), { observability });

    const response = await handler(
      event({
        routeKey: 'POST /cards/{card_id}/actions',
        pathParameters: { card_id: 'card_1' },
        body: JSON.stringify({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          idempotency_key: 'idem_3',
          client_version: 1,
        }),
      }),
    );

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'STALE_VERSION',
      message_key: 'api.error.stale_version',
      details: { server_version: 2 },
    });
    expect(observability.metrics).toContainEqual(
      expect.objectContaining({
        name: 'ActionLatencyMs',
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        error_code: 'STALE_VERSION',
      }),
    );
    expect(observability.annotations).toContainEqual(
      expect.objectContaining({
        route_key: 'POST /cards/{card_id}/actions',
        tenant_id_hash: hashTenantId('tenant_abc123'),
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        error_code: 'STALE_VERSION',
      }),
    );
  });
});
