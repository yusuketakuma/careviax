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

const ROUTE = '/api/drug-masters/[id]';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

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

async function authenticatedGET(req: NextRequest, params: Promise<{ id: string }>) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
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
  });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext.params));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('drug_masters_detail_get_unhandled_error', undefined, {
        event: 'drug_masters_detail_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
