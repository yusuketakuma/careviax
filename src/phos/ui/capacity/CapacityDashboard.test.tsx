// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BlockerSeverity,
  CapacityScope,
  CapacityStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { CapacityResponse } from '@/phos/contracts/phos_contracts';
import { CapacityDashboard } from './CapacityDashboard';

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
      {
        bucket_code: 'REPORT',
        label: '報告',
        planned_minutes: 90,
        available_minutes: 120,
        utilization_percent: 75,
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
        bottleneck_code: 'PHARMACIST_REVIEW',
        label: '薬剤師判断待ち',
        severity: BlockerSeverity.WARNING,
        affected_count: 6,
        over_minutes: 40,
      },
    ],
    server_time: '2026-06-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('CapacityDashboard', () => {
  it('renders manager capacity summary, Recharts charts, and table fallback', () => {
    render(<CapacityDashboard canView capacity={capacity()} />);

    expect(screen.getByRole('heading', { name: 'Capacity Dashboard' })).toBeTruthy();
    expect(screen.getByText('本日の残作業分数')).toBeTruthy();
    expect(screen.getByText('薬剤師判断待ち: 6件 / 40分超過')).toBeTruthy();
    expect(screen.getByText('planned 420 / available 480')).toBeTruthy();
    expect(screen.getByText('工程別作業分数')).toBeTruthy();
    expect(screen.getByText('ボトルネック')).toBeTruthy();
    expect(screen.getByRole('table').textContent).toContain('管理薬剤師 / 管理薬剤師');
    expect(screen.getByRole('table').textContent).toContain('訪問');
  });

  it('keeps capacity dashboard behind the manager-grade role gate', () => {
    render(<CapacityDashboard canView={false} capacity={capacity()} />);

    expect(screen.getByText('管理薬剤師または管理者のみ確認できます。')).toBeTruthy();
    expect(screen.queryByText('工程別作業分数')).toBeNull();
  });

  it('renders a deterministic empty state when capacity data is unavailable', () => {
    render(<CapacityDashboard canView capacity={undefined} />);

    expect(screen.getByText('キャパシティ情報を読み込めません。')).toBeTruthy();
  });
});
