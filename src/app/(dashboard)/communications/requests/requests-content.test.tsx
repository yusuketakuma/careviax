// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const useRouterMock = vi.hoisted(() => vi.fn());
const usePathnameMock = vi.hoisted(() => vi.fn());
const useSearchParamsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));

import { CommunicationRequestsContent } from './requests-content';

setupDomTestEnv();

describe('CommunicationRequestsContent', () => {
  const statusMutateMock = vi.fn();
  const responseMutateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useRouterMock.mockReturnValue({ replace: vi.fn() });
    usePathnameMock.mockReturnValue('/communications/requests');
    useSearchParamsMock.mockReturnValue(new URLSearchParams('context=dashboard_home'));
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock
      .mockReturnValueOnce({
        mutate: statusMutateMock,
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: responseMutateMock,
        isPending: false,
      });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('shows the home context banner for sent communications focus', () => {
    render(<CommunicationRequestsContent initialStatus="sent" initialContext="dashboard_home" />);

    expect(screen.getByTestId('communications-context-banner')).toBeTruthy();
    expect(
      screen.getByText('ホームから返信待ちの依頼・照会にフォーカスして開いています。'),
    ).toBeTruthy();
  });

  it('requires a reason before mutating direct status transitions', () => {
    useMutationMock.mockReset();
    useQueryMock.mockReset();
    useMutationMock.mockReturnValue({
      mutate: statusMutateMock,
      isPending: false,
    });
    useQueryMock.mockImplementation((options: { queryKey?: unknown[] }) => {
      const scope = options.queryKey?.[0];
      if (scope === 'communication-events') {
        return {
          data: { data: [] },
          isLoading: false,
        };
      }

      return {
        data: {
          data: [
            {
              id: 'request_1',
              request_type: 'tracing_report',
              subject: '服薬情報提供書の確認',
              status: 'received',
              requested_at: '2026-05-12T00:00:00.000Z',
              due_date: '2026-05-13T00:00:00.000Z',
              patient_id: 'patient_1',
              related_entity_type: 'tracing_report',
              related_entity_id: 'tracing_1',
              recipient_name: '在宅主治医',
              recipient_role: 'physician',
              responses: [],
            },
          ],
        },
        isLoading: false,
      };
    });
    render(<CommunicationRequestsContent />);

    fireEvent.click(screen.getAllByRole('button', { name: '対応中へ' })[0]!);

    expect(screen.getByRole('dialog', { name: 'ステータス変更を確認' })).toBeTruthy();
    expect(screen.getByText(/患者・相手先・期限を確認/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '理由を記録して更新' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('変更理由'), {
      target: { value: '電話で受領確認し、薬剤師が対応を開始' },
    });
    fireEvent.click(screen.getByRole('button', { name: '理由を記録して更新' }));

    expect(statusMutateMock).toHaveBeenCalledWith({
      id: 'request_1',
      status: 'in_progress',
      reason: '電話で受領確認し、薬剤師が対応を開始',
    });
  });
});
