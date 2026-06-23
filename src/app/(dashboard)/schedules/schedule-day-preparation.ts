import {
  buildHomeVisit2026ReadinessItems,
  type HomeVisit2026EvidenceItem,
} from '@/lib/visits/home-visit-2026-evidence';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import {
  PREPARATION_ITEMS,
  VISIT_TYPE_LABELS,
  type VisitPreparation,
  type VisitPreparationPack,
  type VisitSchedule,
} from './day-view.shared';

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

export type ScheduleDayPreparationDetailsState = ScheduleDayPreparationDetails & {
  loadError: string | null;
  identityError: string | null;
};

export type ScheduleDayPreparationReadinessStatus =
  | 'loading'
  | 'error'
  | 'blocked'
  | 'incomplete'
  | 'ready';

export type ScheduleDayPreparationReadinessViewModel = {
  completedChecklistCount: number;
  incompleteChecklistLabels: string[];
  unresolvedReadinessBlockers: string[];
  onboardingReadinessWarnings: ScheduleDayOnboardingReadinessWarning[];
  onboardingReadinessUnknown: boolean;
  contextBlockerCount: number;
  contextBlockerCategories: string[];
  packStatusError: string | null;
  status: ScheduleDayPreparationReadinessStatus;
  summaryText: string;
  markReadyDisabled: boolean;
};

export type ScheduleDayPreparationClinicalViewModel = {
  visitTypeLabel: string;
  requiredItems: HomeVisit2026EvidenceItem[];
  requiredOpenItems: HomeVisit2026EvidenceItem[];
};

type ScheduleDayOnboardingReadiness = NonNullable<VisitPreparationPack['onboarding_readiness']>;

export type ScheduleDayOnboardingReadinessWarning = {
  key: keyof ScheduleDayOnboardingReadiness;
  label: string;
  variant: 'destructive' | 'outline';
};

export const PREPARATION_ITEM_DESCRIPTIONS: Record<(typeof PREPARATION_ITEMS)[number][0], string> =
  {
    medication_changes_reviewed: '処方差分、薬歴、前回からの用法・薬剤変更を確認します。',
    carry_items_confirmed: '持参薬、物品、未確定の持参物が残っていないか確認します。',
    previous_issues_reviewed: '前回訪問の課題、SOAP plan、未処理タスクを訪問前に確認します。',
    route_confirmed: '訪問先住所、施設集約、移動ルート、受入時間帯を確認します。',
    offline_synced: '訪問先で参照する記録が端末に同期済みか確認します。',
  };

export const PREPARATION_PACK_MISSING_MESSAGE =
  '最新の訪問準備情報を取得できないため ready にできません。';
export const PREPARATION_PACK_MISMATCH_MESSAGE =
  '取得した訪問準備情報が現在の患者・訪問予定と一致しません。';

const ONBOARDING_READINESS_ITEMS = [
  {
    key: 'consent_obtained',
    label: '同意未取得',
    variant: 'destructive',
  },
  {
    key: 'first_visit_doc_delivered',
    label: '初回文書未交付',
    variant: 'outline',
  },
  {
    key: 'emergency_contact_set',
    label: '緊急連絡先未登録',
    variant: 'outline',
  },
  {
    key: 'management_plan_approved',
    label: '管理計画未承認',
    variant: 'outline',
  },
  {
    key: 'primary_physician_set',
    label: '主治医未設定',
    variant: 'outline',
  },
] as const satisfies readonly ScheduleDayOnboardingReadinessWarning[];

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

export function getScheduleDayOnboardingReadinessWarnings(
  readiness: ScheduleDayOnboardingReadiness,
) {
  return ONBOARDING_READINESS_ITEMS.filter((item) => !readiness[item.key]);
}

export function getPreparationPackIdentityError(
  schedule: VisitSchedule,
  pack: VisitPreparationPack | null,
) {
  if (!pack) return null;
  if (pack.visit.id !== schedule.id || pack.patient.id !== schedule.case_.patient.id) {
    return PREPARATION_PACK_MISMATCH_MESSAGE;
  }
  return null;
}

function isPreparationChecklistBlockerResolved(blocker: string, form: ScheduleDayPreparationForm) {
  const preparationItem = PREPARATION_ITEMS.find(([, label]) => label === blocker);
  return preparationItem ? form[preparationItem[0]] : false;
}

export function buildScheduleDayPreparationReadiness({
  form,
  pack,
  loadError,
  identityError,
  loading,
  hasTarget,
  saving,
}: {
  form: ScheduleDayPreparationForm;
  pack: VisitPreparationPack | null;
  loadError: string | null;
  identityError: string | null;
  loading: boolean;
  hasTarget: boolean;
  saving: boolean;
}): ScheduleDayPreparationReadinessViewModel {
  const completedChecklistCount = PREPARATION_ITEMS.filter(([field]) => form[field]).length;
  const incompleteChecklistLabels = PREPARATION_ITEMS.filter(([field]) => !form[field]).map(
    ([, label]) => label,
  );
  const onboardingReadinessWarnings = pack?.onboarding_readiness
    ? getScheduleDayOnboardingReadinessWarnings(pack.onboarding_readiness)
    : [];
  const onboardingReadinessUnknown = Boolean(pack && pack.onboarding_readiness === null);
  const unresolvedReadinessBlockers =
    pack?.readiness_blockers.filter(
      (blocker) => !isPreparationChecklistBlockerResolved(blocker, form),
    ) ?? [];
  const contextBlockerCount =
    unresolvedReadinessBlockers.length +
    onboardingReadinessWarnings.length +
    (onboardingReadinessUnknown ? 1 : 0) +
    (pack?.billing_blockers.length ?? 0);
  const contextBlockerCategories = [
    unresolvedReadinessBlockers.length > 0
      ? `訪問前提 ${unresolvedReadinessBlockers.length}件`
      : null,
    onboardingReadinessUnknown ? '導入準備 不明' : null,
    onboardingReadinessWarnings.length > 0
      ? `導入準備 ${onboardingReadinessWarnings.length}件`
      : null,
    pack && pack.billing_blockers.length > 0 ? `算定確認 ${pack.billing_blockers.length}件` : null,
  ].filter((category): category is string => category !== null);
  const packStatusError =
    loadError ??
    identityError ??
    (!loading && hasTarget && !pack ? PREPARATION_PACK_MISSING_MESSAGE : null);
  const status: ScheduleDayPreparationReadinessStatus = loading
    ? 'loading'
    : packStatusError
      ? 'error'
      : contextBlockerCount > 0
        ? 'blocked'
        : incompleteChecklistLabels.length > 0
          ? 'incomplete'
          : 'ready';
  const summaryText =
    status === 'loading'
      ? '最新の訪問準備情報を読み込み中です。'
      : status === 'error'
        ? (packStatusError ?? PREPARATION_PACK_MISSING_MESSAGE)
        : status === 'blocked'
          ? '出発前に解決が必要な項目があります。'
          : status === 'incomplete'
            ? '出発前チェックリストに未完了項目があります。'
            : 'ready に進める状態です。';

  return {
    completedChecklistCount,
    incompleteChecklistLabels,
    unresolvedReadinessBlockers,
    onboardingReadinessWarnings,
    onboardingReadinessUnknown,
    contextBlockerCount,
    contextBlockerCategories,
    packStatusError,
    status,
    summaryText,
    markReadyDisabled:
      saving ||
      loading ||
      Boolean(packStatusError) ||
      incompleteChecklistLabels.length > 0 ||
      contextBlockerCount > 0,
  };
}

export function buildScheduleDayPreparationClinicalViewModel(
  pack: VisitPreparationPack,
): ScheduleDayPreparationClinicalViewModel {
  const requiredItems = buildHomeVisit2026ReadinessItems({
    structuredSoap: null,
    visitType: pack.visit.visit_type,
    billingBlockers: pack.billing_blockers,
    intakeInitialTransitionExpected: pack.intake_context.initial_transition_management_expected,
  }).filter((item) => item.required);

  return {
    visitTypeLabel: VISIT_TYPE_LABELS[pack.visit.visit_type],
    requiredItems,
    requiredOpenItems: requiredItems.filter((item) => !item.done),
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
  const res = await fetchImpl(`/api/visit-preparations/${encodePathSegment(scheduleId)}`, {
    headers: buildOrgHeaders(orgId),
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
  const preparationRes = await fetchImpl(
    `/api/visit-preparations/${encodePathSegment(request.scheduleId)}`,
    {
      method: 'PUT',
      headers: buildOrgJsonHeaders(orgId),
      body: JSON.stringify({
        checklist: request.form,
        ...request.form,
        mark_ready: request.markReady,
      }),
    },
  );

  if (!preparationRes.ok) {
    const error = (await preparationRes.json().catch(() => ({}))) as { message?: string };
    throw new Error(error.message ?? '訪問準備の保存に失敗しました');
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
    invalidateQueries({ queryKey: ['schedule-day-board', orgId] }),
    invalidateQueries({ queryKey: ['schedule-rail-cockpit', orgId] }),
    invalidateQueries({ queryKey: ['visits', 'today-preparation', orgId] }),
    invalidateQueries({ queryKey: ['tasks', orgId] }),
  ]);
}
