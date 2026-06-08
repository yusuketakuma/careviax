import { describe, expect, it, vi } from 'vitest';
import {
  BlockerSeverity,
  CapacityScope,
  CapacityStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import { toDynamoAttributeValue } from './dynamodb-attribute-values';
import { createDynamoCapacityRepository } from './dynamo-capacity-repository';
import { PHOS_CORE_TABLE } from './dynamo-cards-repository';
import type { TenantContext } from './tenant-context';

const ctx: TenantContext = {
  tenant_id: 'tenant_abc123',
  user_id: 'user_manager',
  role: UserRole.MANAGER,
  request_id: 'req_1',
  correlation_id: 'corr_1',
  scopes: ['phos/capacity.read'],
};

describe('createDynamoCapacityRepository', () => {
  it('loads a tenant-scoped capacity snapshot without scanning', async () => {
    const getCapacitySnapshot = vi.fn(async () => ({
      work_buckets: toDynamoAttributeValue([
        {
          bucket_code: 'DISPENSING',
          label: '調剤',
          planned_minutes: 160,
          available_minutes: 180,
          utilization_percent: 89,
        },
      ]),
      staff_loads: toDynamoAttributeValue([
        {
          user_id: 'user_manager',
          display_name: '管理薬剤師',
          role: UserRole.MANAGER,
          planned_minutes: 160,
          available_minutes: 180,
          utilization_percent: 89,
          active_card_count: 9,
        },
      ]),
      bottlenecks: toDynamoAttributeValue([
        {
          bottleneck_code: 'AUDIT_QUEUE',
          label: '監査待ち',
          severity: BlockerSeverity.WARNING,
          affected_count: 3,
        },
      ]),
    }));
    const repo = createDynamoCapacityRepository(
      { getCapacitySnapshot },
      { now: () => new Date('2026-06-09T00:00:00.000Z') },
    );

    const response = await repo.getCapacity(ctx, {
      date: '2026-06-09',
      scope: CapacityScope.PHARMACY,
    });

    expect(getCapacitySnapshot).toHaveBeenCalledWith({
      table_name: PHOS_CORE_TABLE,
      partition_key: 'TENANT#tenant_abc123',
      sort_key: 'CAPACITY#2026-06-09#PHARMACY',
    });
    expect(response).toMatchObject({
      status: CapacityStatus.TIGHT,
      total_planned_minutes: 160,
      total_available_minutes: 180,
      utilization_percent: 89,
      server_time: '2026-06-09T00:00:00.000Z',
    });
  });

  it('returns UNREGISTERED when the capacity snapshot is missing', async () => {
    const repo = createDynamoCapacityRepository(
      { getCapacitySnapshot: vi.fn(async () => null) },
      { now: () => new Date('2026-06-09T00:00:00.000Z') },
    );

    await expect(
      repo.getCapacity(ctx, { date: '2026-06-09', scope: CapacityScope.ME }),
    ).resolves.toMatchObject({
      status: CapacityStatus.UNREGISTERED,
      total_available_minutes: 0,
      work_buckets: [],
      staff_loads: [],
      bottlenecks: [],
    });
  });
});
