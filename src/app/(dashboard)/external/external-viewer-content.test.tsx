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

    fireEvent.click(screen.getByRole('button', { name: '受理' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'report_1',
      status: 'triaged',
      updated_at: '2026-03-28T01:02:03.000Z',
    });
  });
});
