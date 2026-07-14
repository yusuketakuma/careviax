import { NextRequest } from 'next/server';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { withAuthContext } from '@/lib/auth/context';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { notFound, success, validationError } from '@/lib/api/response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { listStandardMedicationTimeline } from '@/server/services/standard-medication-timeline';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function readOptionalSingleQueryParam(searchParams: URLSearchParams, key: string) {
  const values = searchParams.getAll(key);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [key]: [`${key} は1つだけ指定してください`],
      }),
    };
  }
  const value = values[0]?.trim();
  if (!value || value !== values[0]) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        [key]: [`${key} が不正です`],
      }),
    };
  }
  return { ok: true as const, value };
}

const authenticatedGET = withAuthContext(
  async (req: NextRequest, ctx, { params }) => {
    const { id: rawId } = await params;
    const patientId = normalizeRequiredRouteParam(rawId);
    if (!patientId) return validationError('患者IDが不正です');

    const searchParams = req.nextUrl.searchParams;
    const caseId = readOptionalSingleQueryParam(searchParams, 'case_id');
    if (!caseId.ok) return caseId.response;
    const limit = parseBoundedInteger(searchParams.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id: patientId, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: { id: true },
      });
      if (!patient) return { kind: 'not_found' as const };

      const items = await listStandardMedicationTimeline(tx, {
        orgId: ctx.orgId,
        patientId: patient.id,
        caseId: caseId.value,
        limit,
      });
      return { kind: 'ok' as const, patientId: patient.id, items };
    });

    if (result.kind === 'not_found') return notFound('患者が見つかりません');

    const response = success({
      data: {
        patient_id: result.patientId,
        items: result.items,
      },
      meta: {
        count: result.items.length,
        limit,
        generated_at: new Date().toISOString(),
      },
    });

    recordPhiReadAuditForRequest(ctx, {
      patientId: result.patientId,
      targetType: 'patient',
      targetId: result.patientId,
      view: 'patient_medication_timeline',
    });

    return response;
  },
  {
    permission: 'canVisit',
    message: '患者薬剤タイムラインの閲覧権限がありません',
  },
);

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  return withSensitiveNoStore(await authenticatedGET(req, routeContext));
}
