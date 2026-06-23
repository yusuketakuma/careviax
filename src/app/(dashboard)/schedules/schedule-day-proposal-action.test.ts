import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildScheduleDayContactAttemptRequest,
  buildScheduleDayContactLogForm,
  closeScheduleDayContactLogDialog,
  getScheduleDayProposalActionSuccessMessage,
  getDefaultScheduleDayContactLogForm,
  handleScheduleDayProposalActionSuccess,
  openScheduleDayContactLogDialog,
  updateScheduleDayProposalAction,
  type ScheduleDayProposalActionPayload,
} from './schedule-day-proposal-action';
import type { Proposal } from './day-view.shared';

vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return { ...actual, buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders) };
});

describe('schedule day proposal action helpers', () => {
  beforeEach(() => {
    vi.mocked(buildOrgJsonHeaders).mockClear();
  });

  it('builds the default contact log form', () => {
    expect(getDefaultScheduleDayContactLogForm()).toEqual({
      outcome: 'attempted',
      contact_method: 'phone',
      contact_name: '',
      contact_phone: '',
      note: '',
      callback_due_at: '',
    });
  });

  it.each([
    ['pending', 'attempted'],
    ['attempted', 'attempted'],
    ['confirmed', 'confirmed'],
    ['declined', 'declined'],
    ['change_requested', 'change_requested'],
    ['unreachable', 'unreachable'],
  ] as const)('maps patient contact status %s into contact form outcome %s', (status, outcome) => {
    expect(
      buildScheduleDayContactLogForm({
        patient_contact_status: status,
        contact_logs: [],
      }),
    ).toMatchObject({ outcome });
  });

  it('prefills only non-PHI contact metadata from the latest fax or email log', () => {
    expect(
      buildScheduleDayContactLogForm({
        patient_contact_status: 'pending',
        contact_logs: [
          {
            id: 'log_1',
            outcome: 'attempted',
            contact_method: 'fax',
            has_note: true,
            callback_due_at: '2026-04-09T12:30:00',
            called_at: '2026-04-09T09:00:00.000Z',
          },
        ],
      }),
    ).toEqual({
      outcome: 'attempted',
      contact_method: 'fax',
      contact_name: '',
      contact_phone: '',
      note: '',
      callback_due_at: '2026-04-09T12:30',
    });
  });

  it('builds open and closed contact-log dialog state from one helper surface', () => {
    const proposal: Pick<Proposal, 'patient_contact_status' | 'contact_logs'> & { id: string } = {
      id: 'proposal_1',
      patient_contact_status: 'confirmed',
      contact_logs: [
        {
          id: 'log_1',
          outcome: 'confirmed',
          contact_method: 'email',
          has_note: true,
          callback_due_at: '2026-04-09T12:30:00',
          called_at: '2026-04-09T09:00:00.000Z',
        },
      ],
    };

    expect(openScheduleDayContactLogDialog(proposal)).toEqual({
      target: proposal,
      form: {
        outcome: 'confirmed',
        contact_method: 'email',
        contact_name: '',
        contact_phone: '',
        note: '',
        callback_due_at: '2026-04-09T12:30',
      },
    });

    expect(closeScheduleDayContactLogDialog()).toEqual({
      target: null,
      form: getDefaultScheduleDayContactLogForm(),
    });
  });

  it('builds contact-attempt requests with blank optional fields omitted', () => {
    const callbackDueAt = new Date('2026-04-09T13:45').toISOString();

    expect(
      buildScheduleDayContactAttemptRequest({
        proposalId: 'proposal_1',
        form: {
          outcome: 'change_requested',
          contact_method: 'email',
          contact_name: '',
          contact_phone: '090-0000-0000',
          note: '',
          callback_due_at: '2026-04-09T13:45',
        },
      }),
    ).toEqual({
      id: 'proposal_1',
      payload: {
        action: 'contact_attempt',
        outcome: 'change_requested',
        idempotency_key: expect.stringMatching(/^visit-contact:proposal_1:/),
        contact_method: 'email',
        contact_name: undefined,
        contact_phone: '090-0000-0000',
        note: undefined,
        callback_due_at: callbackDueAt,
      },
    });
  });

  it('patches proposal actions with org scope and JSON payload', async () => {
    const proposalId = 'proposal/1?x=y#frag';
    const payload: ScheduleDayProposalActionPayload = { action: 'approve' };
    const sentinelHeaders = { 'x-org-id': 'org_1', 'x-test-helper': 'buildOrgJsonHeaders' };
    vi.mocked(buildOrgJsonHeaders).mockReturnValueOnce(sentinelHeaders);
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ data: { id: 'proposal_1' } }),
    );

    await expect(
      updateScheduleDayProposalAction({
        orgId: 'org_1',
        request: {
          id: proposalId,
          payload,
        },
        fetchImpl,
      }),
    ).resolves.toEqual({ data: { id: 'proposal_1' } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`/api/visit-schedule-proposals/${encodeURIComponent(proposalId)}`);
    expect(String(url)).not.toContain(proposalId);
    expect(String(url)).not.toContain('%25');
    expect(init?.method).toBe('PATCH');
    expect(init?.headers).toBe(sentinelHeaders);
    expect(vi.mocked(buildOrgJsonHeaders)).toHaveBeenCalledWith('org_1');
    expect(init?.body).toBe(JSON.stringify(payload));
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });

  it.each(['.', '..'])('rejects dot-segment proposal id %s before fetch', async (proposalId) => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      updateScheduleDayProposalAction({
        orgId: 'org_1',
        request: {
          id: proposalId,
          payload: { action: 'approve' },
        },
        fetchImpl,
      }),
    ).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws the server error message when proposal actions fail', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '候補はすでに確定済みです' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await expect(
      updateScheduleDayProposalAction({
        orgId: 'org_1',
        request: {
          id: 'proposal_1',
          payload: { action: 'confirm' },
        },
        fetchImpl,
      }),
    ).rejects.toThrow('候補はすでに確定済みです');
  });

  it.each([
    [{ action: 'approve' } as const, '候補を承認して架電待ちへ移しました'],
    [{ action: 'confirm' } as const, '電話確認が完了し、訪問予定を確定しました'],
    [{ action: 'reject' } as const, '候補を却下しました'],
    [
      {
        action: 'contact_attempt',
        outcome: 'change_requested',
        idempotency_key: 'contact-msg-change',
        contact_method: 'phone',
      } as const,
      '変更希望として記録しました',
    ],
    [
      {
        action: 'contact_attempt',
        outcome: 'declined',
        idempotency_key: 'contact-msg-declined',
        contact_method: 'phone',
      } as const,
      '患者辞退として記録しました',
    ],
    [
      {
        action: 'contact_attempt',
        outcome: 'unreachable',
        idempotency_key: 'contact-msg-unreachable',
        contact_method: 'phone',
      } as const,
      '不通として記録しました',
    ],
    [
      {
        action: 'contact_attempt',
        outcome: 'confirmed',
        idempotency_key: 'contact-msg-confirmed',
        contact_method: 'phone',
      } as const,
      '患者確認済みとして記録しました',
    ],
    [
      {
        action: 'contact_attempt',
        outcome: 'attempted',
        idempotency_key: 'contact-msg-attempted',
        contact_method: 'phone',
      } as const,
      '架電状況を更新しました',
    ],
  ])('keeps success message mapping for %j', (payload, expected) => {
    expect(getScheduleDayProposalActionSuccessMessage(payload)).toBe(expected);
  });

  it('notifies success, keeps non-contact dialogs open, and refreshes proposal-dependent queries', async () => {
    const notifySuccess = vi.fn();
    const closeContactLogDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayProposalActionSuccess({
      orgId: 'org_1',
      payload: { action: 'approve' },
      notifySuccess,
      closeContactLogDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('候補を承認して架電待ちへ移しました');
    expect(closeContactLogDialog).not.toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledTimes(5);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['visit-schedule-proposals', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['visit-schedules', 'week-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, {
      queryKey: ['schedule-day-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(4, {
      queryKey: ['tasks', 'schedule-board', 'org_1'],
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(5, {
      queryKey: ['tasks', 'visit-contact-followup', 'org_1'],
    });
  });

  it('closes the contact log dialog after contact-attempt actions', async () => {
    const notifySuccess = vi.fn();
    const closeContactLogDialog = vi.fn();
    const invalidateQueries = vi.fn(async () => undefined);

    await handleScheduleDayProposalActionSuccess({
      orgId: 'org_1',
      payload: {
        action: 'contact_attempt',
        outcome: 'attempted',
        idempotency_key: 'contact-success-attempted',
        contact_method: 'fax',
        contact_name: '家族A',
      },
      notifySuccess,
      closeContactLogDialog,
      invalidateQueries,
    });

    expect(notifySuccess).toHaveBeenCalledWith('架電状況を更新しました');
    expect(closeContactLogDialog).toHaveBeenCalledOnce();
  });
});
