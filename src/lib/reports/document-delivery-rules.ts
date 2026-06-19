import { prisma } from '@/lib/db/client';
export { inferCareReportTargetRole } from '@/lib/reports/care-report-target-role';

export type DeliveryRuleSuggestion = {
  document_type: string;
  target_role: string;
  channel: string;
  fallback_channels: string[];
};

export async function resolveDocumentDeliveryRule(args: {
  orgId: string;
  documentType: string;
  targetRole: string;
}): Promise<DeliveryRuleSuggestion | null> {
  if (typeof prisma.documentDeliveryRule?.findFirst !== 'function') {
    return null;
  }

  const rule = await prisma.documentDeliveryRule.findFirst({
    where: {
      org_id: args.orgId,
      document_type: args.documentType,
      target_role: args.targetRole,
      is_active: true,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      document_type: true,
      target_role: true,
      channel: true,
      fallback_channels: true,
    },
  });

  if (!rule) return null;

  return {
    document_type: rule.document_type,
    target_role: rule.target_role,
    channel: rule.channel,
    fallback_channels: Array.isArray(rule.fallback_channels)
      ? rule.fallback_channels.filter((value): value is string => typeof value === 'string')
      : [],
  };
}
