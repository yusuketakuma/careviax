import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  applyPatientAssignmentWhere,
  buildVisitRecordScheduleAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { LAB_ANALYTE_CODES } from '@/lib/patient/lab-analytes';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

const labAnalyteCodeSchema = z.enum(LAB_ANALYTE_CODES);
const labQuerySchema = z.object({
  limit: boundedIntegerSearchParam('limit', 1, 200, 50),
});

const createLabSchema = z.object({
  analyte_code: labAnalyteCodeSchema,
  measured_at: z.string().datetime(),
  value_numeric: z.number().optional(),
  value_text: z.string().optional(),
  unit: z.string().optional(),
  abnormal_flag: z.string().optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
  source_type: z.enum(['manual', 'visit_record', 'import']).default('manual'),
  source_visit_record_id: z.string().optional(),
  note: z.string().optional(),
});

async function validateSourceVisitRecord(args: {
  orgId: string;
  patientId: string;
  userId: string;
  role: Parameters<typeof buildVisitRecordScheduleAssignmentWhere>[0]['role'];
  sourceVisitRecordId: string;
}) {
  const assignmentWhere = buildVisitRecordScheduleAssignmentWhere({
    userId: args.userId,
    role: args.role,
  });

  return prisma.visitRecord.findFirst({
    where: {
      id: args.sourceVisitRecordId,
      org_id: args.orgId,
      patient_id: args.patientId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    select: { id: true },
  });
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const url = new URL(req.url);
  const analyteCodeParam = url.searchParams.get('analyte_code') ?? undefined;
  const analyteCode = analyteCodeParam ? labAnalyteCodeSchema.safeParse(analyteCodeParam) : null;
  if (analyteCode && !analyteCode.success) {
    return validationError('検査項目コードが不正です', {
      analyte_code: ['対応していない検査項目コードです'],
    });
  }
  const parsedQuery = parseSearchParams(labQuerySchema, url.searchParams);
  if (!parsedQuery.ok) {
    return validationError('クエリパラメータが不正です', parsedQuery.error.flatten().fieldErrors);
  }
  const { limit } = parsedQuery.data;

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const labs = await prisma.patientLabObservation.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: id,
      ...(analyteCode ? { analyte_code: analyteCode.data } : {}),
    },
    orderBy: [{ measured_at: 'desc' }, { created_at: 'desc' }],
    take: limit,
  });

  return success({ data: labs });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '検査値の登録権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createLabSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  const sourceVisitRecordId = parsed.data.source_visit_record_id?.trim() || undefined;
  let normalizedSourceVisitRecordId: string | null = null;

  if (parsed.data.source_type === 'visit_record') {
    if (!sourceVisitRecordId) {
      return validationError('訪問記録由来の検査値には訪問記録IDが必要です', {
        source_visit_record_id: ['訪問記録IDを指定してください'],
      });
    }

    const sourceVisitRecord = await validateSourceVisitRecord({
      orgId: ctx.orgId,
      patientId: id,
      userId: ctx.userId,
      role: ctx.role,
      sourceVisitRecordId,
    });
    if (!sourceVisitRecord) {
      return validationError('指定された訪問記録が見つかりません', {
        source_visit_record_id: ['登録先患者でアクセス可能な訪問記録を指定してください'],
      });
    }

    normalizedSourceVisitRecordId = sourceVisitRecord.id;
  }

  const lab = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.patientLabObservation.create({
        data: {
          org_id: ctx.orgId,
          patient_id: id,
          analyte_code: parsed.data.analyte_code,
          measured_at: new Date(parsed.data.measured_at),
          value_numeric: parsed.data.value_numeric ?? null,
          value_text: parsed.data.value_text ?? null,
          unit: parsed.data.unit ?? null,
          abnormal_flag: parsed.data.abnormal_flag ?? null,
          reference_low: parsed.data.reference_low ?? null,
          reference_high: parsed.data.reference_high ?? null,
          source_type: parsed.data.source_type,
          source_visit_record_id: normalizedSourceVisitRecordId,
          note: parsed.data.note ?? null,
        },
      });
    },
    { requestContext: ctx },
  );

  return success(lab, 201);
}
