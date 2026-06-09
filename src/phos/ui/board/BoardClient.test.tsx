// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionCode,
  ActionKind,
  BlockerSeverity,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  Tag,
  UserRole,
  VisitStatus,
  VisitStep,
} from '@/phos/contracts/phos_contracts';
import type {
  ActionResponse,
  CapacityResponse,
  CardBoardItemView,
  CardDetailResponse,
  CardSearchResponse,
  CardSummaryView,
  HandoffMutationResponse,
  HandoffSearchResponse,
  HandoffView,
  NextActionView,
  ReportDeliveryMutationResponse,
  ReportDeliverySearchResponse,
  ReportDeliveryView,
  TagView,
  VisitModeView,
} from '@/phos/contracts/phos_contracts';
import type {
  PhosApiClient,
  PhosOfflineActionQueue,
  PhosOfflineEvidenceQueue,
} from '@/phos/api/types';
import { PhosApiError } from '@/phos/api/types';
import { BoardClient } from './BoardClient';

const sessionMock = vi.hoisted(() => ({
  value: {
    phosAccessToken: 'session-access-token',
    phosRole: undefined as UserRole | undefined,
    user: { name: '薬剤師A' },
  } as {
    phosAccessToken?: string;
    phosRole?: UserRole;
    cognitoGroups?: unknown;
    user?: { name?: string | null };
  } | null,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: sessionMock.value,
    status: sessionMock.value ? 'authenticated' : 'unauthenticated',
  }),
}));

const readyCard = {
  card_id: 'card_1',
  card_type: CardType.PRESCRIPTION,
  patient_name: '患者 山田太郎',
  current_step: CurrentStep.DIFF_REVIEW,
  display_status: DisplayStatus.READY,
  server_version: 1,
  tags: [],
} satisfies CardSummaryView;

const dispensingCard = {
  ...readyCard,
  current_step: CurrentStep.DISPENSING,
  display_status: DisplayStatus.IN_PROGRESS,
  server_version: 2,
} satisfies CardSummaryView;

function tag(code: Tag): TagView {
  return {
    code,
    label: code,
    severity: 'WARNING',
    icon: 'tag',
    safety_critical: code === Tag.HIGH_RISK,
  };
}

const nextAction = {
  code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
  kind: ActionKind.STEP_CHANGING,
  label_key: 'action.confirm_prescription_diff',
  enabled: true,
  offline_allowed: false,
  priority: 'PRIMARY',
  required_role: [],
  target_endpoint: '/cards/card_1/actions',
  ui_state: ButtonState.ACTIONABLE,
  can_user_handle: true,
} satisfies NextActionView;

const item = {
  card: readyCard,
  next_action: nextAction,
} satisfies CardBoardItemView;

function searchResponse(items: CardBoardItemView[] = [item]): CardSearchResponse {
  return {
    items,
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function actionResponse(): ActionResponse {
  return {
    card: dispensingCard,
    next_action: {
      ...nextAction,
      code: ActionCode.START_DISPENSING,
      label_key: 'action.start_dispensing',
    },
    display_status: DisplayStatus.IN_PROGRESS,
    blockers: [],
    side_effects: [],
    server_version: 2,
  };
}

function capacityResponse(): CapacityResponse {
  return {
    date: '2026-06-09',
    scope: CapacityScope.PHARMACY,
    status: CapacityStatus.TIGHT,
    total_planned_minutes: 420,
    total_available_minutes: 480,
    utilization_percent: 88,
    work_buckets: [
      {
        bucket_code: 'DISPENSING',
        label: '調剤',
        planned_minutes: 180,
        available_minutes: 210,
        utilization_percent: 86,
      },
    ],
    staff_loads: [],
    bottlenecks: [],
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function visitMode(overrides: Partial<VisitModeView> = {}): VisitModeView {
  return {
    packet_id: 'packet_1',
    server_version: 3,
    patient_name: '患者 山田太郎',
    facility: '青空ホーム',
    room: '101',
    visit_status: VisitStatus.IN_PROGRESS,
    applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
    step_completed: Object.fromEntries(
      Object.values(VisitStep).map((step) => [step, step === VisitStep.ARRIVAL_CONFIRM]),
    ) as Record<VisitStep, boolean>,
    last_opened_step: VisitStep.ARRIVAL_CONFIRM,
    evidence_sync: { blocking_unsynced_count: 0, non_blocking_unsynced_count: 0 },
    online: true,
    ...overrides,
  };
}

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.HIGH,
    related_blocker_code: 'MISSING_EVIDENCE',
    created_by_user_id: 'user_clerk',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 12,
    ...overrides,
  };
}

function handoffSearchResponse(items: HandoffView[] = []): HandoffSearchResponse {
  return {
    items,
    server_time: '2026-06-09T00:00:00.000Z',
  };
}

function reportDelivery(overrides: Partial<ReportDeliveryView> = {}): ReportDeliveryView {
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
    source_refs: [{ kind: 'EVIDENCE_FILE', ref_id: 'report_1', label: '報告書' }],
    ...overrides,
  };
}

function reportDeliverySearchResponse(
  items: ReportDeliveryView[] = [],
): ReportDeliverySearchResponse {
  return {
    items,
    server_time: '2026-06-09T01:30:00.000Z',
  };
}

function reportDeliveryMutationResponse(
  next: ReportDeliveryView = reportDelivery({
    status: ReportDeliveryStatus.ACTION_DONE,
    stale_minutes: 0,
    server_version: 2,
    reply_summary: '問題ありません。',
    reply_received_at: '2026-06-09T02:00:00.000Z',
    action_done_at: '2026-06-09T02:00:00.000Z',
  }),
): ReportDeliveryMutationResponse {
  return {
    delivery: next,
    side_effects: [{ type: 'REPORT_ACTION_DONE', delivery_id: next.delivery_id }],
    server_version: next.server_version,
  };
}

function handoffMutationResponse(next: HandoffView): HandoffMutationResponse {
  return {
    handoff: next,
    side_effects:
      next.status === HandoffStatus.RESOLVED
        ? [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_EVIDENCE' }]
        : [],
    server_version: next.server_version,
  };
}

function detailResponse(overrides: Partial<CardDetailResponse> = {}): CardDetailResponse {
  return {
    card: readyCard,
    visible_tabs: ['OVERVIEW', 'PRESCRIPTION'],
    permissions: {
      can_read: true,
      can_write: true,
      allowed_actions: [ActionCode.CONFIRM_PRESCRIPTION_DIFF],
    },
    next_action: nextAction,
    blockers: [],
    source_refs: [],
    server_version: 1,
    ...overrides,
  };
}

function client(overrides: Partial<PhosApiClient> = {}): PhosApiClient {
  return {
    getCards: vi.fn(async () => searchResponse()),
    getCapacity: vi.fn(async () => capacityResponse()),
    getCardDetail: vi.fn(async () => detailResponse()),
    executeCardAction: vi.fn(async () => actionResponse()),
    getVisitMode: vi.fn(async () => visitMode()),
    updateVisitStep: vi.fn(async () => visitMode({ server_version: 4 })),
    presignEvidenceUpload: vi.fn(),
    getHandoffs: vi.fn(async () => handoffSearchResponse()),
    getReportDeliveries: vi.fn(async () => reportDeliverySearchResponse()),
    registerReportReply: vi.fn(async () => reportDeliveryMutationResponse()),
    markReportActionDone: vi.fn(async () => reportDeliveryMutationResponse()),
    createHandoff: vi.fn(async () => handoffMutationResponse(handoff())),
    openHandoff: vi.fn(async () =>
      handoffMutationResponse(
        handoff({
          status: HandoffStatus.IN_REVIEW,
          server_version: 2,
        }),
      ),
    ),
    resolveHandoff: vi.fn(async () =>
      handoffMutationResponse(
        handoff({
          status: HandoffStatus.RESOLVED,
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          server_version: 2,
        }),
      ),
    ),
    returnHandoff: vi.fn(async () =>
      handoffMutationResponse(
        handoff({
          status: HandoffStatus.RETURNED,
          return_reason_code: 'NEED_MORE_INFO',
          return_note: '施設連絡先を確認してください。',
          server_version: 2,
        }),
      ),
    ),
    ...overrides,
  } as PhosApiClient;
}

describe('BoardClient', () => {
  beforeEach(() => {
    sessionMock.value = {
      phosAccessToken: 'session-access-token',
      phosRole: undefined,
      user: { name: '薬剤師A' },
    };
    window.history.replaceState(null, '', '/board');
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('loads cards from the PH-OS API client', async () => {
    const apiClient = client();

    render(<BoardClient client={apiClient} />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    expect(apiClient.getCards).toHaveBeenCalledWith({ sort: 'VISIT_TIME' });
  });

  it('renders a loading skeleton before cards resolve', () => {
    const apiClient = client({
      getCards: vi.fn(() => new Promise<CardSearchResponse>(() => undefined)),
      getHandoffs: vi.fn(() => new Promise<HandoffSearchResponse>(() => undefined)),
      getReportDeliveries: vi.fn(() => new Promise<ReportDeliverySearchResponse>(() => undefined)),
    });

    render(<BoardClient client={apiClient} />);

    expect(screen.getByText('カードを読み込み中')).toBeTruthy();
    expect(screen.getByLabelText('カード読み込み中')).toBeTruthy();
    expect(screen.queryByText('本日対応予定のカードはありません。')).toBeNull();
  });

  it('sends Board search and sort changes to the PH-OS API client', async () => {
    const apiClient = client({
      getCards: vi.fn(async () => searchResponse()),
      getHandoffs: vi.fn(() => new Promise<HandoffSearchResponse>(() => undefined)),
      getReportDeliveries: vi.fn(() => new Promise<ReportDeliverySearchResponse>(() => undefined)),
    });

    render(<BoardClient client={apiClient} />);

    await waitFor(() => expect(apiClient.getCards).toHaveBeenCalledWith({ sort: 'VISIT_TIME' }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '山田' } });

    await waitFor(() =>
      expect(apiClient.getCards).toHaveBeenCalledWith({ query: '山田', sort: 'VISIT_TIME' }),
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'STALE_TIME' } });

    await waitFor(() =>
      expect(apiClient.getCards).toHaveBeenCalledWith({ query: '山田', sort: 'STALE_TIME' }),
    );
  });

  it('loads and renders CapacityBar only for manager or admin sessions', async () => {
    sessionMock.value = {
      phosAccessToken: 'session-access-token',
      phosRole: UserRole.MANAGER,
      user: { name: '管理薬剤師' },
    };
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(apiClient.getCapacity).toHaveBeenCalled());
    expect(apiClient.getCapacity).toHaveBeenCalledWith({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      scope: CapacityScope.PHARMACY,
    });
    expect(screen.getByRole('heading', { name: 'Capacity' })).toBeTruthy();
    expect(screen.getByText('逼迫')).toBeTruthy();
  });

  it('does not fetch capacity for non-manager sessions', async () => {
    sessionMock.value = {
      phosAccessToken: 'session-access-token',
      phosRole: UserRole.PHARMACIST,
      user: { name: '薬剤師A' },
    };
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(apiClient.getHandoffs).toHaveBeenCalledTimes(2));
    expect(apiClient.getCapacity).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Capacity' })).toBeNull();
  });

  it('loads pharmacist queue and clerk returned handoffs without opening card detail', async () => {
    const apiClient = client({
      getHandoffs: vi
        .fn()
        .mockResolvedValueOnce(handoffSearchResponse([handoff({ summary: '至急確認' })]))
        .mockResolvedValueOnce(
          handoffSearchResponse([
            handoff({
              handoff_id: 'returned_1',
              status: HandoffStatus.RETURNED,
              summary: '差し戻し確認',
              return_reason_code: 'NEED_MORE_INFO',
              return_note: '施設連絡先を確認してください。',
            }),
          ]),
        ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByText('至急確認')).toBeTruthy());
    expect(screen.getByText('差し戻し確認')).toBeTruthy();
    expect(screen.getAllByText('処方箋 1').length).toBeGreaterThan(0);
    expect(apiClient.getHandoffs).toHaveBeenCalledWith({
      status: HandoffStatus.OPEN,
      assignee: 'ME',
    });
    expect(apiClient.getHandoffs).toHaveBeenCalledWith({
      status: HandoffStatus.RETURNED,
      assignee: 'ME',
    });
  });

  it('resolves pharmacist queue handoffs after opening review without selected card detail', async () => {
    const apiClient = client({
      getHandoffs: vi
        .fn()
        .mockResolvedValueOnce(
          handoffSearchResponse([
            handoff({
              status: HandoffStatus.OPEN,
              requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            }),
          ]),
        )
        .mockResolvedValueOnce(handoffSearchResponse([])),
      openHandoff: vi.fn(async () =>
        handoffMutationResponse(
          handoff({
            status: HandoffStatus.IN_REVIEW,
            requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            server_version: 2,
          }),
        ),
      ),
      resolveHandoff: vi.fn(async () =>
        handoffMutationResponse(
          handoff({
            status: HandoffStatus.RESOLVED,
            requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
            server_version: 3,
          }),
        ),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByText('薬剤師確認が必要です。')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '確認を開始' }));
    await waitFor(() =>
      expect(apiClient.openHandoff).toHaveBeenCalledWith(
        'handoff_1',
        expect.objectContaining({ client_version: 1 }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: '確認依頼を解決する' }));

    await waitFor(() =>
      expect(apiClient.resolveHandoff).toHaveBeenCalledWith(
        'handoff_1',
        expect.objectContaining({
          resolved_action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          client_version: 2,
        }),
      ),
    );
  });

  it('loads report delivery waiting replies through the PH-OS report delivery queue API', async () => {
    const apiClient = client({
      getReportDeliveries: vi
        .fn()
        .mockResolvedValueOnce(
          reportDeliverySearchResponse([
            reportDelivery({ target_label: '山田医師', stale_minutes: 90 }),
          ]),
        )
        .mockResolvedValueOnce(reportDeliverySearchResponse()),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: '報告返信待ち' })).toBeTruthy());
    expect(screen.getByText('山田医師')).toBeTruthy();
    expect(screen.getByText('FAX / 90分経過')).toBeTruthy();
    expect(apiClient.getReportDeliveries).toHaveBeenCalledWith({
      status: ReportDeliveryStatus.WAITING_REPLY,
    });
    expect(apiClient.getReportDeliveries).toHaveBeenCalledWith({
      status: ReportDeliveryStatus.ACTION_REQUIRED,
    });
  });

  it('registers report replies with the delivery server version and removes completed deliveries', async () => {
    const apiClient = client({
      getReportDeliveries: vi
        .fn()
        .mockResolvedValueOnce(
          reportDeliverySearchResponse([
            reportDelivery({ target_label: '山田医師', stale_minutes: 90, server_version: 7 }),
          ]),
        )
        .mockResolvedValueOnce(reportDeliverySearchResponse()),
      registerReportReply: vi.fn(async () =>
        reportDeliveryMutationResponse(
          reportDelivery({
            status: ReportDeliveryStatus.ACTION_DONE,
            target_label: '山田医師',
            stale_minutes: 0,
            server_version: 8,
            reply_summary: '問題ありません。',
          }),
        ),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByText('山田医師')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信内容'), {
      target: { value: '問題ありません。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));

    await waitFor(() => expect(apiClient.registerReportReply).toHaveBeenCalled());
    expect(apiClient.registerReportReply).toHaveBeenCalledWith(
      'delivery_1',
      expect.objectContaining({
        result_status: ReportDeliveryStatus.ACTION_DONE,
        reply_summary: '問題ありません。',
        client_version: 7,
        idempotency_key: expect.stringContaining('delivery_1-REGISTER_REPORT_REPLY-'),
      }),
    );
    await waitFor(() => expect(screen.queryByText('山田医師')).toBeNull());
  });

  it('renders report delivery reply failures both inline and as a toast', async () => {
    const apiClient = client({
      getReportDeliveries: vi
        .fn()
        .mockResolvedValueOnce(
          reportDeliverySearchResponse([
            reportDelivery({ target_label: '山田医師', stale_minutes: 90, server_version: 7 }),
          ]),
        )
        .mockResolvedValueOnce(reportDeliverySearchResponse()),
      registerReportReply: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByText('山田医師')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('患者 山田太郎の返信内容'), {
      target: { value: '問題ありません。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信を登録' }));

    await waitFor(() =>
      expect(screen.getAllByText('通信できません。再試行してください。')).toHaveLength(2),
    );
    expect(
      within(screen.getByRole('status', { name: 'PH-OS toast notifications' })).getByText(
        '通信できません。再試行してください。',
      ),
    ).toBeTruthy();
    expect(apiClient.registerReportReply).toHaveBeenCalled();
  });

  it('marks action-required report replies done with the delivery server version', async () => {
    const apiClient = client({
      getReportDeliveries: vi
        .fn()
        .mockResolvedValueOnce(reportDeliverySearchResponse())
        .mockResolvedValueOnce(
          reportDeliverySearchResponse([
            reportDelivery({
              status: ReportDeliveryStatus.ACTION_REQUIRED,
              target_label: '山田医師',
              action_required_note: '薬剤師確認が必要です。',
              server_version: 3,
            }),
          ]),
        ),
      markReportActionDone: vi.fn(async () =>
        reportDeliveryMutationResponse(
          reportDelivery({
            status: ReportDeliveryStatus.ACTION_DONE,
            target_label: '山田医師',
            stale_minutes: 0,
            server_version: 4,
          }),
        ),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(screen.getByText('薬剤師確認が必要です。')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('患者 山田太郎の対応内容'), {
      target: { value: '電話で確認済み。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '返信対応を完了' }));

    await waitFor(() => expect(apiClient.markReportActionDone).toHaveBeenCalled());
    expect(apiClient.markReportActionDone).toHaveBeenCalledWith(
      'delivery_1',
      expect.objectContaining({
        action_note: '電話で確認済み。',
        client_version: 3,
        idempotency_key: expect.stringContaining('delivery_1-MARK_REPORT_ACTION_DONE-'),
      }),
    );
    await waitFor(() => expect(screen.queryByText('薬剤師確認が必要です。')).toBeNull());
  });

  it('uses the session PH-OS access token when loading from API Gateway', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('/report-deliveries')) {
        return new Response(JSON.stringify(reportDeliverySearchResponse()));
      }
      if (url.includes('/handoffs')) {
        return new Response(JSON.stringify(handoffSearchResponse()));
      }
      return new Response(JSON.stringify(searchResponse()));
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<BoardClient apiBaseUrl="https://api.example.com/prod" />);

    await waitFor(() => expect(screen.getByText('患者 山田太郎')).toBeTruthy());
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/prod/cards?sort=VISIT_TIME',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer session-access-token',
        }),
      }),
    );
  });

  it('does not advance the card step while an action is still submitting', async () => {
    let resolveAction: (response: ActionResponse) => void = () => {};
    const pending = new Promise<ActionResponse>((resolve) => {
      resolveAction = resolve;
    });
    const apiClient = client({
      executeCardAction: vi.fn(() => pending),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    await waitFor(() => expect(screen.getByText('操作状態: SUBMITTING')).toBeTruthy());
    expect(screen.getByText('差分確認')).toBeTruthy();

    resolveAction(actionResponse());

    await waitFor(() => expect(screen.getByText('調剤')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiClient.executeCardAction).toHaveBeenCalledWith(
      'card_1',
      expect.objectContaining({
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        client_version: 1,
      }),
    );
  });

  it('renders successful action toasts from ActionResponse', async () => {
    const apiClient = client({
      executeCardAction: vi.fn(
        async (): Promise<ActionResponse> => ({
          ...actionResponse(),
          toast: { tone: 'SUCCESS', message_key: 'toast.handoff.created' },
        }),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    const toastRegion = await screen.findByRole('status', {
      name: 'PH-OS toast notifications',
    });
    expect(within(toastRegion).getByText('薬剤師への確認依頼を作成しました。')).toBeTruthy();
  });

  it('creates handoffs with the requested action selected in Workspace', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          source_refs: [{ kind: 'PRESCRIPTION', ref_id: 'rx_1', label: '処方箋 1' }],
        }),
      ),
      createHandoff: vi.fn(async () =>
        handoffMutationResponse(
          handoff({
            requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          }),
        ),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));

    fireEvent.click(screen.getByRole('button', { name: '確認依頼を作成' }));
    fireEvent.change(screen.getByLabelText('理由'), { target: { value: 'DIFF_REVIEW' } });
    fireEvent.change(screen.getByLabelText('要約'), {
      target: { value: '処方差分を確認してください。' },
    });
    fireEvent.change(screen.getByLabelText('希望対応'), {
      target: { value: ActionCode.CONFIRM_PRESCRIPTION_DIFF },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成する' }));

    await waitFor(() =>
      expect(apiClient.createHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          card_id: 'card_1',
          reason_code: 'DIFF_REVIEW',
          summary: '処方差分を確認してください。',
          requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          client_version: 1,
        }),
      ),
    );
  });

  it('keeps the board visible when selected card detail loading fails', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () => {
        throw new Error('detail failed');
      }),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));

    await waitFor(() => expect(screen.getByText('detail failed')).toBeTruthy());
    expect(document.querySelector('[data-card-id="card_1"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('loads selected card detail, respects visible tabs, and returns focus to the source tile', async () => {
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    const cardButton = screen.getByRole('button', { name: /患者 山田太郎/ });
    fireEvent.click(cardButton);

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    expect(screen.getByRole('tab', { name: '概要' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '処方' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '算定' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(document.activeElement).toBe(cardButton));
  });

  it('opens a deep-linked card from the server-provided initial card id and removes the query on close', async () => {
    window.history.replaceState(null, '', '/board?card=card_1');
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[item]} initialSelectedCardId="card_1" />);

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(window.location.search).toBe('?card=card_1');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('syncs selected card state when the server-provided card query changes on the same route', async () => {
    window.history.replaceState(null, '', '/board?card=card_1');
    const apiClient = client({
      getCardDetail: vi.fn(async (cardId: string) =>
        detailResponse({
          card:
            cardId === 'card_2'
              ? {
                  ...readyCard,
                  card_id: 'card_2',
                  patient_name: '患者 佐藤花子',
                }
              : readyCard,
        }),
      ),
    });

    const { rerender } = render(
      <BoardClient client={apiClient} initialItems={[item]} initialSelectedCardId="card_1" />,
    );

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));

    rerender(
      <BoardClient client={apiClient} initialItems={[item]} initialSelectedCardId="card_2" />,
    );

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_2'));
    expect(screen.getByRole('heading', { name: '患者 佐藤花子' })).toBeTruthy();
    expect(window.location.search).toBe('?card=card_2');
  });

  it('opens a deep-linked card from the current URL when no server prop is available', async () => {
    window.history.replaceState(null, '', '/board?card=card_1');
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(window.location.search).toBe('?card=card_1');
  });

  it('returns focus to the board root when a deep-linked source card is not in the current list', async () => {
    window.history.replaceState(null, '', '/board?card=external_card');
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          card: {
            ...readyCard,
            card_id: 'external_card',
            patient_name: '患者 外部',
          },
        }),
      ),
    });

    render(
      <BoardClient
        client={apiClient}
        initialItems={[item]}
        initialSelectedCardId="external_card"
      />,
    );

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('external_card'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector<HTMLElement>('[data-phos-board-root="true"]'),
      ),
    );
    expect(window.location.search).toBe('');
  });

  it('keeps opened card tabs and switches selected cards through Workspace tabs', async () => {
    const secondItem = {
      card: {
        ...readyCard,
        card_id: 'card_2',
        patient_name: '患者 佐藤花子',
      },
      next_action: nextAction,
    } satisfies CardBoardItemView;
    const apiClient = client({
      getCardDetail: vi.fn(async (cardId: string) =>
        detailResponse({
          card:
            cardId === 'card_2'
              ? {
                  ...readyCard,
                  card_id: 'card_2',
                  patient_name: '患者 佐藤花子',
                }
              : readyCard,
        }),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item, secondItem]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(window.location.search).toBe(''));

    fireEvent.click(screen.getByRole('button', { name: /患者 佐藤花子/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_2'));

    const openedCardTabs = screen.getByRole('group', { name: 'OpenedCardTabs' });
    expect(within(openedCardTabs).getByRole('button', { name: '患者 山田太郎' })).toBeTruthy();
    expect(
      within(openedCardTabs)
        .getByRole('button', { name: '患者 佐藤花子' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(openedCardTabs).getByRole('button', { name: '患者 山田太郎' }));

    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    expect(window.location.search).toBe('?card=card_1');
  });

  it('updates VisitMode through the Visit step API from the VISIT_REPORT tab', async () => {
    const completedVisit = visitMode({
      server_version: 4,
      visit_status: VisitStatus.COMPLETED,
      step_completed: Object.fromEntries(
        Object.values(VisitStep).map((step) => [step, true]),
      ) as Record<VisitStep, boolean>,
    });
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          visible_tabs: ['OVERVIEW', 'VISIT_REPORT'],
          visit_mode: visitMode({
            step_completed: Object.fromEntries(
              Object.values(VisitStep).map((step) => [step, true]),
            ) as Record<VisitStep, boolean>,
          }),
        }),
      ),
      updateVisitStep: vi.fn(async () => completedVisit),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('tab', { name: '訪問・報告' }));

    fireEvent.click(screen.getByRole('button', { name: '訪問を完了する' }));

    await waitFor(() =>
      expect(apiClient.updateVisitStep).toHaveBeenCalledWith(
        'packet_1',
        VisitStep.COMPLETE_CHECK,
        expect.objectContaining({
          client_version: 3,
        }),
      ),
    );
    expect(screen.getByText('完了確認')).toBeTruthy();
  });

  it('does not submit VisitMode draft save for an incomplete current step', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          visible_tabs: ['OVERVIEW', 'VISIT_REPORT'],
          visit_mode: visitMode({
            applicable_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
            required_steps: [VisitStep.ARRIVAL_CONFIRM, VisitStep.COMPLETE_CHECK],
            step_completed: {
              ...(Object.fromEntries(
                Object.values(VisitStep).map((step) => [step, false]),
              ) as Record<VisitStep, boolean>),
              [VisitStep.ARRIVAL_CONFIRM]: true,
            },
            last_opened_step: VisitStep.COMPLETE_CHECK,
          }),
        }),
      ),
      updateVisitStep: vi.fn(async () => visitMode({ server_version: 4 })),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('tab', { name: '訪問・報告' }));
    fireEvent.click(screen.getByRole('button', { name: '一時保存' }));

    expect(screen.getByRole('status').textContent).toBe('一時保存しました');
    expect(apiClient.updateVisitStep).not.toHaveBeenCalled();
  });

  it('submits VisitMode draft save only for completed non-arrival steps', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          visible_tabs: ['OVERVIEW', 'VISIT_REPORT'],
          visit_mode: visitMode({
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
            step_completed: {
              ...(Object.fromEntries(
                Object.values(VisitStep).map((step) => [step, false]),
              ) as Record<VisitStep, boolean>),
              [VisitStep.ARRIVAL_CONFIRM]: true,
              [VisitStep.EVIDENCE_UPLOAD]: true,
            },
            last_opened_step: VisitStep.EVIDENCE_UPLOAD,
          }),
        }),
      ),
      updateVisitStep: vi.fn(async () => visitMode({ server_version: 4 })),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('tab', { name: '訪問・報告' }));
    fireEvent.click(screen.getByRole('button', { name: '一時保存' }));

    await waitFor(() =>
      expect(apiClient.updateVisitStep).toHaveBeenCalledWith(
        'packet_1',
        VisitStep.EVIDENCE_UPLOAD,
        expect.objectContaining({
          client_version: 3,
        }),
      ),
    );
  });

  it('loads offline evidence queue records into VisitMode completion guards', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          visible_tabs: ['VISIT_REPORT'],
          visit_mode: visitMode({
            step_completed: Object.fromEntries(
              Object.values(VisitStep).map((step) => [step, true]),
            ) as Record<VisitStep, boolean>,
          }),
        }),
      ),
    });
    const offlineEvidenceQueue: PhosOfflineEvidenceQueue = {
      enqueueEvidence: vi.fn(async () => ({ queue_id: 1 })),
      listPendingEvidence: vi.fn(async () => [
        {
          evidence_key: 'mandatory_photo',
          label: '必須写真',
          offline_op_class: 'BLOCKING' as const,
          created_at: '2026-06-09T00:00:00.000Z',
          retry_count: 0,
        },
      ]),
      retryUploads: vi.fn(async () => ({ synced: 0, failed: 0 })),
    };

    render(
      <BoardClient
        client={apiClient}
        initialItems={[item]}
        offlineEvidenceQueue={offlineEvidenceQueue}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() =>
      expect(offlineEvidenceQueue.retryUploads).toHaveBeenCalledWith({ client: apiClient }),
    );
    expect(offlineEvidenceQueue.listPendingEvidence).toHaveBeenCalledWith('packet_1');

    await waitFor(() => expect(screen.getByRole('region', { name: '同期待ち証跡' })).toBeTruthy());
    expect(screen.getByText('必須写真')).toBeTruthy();
    expect(screen.getByText('必須未同期 1件')).toBeTruthy();

    const complete = screen.getByRole('button', { name: '訪問を完了する（未完了）' });
    fireEvent.click(complete);

    expect(complete.getAttribute('data-enabled')).toBe('false');
    expect(apiClient.updateVisitStep).not.toHaveBeenCalled();
  });

  it('queues captured VisitMode photo evidence as Blob records and refreshes pending guards', async () => {
    const hashBytes = new Uint8Array(32);
    hashBytes.fill(10);
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid_1',
      subtle: {
        digest: vi.fn(async () => hashBytes.buffer),
      },
    });
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          visible_tabs: ['VISIT_REPORT'],
          visit_mode: visitMode({
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
            step_completed: Object.fromEntries(
              Object.values(VisitStep).map((step) => [step, true]),
            ) as Record<VisitStep, boolean>,
            last_opened_step: VisitStep.EVIDENCE_UPLOAD,
          }),
        }),
      ),
    });
    const offlineEvidenceQueue: PhosOfflineEvidenceQueue = {
      enqueueEvidence: vi.fn(async () => ({ queue_id: 7 })),
      listPendingEvidence: vi.fn(async () => [
        {
          evidence_key: 'required_visit_photo_1',
          label: '必須写真: required.jpg',
          offline_op_class: 'BLOCKING' as const,
          created_at: '2026-06-09T00:00:00.000Z',
          retry_count: 0,
        },
      ]),
      retryUploads: vi.fn(async () => ({ synced: 0, failed: 1 })),
    };

    render(
      <BoardClient
        client={apiClient}
        initialItems={[item]}
        offlineEvidenceQueue={offlineEvidenceQueue}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('tab', { name: '訪問・報告' }));

    const requiredFile = new File(['required'], 'required.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('必須写真ファイル'), {
      target: { files: [requiredFile] },
    });

    await waitFor(() =>
      expect(offlineEvidenceQueue.enqueueEvidence).toHaveBeenCalledWith(
        expect.objectContaining({
          card_id: 'card_1',
          packet_id: 'packet_1',
          label: '必須写真: required.jpg',
          evidence_type: 'VISIT_PHOTO',
          file_name: 'required.jpg',
          mime_type: 'image/jpeg',
          sha256: '0a'.repeat(32),
          offline_op_class: 'BLOCKING',
          file: requiredFile,
        }),
      ),
    );
    expect(offlineEvidenceQueue.retryUploads).toHaveBeenCalledWith({ client: apiClient });
    await waitFor(() => expect(screen.getByText('必須写真: required.jpg')).toBeTruthy());
    expect(screen.getByText('必須未同期 1件')).toBeTruthy();
  });

  it('filters board items through quick filters and triage lanes', async () => {
    const mine = {
      ...item,
      card: { ...readyCard, assigned_user: '薬剤師A' },
    } satisfies CardBoardItemView;
    const safety = {
      card: {
        ...readyCard,
        card_id: 'card_safety',
        patient_name: '患者 安全',
        tags: [tag(Tag.HIGH_RISK)],
      },
      next_action: nextAction,
    } satisfies CardBoardItemView;
    const reply = {
      card: {
        ...readyCard,
        card_id: 'card_reply',
        patient_name: '患者 返信',
        tags: [tag(Tag.WAITING_REPLY)],
      },
      next_action: nextAction,
    } satisfies CardBoardItemView;

    const apiClient = client();
    render(<BoardClient client={apiClient} initialItems={[mine, safety, reply]} />);

    await waitFor(() => expect(apiClient.getHandoffs).toHaveBeenCalledTimes(2));

    expect(screen.getByText('患者 山田太郎')).toBeTruthy();
    expect(screen.getByText('患者 安全')).toBeTruthy();
    expect(screen.getByText('患者 返信')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /緊急/ }));
    expect(screen.queryByText('患者 山田太郎')).toBeNull();
    expect(screen.getByText('患者 安全')).toBeTruthy();
    expect(screen.queryByText('患者 返信')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /返信待ち/ })[1]);
    expect(screen.getByText('条件に一致するカードはありません。')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '検索条件を解除' }));
    expect(screen.getByText('患者 山田太郎')).toBeTruthy();
    expect(screen.getByText('患者 安全')).toBeTruthy();
    expect(screen.getByText('患者 返信')).toBeTruthy();
  });

  it('applies compact density through BoardClient state', async () => {
    const blockedItem = {
      card: {
        ...readyCard,
        assigned_user: '薬剤師A',
        blocker_summary: {
          top: {
            blocker_code: 'NEED_PHARMACIST',
            severity: BlockerSeverity.WARNING,
            owner_role: UserRole.PHARMACIST,
            message_key: 'blocker.need_pharmacist',
            active: true,
          },
          blocking_count: 1,
          total_count: 1,
        },
      },
      next_action: {
        ...nextAction,
        enabled: false,
        ui_state: ButtonState.FOREIGN_BLOCK,
        can_user_handle: false,
      },
    } satisfies CardBoardItemView;
    const apiClient = client();

    render(<BoardClient client={apiClient} initialItems={[blockedItem]} />);

    await waitFor(() => expect(apiClient.getHandoffs).toHaveBeenCalledTimes(2));
    expect(screen.getByText('薬剤師の判断が必要です。')).toBeTruthy();
    expect(screen.getByText('担当: 薬剤師A')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'コンパクト' }));

    expect(screen.queryByText('薬剤師の判断が必要です。')).toBeNull();
    expect(screen.queryByText('担当: 薬剤師A')).toBeNull();
    expect(screen.getByText('他の担当者による確認が必要です。')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'コンパクト' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens shortcut help with question mark outside text entry fields', async () => {
    const apiClient = client();
    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(apiClient.getHandoffs).toHaveBeenCalledTimes(2));

    fireEvent.keyDown(window, { key: '?' });

    expect(await screen.findByRole('heading', { name: 'ショートカット' })).toBeTruthy();
    expect(screen.getByText('Board検索へ移動')).toBeTruthy();
  });

  it('does not open shortcut help with question mark while typing in search', async () => {
    const apiClient = client();
    render(<BoardClient client={apiClient} initialItems={[item]} />);

    await waitFor(() => expect(apiClient.getHandoffs).toHaveBeenCalledTimes(2));

    const search = screen.getByPlaceholderText('患者名・施設名・薬剤名・担当者で検索');
    search.focus();
    fireEvent.keyDown(search, { key: '?' });

    expect(screen.queryByRole('heading', { name: 'ショートカット' })).toBeNull();
  });

  it('uses selected detail server_version for workspace actions', async () => {
    const apiClient = client({
      getCardDetail: vi.fn(async () => detailResponse({ server_version: 7 })),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));

    const actionButtons = screen.getAllByRole('button', { name: '処方差分を確認する' });
    fireEvent.click(actionButtons[actionButtons.length - 1]!);

    await waitFor(() =>
      expect(apiClient.executeCardAction).toHaveBeenCalledWith(
        'card_1',
        expect.objectContaining({
          action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
          client_version: 7,
        }),
      ),
    );
  });

  it('sends workspace reason input for reason-required actions', async () => {
    const reasonNextAction = {
      ...nextAction,
      code: ActionCode.REJECT_SET_AUDIT,
      label_key: 'action.reject_set_audit',
      reason_required: true,
    } satisfies NextActionView;
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          card: {
            ...readyCard,
            current_step: CurrentStep.SET_AUDIT,
            server_version: 7,
          },
          next_action: reasonNextAction,
          server_version: 7,
        }),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));

    fireEvent.change(screen.getByLabelText('理由'), { target: { value: 'PHOTO_INSUFFICIENT' } });
    fireEvent.change(screen.getByLabelText('補足'), { target: { value: ' 写真が不鮮明です。 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'セット監査を差し戻す' }));

    await waitFor(() =>
      expect(apiClient.executeCardAction).toHaveBeenCalledWith(
        'card_1',
        expect.objectContaining({
          action_code: ActionCode.REJECT_SET_AUDIT,
          client_version: 7,
          reason_code: 'PHOTO_INSUFFICIENT',
          reason_note: '写真が不鮮明です。',
        }),
      ),
    );
  });

  it('uses selected detail action metadata instead of stale board reason metadata', async () => {
    const staleReasonItem = {
      ...item,
      next_action: {
        ...nextAction,
        reason_required: true,
      },
    } satisfies CardBoardItemView;
    const freshNextAction = {
      ...nextAction,
      code: ActionCode.START_DISPENSING,
      label_key: 'action.start_dispensing',
      reason_required: false,
    } satisfies NextActionView;
    const apiClient = client({
      getCardDetail: vi.fn(async () =>
        detailResponse({
          next_action: freshNextAction,
          server_version: 7,
        }),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[staleReasonItem]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));
    fireEvent.click(screen.getByRole('button', { name: '調剤を開始する' }));

    await waitFor(() =>
      expect(apiClient.executeCardAction).toHaveBeenCalledWith(
        'card_1',
        expect.objectContaining({
          action_code: ActionCode.START_DISPENSING,
          client_version: 7,
        }),
      ),
    );
    expect(apiClient.executeCardAction).toHaveBeenCalledWith(
      'card_1',
      expect.not.objectContaining({ reason_code: expect.any(String) }),
    );
  });

  it('updates visible tabs from ActionResponse while preserving the open workspace', async () => {
    const apiClient = client({
      executeCardAction: vi.fn(
        async (): Promise<ActionResponse> => ({
          ...actionResponse(),
          visible_tabs: ['CLAIM_HISTORY'],
        }),
      ),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: /患者 山田太郎/ }));
    await waitFor(() => expect(apiClient.getCardDetail).toHaveBeenCalledWith('card_1'));

    const actionButtons = screen.getAllByRole('button', { name: '処方差分を確認する' });
    fireEvent.click(actionButtons[actionButtons.length - 1]!);

    await waitFor(() => expect(screen.getByRole('tab', { name: '算定' })).toBeTruthy());
    expect(screen.queryByRole('tab', { name: '概要' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '処方' })).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a safe configuration error instead of calling Next.js /api when no API base URL exists', async () => {
    render(<BoardClient />);

    await waitFor(() =>
      expect(screen.getByText('PH-OS API Gateway base URL is not configured.')).toBeTruthy(),
    );
  });

  it('does not call API Gateway without an access token provider', async () => {
    sessionMock.value = null;

    render(<BoardClient apiBaseUrl="https://api.example.com/prod" />);

    await waitFor(() =>
      expect(screen.getByText('PH-OS access token provider is not configured.')).toBeTruthy(),
    );
  });

  it('keeps guard failures inline without advancing the card', async () => {
    const apiClient = client({
      executeCardAction: vi.fn(async () => {
        throw new PhosApiError(422, {
          request_id: 'req_1',
          error_code: 'ACTION_GUARD_FAILED',
          message_key: 'api.error.action_guard_failed',
        });
      }),
    });

    render(<BoardClient client={apiClient} initialItems={[item]} />);

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('必要な情報が不足しています。カード詳細で不足内容を確認してください。'),
      ).toHaveLength(2),
    );
    expect(
      within(screen.getByRole('status', { name: 'PH-OS toast notifications' })).getByText(
        '必要な情報が不足しています。カード詳細で不足内容を確認してください。',
      ),
    ).toBeTruthy();
    expect(screen.getByText('差分確認')).toBeTruthy();
    expect(screen.queryByText('調剤')).toBeNull();
  });

  it('queues offline-allowed primary action network failures without advancing the card', async () => {
    const offlineItem = {
      ...item,
      next_action: {
        ...nextAction,
        offline_allowed: true,
      },
    } satisfies CardBoardItemView;
    const offlineActionQueue: PhosOfflineActionQueue = {
      enqueueCardAction: vi.fn(async () => ({ queue_id: 1 })),
    };
    const apiClient = client({
      executeCardAction: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });

    render(
      <BoardClient
        client={apiClient}
        initialItems={[offlineItem]}
        offlineActionQueue={offlineActionQueue}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('オフラインキューに保存しました。オンライン復帰後に同期します。'),
      ).toHaveLength(2),
    );
    expect(offlineActionQueue.enqueueCardAction).toHaveBeenCalledWith({
      card_id: 'card_1',
      request: expect.objectContaining({
        action_code: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
        client_version: 1,
      }),
      offline_op_class: 'BLOCKING',
    });
    expect(screen.getByText('差分確認')).toBeTruthy();
    expect(screen.queryByText('調剤')).toBeNull();
  });

  it('does not queue offline-disallowed primary action network failures', async () => {
    const offlineActionQueue: PhosOfflineActionQueue = {
      enqueueCardAction: vi.fn(async () => ({ queue_id: 1 })),
    };
    const apiClient = client({
      executeCardAction: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });

    render(
      <BoardClient
        client={apiClient}
        initialItems={[item]}
        offlineActionQueue={offlineActionQueue}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '処方差分を確認する' }));

    await waitFor(() =>
      expect(screen.getAllByText('通信できません。再試行してください。')).toHaveLength(2),
    );
    expect(offlineActionQueue.enqueueCardAction).not.toHaveBeenCalled();
    expect(screen.getByText('差分確認')).toBeTruthy();
  });
});
