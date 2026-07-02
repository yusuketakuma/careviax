// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { toast } from 'sonner';
import {
  ScheduleCreateEditDrawer,
  buildScheduleCreateEditDrawerForm,
  buildScheduleCreateEditDrawerPayload,
  getScheduleCreateEditDrawerContactBlocker,
  getScheduleCreateEditDrawerSaveBlocker,
  type ScheduleCreateEditDrawerForm,
} from './schedule-create-edit-drawer';
import type { CaseOption, Pharmacist, Proposal } from './day-view.shared';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const requestNavigationConfirmationMock = vi.hoisted(() => vi.fn());
const useUnsavedChangesGuardMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/providers/navigation-confirm-provider', () => ({
  requestNavigationConfirmation: requestNavigationConfirmationMock,
}));

vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: useUnsavedChangesGuardMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderCreateEditDrawer(props?: {
  editingProposal?: Proposal | null;
  onOpenChange?: (open: boolean) => void;
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const cases: CaseOption[] = [
    {
      id: 'case_1',
      status: 'active',
      primary_pharmacist_id: 'user_1',
      primary_pharmacist_name: '佐藤薬剤師',
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
  ];
  const pharmacists: Pharmacist[] = [
    { id: 'user_1', name: '佐藤薬剤師', site_id: 'site_1', site_name: '本店' },
  ];

  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(ScheduleCreateEditDrawer, {
        open: true,
        onOpenChange: props?.onOpenChange ?? (() => undefined),
        orgId: 'org_1',
        cases,
        pharmacists,
        defaultDate: '2026-06-30',
        editingProposal: props?.editingProposal,
      }),
    ),
  );
}

describe('schedule create/edit drawer unsaved-changes guard (FEUX-8)', () => {
  it('intercepts drawer close while dirty and honors cancel', async () => {
    requestNavigationConfirmationMock.mockResolvedValue(false);
    const onOpenChange = vi.fn();
    renderCreateEditDrawer({ onOpenChange });

    // controlled-state フォームを dirty 化する。
    fireEvent.change(screen.getByLabelText('候補日'), { target: { value: '2026-07-01' } });
    // ページ離脱ガードも dirty で有効化されている(結線 teeth)。
    const lastGuardCall = useUnsavedChangesGuardMock.mock.calls.at(-1)?.[0];
    expect(lastGuardCall?.enabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    await waitFor(() => expect(requestNavigationConfirmationMock).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('closes after the user confirms discarding changes', async () => {
    requestNavigationConfirmationMock.mockResolvedValue(true);
    const onOpenChange = vi.fn();
    renderCreateEditDrawer({ onOpenChange });

    fireEvent.change(screen.getByLabelText('候補日'), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('closes cleanly without confirmation when nothing changed', () => {
    const onOpenChange = vi.fn();
    renderCreateEditDrawer({ onOpenChange });

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(requestNavigationConfirmationMock).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('schedule create/edit drawer helpers', () => {
  it('keeps patient contact status out of draft drawer payloads', () => {
    const form: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(
      buildScheduleCreateEditDrawerPayload({
        form,
        proposalId: 'proposal_1',
        submitForContact: true,
      }),
    ).toEqual({
      id: 'proposal_1',
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
      submit_for_contact: true,
    });
  });

  it('does not copy existing contact results into the editable drawer form', () => {
    const proposal = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      proposed_date: '2026-06-30T00:00:00.000Z',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      vehicle_resource: { travel_mode: 'DRIVE' },
      patient_contact_status: 'attempted',
    } as unknown as Proposal;

    expect(
      buildScheduleCreateEditDrawerForm({
        defaultDate: '2026-07-01',
        proposal,
        cases: [],
        pharmacists: [],
      }),
    ).toEqual({
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    });
  });

  it('normalizes proposal time windows from HH:mm and ISO sentinel values', () => {
    const proposal = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30T00:00:00.000Z',
      time_window_start: '1970-01-01T09:00:00.000-08:00',
      time_window_end: '1970-01-01T10:30:00.000-0800',
      proposed_pharmacist_id: 'user_1',
    } as unknown as Proposal;

    expect(
      buildScheduleCreateEditDrawerForm({
        defaultDate: '2026-07-01',
        proposal,
        cases: [],
        pharmacists: [],
      }),
    ).toMatchObject({
      time_window_start: '09:00',
      time_window_end: '10:30',
    });
  });

  it('omits empty time window fields from drawer payloads', () => {
    const form: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '',
      time_window_end: '',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(
      buildScheduleCreateEditDrawerPayload({
        form,
        submitForContact: false,
      }),
    ).toEqual({
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
      submit_for_contact: false,
    });
  });

  it('renders a labeled end-time input in the drawer form', () => {
    renderCreateEditDrawer();

    expect(screen.getByLabelText('終了時刻').getAttribute('type')).toBe('time');
  });

  it('blocks incomplete and reversed time windows before saving', () => {
    const baseForm: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, time_window_end: '' })).toBe(
      '保存するには 終了時刻も入力してください。',
    );
    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, time_window_start: '' })).toBe(
      '保存するには 開始時刻も入力してください。',
    );
    expect(
      getScheduleCreateEditDrawerSaveBlocker({
        ...baseForm,
        time_window_start: '10:30',
        time_window_end: '10:30',
      }),
    ).toBe('終了時刻は開始時刻より後にしてください。');
    expect(
      getScheduleCreateEditDrawerSaveBlocker({
        ...baseForm,
        time_window_start: '10:30',
        time_window_end: '09:30',
      }),
    ).toBe('終了時刻は開始時刻より後にしてください。');
  });

  it('allows draft save without a time window but blocks moving to contact pending', () => {
    const form: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '',
      time_window_end: '',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(getScheduleCreateEditDrawerSaveBlocker(form)).toBeNull();
    expect(getScheduleCreateEditDrawerContactBlocker(form)).toBe(
      '確認待ちにするには 開始時刻と終了時刻を入力してください。',
    );
  });

  it('keeps draft save enabled but disables contact pending when both times are empty', () => {
    renderCreateEditDrawer();

    const draftButton = screen.getByRole('button', { name: '下書き保存' });
    const contactButton = screen.getByRole('button', { name: '確認待ちにする' });

    expect((draftButton as HTMLButtonElement).disabled).toBe(false);
    expect((contactButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(
      '確認待ちにするには 開始時刻と終了時刻を入力してください。',
    );
    expect(contactButton.getAttribute('aria-describedby')).toBe('schedule-drawer-save-blocker');
    expect(draftButton.getAttribute('aria-describedby')).toBeNull();
  });

  it('sends start and end time values from the drawer UI in the PUT body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { id: 'proposal_1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '10:30' } });
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals',
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(String),
        }),
      );
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      time_window_start: '09:00',
      time_window_end: '10:30',
      submit_for_contact: false,
    });
  });

  it('sends contact-pending intent and time values from the drawer UI in the PUT body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { id: 'proposal_1' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.change(screen.getByLabelText('開始時刻'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('終了時刻'), { target: { value: '10:30' } });
    fireEvent.click(screen.getByRole('button', { name: '確認待ちにする' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/visit-schedule-proposals',
        expect.objectContaining({
          method: 'PUT',
          body: expect.any(String),
        }),
      );
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      time_window_start: '09:00',
      time_window_end: '10:30',
      submit_for_contact: true,
    });
  });

  it('shows the standard API message when proposal save returns a code/message envelope', async () => {
    const message = '同一ケース・同一日付の訪問予定が既に存在します。既存予定を確認してください';
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { code: 'WORKFLOW_CONFLICT', message, details: { field: 'proposed_date' } },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(message);
    });
  });

  it('prefers the standard API message when legacy error and message are both present', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          error: 'legacy compatibility message',
          code: 'WORKFLOW_CONFLICT',
          message: 'standard workflow conflict message',
          details: {},
        },
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('standard workflow conflict message');
    });
    expect(toast.error).not.toHaveBeenCalledWith('legacy compatibility message');
  });

  it('keeps legacy error-envelope compatibility when proposal save fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ error: 'legacy compatibility message' }, { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('legacy compatibility message');
    });
  });

  it('falls back to the generic save error when proposal save returns a non-JSON body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('not json', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('予定の保存に失敗しました');
    });
  });

  it('falls back to the generic save error when proposal save returns malformed envelope fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          code: 'INTERNAL_ERROR',
          error: 123,
          message: { raw: 'patient secret' },
          details: { raw: 'db stack patient secret' },
        },
        { status: 500 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('予定の保存に失敗しました');
    });
    const firstToastMessage = vi.mocked(toast.error).mock.calls[0]?.[0];
    expect(String(firstToastMessage)).not.toContain('patient secret');
    expect(String(firstToastMessage)).not.toContain('db stack');
  });

  it('falls back to the generic save error when proposal save omits message and error fields', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { code: 'INTERNAL_ERROR', details: { raw: 'db stack patient secret' } },
        { status: 500 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderCreateEditDrawer();
    fireEvent.click(screen.getByRole('button', { name: '下書き保存' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('予定の保存に失敗しました');
    });
    const firstToastMessage = vi.mocked(toast.error).mock.calls[0]?.[0];
    expect(String(firstToastMessage)).not.toContain('patient secret');
    expect(String(firstToastMessage)).not.toContain('db stack');
  });

  it('summarizes missing save fields without copying patient or staff values', () => {
    const baseForm: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      time_window_end: '10:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(getScheduleCreateEditDrawerSaveBlocker(baseForm)).toBeNull();

    const blocker = getScheduleCreateEditDrawerSaveBlocker({
      ...baseForm,
      case_id: '',
      proposed_date: '',
      proposed_pharmacist_id: '',
    });

    expect(blocker).toBe('保存するには 患者、候補日、担当薬剤師 を選択してください。');
    expect(blocker).not.toMatch(/case_1|user_1|2026-06-30|09:30|山田|佐藤/);

    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, case_id: '' })).toBe(
      '保存するには 患者 を選択してください。',
    );
    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, proposed_date: '' })).toBe(
      '保存するには 候補日 を選択してください。',
    );
    expect(
      getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, proposed_pharmacist_id: '' }),
    ).toBe('保存するには 担当薬剤師 を選択してください。');
    expect(
      getScheduleCreateEditDrawerSaveBlocker({
        ...baseForm,
        case_id: '',
        proposed_date: '',
      }),
    ).toBe('保存するには 患者、候補日 を選択してください。');

    const valueLeakBlocker = getScheduleCreateEditDrawerSaveBlocker({
      ...baseForm,
      case_id: '田中花子',
      proposed_date: '',
      time_window_start: '09:30',
      proposed_pharmacist_id: '薬剤師A',
    });

    expect(valueLeakBlocker).toBe('保存するには 候補日 を選択してください。');
    expect(valueLeakBlocker).not.toMatch(/田中|花子|09:30|薬剤師A/);
  });
});
