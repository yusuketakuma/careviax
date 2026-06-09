// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReportDeliveryStatus,
  SourceRefKind,
  type ReportDeliveryMutationResponse,
  type ReportDeliverySearchResponse,
  type ReportDeliveryView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from '@/phos/api/types';
import { ReportsPageClient } from './ReportsPageClient';

const routerPushMock = vi.hoisted(() => vi.fn());
const sessionMock = vi.hoisted(() => ({
  value: {
    phosAccessToken: 'session-access-token',
    user: { name: '薬剤師A' },
  } as { phosAccessToken?: string; user?: { name?: string | null } } | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: sessionMock.value,
    status: sessionMock.value ? 'authenticated' : 'unauthenticated',
  }),
}));

function delivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
  return {
    delivery_id: 'delivery_1',
    card_id: 'card_1',
    report_id: 'report_1',
    patient_name: '患者 山田太郎',
    target_label: '山田医師',
    status: ReportDeliveryStatus.WAITING_REPLY,
    delivery_method: 'FAX',
    sent_at: '2026-06-09T00:00:00.000Z',
    stale_minutes: 90,
    server_version: 1,
    source_refs: [
      {
        kind: SourceRefKind.EVIDENCE_FILE,
        ref_id: 'evidence_1',
        label: '報告書',
      },
    ],
    ...overrides,
  };
}

function searchResponse(items: ReportDeliveryView[] = []): ReportDeliverySearchResponse {
  return {
    items,
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function mutationResponse(next: ReportDeliveryView): ReportDeliveryMutationResponse {
  return {
    delivery: next,
    side_effects: [],
    server_version: next.server_version,
  };
}

function client(overrides: Partial<PhosApiClient> = {}): PhosApiClient {
  return {
    getCards: vi.fn(),
    getCapacity: vi.fn(),
    getClaimCandidates: vi.fn(),
    excludeClaimCandidate: vi.fn(),
    getFeeRules: vi.fn(),
    getCardDetail: vi.fn(),
    executeCardAction: vi.fn(),
    getVisitMode: vi.fn(),
    updateVisitStep: vi.fn(),
    presignEvidenceUpload: vi.fn(),
    getHandoffs: vi.fn(),
    getReportDeliveries: vi.fn(async ({ status } = {}) =>
      searchResponse(status === ReportDeliveryStatus.WAITING_REPLY ? [delivery()] : []),
    ),
    registerReportReply: vi.fn(async () =>
      mutationResponse(
        delivery({
          status: ReportDeliveryStatus.ACTION_DONE,
          server_version: 2,
        }),
      ),
    ),
    markReportActionDone: vi.fn(async () =>
      mutationResponse(
        delivery({
          status: ReportDeliveryStatus.ACTION_DONE,
          server_version: 3,
        }),
      ),
    ),
    createHandoff: vi.fn(),
    openHandoff: vi.fn(),
    resolveHandoff: vi.fn(),
    returnHandoff: vi.fn(),
    ...overrides,
  } as PhosApiClient;
}

describe('ReportsPageClient', () => {
  beforeEach(() => {
    routerPushMock.mockReset();
    sessionMock.value = {
      phosAccessToken: 'session-access-token',
      user: { name: '薬剤師A' },
    };
    vi.unstubAllGlobals();
  });

  it('loads waiting and action-required PH-OS report deliveries for /reports', async () => {
    const apiClient = client({
      getReportDeliveries: vi.fn(async ({ status } = {}) =>
        searchResponse(
          status === ReportDeliveryStatus.WAITING_REPLY
            ? [delivery()]
            : [
                delivery({
                  delivery_id: 'delivery_2',
                  status: ReportDeliveryStatus.ACTION_REQUIRED,
                  action_required_note: '薬剤師確認が必要です。',
                }),
              ],
        ),
      ),
    });

    render(<ReportsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getAllByText('患者 山田太郎')).toHaveLength(2));
    expect(apiClient.getReportDeliveries).toHaveBeenCalledWith({
      status: ReportDeliveryStatus.WAITING_REPLY,
    });
    expect(apiClient.getReportDeliveries).toHaveBeenCalledWith({
      status: ReportDeliveryStatus.ACTION_REQUIRED,
    });
  });

  it('opens PH-OS cards from the existing /reports route back to the Board deep link', async () => {
    render(<ReportsPageClient client={client()} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'カードを開く' }));

    expect(routerPushMock).toHaveBeenCalledWith('/board?card=card_1');
  });

  it('registers report replies with server version and idempotency', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid_reply' });
    const apiClient = client();

    render(<ReportsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信内容'), {
      target: { value: '問題ありません。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));

    await waitFor(() =>
      expect(apiClient.registerReportReply).toHaveBeenCalledWith(
        'delivery_1',
        expect.objectContaining({
          result_status: ReportDeliveryStatus.ACTION_DONE,
          reply_summary: '問題ありません。',
          client_version: 1,
          idempotency_key: 'delivery_1-REGISTER_REPORT_REPLY-uuid_reply',
        }),
      ),
    );
    expect(screen.getByText('返信待ちの報告書はありません。')).toBeTruthy();
  });

  it('marks action-required report replies done with server version and idempotency', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid_done' });
    const apiClient = client({
      getReportDeliveries: vi.fn(async ({ status } = {}) =>
        searchResponse(
          status === ReportDeliveryStatus.ACTION_REQUIRED
            ? [
                delivery({
                  status: ReportDeliveryStatus.ACTION_REQUIRED,
                  action_required_note: '薬剤師確認が必要です。',
                }),
              ]
            : [],
        ),
      ),
    });

    render(<ReportsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('患者 山田太郎の対応内容'), {
      target: { value: '電話で確認済み。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信対応を完了' }));

    await waitFor(() =>
      expect(apiClient.markReportActionDone).toHaveBeenCalledWith(
        'delivery_1',
        expect.objectContaining({
          action_note: '電話で確認済み。',
          client_version: 1,
          idempotency_key: 'delivery_1-MARK_REPORT_ACTION_DONE-uuid_done',
        }),
      ),
    );
    expect(screen.queryByText('返信対応待ち')).toBeNull();
  });

  it('renders inline configuration errors without adding a competing /reports route', () => {
    sessionMock.value = null;

    render(<ReportsPageClient />);

    expect(screen.getByText('PH-OS API Gateway base URL is not configured.')).toBeTruthy();
  });
});
