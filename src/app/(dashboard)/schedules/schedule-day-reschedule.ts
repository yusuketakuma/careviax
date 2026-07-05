import { readApiJson } from '@/lib/api/client-json';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import type { VisitPriority } from './day-view.shared';

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export type ScheduleDayRescheduleTarget = {
  id: string;
};

export type ScheduleDayRescheduleForm = {
  reason: string;
  reason_code:
    | 'emergency_insert'
    | 'pharmacist_unavailable'
    | 'patient_request'
    | 'facility_request'
    | 'weather'
    | 'other';
  communication_channel: 'phone' | 'fax' | 'email' | 'collaboration' | 'in_person';
  communication_result: 'pending' | 'sent' | 'verbal_notified';
  start_date: string;
  priority: VisitPriority;
};

export async function generateScheduleDayRescheduleProposals({
  orgId,
  target,
  form,
  fetchImpl = fetch,
}: {
  orgId: string;
  target: ScheduleDayRescheduleTarget | null;
  form: ScheduleDayRescheduleForm;
  fetchImpl?: FetchLike;
}) {
  if (!target) {
    throw new Error('リスケ対象が選択されていません');
  }

  const res = await fetchImpl(`/api/visit-schedules/${encodePathSegment(target.id)}/reschedule`, {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify(form),
  });

  return readApiJson<unknown>(res, 'リスケ候補の生成に失敗しました');
}

export async function handleScheduleDayRescheduleSuccess({
  orgId,
  notifySuccess,
  closeDialog,
  invalidateQueries,
}: {
  orgId: string;
  notifySuccess: (message: string) => void;
  closeDialog: () => void;
  invalidateQueries: QueryInvalidator;
}) {
  notifySuccess('リスケ候補を生成しました');
  closeDialog();
  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
  ]);
}
