'use client';

import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import type { WorkflowDashboardResponse } from '@/types/api/workflow-dashboard';

export type WorkflowPhaseKey =
  | 'proposals'
  | 'prescriptions'
  | 'dispensing'
  | 'auditing'
  | 'medication_sets'
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

function previewFromWorkbenchItem(item: WorkflowWorkbenchItem): WorkflowPreviewItem {
  return {
    id: item.id,
    patient_name: item.patient_name ?? '患者未登録',
    href: item.action_href,
    label: item.action_label,
    sublabel: item.summary || item.title,
  };
}

function buildWorkflowPhaseAccess(
  payload: WorkflowDashboardResponse['data']
): Record<WorkflowPhaseKey, WorkflowPhaseAccessItem> {
  const workbench = (payload.unified_workbench ?? []) as WorkflowWorkbenchItem[];
  const proposals = workbench.filter((item) => item.item_type === 'proposal');
  const dispensing = workbench.filter((item) => item.action_href.startsWith('/dispensing'));
  const auditing = workbench.filter((item) => item.action_href.startsWith('/auditing'));
  const medicationSets = workbench.filter((item) => item.action_href.startsWith('/medication-sets'));
  const visits = workbench.filter(
    (item) =>
      item.item_type === 'visit' ||
      item.action_href.startsWith('/schedules') ||
      item.action_href.startsWith('/visits')
  );
  const reports = workbench.filter((item) => item.action_href.startsWith('/reports'));
  const intakeLinkageCount = Array.isArray(payload.intake_linkage) ? payload.intake_linkage.length : 0;
  const refillUpcomingCount = Array.isArray(payload.refill_upcoming)
    ? payload.refill_upcoming.length
    : 0;
  const prescriptionCount = intakeLinkageCount + refillUpcomingCount;

  const proposalNext = proposals[0];
  const dispensingNext = dispensing[0];
  const auditingNext = auditing[0];
  const medicationSetsNext = medicationSets[0];
  const visitsNext = visits[0];
  const reportsNext = reports[0];

  return {
    proposals: {
      preview_items: proposalNext ? [previewFromWorkbenchItem(proposalNext)] : [],
      label: '訪問候補',
      href: '/schedules/proposals',
      pending_count: proposals.length,
      summary:
        proposals.length > 0 ? `未確定候補 ${proposals.length}件` : '対応待ちの訪問候補はありません',
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
        prescriptionCount > 0
          ? { href: '/prescriptions', label: '処方受付を開く' }
          : null,
    },
    dispensing: {
      preview_items: dispensingNext ? [previewFromWorkbenchItem(dispensingNext)] : [],
      label: '調剤',
      href: '/dispensing',
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
      href: '/auditing',
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
      href: '/medication-sets',
      pending_count: medicationSets.length,
      summary:
        medicationSets.length > 0
          ? `セット関連 ${medicationSets.length}件`
          : 'セット関連の滞留はありません',
      tone: medicationSets.length > 0 ? 'warning' : 'default',
      next_action: medicationSetsNext
        ? { href: medicationSetsNext.action_href, label: medicationSetsNext.action_label }
        : null,
    },
    visits: {
      preview_items: visitsNext ? [previewFromWorkbenchItem(visitsNext)] : [],
      label: '訪問管理',
      href: '/schedules',
      pending_count: visits.length,
      summary: visits.length > 0 ? `訪問関連 ${visits.length}件` : '訪問関連の滞留はありません',
      tone: payload.visit_operations.overdue > 0 ? 'danger' : visits.length > 0 ? 'warning' : 'default',
      next_action: visitsNext ? { href: visitsNext.action_href, label: visitsNext.action_label } : null,
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

export function useWorkflowPhaseAccess() {
  const orgId = useOrgId();

  const query = useRealtimeQuery({
    queryKey: ['dashboard-workflow', orgId],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/workflow', {
        headers: { 'x-org-id': orgId },
      });
      if (!response.ok) {
        throw new Error('工程ナビゲーションの取得に失敗しました');
      }
      return response.json() as Promise<WorkflowDashboardResponse>;
    },
    enabled: Boolean(orgId),
    staleTime: 30_000,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  return {
    ...query,
    phaseAccess: query.data ? buildWorkflowPhaseAccess(query.data.data) : null,
  };
}
