// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
  type VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type { PhosApiClient, PhosOfflineEvidenceQueue } from '@/phos/api/types';
import { VisitModePageClient } from './VisitModePageClient';

const sessionMock = vi.hoisted(() => ({
  value: {
    phosAccessToken: 'session-access-token',
    user: { name: '薬剤師A' },
  } as { phosAccessToken?: string; user?: { name?: string | null } } | null,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: sessionMock.value,
    status: sessionMock.value ? 'authenticated' : 'unauthenticated',
  }),
}));

const allIncomplete = Object.fromEntries(
  Object.values(VisitStep).map((step) => [step, false]),
) as Record<VisitStep, boolean>;

function visit(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    card_id: 'card_1',
    server_version: 1,
    patient_name: '患者 山田太郎',
    facility: '青空ホーム',
    room: '101',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    required_steps: [
      VisitStep.ARRIVAL_CONFIRM,
      VisitStep.EVIDENCE_UPLOAD,
      VisitStep.COMPLETE_CHECK,
    ],
    step_completed: allIncomplete,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
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
    getVisitMode: vi.fn(async () => visit()),
    updateVisitStep: vi.fn(async (_packetId, step) =>
      visit({
        server_version: 2,
        last_opened_step: step,
        step_completed: {
          ...allIncomplete,
          [VisitStep.ARRIVAL_CONFIRM]: step === VisitStep.ARRIVAL_CONFIRM,
        },
      }),
    ),
    presignEvidenceUpload: vi.fn(),
    getHandoffs: vi.fn(),
    getReportDeliveries: vi.fn(),
    registerReportReply: vi.fn(),
    markReportActionDone: vi.fn(),
    createHandoff: vi.fn(),
    openHandoff: vi.fn(),
    resolveHandoff: vi.fn(),
    returnHandoff: vi.fn(),
    ...overrides,
  } as PhosApiClient;
}

function offlineEvidenceQueue(): PhosOfflineEvidenceQueue {
  return {
    enqueueEvidence: vi.fn(async () => ({ queue_id: 1 })),
    listPendingEvidence: vi.fn(async () => []),
    retryUploads: vi.fn(async () => ({ synced: 0, failed: 0 })),
  };
}

describe('VisitModePageClient', () => {
  beforeEach(() => {
    sessionMock.value = {
      phosAccessToken: 'session-access-token',
      user: { name: '薬剤師A' },
    };
    vi.unstubAllGlobals();
  });

  it('loads VisitMode by packet id and retries pending evidence when online', async () => {
    const apiClient = client();
    const queue = offlineEvidenceQueue();

    render(
      <VisitModePageClient packetId="packet_1" client={apiClient} offlineEvidenceQueue={queue} />,
    );

    await waitFor(() => expect(screen.getByText('患者 山田太郎 / 青空ホーム / 101')).toBeTruthy());
    expect(apiClient.getVisitMode).toHaveBeenCalledWith('packet_1');
    expect(queue.retryUploads).toHaveBeenCalledWith({ client: apiClient });
    expect(queue.listPendingEvidence).toHaveBeenCalledWith('packet_1');
  });

  it('updates arrival outcomes through the VisitMode API with version and idempotency', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid_1' });
    const apiClient = client();

    render(<VisitModePageClient packetId="packet_1" client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎 / 青空ホーム / 101')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '在宅' }));

    await waitFor(() =>
      expect(apiClient.updateVisitStep).toHaveBeenCalledWith(
        'packet_1',
        VisitStep.ARRIVAL_CONFIRM,
        expect.objectContaining({
          client_version: 1,
          idempotency_key: 'packet_1-ARRIVAL_CONFIRM-uuid_1',
          payload: { arrival_outcome: VisitArrivalOutcome.PRESENT },
        }),
      ),
    );
  });

  it('queues photo evidence only when the VisitMode response includes a card id', async () => {
    const hashBytes = new Uint8Array(32);
    hashBytes.fill(11);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid_2',
      subtle: {
        digest: vi.fn(async () => hashBytes.buffer),
      },
    });
    const apiClient = client({
      getVisitMode: vi.fn(async () => visit({ last_opened_step: VisitStep.EVIDENCE_UPLOAD })),
    });
    const queue = offlineEvidenceQueue();

    render(
      <VisitModePageClient packetId="packet_1" client={apiClient} offlineEvidenceQueue={queue} />,
    );

    await waitFor(() => expect(screen.getByText('証跡を追加')).toBeTruthy());
    const file = new File(['photo'], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('必須写真ファイル'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(queue.enqueueEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          card_id: 'card_1',
          packet_id: 'packet_1',
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          sha256: '0b'.repeat(32),
          offline_op_class: 'BLOCKING',
          file,
        }),
      ),
    );
  });

  it('hides photo capture when the direct VisitMode response has no card id', async () => {
    const apiClient = client({
      getVisitMode: vi.fn(async () =>
        visit({
          card_id: undefined,
          last_opened_step: VisitStep.EVIDENCE_UPLOAD,
        }),
      ),
    });

    render(<VisitModePageClient packetId="packet_1" client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎 / 青空ホーム / 101')).toBeTruthy());
    expect(screen.queryByText('証跡を追加')).toBeNull();
  });
});
