// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
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

function buildNamedRow({
  id,
  patientName,
  patientKana,
  prescribedDate = '2026-04-21T00:00:00.000Z',
  prescriberName = '鈴木医師',
  sourceType = 'refill',
  refillRemainingCount = 2,
}: {
  id: string;
  patientName: string;
  patientKana: string;
  prescribedDate?: string;
  prescriberName?: string;
  sourceType?: string;
  refillRemainingCount?: number | null;
}): PrescriptionIntakeRow {
  return buildRow({
    id,
    source_type: sourceType,
    prescribed_date: prescribedDate,
    prescriber_name: prescriberName,
    refill_remaining_count: refillRemainingCount,
    cycle: {
      overall_status: 'ready_to_dispense',
      patient_id: `patient_${id}`,
      case_: {
        patient: {
          id: `patient_${id}`,
          name: patientName,
          name_kana: patientKana,
        },
      },
    },
  });
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
    expect(screen.queryAllByRole('option')).toHaveLength(0);
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

    expect(screen.getAllByRole('listbox', { name: '処方受付一覧' }).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getAllByRole('option', { name: '山田太郎' }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('山田太郎').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('ヤマダタロウ').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('佐藤医師').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('04/20').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('heading', { name: '処方受付一覧を表示できません' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'CSV出力' })).toBeNull();
    expect(screen.queryByRole('button', { name: '印刷' })).toBeNull();
  });

  it('preserves selected option semantics and source-index row activation', () => {
    const handleRowClick = vi.fn();
    const rows = [
      buildRow(),
      buildNamedRow({
        id: 'intake_2',
        patientName: '鈴木花子',
        patientKana: 'スズキハナコ',
      }),
    ];

    render(
      <PrescriptionsTable
        items={rows}
        isLoading={false}
        selectedId="intake_2"
        onRowClick={handleRowClick}
      />,
    );

    const selectedOptions = screen.getAllByRole('option', { name: '鈴木花子' });
    const unselectedOptions = screen.getAllByRole('option', { name: '山田太郎' });
    expect(selectedOptions.length).toBeGreaterThanOrEqual(2);
    expect(unselectedOptions.length).toBeGreaterThanOrEqual(2);
    for (const option of selectedOptions) {
      expect(option.getAttribute('aria-selected')).toBe('true');
      expect(option.getAttribute('tabindex')).toBe('0');
    }
    for (const option of unselectedOptions) {
      expect(option.getAttribute('aria-selected')).toBe('false');
      expect(option.getAttribute('tabindex')).toBe('-1');
    }

    const desktopSelectedOption = within(screen.getByRole('table')).getByRole('option', {
      name: '鈴木花子',
    });
    fireEvent.click(desktopSelectedOption);
    expect(handleRowClick).toHaveBeenCalledWith(1);

    handleRowClick.mockClear();
    fireEvent.keyDown(desktopSelectedOption, { key: 'Enter', code: 'Enter' });
    expect(handleRowClick).toHaveBeenCalledWith(1);

    handleRowClick.mockClear();
    fireEvent.keyDown(desktopSelectedOption, { key: ' ', code: 'Space' });
    expect(handleRowClick).toHaveBeenCalledWith(1);
  });
});
