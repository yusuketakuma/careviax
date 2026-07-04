'use client';

import { buildOrgHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { readApiJson } from '@/lib/api/client-json';
import { readJsonObject } from '@/lib/db/json';
import type { WorkflowDashboardResponse } from '@/types/api/workflow-dashboard';

export type WorkflowPhaseKey =
  | 'proposals'
  | 'prescriptions'
  | 'dispensing'
  | 'auditing'
  | 'medication_sets'
  | 'set_audit'
  | 'schedules'
  | 'visits'
  | 'reports';

export type WorkflowPhaseAccessItem = {
  preview_items: Array<{
    id: string;
    patient_name: string;
    href: string;
    label: string;
    sublabel?: string | null;
  }>;
  label: string;
  href: string;
  pending_count: number;
  summary: string;
  tone: 'default' | 'warning' | 'danger';
  next_action: {
    href: string;
    label: string;
  } | null;
};

type WorkflowWorkbenchItem = {
  id: string;
  item_type: string;
  title: string;
  summary: string;
  action_href: string;
  action_label: string;
  patient_name: string | null;
};

type WorkflowPreviewItem = WorkflowPhaseAccessItem['preview_items'][number];

function readFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNumberRecord(value: unknown): Record<string, number> | null {
  const object = readJsonObject(value);
  if (!object) return null;
  const entries = Object.entries(object);
  if (!entries.every((entry): entry is [string, number] => readFiniteNumber(entry[1]) !== null)) {
    return null;
  }
  return Object.fromEntries(entries);
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readRequiredNumberObject<TKey extends string>(
  value: unknown,
  keys: readonly TKey[],
): Record<TKey, number> | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const normalized = {} as Record<TKey, number>;
  for (const key of keys) {
    const numberValue = readFiniteNumber(object[key]);
    if (numberValue === null) return null;
    normalized[key] = numberValue;
  }
  return normalized;
}

function readWorkflowWorkbenchItem(value: unknown): WorkflowWorkbenchItem | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (
    typeof object.id !== 'string' ||
    typeof object.item_type !== 'string' ||
    typeof object.title !== 'string' ||
    typeof object.summary !== 'string' ||
    typeof object.action_href !== 'string' ||
    typeof object.action_label !== 'string' ||
    (typeof object.patient_name !== 'string' && object.patient_name !== null)
  ) {
    return null;
  }

  return {
    id: object.id,
    item_type: object.item_type,
    title: object.title,
    summary: object.summary,
    action_href: object.action_href,
    action_label: object.action_label,
    patient_name: object.patient_name,
  };
}

function normalizeWorkflowWorkbench(value: unknown): WorkflowWorkbenchItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(readWorkflowWorkbenchItem);
  if (items.some((item) => item === null)) return null;
  return items as WorkflowWorkbenchItem[];
}

export function normalizeWorkflowDashboardResponse(
  payload: unknown,
): WorkflowDashboardResponse | null {
  const root = readJsonObject(payload);
  const data = readJsonObject(root?.data);
  if (!data) return null;

  const cycleStatusCounts = readNumberRecord(data.cycle_status_counts);
  const operationsQueue = readRequiredNumberObject(data.operations_queue, [
    'visit_demands',
    'callback_followups',
    'management_plan_reviews',
    'preparation_pending',
    'geocode_reviews',
    'intake_linkages',
    'self_reports_triage',
  ] as const);
  const visitOperations = readRequiredNumberObject(data.visit_operations, [
    'overdue',
    'awaiting_reports',
    'missing_visit_consent',
    'missing_management_plan',
    'missing_first_visit_doc',
    'missing_emergency_contact',
    'missing_primary_physician',
  ] as const);
  const unifiedWorkbench = normalizeWorkflowWorkbench(data.unified_workbench);
  const intakeLinkage = readArray(data.intake_linkage);
  const refillUpcoming = readArray(data.refill_upcoming);

  if (
    !cycleStatusCounts ||
    !operationsQueue ||
    !visitOperations ||
    !unifiedWorkbench ||
    !intakeLinkage ||
    !refillUpcoming
  ) {
    return null;
  }

  return {
    data: {
      ...(data as WorkflowDashboardResponse['data']),
      cycle_status_counts: cycleStatusCounts,
      operations_queue: operationsQueue,
      visit_operations: visitOperations,
      unified_workbench: unifiedWorkbench as WorkflowDashboardResponse['data']['unified_workbench'],
      intake_linkage: intakeLinkage,
      refill_upcoming: refillUpcoming,
    },
  };
}

function previewFromWorkbenchItem(item: WorkflowWorkbenchItem): WorkflowPreviewItem {
  return {
    id: item.id,
    patient_name: item.patient_name ?? '患者未登録',
    href: item.action_href,
    label: item.action_label,
    sublabel: item.summary || item.title,
  };
}

function buildMedicationSetSummary(preparationCount: number, auditCount: number) {
  if (preparationCount > 0 && auditCount > 0) {
    return `セット ${preparationCount}件 / セット監査 ${auditCount}件`;
  }
  if (auditCount > 0) {
    return `セット監査 ${auditCount}件`;
  }
  return `セット ${preparationCount}件`;
}

export function buildWorkflowPhaseAccess(
  payload: WorkflowDashboardResponse['data'],
): Record<WorkflowPhaseKey, WorkflowPhaseAccessItem> {
  const workbench = normalizeWorkflowWorkbench(payload.unified_workbench) ?? [];
  const proposals = workbench.filter((item) => item.item_type === 'proposal');
  const dispensing = workbench.filter((item) => item.action_href.startsWith('/dispense'));
  const auditing = workbench.filter((item) => item.action_href.startsWith('/audit'));
  const medicationSets = workbench.filter(
    (item) => item.action_href.startsWith('/set') && !item.action_href.startsWith('/set-audit'),
  );
  const setAudits = workbench.filter((item) => item.action_href.startsWith('/set-audit'));
  const schedules = workbench.filter((item) => item.action_href.startsWith('/schedules'));
  const visits = workbench.filter(
    (item) => item.item_type === 'visit' || item.action_href.startsWith('/visits'),
  );
  const reports = workbench.filter((item) => item.action_href.startsWith('/reports'));
  const intakeLinkageCount = Array.isArray(payload.intake_linkage)
    ? payload.intake_linkage.length
    : 0;
  const refillUpcomingCount = Array.isArray(payload.refill_upcoming)
    ? payload.refill_upcoming.length
    : 0;
  const prescriptionCount = intakeLinkageCount + refillUpcomingCount;
  const medicationSetPreparationCount = payload.cycle_status_counts.setting ?? 0;
  const medicationSetAuditCount = payload.cycle_status_counts.set_audited ?? 0;
  const medicationSetPendingCount = Math.max(medicationSets.length, medicationSetPreparationCount);
  const setAuditPendingCount = Math.max(setAudits.length, medicationSetAuditCount);
  const schedulePendingCount = Math.max(
    schedules.length,
    payload.operations_queue.visit_demands + payload.operations_queue.intake_linkages,
  );

  const proposalNext = proposals[0];
  const dispensingNext = dispensing[0];
  const auditingNext = auditing[0];
  const medicationSetsNext = medicationSets[0];
  const setAuditsNext = setAudits[0];
  const schedulesNext = schedules[0];
  const visitsNext = visits[0];
  const reportsNext = reports[0];

  return {
    proposals: {
      preview_items: proposalNext ? [previewFromWorkbenchItem(proposalNext)] : [],
      label: '訪問候補',
      href: '/schedules/proposals',
      pending_count: proposals.length,
      summary:
        proposals.length > 0
          ? `未確定候補 ${proposals.length}件`
          : '対応待ちの訪問候補はありません',
      tone: proposals.length > 0 ? 'warning' : 'default',
      next_action: proposalNext
        ? { href: proposalNext.action_href, label: proposalNext.action_label }
        : null,
    },
    prescriptions: {
      preview_items: [],
      label: '処方受付',
      href: '/prescriptions',
      pending_count: prescriptionCount,
      summary:
        prescriptionCount > 0
          ? `導線未作成 ${intakeLinkageCount}件 / 次回調剤近接 ${refillUpcomingCount}件`
          : '処方受付の滞留はありません',
      tone: intakeLinkageCount > 0 ? 'danger' : prescriptionCount > 0 ? 'warning' : 'default',
      next_action:
        prescriptionCount > 0 ? { href: '/prescriptions', label: '処方受付を開く' } : null,
    },
    dispensing: {
      preview_items: dispensingNext ? [previewFromWorkbenchItem(dispensingNext)] : [],
      label: '調剤',
      href: '/dispense',
      pending_count: dispensing.length,
      summary: dispensing.length > 0 ? `調剤待ち ${dispensing.length}件` : '調剤待ちはありません',
      tone: dispensing.length > 0 ? 'warning' : 'default',
      next_action: dispensingNext
        ? { href: dispensingNext.action_href, label: dispensingNext.action_label }
        : null,
    },
    auditing: {
      preview_items: auditingNext ? [previewFromWorkbenchItem(auditingNext)] : [],
      label: '調剤監査',
      href: '/audit',
      pending_count: auditing.length,
      summary: auditing.length > 0 ? `監査待ち ${auditing.length}件` : '監査待ちはありません',
      tone: auditing.length > 0 ? 'warning' : 'default',
      next_action: auditingNext
        ? { href: auditingNext.action_href, label: auditingNext.action_label }
        : null,
    },
    medication_sets: {
      preview_items: medicationSetsNext ? [previewFromWorkbenchItem(medicationSetsNext)] : [],
      label: 'セット',
      href: '/set',
      pending_count: medicationSetPendingCount,
      summary:
        medicationSetPendingCount > 0
          ? buildMedicationSetSummary(medicationSetPreparationCount, 0)
          : 'セット関連の滞留はありません',
      tone: medicationSetPendingCount > 0 ? 'warning' : 'default',
      next_action: medicationSetsNext
        ? { href: medicationSetsNext.action_href, label: medicationSetsNext.action_label }
        : medicationSetPendingCount > 0
          ? {
              href: '/set',
              label: 'セット管理を開く',
            }
          : null,
    },
    set_audit: {
      preview_items: setAuditsNext ? [previewFromWorkbenchItem(setAuditsNext)] : [],
      label: 'セット監査',
      href: '/set-audit',
      pending_count: setAuditPendingCount,
      summary:
        setAuditPendingCount > 0
          ? `セット監査 ${setAuditPendingCount}件`
          : 'セット監査待ちはありません',
      tone: setAuditPendingCount > 0 ? 'warning' : 'default',
      next_action: setAuditsNext
        ? { href: setAuditsNext.action_href, label: setAuditsNext.action_label }
        : setAuditPendingCount > 0
          ? { href: '/set-audit', label: 'セット監査を確認' }
          : null,
    },
    schedules: {
      preview_items: schedulesNext ? [previewFromWorkbenchItem(schedulesNext)] : [],
      label: 'スケジュール登録',
      href: '/schedules',
      pending_count: schedulePendingCount,
      summary:
        schedulePendingCount > 0
          ? `訪問候補・受付導線 ${schedulePendingCount}件`
          : 'スケジュール登録待ちはありません',
      tone: schedulePendingCount > 0 ? 'warning' : 'default',
      next_action: schedulesNext
        ? { href: schedulesNext.action_href, label: schedulesNext.action_label }
        : schedulePendingCount > 0
          ? { href: '/schedules', label: 'スケジュール登録を開く' }
          : null,
    },
    visits: {
      preview_items: visitsNext ? [previewFromWorkbenchItem(visitsNext)] : [],
      label: '訪問時',
      href: '/visits',
      pending_count: visits.length,
      summary: visits.length > 0 ? `訪問時対応 ${visits.length}件` : '訪問時対応の滞留はありません',
      tone:
        payload.visit_operations.overdue > 0 ? 'danger' : visits.length > 0 ? 'warning' : 'default',
      next_action: visitsNext
        ? { href: visitsNext.action_href, label: visitsNext.action_label }
        : null,
    },
    reports: {
      preview_items: reportsNext ? [previewFromWorkbenchItem(reportsNext)] : [],
      label: '報告',
      href: '/reports',
      pending_count: payload.visit_operations.awaiting_reports,
      summary:
        payload.visit_operations.awaiting_reports > 0
          ? `報告待ち ${payload.visit_operations.awaiting_reports}件`
          : '報告待ちはありません',
      tone: payload.visit_operations.awaiting_reports > 0 ? 'warning' : 'default',
      next_action: reportsNext
        ? { href: reportsNext.action_href, label: reportsNext.action_label }
        : payload.visit_operations.awaiting_reports > 0
          ? { href: '/reports', label: '報告待ちを確認' }
          : null,
    },
  };
}

export async function fetchWorkflowDashboardPhaseAccess(
  orgId: string,
): Promise<WorkflowDashboardResponse> {
  const response = await fetch('/api/dashboard/workflow?view=phase', {
    headers: buildOrgHeaders(orgId),
  });
  const payload = normalizeWorkflowDashboardResponse(
    await readApiJson<unknown>(response, '工程ナビゲーションの取得に失敗しました'),
  );
  if (!payload) {
    throw new Error('工程ナビゲーションの取得に失敗しました');
  }
  return payload;
}

export function useWorkflowPhaseAccess() {
  const orgId = useOrgId();

  const query = useRealtimeQuery({
    queryKey: ['dashboard-workflow', orgId],
    queryFn: () => fetchWorkflowDashboardPhaseAccess(orgId),
    enabled: Boolean(orgId),
    staleTime: 30_000,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  return {
    ...query,
    phaseAccess: query.data ? buildWorkflowPhaseAccess(query.data.data) : null,
  };
}
