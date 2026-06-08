import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapacityScope, CapacityStatus, UserRole } from '@/phos/contracts/phos_contracts';
import type { CapacityResponse } from '@/phos/contracts/phos_contracts';
import type { PhosCapacityRepository } from './capacity-repository';
import { createCapacityLambdaHandler } from './capacity-lambda';
import type { PhosHttpEvent } from './lambda-handler';

function capacityResponse(): CapacityResponse {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    status: CapacityStatus.AVAILABLE,
    total_planned_minutes: 120,
    total_available_minutes: 180,
    utilization_percent: 67,
    work_buckets: [],
    staff_loads: [],
    bottlenecks: [],
    server_time: '2026-06-09T00:00:00.000Z',
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

describe('PH-OS capacity Lambda composition', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('wires GET /capacity through tenant context into the repository', async () => {
    const repo: PhosCapacityRepository = {
      getCapacity: vi.fn(async () => capacityResponse()),
    };
    const handler = createCapacityLambdaHandler({ repository: repo });

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(repo.getCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant_abc123', role: UserRole.MANAGER }),
      { date: '2026-06-09', scope: CapacityScope.PHARMACY },
    );
  });
});
