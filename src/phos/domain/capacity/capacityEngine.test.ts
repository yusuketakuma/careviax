import { describe, expect, it } from 'vitest';
import {
  BlockerSeverity,
  CapacityScope,
  CapacityStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CapacityEngineInput } from './capacityEngine';
import { resolveCapacity } from './capacityEngine';

function input(overrides: Partial<CapacityEngineInput> = {}): CapacityEngineInput {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    work_buckets: [
      {
        bucket_code: 'DISPENSING',
        label: '調剤',
        planned_minutes: 120,
        available_minutes: 180,
        utilization_percent: 67,
      },
    ],
    staff_loads: [
      {
        user_id: 'user_1',
        display_name: '管理薬剤師',
        role: UserRole.MANAGER,
        planned_minutes: 120,
        available_minutes: 180,
        utilization_percent: 67,
        active_card_count: 8,
      },
    ],
    bottlenecks: [],
    server_time: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveCapacity', () => {
  it('calculates totals and AVAILABLE status from staff WIP', () => {
    expect(resolveCapacity(input())).toMatchObject({
      total_planned_minutes: 120,
      total_available_minutes: 180,
      utilization_percent: 67,
      status: CapacityStatus.AVAILABLE,
    });
  });

  it('marks capacity as TIGHT when utilization reaches the warning threshold', () => {
    expect(
      resolveCapacity(
        input({
          staff_loads: [
            {
              user_id: 'user_1',
              display_name: '管理薬剤師',
              role: UserRole.MANAGER,
              planned_minutes: 170,
              available_minutes: 200,
              utilization_percent: 85,
              active_card_count: 11,
            },
          ],
        }),
      ).status,
    ).toBe(CapacityStatus.TIGHT);
  });

  it('marks capacity as OVER_CAPACITY for overplanned work or critical bottlenecks', () => {
    expect(
      resolveCapacity(
        input({
          staff_loads: [
            {
              user_id: 'user_1',
              display_name: '管理薬剤師',
              role: UserRole.MANAGER,
              planned_minutes: 210,
              available_minutes: 200,
              utilization_percent: 105,
              active_card_count: 14,
            },
          ],
        }),
      ).status,
    ).toBe(CapacityStatus.OVER_CAPACITY);

    expect(
      resolveCapacity(
        input({
          bottlenecks: [
            {
              bottleneck_code: 'AUDIT_QUEUE',
              label: '監査待ち',
              severity: BlockerSeverity.CRITICAL,
              affected_count: 7,
              over_minutes: 45,
            },
          ],
        }),
      ).status,
    ).toBe(CapacityStatus.OVER_CAPACITY);
  });

  it('marks capacity as UNREGISTERED when available minutes are missing', () => {
    expect(
      resolveCapacity(
        input({
          work_buckets: [],
          staff_loads: [],
        }),
      ),
    ).toMatchObject({
      total_planned_minutes: 0,
      total_available_minutes: 0,
      status: CapacityStatus.UNREGISTERED,
    });
  });
});
