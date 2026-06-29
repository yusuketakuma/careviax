// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

import { ExternalViewerContent } from './external-viewer-content';

setupDomTestEnv();

describe('ExternalViewerContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgIdMock.mockReturnValue('org_1');
    useQueryClientMock.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    useMutationMock.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useQueryMock.mockReturnValue({
      data: { data: [] },
      isLoading: false,
    });
  });

  it('shows the home context banner for self report focus', () => {
    render(<ExternalViewerContent initialFocus="self_reports" initialContext="dashboard_home" />);

    expect(screen.getByTestId('external-context-banner')).toBeTruthy();
    expect(screen.getByText('ホームから自己申告キューにフォーカスして開いています。')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '外部連携サマリー' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '共有とフォロー' })).toBeTruthy();
  });

  it('sends the self report version timestamp when updating status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ data: { id: 'report_1' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ExternalViewerContent />);

    const updateMutation = useMutationMock.mock.calls[0]?.[0] as {
      mutationFn: (variables: {
        id: string;
        status: 'triaged' | 'resolved' | 'dismissed' | 'converted_to_task';
        updated_at: string;
      }) => Promise<unknown>;
    };

    await updateMutation.mutationFn({
      id: 'report_1',
      status: 'resolved',
      updated_at: '2026-03-28T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/patient-self-reports/report_1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': 'org_1',
      },
      body: JSON.stringify({
        status: 'resolved',
        updated_at: '2026-03-28T00:00:00.000Z',
      }),
    });
  });

  it('passes the visible report version timestamp when the triage button is clicked', () => {
    const updateMutate = vi.fn();
    useMutationMock
      .mockReturnValueOnce({
        mutate: updateMutate,
        mutateAsync: vi.fn(),
        isPending: false,
      })
      .mockReturnValueOnce({
        mutate: vi.fn(),
        mutateAsync: vi.fn(),
        isPending: false,
      });
    useQueryMock
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              category: 'adherence',
              subject: '飲み忘れ',
              status: 'submitted',
              reported_by_name: '家族A',
              requested_callback: true,
              created_at: '2026-03-28T00:00:00.000Z',
              updated_at: '2026-03-28T01:02:03.000Z',
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      });

    render(<ExternalViewerContent />);

    // 自己申告のステータスは生 enum ('submitted') ではなく日本語ラベルで表示する。
    expect(screen.getByText('未対応')).toBeTruthy();
    expect(screen.queryByText('submitted')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '受理' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'report_1',
      status: 'triaged',
      updated_at: '2026-03-28T01:02:03.000Z',
    });
  });

  it('moves the requested focus queue to the first work panel', () => {
    useQueryMock
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'grant_1',
              patient_id: 'patient_1',
              patient: { name: '患者A' },
              granted_to_name: '家族A',
              granted_to_contact_masked: null,
              scope: { medications: true },
              expires_at: '2026-04-01T00:00:00.000Z',
              accessed_at: null,
              created_at: '2026-03-28T00:00:00.000Z',
              self_report_summary: { total: 0, open: 0, latest_at: null },
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: {
          data: [
            {
              id: 'report_1',
              patient_id: 'patient_1',
              patient_name: '患者A',
              category: '服薬相談',
              subject: '残薬が増えた',
              status: 'submitted',
              reported_by_name: '家族A',
              requested_callback: true,
              created_at: '2026-03-28T00:00:00.000Z',
              updated_at: '2026-03-28T01:02:03.000Z',
            },
          ],
        },
        isLoading: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
      });

    render(<ExternalViewerContent initialFocus="self_reports" />);

    const workQueue = screen.getByTestId('external-work-queue');
    const panelGrid = workQueue.lastElementChild;
    const firstPanel = workQueue.querySelector('[data-testid="external-self-report-queue"]');

    expect(firstPanel).toBe(panelGrid?.firstElementChild);
  });

  it('shows a retryable error state instead of a false empty when the share query fails', () => {
    const grantsRefetch = vi.fn();
    useQueryMock
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: grantsRefetch,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      });

    render(<ExternalViewerContent />);

    // 取得失敗を「有効な共有リンクはありません」という false empty に潰さない。
    expect(screen.queryByText('有効な共有リンクはありません')).toBeNull();
    expect(screen.getByText('外部共有を表示できません')).toBeTruthy();

    // 再試行ボタンは refetch を呼ぶ。
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(grantsRefetch).toHaveBeenCalledTimes(1);

    // サマリーは誤った 0 ではなく「—」と取得失敗の注記を出す。
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('取得に失敗しました')).toBeTruthy();
  });

  it('keeps independent panels working when only one query fails', () => {
    useQueryMock
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: { data: [] },
        isLoading: false,
        isError: false,
      })
      .mockReturnValueOnce({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: vi.fn(),
      });

    render(<ExternalViewerContent />);

    // 失敗した地域活動パネルだけがエラー表示。共有・自己申告は通常の空表示を維持。
    expect(screen.getByText('地域活動を表示できません')).toBeTruthy();
    expect(screen.getByText('有効な共有リンクはありません')).toBeTruthy();
    expect(screen.getByText('自己申告はありません')).toBeTruthy();
    expect(screen.queryByText('要フォロー活動はありません')).toBeNull();
  });
});
