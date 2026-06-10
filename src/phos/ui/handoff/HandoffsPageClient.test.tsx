// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  HandoffStatus,
  HandoffUrgency,
  SourceRefKind,
  type HandoffMutationResponse,
  type HandoffSearchResponse,
  type HandoffView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient } from '@/phos/api/types';
import { HandoffsPageClient } from './HandoffsPageClient';

const routerPushMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '処方差分を確認してください。',
    source_refs: [
      {
        kind: SourceRefKind.PRESCRIPTION,
        ref_id: 'rx_1',
        label: '処方箋',
      },
    ],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.HIGH,
    created_by_user_id: 'user_clerk',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 18,
    ...overrides,
  };
}

function searchResponse(items: HandoffView[] = []): HandoffSearchResponse {
  return {
    items,
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function mutationResponse(next: HandoffView): HandoffMutationResponse {
  return {
    handoff: next,
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
    getHandoffs: vi.fn(async ({ status } = {}) =>
      searchResponse(status === HandoffStatus.OPEN ? [handoff()] : []),
    ),
    getReportDeliveries: vi.fn(),
    registerReportReply: vi.fn(),
    markReportActionDone: vi.fn(),
    createHandoff: vi.fn(),
    openHandoff: vi.fn(async () =>
      mutationResponse(handoff({ status: HandoffStatus.IN_REVIEW, server_version: 2 })),
    ),
    resolveHandoff: vi.fn(async () =>
      mutationResponse(handoff({ status: HandoffStatus.RESOLVED, server_version: 3 })),
    ),
    returnHandoff: vi.fn(async () =>
      mutationResponse(handoff({ status: HandoffStatus.RETURNED, server_version: 3 })),
    ),
    ...overrides,
  } as PhosApiClient;
}

describe('HandoffsPageClient', () => {
  beforeEach(() => {
    routerPushMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('loads OPEN and IN_REVIEW pharmacist handoffs for the dedicated route', async () => {
    const apiClient = client({
      getHandoffs: vi.fn(async ({ status } = {}) =>
        searchResponse(
          status === HandoffStatus.OPEN
            ? [handoff()]
            : [handoff({ handoff_id: 'handoff_2', status: HandoffStatus.IN_REVIEW })],
        ),
      ),
    });

    render(<HandoffsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getAllByText('患者 山田太郎')).toHaveLength(2));
    expect(apiClient.getHandoffs).toHaveBeenCalledWith({
      status: HandoffStatus.OPEN,
      assignee: 'ME',
    });
    expect(apiClient.getHandoffs).toHaveBeenCalledWith({
      status: HandoffStatus.IN_REVIEW,
      assignee: 'ME',
    });
    expect(screen.getByText('2件')).toBeTruthy();
  });

  it('opens cards back on the PH-OS Board deep link', async () => {
    render(<HandoffsPageClient client={client()} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'カードを開く' }));

    expect(routerPushMock).toHaveBeenCalledWith('/board?card=card_1');
  });

  it('moves an OPEN handoff into review with server version and idempotency', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid_1' });
    const apiClient = client();

    render(<HandoffsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '確認を開始' }));

    await waitFor(() =>
      expect(apiClient.openHandoff).toHaveBeenCalledWith(
        'handoff_1',
        expect.objectContaining({
          client_version: 1,
          idempotency_key: 'handoff_1-OPEN_HANDOFF-uuid_1',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getAllByText((_, element) => element?.textContent?.includes('確認中') ?? false)
          .length,
      ).toBeGreaterThan(0),
    );
  });

  it('resolves IN_REVIEW handoffs from the dedicated route queue', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid_2' });
    const apiClient = client({
      getHandoffs: vi.fn(async ({ status } = {}) =>
        searchResponse(
          status === HandoffStatus.IN_REVIEW ? [handoff({ status: HandoffStatus.IN_REVIEW })] : [],
        ),
      ),
    });

    render(<HandoffsPageClient client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '確認依頼を解決する' }));

    await waitFor(() =>
      expect(apiClient.resolveHandoff).toHaveBeenCalledWith(
        'handoff_1',
        expect.objectContaining({
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          client_version: 1,
          idempotency_key: 'handoff_1-RESOLVE_HANDOFF-uuid_2',
        }),
      ),
    );
    expect(screen.getByText('判断待ちの確認依頼はありません。')).toBeTruthy();
  });

  it('renders inline configuration errors instead of pretending the route loaded', () => {
    render(<HandoffsPageClient />);

    expect(screen.getByText('PH-OS API Gateway base URL is not configured.')).toBeTruthy();
  });
});
