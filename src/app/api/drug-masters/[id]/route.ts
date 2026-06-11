import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, notFound, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const INTERACTION_SEVERITY_PRIORITY: Record<string, number> = {
  contraindicated: 0,
  caution: 1,
  minor: 2,
};

function sortInteractionsBySafetyPriority<TInteraction extends { severity: string; id: string }>(
  interactions: TInteraction[],
) {
  return [...interactions].sort((a, b) => {
    const severityDelta =
      (INTERACTION_SEVERITY_PRIORITY[a.severity] ?? 99) -
      (INTERACTION_SEVERITY_PRIORITY[b.severity] ?? 99);
    return severityDelta || a.id.localeCompare(b.id);
  });
}

export const GET = withAuthContext(
  async (_req: NextRequest, _ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('医薬品IDが不正です');

    const drug = await prisma.drugMaster.findUnique({
      where: { id },
      include: {
        package_inserts: {
          orderBy: { revised_at: 'desc' },
          take: 1,
          select: {
            id: true,
            contraindications: true,
            interactions: true,
            adverse_effects: true,
            dosage_adjustment_renal: true,
            precautions_elderly: true,
            document_version: true,
            revised_at: true,
          },
        },
        interactions_as_a: {
          include: {
            drug_b: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
        interactions_as_b: {
          include: {
            drug_a: { select: { id: true, drug_name: true, yj_code: true } },
          },
        },
      },
    });

    if (!drug) return notFound('医薬品が見つかりません');

    return success({
      ...drug,
      interactions_as_a: sortInteractionsBySafetyPriority(drug.interactions_as_a),
      interactions_as_b: sortInteractionsBySafetyPriority(drug.interactions_as_b),
    });
  },
);
