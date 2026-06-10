import type { VisitPreparation, VisitPreparationPack } from './day-view.shared';

type FetchLike = typeof fetch;

type QueryInvalidator = (filters: { queryKey: readonly unknown[] }) => Promise<unknown> | unknown;

export type ScheduleDayPreparationForm = {
  medication_changes_reviewed: boolean;
  carry_items_confirmed: boolean;
  previous_issues_reviewed: boolean;
  route_confirmed: boolean;
  offline_synced: boolean;
};

export type ScheduleDayPreparationDetails = {
  preparation: VisitPreparation | null;
  pack: VisitPreparationPack | null;
};

export type SaveScheduleDayPreparationRequest = {
  scheduleId: string;
  form: ScheduleDayPreparationForm;
  markReady: boolean;
};

export function buildScheduleDayPreparationForm(
  preparation: VisitPreparation | null,
): ScheduleDayPreparationForm {
  return {
    medication_changes_reviewed: preparation?.medication_changes_reviewed ?? false,
    carry_items_confirmed: preparation?.carry_items_confirmed ?? false,
    previous_issues_reviewed: preparation?.previous_issues_reviewed ?? false,
    route_confirmed: preparation?.route_confirmed ?? false,
    offline_synced: preparation?.offline_synced ?? false,
  };
}

export async function fetchScheduleDayPreparationDetails({
  orgId,
  scheduleId,
  fetchImpl = fetch,
}: {
  orgId: string;
  scheduleId: string;
  fetchImpl?: FetchLike;
}) {
  const res = await fetchImpl(`/api/visit-preparations/${scheduleId}`, {
    headers: { 'x-org-id': orgId },
  });

  if (!res.ok) {
    throw new Error('訪問準備情報の取得に失敗しました');
  }

  const payload = (await res.json()) as {
    data: ScheduleDayPreparationDetails;
  };
  return payload.data;
}

export async function saveScheduleDayPreparation({
  orgId,
  request,
  fetchImpl = fetch,
}: {
  orgId: string;
  request: SaveScheduleDayPreparationRequest;
  fetchImpl?: FetchLike;
}) {
  const preparationRes = await fetchImpl(`/api/visit-preparations/${request.scheduleId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': orgId,
    },
    body: JSON.stringify({
      checklist: request.form,
      ...request.form,
    }),
  });

  if (!preparationRes.ok) {
    const error = (await preparationRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message ?? '訪問準備の保存に失敗しました');
  }

  if (request.markReady) {
    const readyRes = await fetchImpl(`/api/visit-schedules/${request.scheduleId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({
        schedule_status: 'ready',
      }),
    });
    if (!readyRes.ok) {
      const error = (await readyRes.json().catch(() => ({}))) as { message?: string };
      throw new Error(error.message ?? '訪問予定を ready に更新できませんでした');
    }
  }

  return preparationRes.json();
}

export async function handleScheduleDayPreparationSuccess({
  orgId,
  markReady,
  notifySuccess,
  closeDialog,
  invalidateQueries,
}: {
  orgId: string;
  markReady: boolean;
  notifySuccess: (message: string) => void;
  closeDialog: () => void;
  invalidateQueries: QueryInvalidator;
}) {
  notifySuccess(markReady ? '訪問準備を保存し、ready へ進めました' : '訪問準備を保存しました');
  closeDialog();
  await Promise.all([
    invalidateQueries({ queryKey: ['visit-schedules', 'week-board', orgId] }),
    invalidateQueries({ queryKey: ['tasks', orgId] }),
  ]);
}
