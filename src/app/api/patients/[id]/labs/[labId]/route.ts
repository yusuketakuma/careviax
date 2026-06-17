import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  buildCareCaseAssignmentWhere,
  buildVisitRecordScheduleAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

const patchLabSchema = z.object({
  abnormal_flag: z.string().optional(),
  note: z.string().optional(),
  value_numeric: z.number().optional(),
  value_text: z.string().optional(),
  unit: z.string().optional(),
  reference_low: z.number().optional(),
  reference_high: z.number().optional(),
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; labId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '検査値の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId, labId: rawLabId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const labId = normalizeRequiredRouteParam(rawLabId);
  if (!labId) return validationError('検査値IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = patchLabSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  // Fold the patient-assignment access check into the resource query so we
  // issue one DB round-trip instead of two. `buildCareCaseAssignmentWhere`
  // returns null for owner/admin, leaving the relation filter unset (bypass).
  const caseAssignmentWhere = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const existing = await prisma.patientLabObservation.findFirst({
    where: {
      id: labId,
      org_id: ctx.orgId,
      patient_id: id,
      ...(caseAssignmentWhere ? { patient: { cases: { some: caseAssignmentWhere } } } : {}),
    },
  });
  if (!existing) return notFound('検査値が見つかりません');

  if (existing.source_type === 'visit_record') {
    if (!existing.source_visit_record_id) {
      return validationError('訪問記録由来の検査値に訪問記録IDがありません', {
        source_visit_record_id: ['訪問記録IDを確認してください'],
      });
    }

    const sourceVisitRecord = await validateSourceVisitRecord({
      orgId: ctx.orgId,
      patientId: id,
      userId: ctx.userId,
      role: ctx.role,
      sourceVisitRecordId: existing.source_visit_record_id,
    });
    if (!sourceVisitRecord) {
      return validationError('指定された訪問記録が見つかりません', {
        source_visit_record_id: ['登録先患者でアクセス可能な訪問記録を指定してください'],
      });
    }
  }

  const shouldClearInconsistentSourceVisitRecordId =
    existing.source_type !== 'visit_record' && Boolean(existing.source_visit_record_id);

  const updated = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      return tx.patientLabObservation.update({
        where: { id: labId },
        data: {
          ...(parsed.data.abnormal_flag !== undefined
            ? { abnormal_flag: parsed.data.abnormal_flag }
            : {}),
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          ...(parsed.data.value_numeric !== undefined
            ? { value_numeric: parsed.data.value_numeric }
            : {}),
          ...(parsed.data.value_text !== undefined ? { value_text: parsed.data.value_text } : {}),
          ...(parsed.data.unit !== undefined ? { unit: parsed.data.unit } : {}),
          ...(parsed.data.reference_low !== undefined
            ? { reference_low: parsed.data.reference_low }
            : {}),
          ...(parsed.data.reference_high !== undefined
            ? { reference_high: parsed.data.reference_high }
            : {}),
          ...(shouldClearInconsistentSourceVisitRecordId ? { source_visit_record_id: null } : {}),
        },
      });
    },
    { requestContext: ctx },
  );

  return success(updated);
}
