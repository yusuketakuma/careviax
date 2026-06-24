// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PrescriptionsTable, type PrescriptionIntakeRow } from './prescriptions-table';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

setupDomTestEnv();

function buildRow(overrides: Partial<PrescriptionIntakeRow> = {}): PrescriptionIntakeRow {
  return {
    id: 'intake_1',
    cycle_id: 'cycle_1',
    source_type: 'paper',
    prescribed_date: '2026-04-20T00:00:00.000Z',
    prescriber_name: '佐藤医師',
    prescriber_institution: '佐藤医院',
    prescription_expiry_date: null,
    refill_remaining_count: null,
    refill_next_dispense_date: null,
    created_at: '2026-04-20T09:00:00.000Z',
    cycle: {
      overall_status: 'intake_received',
      patient_id: 'patient_1',
      case_: {
        patient: {
          id: 'patient_1',
          name: '山田太郎',
          name_kana: 'ヤマダタロウ',
        },
      },
    },
    ...overrides,
  };
}

describe('PrescriptionsTable', () => {
  it('shows retryable ErrorState instead of the empty prescription state when loading failed', () => {
    const handleRetry = vi.fn();

    render(
      <PrescriptionsTable
        items={[]}
        isLoading={false}
        isError
        errorMessage="処方受付一覧の取得に失敗しました"
        onRetry={handleRetry}
        selectedId={null}
        onRowClick={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: '処方受付一覧を表示できません' })).toBeTruthy();
    expect(screen.getByText('処方受付一覧の取得に失敗しました')).toBeTruthy();
    expect(screen.queryByText('該当する処方受付がありません')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    expect(handleRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the actionable empty state for a successful zero-result response', () => {
    render(
      <PrescriptionsTable items={[]} isLoading={false} selectedId={null} onRowClick={vi.fn()} />,
    );

    expect(screen.getByRole('status').textContent).toContain('該当する処方受付がありません');
    expect(screen.queryByRole('heading', { name: '処方受付一覧を表示できません' })).toBeNull();
  });

  it('renders loaded prescription rows when data is available even if a background refetch failed', () => {
    render(
      <PrescriptionsTable
        items={[buildRow()]}
        isLoading={false}
        isError
        errorMessage="再取得に失敗しました"
        selectedId="intake_1"
        onRowClick={vi.fn()}
      />,
    );

    expect(screen.getByRole('listbox', { name: '処方受付一覧' })).toBeTruthy();
    expect(screen.getByText('山田太郎')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '処方受付一覧を表示できません' })).toBeNull();
  });
});
