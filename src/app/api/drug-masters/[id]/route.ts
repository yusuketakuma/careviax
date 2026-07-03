import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  buildDrugMasterDetailCacheKey,
  DRUG_MASTER_DETAIL_CACHE_TTL_MS,
  drugMasterDetailCache,
} from '@/server/services/drug-master-detail-cache';

const ROUTE = '/api/drug-masters/[id]';

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

async function authenticatedGET(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('医薬品IDが不正です');

    const cacheKey = buildDrugMasterDetailCacheKey(id);
    const cached = drugMasterDetailCache.get<DrugMasterDetail>(cacheKey);
    if (cached !== undefined) {
      return success(cached);
    }

    const drug = await fetchDrugMasterDetail(id);
    if (!drug) return notFound('医薬品が見つかりません');

    drugMasterDetailCache.set(cacheKey, drug, DRUG_MASTER_DETAIL_CACHE_TTL_MS);

    return success(drug);
  });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext.params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'drug_masters_detail_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
