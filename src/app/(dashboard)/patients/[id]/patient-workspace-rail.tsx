'use client';

import { useRouter } from 'next/navigation';
import {
  WorkspaceActionRail,
  type BlockedReason,
  type EvidenceItem,
} from '@/components/features/workspace/action-rail';
import { getCycleWorkspaceAction } from '@/lib/prescription/cycle-workspace';
import type { PatientWorkspace } from './patient-detail.types';
import type { VisitBrief, VisitBriefSeverity } from '@/types/visit-brief';

/**
 * p0_08「カードを開いた画面」の右レール(3 点セットの基準実装)。
 * 「次にやること」は進行中サイクルの工程(workspace)駆動。
 * 「止まっている理由」は WorkflowException + visit-brief の未解決項目。
 * 「根拠・記録」は処方せん画像・前回訪問メモ・お薬手帳画像・検査値メモ。
 */

type PatientWorkspaceRailProps = {
  patientId: string;
  brief: VisitBrief | null;
  workspace: PatientWorkspace | null;
  onNavigateTab: (tab: string) => void;
  className?: string;
};

function toBlockedSeverity(severity: VisitBriefSeverity): BlockedReason['severity'] {
  return severity === 'urgent' || severity === 'high' ? 'critical' : 'warning';
}

export function PatientWorkspaceRail({
  patientId,
  brief,
  workspace,
  onNavigateTab,
  className,
}: PatientWorkspaceRailProps) {
  const router = useRouter();

  const cycleAction = workspace ? getCycleWorkspaceAction(workspace.overall_status) : null;
  const unresolved = brief?.unresolved_items ?? [];
  const primaryUnresolved = unresolved[0] ?? null;

  const nextAction = cycleAction
    ? {
        description: cycleAction.description,
        actionLabel: cycleAction.actionLabel,
        onAction: () => router.push(cycleAction.actionHref),
      }
    : primaryUnresolved
      ? {
          description: primaryUnresolved.summary,
          actionLabel: '対応を開く',
          onAction: () => router.push(primaryUnresolved.href),
        }
      : {
          description: '進行中の工程はありません。',
          actionLabel: '服薬状況を確認',
          onAction: () => onNavigateTab('medications'),
        };

  const blockedReasons: BlockedReason[] = [
    ...(workspace?.open_exceptions ?? []).map((exception) => ({
      id: exception.id,
      label: exception.description,
      severity: exception.severity,
    })),
    ...unresolved.map((item, index) => ({
      id: `${item.source_type}-${index}`,
      label: item.title,
      severity: toBlockedSeverity(item.severity),
    })),
  ];

  const evidence: EvidenceItem[] = [
    workspace?.prescription_document_url
      ? {
          id: 'prescription-image',
          label: '処方せん画像',
          href: workspace.prescription_document_url,
        }
      : {
          id: 'prescription-image',
          label: '処方せん画像',
          onView: () => onNavigateTab('prescriptions'),
        },
    {
      id: 'previous-visit-memo',
      label: '前回訪問メモ',
      onView: () => onNavigateTab('visits'),
    },
    {
      id: 'medication-notebook',
      label: 'お薬手帳画像',
      onView: () => onNavigateTab('medications'),
    },
    {
      id: 'lab-memo',
      label: '検査値メモ',
      onView: () => router.push(`/patients/${patientId}?tab=basic`),
    },
  ];

  return (
    <WorkspaceActionRail
      className={className}
      nextAction={nextAction}
      blockedReasons={blockedReasons}
      blockedReasonsEmptyLabel="止まっている作業はありません"
      evidence={evidence}
    />
  );
}
