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
import { CapacityBar } from './CapacityBar';

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
    ...overrides,
  };
}

describe('CapacityBar', () => {
  it('renders capacity status, utilization, bottlenecks, and table fallback', () => {
    render(<CapacityBar capacity={capacity()} />);

    expect(screen.getByRole('heading', { name: 'Capacity' })).toBeTruthy();
    expect(screen.getByText('逼迫')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Capacity utilization 88%/ })).toBeTruthy();
    expect(screen.getByLabelText('Bottlenecks').textContent).toContain('監査待ち: 4件');
    expect(screen.getByText('工程・スタッフ別の内訳')).toBeTruthy();
    expect(screen.getByText('調剤')).toBeTruthy();
    expect(screen.getByText(/管理薬剤師/)).toBeTruthy();
  });

  it('shows the unregistered empty state when availability is missing', () => {
    render(
      <CapacityBar
        capacity={capacity({
          status: CapacityStatus.UNREGISTERED,
          total_planned_minutes: 0,
          total_available_minutes: 0,
          utilization_percent: 0,
          work_buckets: [],
          staff_loads: [],
          bottlenecks: [],
        })}
      />,
    );

    expect(screen.getByText('未登録')).toBeTruthy();
    expect(screen.getByText('スタッフ可処分時間が未登録です。')).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('renders loading and error states without requiring capacity data', () => {
    const { rerender } = render(<CapacityBar phase="LOADING" />);
    expect(screen.getByLabelText('Capacity loading').textContent).toContain('可処分時間を確認中');

    rerender(<CapacityBar phase="ERROR" errorMessage="capacity failed" />);
    expect(screen.getByLabelText('Capacity error').textContent).toContain('capacity failed');
  });
});
