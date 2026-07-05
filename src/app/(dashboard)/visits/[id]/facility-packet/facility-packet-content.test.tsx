// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper, createTestQueryClient } from '@/test/query-client-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { FacilityPacketContent } from './facility-packet-content';

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

setupDomTestEnv();

function buildFacilityPacketResponse() {
  return {
    data: {
      pack: {
        facility_parallel_context: {
          label: '青空ホーム',
          place_kind: 'facility',
          site_name: '青空ホーム',
          common_notes: null,
          current_schedule_id: 'schedule_1',
          patients: [
            {
              schedule_id: 'schedule_1',
              patient_name: '山田 花子',
              unit_name: '101',
              route_order: 1,
              schedule_status: 'ready',
              preparation_blockers_count: 0,
              visit_record_id: null,
            },
          ],
        },
      },
    },
  };
}

describe('FacilityPacketContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the facility packet through the visit-preparation endpoint with org headers', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(buildFacilityPacketResponse()));
    vi.stubGlobal('fetch', fetchMock);

    render(<FacilityPacketContent scheduleId="schedule_1" />, {
      wrapper: createQueryClientWrapper(),
    });

    expect(await screen.findByTestId('facility-packet-page')).toBeTruthy();
    expect(screen.getByTestId('facility-packet-patient').textContent).toContain('山田 花子 様');
    expect(fetchMock).toHaveBeenCalledWith('/api/visit-preparations/schedule_1', {
      headers: { 'x-org-id': 'org_1' },
    });
  });

  it('surfaces API messages from the facility packet read query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ message: 'API側の施設訪問パケットエラー' }, 500)),
    );
    const queryClient = createTestQueryClient();

    render(<FacilityPacketContent scheduleId="schedule_1" />, {
      wrapper: createQueryClientWrapper(queryClient),
    });

    expect(await screen.findByText('施設訪問パケットを表示できません')).toBeTruthy();
    await waitFor(() => {
      expect(
        queryClient.getQueryState(['visit-preparation-facility-packet', 'schedule_1', 'org_1'])
          ?.error,
      ).toEqual(new Error('API側の施設訪問パケットエラー'));
    });
  });

  it('keeps API messages from facility packet save failures', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/visit-preparations/schedule_1') {
        return jsonResponse(buildFacilityPacketResponse());
      }
      return jsonResponse({ message: '施設一括訪問の順序が同時に更新されました' }, 409);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FacilityPacketContent scheduleId="schedule_1" />, {
      wrapper: createQueryClientWrapper(),
    });

    expect(await screen.findByTestId('facility-packet-page')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '施設訪問パケットを編集' }));
    fireEvent.change(screen.getByLabelText('入館方法'), {
      target: { value: '正面玄関で受付' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('施設一括訪問の順序が同時に更新されました');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/facility-visit-batches', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': 'org_1' },
      body: JSON.stringify({
        schedule_ids: ['schedule_1'],
        ordered_schedule_ids: ['schedule_1'],
        expected_route_orders: [{ schedule_id: 'schedule_1', route_order: 1 }],
        packet_memo: {
          entry: '正面玄関で受付',
          parking: '',
          nurse_station: '',
          cart: '',
          handoff: '',
        },
      }),
    });
  });
});
