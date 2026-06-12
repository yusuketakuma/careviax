import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { buildVisitRecordScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

const MAX_RESIDUAL_MEDICATION_LIMIT = 200;

const residualMedicationQuerySchema = z.object({
  limit: optionalBoundedIntegerSearchParam('limit', 1, MAX_RESIDUAL_MEDICATION_LIMIT),
});

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const visitRecordId = searchParams.get('visit_record_id') ?? undefined;
    const patientId = searchParams.get('patient_id') ?? undefined;
    const parsed = parseSearchParams(residualMedicationQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }
    const take = parsed.data.limit;

    const visitRecordAssignmentWhere = buildVisitRecordScheduleAssignmentWhere(ctx);

    let patientVisitRecordIds: string[] | null = null;
    if (visitRecordId) {
      const visitRecordWhere: Prisma.VisitRecordWhereInput = {
        id: visitRecordId,
        org_id: ctx.orgId,
        ...(patientId ? { patient_id: patientId } : {}),
        ...(visitRecordAssignmentWhere ? { AND: [visitRecordAssignmentWhere] } : {}),
      };
      const visitRecord = await prisma.visitRecord.findFirst({
        where: visitRecordWhere,
        select: { id: true },
      });

      if (!visitRecord) return success({ data: [] });
      patientVisitRecordIds = [visitRecord.id];
    }

    if (!visitRecordId && patientId) {
      const visitRecords = await prisma.visitRecord.findMany({
        where: {
          org_id: ctx.orgId,
          patient_id: patientId,
          ...(visitRecordAssignmentWhere ? { AND: [visitRecordAssignmentWhere] } : {}),
        },
        select: { id: true },
      });

      patientVisitRecordIds = visitRecords.map((record) => record.id);
      if (patientVisitRecordIds.length === 0) {
        return success({ data: [] });
      }
    } else if (!visitRecordId && visitRecordAssignmentWhere) {
      const visitRecords = await prisma.visitRecord.findMany({
        where: {
          org_id: ctx.orgId,
          AND: [visitRecordAssignmentWhere],
        },
        select: { id: true },
      });

      patientVisitRecordIds = visitRecords.map((record) => record.id);
      if (patientVisitRecordIds.length === 0) {
        return success({ data: [] });
      }
    }

    const records = await prisma.residualMedication.findMany({
      where: {
        org_id: ctx.orgId,
        ...(visitRecordId
          ? { visit_record_id: visitRecordId }
          : patientVisitRecordIds
            ? { visit_record_id: { in: patientVisitRecordIds } }
            : {}),
      },
      orderBy: { created_at: 'asc' },
      ...(take !== undefined ? { take } : {}),
    });

    return success({ data: records });
  },
  {
    permission: 'canVisit',
    message: '残薬情報の閲覧権限がありません',
  },
);

const createResidualMedicationSchema = z.object({
  visit_record_id: z.string().min(1, '訪問記録IDは必須です'),
  medications: z
    .array(
      z.object({
        drug_name: z.string().min(1, '薬剤名は必須です'),
        drug_code: z.string().optional(),
        prescribed_quantity: z.number().positive().optional(),
        prescribed_daily_dose: z.number().positive().optional(),
        remaining_quantity: z.number().min(0, '残数は0以上で入力してください'),
        is_prohibited_reduction: z.boolean().default(false),
      }),
    )
    .min(1, '薬剤情報は1件以上必要です'),
});

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createResidualMedicationSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { visit_record_id, medications } = parsed.data;

    const visitRecordAssignmentWhere = buildVisitRecordScheduleAssignmentWhere(ctx);
    const visitRecord = await prisma.visitRecord.findFirst({
      where: {
        id: visit_record_id,
        org_id: ctx.orgId,
        ...(visitRecordAssignmentWhere ? { AND: [visitRecordAssignmentWhere] } : {}),
      },
      select: { id: true },
    });
    if (!visitRecord) return notFound('指定された訪問記録が見つかりません');

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await Promise.all(
        medications.map((med) => {
          // Calculate excess days: remaining_quantity / prescribed_daily_dose
          let excess_days: number | undefined;
          if (
            med.prescribed_daily_dose &&
            med.prescribed_daily_dose > 0 &&
            med.remaining_quantity > 0
          ) {
            excess_days = Math.floor(med.remaining_quantity / med.prescribed_daily_dose);
          }

          return tx.residualMedication.create({
            data: {
              org_id: ctx.orgId,
              visit_record_id,
              drug_name: med.drug_name,
              drug_code: med.drug_code,
              prescribed_quantity: med.prescribed_quantity,
              remaining_quantity: med.remaining_quantity,
              excess_days: excess_days ?? null,
              is_reduction_target: excess_days !== undefined && excess_days > 7,
              is_prohibited_reduction: med.is_prohibited_reduction,
            },
          });
        }),
      );

      return created;
    });

    return success(result, 201);
  },
  {
    permission: 'canVisit',
    message: '残薬情報の作成権限がありません',
  },
);
