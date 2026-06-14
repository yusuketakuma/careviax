// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  SET_AUDIT_CHECKLIST_ITEMS,
  SET_AUDIT_PHOTO_SLOTS,
} from './set-audit-content.helpers';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useRealtimeQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@/lib/hooks/use-realtime-query', () => ({
  useRealtimeQuery: useRealtimeQueryMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

import { SetAuditContent } from './set-audit-content';

setupDomTestEnv();

const PLAN_DETAIL = {
  id: 'plan_1',
  set_method: 'four_times_daily',
  target_period_start: '2026-04-01',
  target_period_end: '2026-04-07',
  notes: '残薬の整理を優先\n冷所品は別包',
  packaging_method_ref: { name: '一包化' },
  audits: [],
};

const allCheckedChecklist = Object.fromEntries(
  SET_AUDIT_CHECKLIST_ITEMS.map((item) => [item.key, true]),
);

const allUncheckedChecklist = Object.fromEntries(
  SET_AUDIT_CHECKLIST_ITEMS.map((item) => [item.key, false]),
);

describe('SetAuditContent', () => {
  const mutateSpy = vi.fn();
  const invalidateQueriesSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRealtimeQueryMock.mockReturnValue({
      data: PLAN_DETAIL,
      isLoading: false,
      isError: false,
    });
    useQueryClientMock.mockReturnValue({
      invalidateQueries: invalidateQueriesSpy,
    });
    useMutationMock.mockReturnValue({
      mutate: mutateSpy,
      isPending: false,
    });
  });

  it('queries the set plan by id via the realtime query', () => {
    render(<SetAuditContent planId="plan_1" />);

    expect(useRealtimeQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['set-plan-audit', 'plan_1'],
      }),
    );
  });

  it('renders the セット指示 lines derived from the plan', () => {
    render(<SetAuditContent planId="plan_1" />);

    expect(screen.getByText('セット指示')).toBeTruthy();
    // set_method four_times_daily → 4回／日 label
    expect(screen.getByText(/セット方法：4回／日/)).toBeTruthy();
    expect(screen.getByText(/配薬方法：一包化/)).toBeTruthy();
    expect(screen.getByText(/期間：4\/1〜4\/7/)).toBeTruthy();
    expect(screen.getByText(/残薬の整理を優先/)).toBeTruthy();
    expect(screen.getByText(/冷所品は別包/)).toBeTruthy();
  });

  it('renders the three photo confirmation slots', () => {
    render(<SetAuditContent planId="plan_1" />);

    expect(screen.getByText('写真・実物確認')).toBeTruthy();
    for (const slot of SET_AUDIT_PHOTO_SLOTS) {
      expect(screen.getByText(slot.label)).toBeTruthy();
    }
  });

  it('renders all six audit checklist items', () => {
    render(<SetAuditContent planId="plan_1" />);

    expect(screen.getByText('監査チェック')).toBeTruthy();
    for (const item of SET_AUDIT_CHECKLIST_ITEMS) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }
    expect(screen.getAllByRole('checkbox')).toHaveLength(
      SET_AUDIT_CHECKLIST_ITEMS.length,
    );
  });

  it('blocks 監査OK until every checklist item is checked', () => {
    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: /監査OK/ }));

    expect(mutateSpy).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      '監査OKには全6項目のチェックが必要です',
    );
  });

  it('does not enable 監査OK with a partially completed checklist', () => {
    render(<SetAuditContent planId="plan_1" />);

    const checkboxes = screen.getAllByRole('checkbox');
    // check all but the last
    for (const checkbox of checkboxes.slice(0, -1)) {
      fireEvent.click(checkbox);
    }

    fireEvent.click(screen.getByRole('button', { name: /監査OK/ }));

    expect(mutateSpy).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      '監査OKには全6項目のチェックが必要です',
    );
  });

  it('posts result=approved with the full checklist once all items are checked', () => {
    render(<SetAuditContent planId="plan_1" />);

    for (const checkbox of screen.getAllByRole('checkbox')) {
      fireEvent.click(checkbox);
    }

    fireEvent.click(screen.getByRole('button', { name: /監査OK/ }));

    expect(mutateSpy).toHaveBeenCalledWith(
      {
        result: 'approved',
        checklist: allCheckedChecklist,
        photo_asset_ids: [],
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('opens the reason dialog when 差し戻す is clicked', () => {
    render(<SetAuditContent planId="plan_1" />);

    // dialog is closed initially
    expect(screen.queryByTestId('reason-dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /差し戻す/ }));

    expect(screen.getByTestId('reason-dialog')).toBeTruthy();
    expect(screen.getByText('差し戻し理由を入力')).toBeTruthy();
    expect(screen.getAllByTestId('reason-option').length).toBeGreaterThan(0);
  });

  it('posts result=rejected with the selected reason from the dialog', () => {
    render(<SetAuditContent planId="plan_1" />);

    fireEvent.click(screen.getByRole('button', { name: /差し戻す/ }));

    // pick a reason chip, then confirm
    fireEvent.click(screen.getByRole('button', { name: '薬剤不一致' }));
    fireEvent.click(screen.getByRole('button', { name: '保存する' }));

    expect(mutateSpy).toHaveBeenCalledWith(
      {
        result: 'rejected',
        reject_reason: '薬剤不一致',
        checklist: allUncheckedChecklist,
        photo_asset_ids: [],
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it('shows a loading state while the plan query is pending', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    render(<SetAuditContent planId="plan_1" />);

    expect(screen.getByText('読み込み中...')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /監査OK/ })).toBeNull();
  });

  it('shows an error state when the plan query fails', () => {
    useRealtimeQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<SetAuditContent planId="plan_1" />);

    expect(
      screen.getByText(
        'セットプランの取得に失敗しました。ページを再読み込みしてください。',
      ),
    ).toBeTruthy();
  });
});
