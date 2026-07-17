import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { success, notFound, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import {
  buildDrugMasterDetailCacheKey,
  DRUG_MASTER_DETAIL_CACHE_TTL_MS,
  drugMasterDetailCache,
} from '@/server/services/drug-master-detail-cache';

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

async function fetchDrugMasterDetail(id: string) {
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

  if (!drug) return null;

  return {
    ...drug,
    interactions_as_a: sortInteractionsBySafetyPriority(drug.interactions_as_a),
    interactions_as_b: sortInteractionsBySafetyPriority(drug.interactions_as_b),
  };
}

type DrugMasterDetail = NonNullable<Awaited<ReturnType<typeof fetchDrugMasterDetail>>>;

async function authenticatedGET(
  _req: NextRequest,
  _ctx: AuthContext,
  { params }: AuthRouteContext<{ id: string }>,
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('医薬品IDが不正です');

  const cacheKey = buildDrugMasterDetailCacheKey(id);
  const cached = drugMasterDetailCache.get<DrugMasterDetail>(cacheKey);
  if (cached !== undefined) {
    return success({ data: cached });
  }

  const drug = await fetchDrugMasterDetail(id);
  if (!drug) return notFound('医薬品が見つかりません');

  drugMasterDetailCache.set(cacheKey, drug, DRUG_MASTER_DETAIL_CACHE_TTL_MS);

  return success({ data: drug });
}

export const GET = withAuthContext<{ id: string }>(authenticatedGET);
