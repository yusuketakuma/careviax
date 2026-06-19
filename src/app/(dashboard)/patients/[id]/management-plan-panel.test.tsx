// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ManagementPlanPanel } from './management-plan-panel';
import { toast } from 'sonner';

setupDomTestEnv();

describe('ManagementPlanPanel', () => {
  it('renders the no-case state with a semantic section heading', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel patientId="patient_1" patientName="山田花子" cases={[]} orgId="org_1" />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '管理計画書' }).tagName).toBe('H2');
    expect(screen.getByText('ケースがありません')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain(
      'ケース作成後に管理計画書を登録できます',
    );
  });

  it('exposes the management-plan case selector by label', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            primary_pharmacist_id: 'pharmacist_1',
            referral_source: '居宅介護支援事業所',
            start_date: '2026-06-02',
            end_date: null,
          },
        ]}
      />,
    );

    expect(screen.getByLabelText('管理計画書のケース')).toBeTruthy();
  });

  it('keeps management-plan editor validation visible inline', () => {
    const mutateMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            primary_pharmacist_id: 'pharmacist_1',
            referral_source: '居宅介護支援事業所',
            start_date: '2026-06-02',
            end_date: null,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新規計画書' }));
    const title = screen.getByLabelText('タイトル');
    const content = screen.getByLabelText('本文(JSON)');

    fireEvent.change(title, { target: { value: '' } });
    fireEvent.change(content, { target: { value: '{invalid' } });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(screen.getByText('タイトルを入力してください').getAttribute('role')).toBe('alert');
    expect(screen.getByText('本文は JSON 形式で入力してください').getAttribute('role')).toBe(
      'alert',
    );
    expect(title.getAttribute('aria-invalid')).toBe('true');
    expect(title.getAttribute('aria-describedby')).toBe('management-plan-title-error');
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(content.getAttribute('aria-describedby')).toBe('management-plan-content-error');
    expect(toast.error).toHaveBeenCalledWith('タイトルを入力してください');
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it('submits valid management-plan editor values through the existing mutation path', () => {
    const mutateMock = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] }, isLoading: false, error: null });
    useMutationMock.mockReturnValue({ mutate: mutateMock, isPending: false });

    render(
      <ManagementPlanPanel
        patientId="patient_1"
        patientName="山田花子"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            primary_pharmacist_id: 'pharmacist_1',
            referral_source: '居宅介護支援事業所',
            start_date: '2026-06-02',
            end_date: null,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '新規計画書' }));
    fireEvent.change(screen.getByLabelText('タイトル'), {
      target: { value: '訪問薬剤管理指導計画書 更新版' },
    });
    fireEvent.change(screen.getByLabelText('本文(JSON)'), {
      target: { value: '{"visit_policy":"週1回訪問"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    expect(mutateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '訪問薬剤管理指導計画書 更新版',
        contentText: '{"visit_policy":"週1回訪問"}',
      }),
    );
  });
});
