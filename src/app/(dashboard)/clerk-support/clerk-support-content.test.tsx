// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { ClerkSupportResponse } from '@/types/clerk-support';

setupDomTestEnv();

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

import { ClerkSupportContent } from './clerk-support-content';

function buildFixture(): ClerkSupportResponse {
  return {
    generated_at: '2026-06-12T09:00:00.000Z',
    kpis: {
      intake_pending: 12,
      delivery_target_missing: 8,
      schedule_confirmation: 6,
      document_drafts: 11,
      reply_pending: 7,
      pharmacist_review: 5,
    },
    tasks: [
      {
        id: 'intake-1',
        kind_label: '処方受付',
        patient_name: '田中 一郎',
        next_action: '取込内容を確認して入力へ送る',
        due_label: null,
        href: '/prescriptions/intake',
      },
      {
        id: 'proposal-1',
        kind_label: '日程確認',
        patient_name: '鈴木 修',
        next_action: '候補日時を電話で確認',
        due_label: '2026-06-13',
        href: '/schedules/proposals?detail=proposal-1',
      },
    ],
    consult_items: ['処方内容の判断', '薬の変更理由', '服薬指導の内容', '算定できるかの判断'],
  };
}

describe('ClerkSupportContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useQueryMock.mockReturnValue({
      data: buildFixture(),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the heading, six KPI tiles, tasks, and consult boundary list', () => {
    render(<ClerkSupportContent />);

    expect(screen.getByRole('heading', { name: '事務でできること' })).toBeTruthy();
    expect(screen.getByText('薬剤師の判断が必要なものは、迷わず相談へ回します。')).toBeTruthy();

    const grid = screen.getByTestId('clerk-kpi-grid');
    for (const label of [
      '処方受付',
      '送付先未設定',
      '日程確認',
      '文書記録',
      '返信待ち',
      '薬剤師確認',
    ]) {
      expect(within(grid).getByText(label)).toBeTruthy();
    }
    expect(within(grid).getByText('12')).toBeTruthy();
    expect(within(grid).getByText('8')).toBeTruthy();

    const table = screen.getByTestId('clerk-task-table');
    expect(within(table).getByText('田中 一郎')).toBeTruthy();
    expect(within(table).getByRole('link', { name: '候補日時を電話で確認' })).toBeTruthy();
    expect(within(table).getByText('2026-06-13')).toBeTruthy();

    const consult = screen.getByTestId('clerk-consult-card');
    expect(within(consult).getByText('薬剤師に相談が必要')).toBeTruthy();
    expect(within(consult).getByText(/算定できるかの判断/)).toBeTruthy();
  });

  it('shows the empty-task message when no clerk work is pending', () => {
    useQueryMock.mockReturnValue({
      data: { ...buildFixture(), tasks: [] },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ClerkSupportContent />);
    expect(screen.getByText('いま事務側で止まっている作業はありません。')).toBeTruthy();
  });
});
