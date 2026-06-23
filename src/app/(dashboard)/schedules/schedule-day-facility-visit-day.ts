import { buildOrgJsonHeaders } from '@/lib/api/org-headers';

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export type ScheduleDayFacilityVisitDayTarget = {
  label: string;
  scheduleIds: string[];
};

export type ScheduleDayFacilityVisitDayForm = {
  preferred_weekdays: number[];
  preferred_time_from: string;
  preferred_time_to: string;
  facility_time_from: string;
  facility_time_to: string;
  visit_buffer_minutes: string;
  notes: string;
};

export type ScheduleDayFacilityVisitDayPayload = {
  facility_label: string;
  schedule_ids: string[];
  preferred_weekdays: number[];
  preferred_time_from: string | null;
  preferred_time_to: string | null;
  facility_time_from: string | null;
  facility_time_to: string | null;
  visit_buffer_minutes: number | null;
  notes: string | null;
};

export function buildScheduleDayFacilityVisitDayPayload({
  target,
  form,
}: {
  target: ScheduleDayFacilityVisitDayTarget;
  form: ScheduleDayFacilityVisitDayForm;
}): ScheduleDayFacilityVisitDayPayload {
  return {
    facility_label: target.label,
    schedule_ids: target.scheduleIds,
    preferred_weekdays: form.preferred_weekdays,
    preferred_time_from: form.preferred_time_from || null,
    preferred_time_to: form.preferred_time_to || null,
    facility_time_from: form.facility_time_from || null,
    facility_time_to: form.facility_time_to || null,
    visit_buffer_minutes: form.visit_buffer_minutes ? Number(form.visit_buffer_minutes) : null,
    notes: form.notes || null,
  };
}

export async function saveScheduleDayFacilityVisitDay({
  orgId,
  target,
  form,
  fetchImpl = fetch,
}: {
  orgId: string;
  target: ScheduleDayFacilityVisitDayTarget | null;
  form: ScheduleDayFacilityVisitDayForm;
  fetchImpl?: FetchLike;
}) {
  if (!target) {
    throw new Error('訪問先グループが選択されていません');
  }

  const res = await fetchImpl('/api/facility-visit-batches/visit-days', {
    method: 'POST',
    headers: buildOrgJsonHeaders(orgId),
    body: JSON.stringify(
      buildScheduleDayFacilityVisitDayPayload({
        target,
        form,
      }),
    ),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      typeof error.message === 'string'
        ? error.message
        : '訪問先グループの定期訪問日の保存に失敗しました',
    );
  }

  return res.json();
}

export async function handleScheduleDayFacilityVisitDaySuccess({
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
  notifySuccess('訪問先グループの定期訪問日を保存しました');
  closeDialog();
  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
    invalidateQueries({ queryKey: ['visit-schedule-proposals', orgId] }),
  ]);
}
