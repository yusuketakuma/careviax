import { isUnresolvedUatBlocker } from '@/lib/uat-feedback';

type PilotReadinessCase = {
  id: string;
  status: string;
  required_visit_support: unknown;
  patient: {
    id: string;
    name: string;
    residences: Array<{
      facility_id: string | null;
    }>;
  };
};

type PilotReadinessFeedback = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  status: string;
  feedback: string;
  checklist_progress: string | null;
  source: string | null;
  created_at: Date;
};

export type PilotReadinessSnapshot = {
  generated_at: string;
  case_summary: {
    active_case_count: number;
    facility_linked_case_count: number;
    non_facility_case_count: number;
    facility_count: number;
    set_pilot_case_count: number;
    set_pilot_without_facility_count: number;
  };
  uat_summary: {
    total_feedback: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    low_count: number;
    blocker_count: number;
    recent_feedback: Array<{
      id: string;
      priority: string;
      feedback: string;
      checklist_progress: string | null;
      source: string | null;
      created_at: string;
    }>;
  };
  decisions: {
    facility_batching: 'ready' | 'phase2_candidate';
    medication_set_workflow: 'ready' | 'phase2_candidate';
    phase2_entry: 'ready' | 'blocked';
  };
  recommendations: string[];
};

function hasSetPilotEnabled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.set_pilot_enabled === true;
}

export function buildPilotReadinessSnapshot(args: {
  cases: PilotReadinessCase[];
  feedback: PilotReadinessFeedback[];
  now?: Date;
}): PilotReadinessSnapshot {
  const now = args.now ?? new Date();
  const facilityIds = new Set<string>();
  let facilityLinkedCaseCount = 0;
  let setPilotCaseCount = 0;
  let setPilotWithoutFacilityCount = 0;

  for (const careCase of args.cases) {
    const facilityId = careCase.patient.residences[0]?.facility_id ?? null;
    const setPilotEnabled = hasSetPilotEnabled(careCase.required_visit_support);

    if (facilityId) {
      facilityIds.add(facilityId);
      facilityLinkedCaseCount += 1;
    }

    if (setPilotEnabled) {
      setPilotCaseCount += 1;
      if (!facilityId) {
        setPilotWithoutFacilityCount += 1;
      }
    }
  }

  const criticalCount = args.feedback.filter((item) => item.priority === 'critical').length;
  const highCount = args.feedback.filter((item) => item.priority === 'high').length;
  const mediumCount = args.feedback.filter((item) => item.priority === 'medium').length;
  const lowCount = args.feedback.filter((item) => item.priority === 'low').length;
  const blockerCount = args.feedback.filter((item) => isUnresolvedUatBlocker(item)).length;

  const recommendations: string[] = [];
  if (facilityLinkedCaseCount === 0) {
    recommendations.push(
      '施設患者が未確認です。FacilityVisitBatch と自動ルート最適化は Phase 2 移行候補として扱ってください。'
    );
  }
  if (setPilotCaseCount === 0) {
    recommendations.push(
      'セット pilot 対象ケースが未確認です。セット本格機能は pilot 対象明示後に有効化してください。'
    );
  }
  if (blockerCount > 0) {
    recommendations.push(
      `UAT に critical/high が ${blockerCount} 件あります。Phase 2 開始前に優先修正を完了してください。`
    );
  }
  if (setPilotWithoutFacilityCount > 0) {
    recommendations.push(
      `セット pilot 対象のうち ${setPilotWithoutFacilityCount} 件は施設紐付けがありません。運用導線と患者属性を確認してください。`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push('現時点のローカル指標では pilot 前提条件に大きな欠落はありません。');
  }

  return {
    generated_at: now.toISOString(),
    case_summary: {
      active_case_count: args.cases.length,
      facility_linked_case_count: facilityLinkedCaseCount,
      non_facility_case_count: Math.max(0, args.cases.length - facilityLinkedCaseCount),
      facility_count: facilityIds.size,
      set_pilot_case_count: setPilotCaseCount,
      set_pilot_without_facility_count: setPilotWithoutFacilityCount,
    },
    uat_summary: {
      total_feedback: args.feedback.length,
      critical_count: criticalCount,
      high_count: highCount,
      medium_count: mediumCount,
      low_count: lowCount,
      blocker_count: blockerCount,
      recent_feedback: args.feedback.slice(0, 5).map((item) => ({
        id: item.id,
        priority: item.priority,
        feedback: item.feedback,
        checklist_progress: item.checklist_progress,
        source: item.source,
        created_at: item.created_at.toISOString(),
      })),
    },
    decisions: {
      facility_batching: facilityLinkedCaseCount > 0 ? 'ready' : 'phase2_candidate',
      medication_set_workflow: setPilotCaseCount > 0 ? 'ready' : 'phase2_candidate',
      phase2_entry: blockerCount > 0 ? 'blocked' : 'ready',
    },
    recommendations,
  };
}

export async function getPilotReadinessSnapshot(orgId: string): Promise<PilotReadinessSnapshot> {
  const { prisma } = await import('@/lib/db/client');
  const [cases, feedback] = await Promise.all([
    prisma.careCase.findMany({
      where: {
        org_id: orgId,
        status: {
          in: ['assessment', 'active', 'on_hold'],
        },
      },
      select: {
        id: true,
        status: true,
        required_visit_support: true,
        patient: {
          select: {
            id: true,
            name: true,
            residences: {
              where: { is_primary: true },
              select: {
                facility_id: true,
              },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.uatFeedback.findMany({
      where: { org_id: orgId },
      orderBy: [{ created_at: 'desc' }],
      take: 200,
    }),
  ]);

  return buildPilotReadinessSnapshot({
    cases,
    feedback,
  });
}
