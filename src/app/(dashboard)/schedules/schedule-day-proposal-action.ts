import { format, parseISO } from 'date-fns';
import type { PatientContactStatus, Proposal } from './day-view.shared';

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export type ScheduleDayContactLogForm = {
  outcome: Extract<
    PatientContactStatus,
    'attempted' | 'declined' | 'change_requested' | 'unreachable' | 'confirmed'
  >;
  contact_method: 'phone' | 'fax' | 'email';
  contact_name: string;
  contact_phone: string;
  note: string;
  callback_due_at: string;
};

export type ScheduleDayProposalActionPayload =
  | { action: 'approve' }
  | { action: 'confirm' }
  | { action: 'reject' }
  | {
      action: 'contact_attempt';
      outcome: Extract<
        PatientContactStatus,
        'attempted' | 'declined' | 'change_requested' | 'unreachable' | 'confirmed'
      >;
      contact_method: 'phone' | 'fax' | 'email';
      contact_name?: string;
      contact_phone?: string;
      note?: string;
      callback_due_at?: string;
    };

export type ScheduleDayProposalActionRequest = {
  id: string;
  payload: ScheduleDayProposalActionPayload;
};

export type ScheduleDayContactLogDialogState<
  TProposal extends Pick<Proposal, 'patient_contact_status' | 'contact_logs'> = Proposal,
> = {
  target: TProposal | null;
  form: ScheduleDayContactLogForm;
};

export function getDefaultScheduleDayContactLogForm(): ScheduleDayContactLogForm {
  return {
    outcome: 'attempted',
    contact_method: 'phone',
    contact_name: '',
    contact_phone: '',
    note: '',
    callback_due_at: '',
  };
}

function resolveScheduleDayContactLogOutcome(
  status: PatientContactStatus,
): ScheduleDayContactLogForm['outcome'] {
  if (
    status === 'confirmed' ||
    status === 'declined' ||
    status === 'change_requested' ||
    status === 'unreachable'
  ) {
    return status;
  }
  return 'attempted';
}

export function buildScheduleDayContactLogForm(
  proposal: Pick<Proposal, 'patient_contact_status' | 'contact_logs'>,
): ScheduleDayContactLogForm {
  const latestLog = proposal.contact_logs[0] ?? null;
  return {
    outcome: resolveScheduleDayContactLogOutcome(proposal.patient_contact_status),
    contact_method:
      latestLog?.contact_method === 'fax' || latestLog?.contact_method === 'email'
        ? latestLog.contact_method
        : 'phone',
    contact_name: latestLog?.contact_name ?? '',
    contact_phone: latestLog?.contact_phone ?? '',
    note: '',
    callback_due_at: latestLog?.callback_due_at
      ? format(parseISO(latestLog.callback_due_at), "yyyy-MM-dd'T'HH:mm")
      : '',
  };
}

export function openScheduleDayContactLogDialog<
  TProposal extends Pick<Proposal, 'patient_contact_status' | 'contact_logs'>,
>(proposal: TProposal): ScheduleDayContactLogDialogState<TProposal> {
  return {
    target: proposal,
    form: buildScheduleDayContactLogForm(proposal),
  };
}

export function closeScheduleDayContactLogDialog(): ScheduleDayContactLogDialogState {
  return {
    target: null,
    form: getDefaultScheduleDayContactLogForm(),
  };
}

export function buildScheduleDayContactAttemptRequest({
  proposalId,
  form,
}: {
  proposalId: string;
  form: ScheduleDayContactLogForm;
}): ScheduleDayProposalActionRequest {
  return {
    id: proposalId,
    payload: {
      action: 'contact_attempt',
      outcome: form.outcome,
      contact_method: form.contact_method,
      contact_name: form.contact_name || undefined,
      contact_phone: form.contact_phone || undefined,
      note: form.note || undefined,
      callback_due_at: form.callback_due_at
        ? new Date(form.callback_due_at).toISOString()
        : undefined,
    },
  };
}

export async function updateScheduleDayProposalAction({
  orgId,
  request,
  fetchImpl = fetch,
}: {
  orgId: string;
  request: ScheduleDayProposalActionRequest;
  fetchImpl?: FetchLike;
}) {
  const res = await fetchImpl(`/api/visit-schedule-proposals/${request.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify(request.payload),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(typeof error.message === 'string' ? error.message : '候補更新に失敗しました');
  }

  return res.json();
}

export function getScheduleDayProposalActionSuccessMessage(
  payload: ScheduleDayProposalActionPayload,
) {
  if (payload.action === 'approve') {
    return '候補を承認して架電待ちへ移しました';
  }
  if (payload.action === 'confirm') {
    return '電話確認が完了し、訪問予定を確定しました';
  }
  if (payload.action === 'reject') {
    return '候補を却下しました';
  }
  if (payload.outcome === 'change_requested') {
    return '変更希望として記録しました';
  }
  if (payload.outcome === 'declined') {
    return '患者辞退として記録しました';
  }
  if (payload.outcome === 'unreachable') {
    return '不通として記録しました';
  }
  if (payload.outcome === 'confirmed') {
    return '患者確認済みとして記録しました';
  }
  return '架電状況を更新しました';
}

export async function handleScheduleDayProposalActionSuccess({
  orgId,
  payload,
  notifySuccess,
  closeContactLogDialog,
  invalidateQueries,
}: {
  orgId: string;
  payload: ScheduleDayProposalActionPayload;
  notifySuccess: (message: string) => void;
  closeContactLogDialog: () => void;
  invalidateQueries: QueryInvalidator;
}) {
  notifySuccess(getScheduleDayProposalActionSuccessMessage(payload));
  if (payload.action === 'contact_attempt') {
    closeContactLogDialog();
  }

  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
    invalidateQueries({ queryKey: ['tasks', 'schedule-board', orgId] }),
    invalidateQueries({
      queryKey: ['tasks', 'visit-contact-followup', orgId],
    }),
  ]);
}
