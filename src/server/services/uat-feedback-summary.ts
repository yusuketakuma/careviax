import { UAT_CHECKLIST, UAT_CHECKLIST_LABEL_BY_ID } from '@/lib/constants/uat';
import { isUnresolvedUatBlocker } from '@/lib/uat-feedback';

type UatFeedbackSummaryRecord = {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  status: string;
  feedback: string;
  checklist_progress: string | null;
  checked_items: unknown;
  source: string | null;
  created_at: Date;
};

export type UatFeedbackSummary = {
  generated_at: string;
  total_feedback: number;
  priorities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  blocker_count: number;
  action_items: Array<{
    id: string;
    priority: string;
    status: string;
    feedback: string;
    checklist_progress: string | null;
    source: string | null;
    created_at: string;
  }>;
  checklist_coverage: Array<{
    item_id: string;
    label: string;
    checked_count: number;
  }>;
  recommendations: string[];
};

function normalizeCheckedItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function buildUatFeedbackSummary(args: {
  feedback: UatFeedbackSummaryRecord[];
  now?: Date;
}): UatFeedbackSummary {
  const now = args.now ?? new Date();
  const priorities = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const checklistCounts = new Map<string, number>();
  for (const section of UAT_CHECKLIST) {
    for (const item of section.items) {
      checklistCounts.set(item.id, 0);
    }
  }

  for (const item of args.feedback) {
    if (item.priority === 'critical') priorities.critical += 1;
    else if (item.priority === 'high') priorities.high += 1;
    else if (item.priority === 'medium') priorities.medium += 1;
    else if (item.priority === 'low') priorities.low += 1;

    for (const checkedItem of normalizeCheckedItems(item.checked_items)) {
      checklistCounts.set(checkedItem, (checklistCounts.get(checkedItem) ?? 0) + 1);
    }
  }

  const blockerCount = args.feedback.filter((item) => isUnresolvedUatBlocker(item)).length;
  const actionItems = args.feedback
    .filter((item) => isUnresolvedUatBlocker(item))
    .slice(0, 10)
    .map((item) => ({
      id: item.id,
      priority: item.priority,
      status: item.status,
      feedback: item.feedback,
      checklist_progress: item.checklist_progress,
      source: item.source,
      created_at: item.created_at.toISOString(),
    }));

  const checklistCoverage = Array.from(checklistCounts.entries())
    .map(([itemId, checkedCount]) => ({
      item_id: itemId,
      label: UAT_CHECKLIST_LABEL_BY_ID.get(itemId) ?? itemId,
      checked_count: checkedCount,
    }))
    .sort((left, right) => left.checked_count - right.checked_count || left.item_id.localeCompare(right.item_id));

  const recommendations: string[] = [];
  if (blockerCount > 0) {
    recommendations.push(
      `critical/high の blocker が ${blockerCount} 件あります。Phase 2 開始前に action_items の解消を優先してください。`
    );
  }
  const lowestCoverage = checklistCoverage.filter((item) => item.checked_count === checklistCoverage[0]?.checked_count).slice(0, 3);
  if (args.feedback.length > 0 && lowestCoverage.length > 0) {
    recommendations.push(
      `UAT で確認回数が少ない項目: ${lowestCoverage.map((item) => item.label).join(' / ')}`
    );
  }
  if (args.feedback.length === 0) {
    recommendations.push('まだ UAT フィードバックがありません。1週間の pilot 実運用で最低 1 件以上の記録を残してください。');
  }

  return {
    generated_at: now.toISOString(),
    total_feedback: args.feedback.length,
    priorities,
    blocker_count: blockerCount,
    action_items: actionItems,
    checklist_coverage: checklistCoverage,
    recommendations,
  };
}

export async function getUatFeedbackSummary(orgId: string): Promise<UatFeedbackSummary> {
  const { prisma } = await import('@/lib/db/client');
  const feedback = await prisma.uatFeedback.findMany({
    where: { org_id: orgId },
    orderBy: [{ created_at: 'desc' }],
    take: 200,
  });

  return buildUatFeedbackSummary({ feedback });
}
