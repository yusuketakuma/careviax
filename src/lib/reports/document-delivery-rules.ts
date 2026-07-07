import { prisma } from '@/lib/db/client';

export type DeliveryRuleSuggestion = {
  document_type: string;
  target_role: string;
  channel: string;
  fallback_channels: string[];
};

type DocumentDeliveryRuleDb = {
  documentDeliveryRule?: {
    findFirst?: (
      args: Parameters<typeof prisma.documentDeliveryRule.findFirst>[0],
    ) => ReturnType<typeof prisma.documentDeliveryRule.findFirst>;
  };
};

export async function resolveDocumentDeliveryRule(args: {
  orgId: string;
  documentType: string;
  targetRole: string;
  db?: DocumentDeliveryRuleDb;
}): Promise<DeliveryRuleSuggestion | null> {
  const db = args.db ?? prisma;
  if (typeof db.documentDeliveryRule?.findFirst !== 'function') {
    return null;
  }

  const rule = await db.documentDeliveryRule.findFirst({
    where: {
      org_id: args.orgId,
      document_type: args.documentType,
      target_role: args.targetRole,
      is_active: true,
    },
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
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
