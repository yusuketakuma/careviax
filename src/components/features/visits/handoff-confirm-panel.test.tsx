// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import { HandoffConfirmPanel } from './handoff-confirm-panel';
import type { VisitHandoff } from '@/types/visit-brief';

setupDomTestEnv();

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: () => 'org_1',
}));

vi.mock('sonner', async () => {
  const { createSonnerToastMock } = await import('@/test/sonner-test-utils');
  return createSonnerToastMock().module;
});

function baseHandoff(): VisitHandoff {
  return {
    next_check_items: ['残薬を確認'],
    ongoing_monitoring: ['眠気'],
    decision_rationale: '訪問時に眠気の訴えあり',
    ai_extracted: true,
    ai_confidence: 0.88,
    confirmed_by: null,
    confirmed_at: null,
    extracted_at: '2026-06-11T00:00:00.000Z',
  };
}

type PanelOptions = {
  handoff?: VisitHandoff;
  canConfirm?: boolean;
  requiresOverrideReason?: boolean;
  overrideReasonMaxLength?: number;
  supervisionConfirmTaskId?: string | null;
  canRequestSupervision?: boolean;
  supervisionRequestNoteMaxLength?: number;
};

function renderPanel({
  handoff = baseHandoff(),
  canConfirm = true,
  requiresOverrideReason = false,
  overrideReasonMaxLength,
  supervisionConfirmTaskId,
  canRequestSupervision,
  supervisionRequestNoteMaxLength,
}: PanelOptions = {}) {
  return render(
    <HandoffConfirmPanel
      visitRecordId="visit_record_1"
      expectedVisitRecordVersion={7}
      handoff={handoff}
      canConfirm={canConfirm}
      requiresOverrideReason={requiresOverrideReason}
      overrideReasonMaxLength={overrideReasonMaxLength}
      supervisionConfirmTaskId={supervisionConfirmTaskId}
      canRequestSupervision={canRequestSupervision}
      supervisionRequestNoteMaxLength={supervisionRequestNoteMaxLength}
    />,
    {
      wrapper: createQueryClientWrapper(),
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('HandoffConfirmPanel', () => {
  it('sends the expected visit record version when confirming handoff', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
    });
  });

  it('keeps the expected visit record version when confirming edited handoff', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '編集して確定' }));
    fireEvent.click(screen.getByRole('button', { name: '編集して確定' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      confirmed: true,
      expected_visit_record_version: 7,
      edits: expect.objectContaining({
        next_check_items: ['残薬を確認'],
        ongoing_monitoring: ['眠気'],
        decision_rationale: '訪問時に眠気の訴えあり',
      }),
    });
  });

  it('keeps server messages when handoff confirmation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '申し送りは既に確定されています' }), {
            status: 409,
          }),
      ),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('申し送りは既に確定されています');
    });
  });

  it('falls back when handoff confirmation fails without a server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    );
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: '確認' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('申し送りの確定に失敗しました');
    });
  });

  it('requires an override reason before sending admin confirmation', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ canConfirm: false, requiresOverrideReason: true });

    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '編集して確定' })).toBeNull();
    const button = screen.getByRole('button', { name: '管理者として確定' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('代行理由'), {
      target: { value: '短い' },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('代行理由'), {
      target: { value: '担当者不在のため本日訪問前に確認が必要' },
    });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
      override_reason: '担当者不在のため本日訪問前に確認が必要',
    });
  });

  it('renders read-only state without confirmation actions', () => {
    renderPanel({ canConfirm: false });

    expect(screen.getByText(/閲覧のみ:/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '編集して確定' })).toBeNull();
  });

  it('lets trainees request supervision without sending a final confirmation payload', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { status: 'requested' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({ canConfirm: false, canRequestSupervision: true });

    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    expect(screen.queryByRole('button', { name: '編集して確定' })).toBeNull();
    expect(screen.queryByRole('button', { name: '管理者として確定' })).toBeNull();
    const button = screen.getByRole('button', { name: '上長確認を依頼' });

    fireEvent.change(screen.getByLabelText('依頼メモ'), {
      target: { value: ' 上長確認をお願いします ' },
    });
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/visit-records/visit_record_1/handoff/supervision-request',
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      expected_visit_record_version: 7,
      request_note: '上長確認をお願いします',
    });
    expect(body).not.toHaveProperty('confirmed');
  });

  it('uses the dedicated supervisor confirmation endpoint for supervision tasks', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: { confirmed_at: '2026-06-11T01:00:00.000Z' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel({
      canConfirm: false,
      supervisionConfirmTaskId: 'task_supervision_1',
    });

    expect(screen.queryByRole('button', { name: '上長確認を依頼' })).toBeNull();
    expect(screen.queryByRole('button', { name: '確認' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '上長確認を確定' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/visit-records/visit_record_1/handoff/supervision-confirm',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      confirmed: true,
      expected_visit_record_version: 7,
      task_id: 'task_supervision_1',
    });
  });

  it('keeps server messages when supervision request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: '上長確認の依頼先が見つかりません' }), {
            status: 403,
          }),
      ),
    );
    renderPanel({ canConfirm: false, canRequestSupervision: true });

    fireEvent.click(screen.getByRole('button', { name: '上長確認を依頼' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('上長確認の依頼先が見つかりません');
    });
  });

  it('formats confirmed timestamps in JST', () => {
    renderPanel({
      handoff: {
        ...baseHandoff(),
        confirmed_at: '2026-06-11T00:00:00.000Z',
        confirmed_by: 'user_1',
      },
    });

    expect(screen.getByText(/確認日時: 2026\/06\/11 09:00 JST/)).toBeTruthy();
  });
});
