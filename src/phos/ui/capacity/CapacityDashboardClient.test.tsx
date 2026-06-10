// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlockerSeverity,
  CapacityScope,
  CapacityStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CapacityResponse } from '@/phos/contracts/phos_contracts';
import { CapacityDashboardClient } from './CapacityDashboardClient';

const sessionMock = vi.hoisted(() => ({
  value: {
    phosRole: 'MANAGER' as UserRole | undefined,
    cognitoGroups: [] as string[],
  },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: sessionMock.value,
    status: sessionMock.value ? 'authenticated' : 'unauthenticated',
  }),
}));

function capacity(overrides: Partial<CapacityResponse> = {}): CapacityResponse {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    status: CapacityStatus.TIGHT,
    total_planned_minutes: 420,
    total_available_minutes: 480,
    utilization_percent: 88,
    work_buckets: [
      {
        bucket_code: 'VISIT',
        label: '訪問',
        planned_minutes: 180,
        available_minutes: 210,
        utilization_percent: 86,
      },
    ],
    staff_loads: [],
    bottlenecks: [
      {
        bottleneck_code: 'PHARMACIST_REVIEW',
        label: '薬剤師判断待ち',
        severity: BlockerSeverity.WARNING,
        affected_count: 6,
      },
    ],
    server_time: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('CapacityDashboardClient', () => {
  beforeEach(() => {
    sessionMock.value = {
      phosRole: UserRole.MANAGER,
      cognitoGroups: [],
    };
  });

  it('loads capacity for manager-grade sessions through the PH-OS API client', async () => {
    const client = {
      getCapacity: vi.fn(async () => capacity()),
    };

    render(<CapacityDashboardClient client={client} />);

    await waitFor(() =>
      expect(client.getCapacity).toHaveBeenCalledWith({
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        scope: CapacityScope.PHARMACY,
      }),
    );
    expect(screen.getByRole('heading', { name: 'Capacity Dashboard' })).toBeTruthy();
    expect(screen.getByText('薬剤師判断待ち: 6件')).toBeTruthy();
  });

  it('does not fetch capacity for non-manager sessions', async () => {
    sessionMock.value = {
      phosRole: UserRole.PHARMACY_CLERK,
      cognitoGroups: [],
    };
    const client = {
      getCapacity: vi.fn(async () => capacity()),
    };

    render(<CapacityDashboardClient client={client} />);

    expect(screen.getByText('管理薬剤師または管理者のみ確認できます。')).toBeTruthy();
    expect(client.getCapacity).not.toHaveBeenCalled();
  });
});
