import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlockerSeverity,
  CapacityScope,
  CapacityStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CapacityResponse } from '@/phos/contracts/phos_contracts';
import { withTenantContext } from './lambda-handler';
import type { PhosHttpEvent } from './lambda-handler';
import { createCapacityHandler } from './capacity-handlers';
import type { PhosCapacityRepository } from './capacity-repository';

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
    staff_loads: [
      {
        user_id: 'user_manager',
        display_name: '管理薬剤師',
        role: UserRole.MANAGER,
        planned_minutes: 240,
        available_minutes: 260,
        utilization_percent: 92,
        active_card_count: 12,
      },
    ],
    bottlenecks: [
      {
        bottleneck_code: 'AUDIT_QUEUE',
        label: '監査待ち',
        severity: BlockerSeverity.WARNING,
        affected_count: 4,
      },
    ],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function repository(overrides: Partial<PhosCapacityRepository> = {}): PhosCapacityRepository {
  return {
    getCapacity: vi.fn(async () => capacityResponse()),
    ...overrides,
  };
}

function event(overrides: Partial<PhosHttpEvent> = {}): PhosHttpEvent {
  return {
    routeKey: 'GET /capacity',
    queryStringParameters: { date: '2026-06-09', scope: CapacityScope.PHARMACY },
    requestContext: {
      requestId: 'req_1',
      authorizer: {
        jwt: {
          claims: {
            token_use: 'access',
            tenant_id: 'tenant_abc123',
            sub: 'user_manager',
            role: 'MANAGER',
            scope: 'phos/capacity.read',
          },
        },
      },
    },
    ...overrides,
  };
}

describe('PH-OS capacity Lambda handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads capacity for managers with validated date and scope', async () => {
    const repo = repository();
    const handler = withTenantContext(createCapacityHandler(repo));

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(repo.getCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', role: UserRole.MANAGER }),
      { date: '2026-06-09', scope: CapacityScope.PHARMACY },
    );
    expect(JSON.parse(response.body)).toEqual(capacityResponse());
  });

  it('rejects invalid calendar dates before repository access', async () => {
    const repo = repository();
    const handler = withTenantContext(createCapacityHandler(repo));

    const response = await handler(event({ queryStringParameters: { date: '2026-02-30' } }));

    expect(response.statusCode).toBe(400);
    expect(repo.getCapacity).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toEqual({
      request_id: 'req_1',
      error_code: 'VALIDATION_ERROR',
      message_key: 'api.error.validation.generic',
      details: { field: 'date', expected: 'YYYY-MM-DD' },
    });
  });

  it('rejects invalid scope values', async () => {
    const handler = withTenantContext(createCapacityHandler(repository()));

    const response = await handler(
      event({ queryStringParameters: { date: '2026-06-09', scope: 'TENANT' } }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      details: { field: 'scope', allowed_values: ['PHARMACY', 'ME'] },
    });
  });

  it('allows admins but rejects non-manager roles', async () => {
    const adminRepo = repository();
    const adminHandler = withTenantContext(createCapacityHandler(adminRepo));
    await expect(
      adminHandler(
        event({
          requestContext: {
            requestId: 'req_1',
            authorizer: {
              jwt: {
                claims: {
                  token_use: 'access',
                  tenant_id: 'tenant_abc123',
                  sub: 'user_admin',
                  role: 'ADMIN',
                  scope: 'phos/capacity.read',
                },
              },
            },
          },
        }),
      ),
    ).resolves.toMatchObject({ statusCode: 200 });

    const clerkRepo = repository();
    const clerkHandler = withTenantContext(createCapacityHandler(clerkRepo));
    const clerkResponse = await clerkHandler(
      event({
        requestContext: {
          requestId: 'req_2',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_clerk',
                role: 'PHARMACY_CLERK',
                scope: 'phos/capacity.read',
              },
            },
          },
        },
      }),
    );

    expect(clerkResponse.statusCode).toBe(403);
    expect(clerkRepo.getCapacity).not.toHaveBeenCalled();
  });

  it('rejects requests missing the capacity read scope', async () => {
    const repo = repository();
    const handler = withTenantContext(createCapacityHandler(repo));

    const response = await handler(
      event({
        requestContext: {
          requestId: 'req_3',
          authorizer: {
            jwt: {
              claims: {
                token_use: 'access',
                tenant_id: 'tenant_abc123',
                sub: 'user_manager',
                role: 'MANAGER',
                scope: 'phos/cards.read',
              },
            },
          },
        },
      }),
    );

    expect(response.statusCode).toBe(403);
    expect(repo.getCapacity).not.toHaveBeenCalled();
    expect(JSON.parse(response.body)).toMatchObject({
      request_id: 'req_3',
      error_code: 'FORBIDDEN',
      details: { missing_scopes: ['phos/capacity.read'] },
    });
  });
});
