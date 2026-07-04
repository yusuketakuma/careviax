'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { readApiJson } from '@/lib/api/client-json';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { messageFromError } from '@/lib/utils/error-message';
import type { HomeLinkContext, WorkflowFocus } from '@/lib/dashboard/home-link-builders';
import { getInquiryStructuredMetaFromLegacy } from '@/lib/inquiries/presentation';
import type {
  InquiryEditState,
  InquiryWorkbenchItem,
  WorkflowData,
} from './workflow-dashboard.types';
import { WorkflowDashboardView } from './workflow-dashboard-view';

function buildInquiryEditState(item: InquiryWorkbenchItem): InquiryEditState {
  const detail = item.change_detail ?? '';
  const structuredMeta = getInquiryStructuredMetaFromLegacy({
    proposalOrigin: item.proposal_origin,
    residualAdjustment: item.residual_adjustment,
    reason: item.reason,
    changeDetail: detail,
  });
  return {
    changeDetail: detail,
    drugName: item.line?.drug_name ?? '',
    dose: item.line?.dose ?? '',
    frequency: item.line?.frequency ?? '',
    days: item.line ? String(item.line.days) : '',
    proposalOrigin: structuredMeta.proposalOrigin,
    residualAdjustment: structuredMeta.residualAdjustment,
  };
}

function buildInquiryResolutionDetail(args: {
  result: 'changed' | 'unchanged' | 'pending';
  changeDetail?: string;
}) {
  return (
    args.changeDetail?.trim() ||
    (args.result === 'changed'
      ? 'workflow から処方反映ありで確定'
      : args.result === 'unchanged'
        ? 'workflow から変更なしで確定'
        : 'workflow から回答待ちへ更新')
  );
}

type WorkflowDashboardContentProps = {
  initialFocus?: WorkflowFocus;
  initialContext?: HomeLinkContext | null;
};

export function WorkflowDashboardContent({
  initialFocus,
  initialContext,
}: WorkflowDashboardContentProps = {}) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [inquiryEdits, setInquiryEdits] = useState<Record<string, InquiryEditState>>({});

  const { data, isLoading, isError, refetch } = useRealtimeQuery({
    queryKey: ['dashboard-workflow', orgId],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/workflow', {
        headers: buildOrgHeaders(orgId),
      });
      return readApiJson<{ data: WorkflowData }>(res, 'ダッシュボードの取得に失敗しました');
    },
    enabled: !!orgId,
    fallbackRefetchInterval: 60_000,
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const workflow = data?.data;

  const createEmergencyDraftMutation = useMutation({
    mutationFn: async (draft: WorkflowData['communication_queue']['emergency_drafts'][number]) => {
      const res = await fetch('/api/communication-requests', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: draft.patient_id,
          request_type: draft.request_type,
          template_key: draft.template_key,
          recipient_name: draft.target_name ?? draft.target_role,
          recipient_role: draft.target_role,
          related_entity_type: 'patient',
          related_entity_id: draft.patient_id,
          context_snapshot: {
            source: 'communication_queue',
            template_key: draft.template_key,
          },
          status: 'draft',
          subject: draft.subject,
          content: draft.content,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '緊急連絡ドラフトの起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('緊急連絡ドラフトを起票しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '緊急連絡ドラフトの起票に失敗しました'));
    },
  });

  const createInquiryMutation = useMutation({
    mutationFn: async (item: WorkflowData['inquiry_workbench'][number]) => {
      if (!item.cycle_id || !item.issue_id) {
        throw new Error('有効なサイクルがないため疑義照会を起票できません');
      }
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      const res = await fetch('/api/inquiry-records', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          cycle_id: item.cycle_id,
          issue_id: item.issue_id,
          reason: item.reason,
          inquiry_to_physician: item.inquiry_to_physician,
          inquiry_content: item.summary,
          inquired_at: new Date().toISOString(),
          request_due_date: format(dueDate, 'yyyy-MM-dd'),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '疑義照会の起票に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('疑義照会を起票しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '疑義照会の起票に失敗しました'));
    },
  });

  const resolveInquiryMutation = useMutation({
    mutationFn: async ({
      inquiryId,
      result,
      changeDetail,
      proposalOrigin,
      residualAdjustment,
      lineUpdate,
    }: {
      inquiryId: string;
      result: 'changed' | 'unchanged' | 'pending';
      changeDetail?: string;
      proposalOrigin?: InquiryEditState['proposalOrigin'];
      residualAdjustment?: boolean;
      lineUpdate?: {
        drug_name: string;
        dose: string;
        frequency: string;
        days: number;
      };
    }) => {
      const res = await fetch(`/api/inquiry-records/${inquiryId}`, {
        method: 'PATCH',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          result,
          change_detail:
            changeDetail ??
            (result === 'changed'
              ? 'workflow から処方反映ありで確定'
              : result === 'unchanged'
                ? 'workflow から変更なしで確定'
                : 'workflow から回答待ちへ更新'),
          proposal_origin: proposalOrigin,
          residual_adjustment: residualAdjustment,
          ...(lineUpdate ? { line_update: lineUpdate } : {}),
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '疑義照会の更新に失敗しました');
      }
      return res.json();
    },
    onSuccess: async (_data, variables) => {
      setInquiryEdits((prev) => {
        const next = { ...prev };
        delete next[variables.inquiryId];
        return next;
      });
      toast.success('疑義照会を更新しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
      await queryClient.invalidateQueries({ queryKey: ['communication-requests', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '疑義照会の更新に失敗しました'));
    },
  });

  const getInquiryEditState = (item: InquiryWorkbenchItem) => {
    if (!item.inquiry_id) return buildInquiryEditState(item);
    return inquiryEdits[item.inquiry_id] ?? buildInquiryEditState(item);
  };

  const updateInquiryEditState = (item: InquiryWorkbenchItem, patch: Partial<InquiryEditState>) => {
    if (!item.inquiry_id) return;
    const inquiryId = item.inquiry_id;
    setInquiryEdits((prev) => ({
      ...prev,
      [inquiryId]: {
        ...(prev[inquiryId] ?? buildInquiryEditState(item)),
        ...patch,
      },
    }));
  };

  const generateRefillProposalMutation = useMutation({
    mutationFn: async (item: WorkflowData['refill_upcoming'][number]) => {
      if (!item.case_id) {
        throw new Error('ケースIDがないため再訪候補を作成できません');
      }
      const startDate =
        item.suggested_start_date ??
        item.next_dispense_date ??
        item.refill_next_dispense_date ??
        item.split_next_dispense_date ??
        item.prescribed_date;
      const res = await fetch('/api/visit-schedule-proposals', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          case_id: item.case_id,
          visit_type: 'regular',
          priority: 'normal',
          start_date: startDate.slice(0, 10),
          candidate_count: 3,
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message ?? '再訪候補の生成に失敗しました');
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success('リフィル再訪候補を生成しました');
      await queryClient.invalidateQueries({ queryKey: ['dashboard-workflow', orgId] });
    },
    onError: (error) => {
      toast.error(messageFromError(error, '再訪候補の生成に失敗しました'));
    },
  });

  return (
    <WorkflowDashboardView
      workflow={workflow}
      isLoading={isLoading}
      isError={isError && !workflow}
      refetch={refetch}
      initialFocus={initialFocus}
      initialContext={initialContext}
      getInquiryEditState={getInquiryEditState}
      updateInquiryEditState={updateInquiryEditState}
      buildInquiryResolutionDetail={buildInquiryResolutionDetail}
      createEmergencyDraftMutation={createEmergencyDraftMutation}
      createInquiryMutation={createInquiryMutation}
      resolveInquiryMutation={resolveInquiryMutation}
      generateRefillProposalMutation={generateRefillProposalMutation}
    />
  );
}
