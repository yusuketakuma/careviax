import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { optionalBoundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { readStrictOptionalSearchParam } from '@/lib/api/search-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { buildVisitRecordScheduleAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { findMissingResidualMedicationDrugMasterIds } from '@/server/services/visit-record-derived-data';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

const ROUTE = '/api/residual-medications';
const MAX_RESIDUAL_MEDICATION_LIMIT = 200;

function blankStringToUndefined(value: unknown) {
  return typeof value === 'string' && value.trim().length === 0 ? undefined : value;
}

const optionalTrimmedStringSchema = z.preprocess(
  blankStringToUndefined,
  z.string().trim().optional(),
);

const residualMedicationQuerySchema = z.object({
  limit: optionalBoundedIntegerSearchParam('limit', 1, MAX_RESIDUAL_MEDICATION_LIMIT),
});

function parseResidualMedicationFilters(searchParams: URLSearchParams) {
  const visitRecordResult = readStrictOptionalSearchParam(searchParams, 'visit_record_id', {
    blank: '訪問記録IDを指定してください',
    invalid: '訪問記録IDの形式が不正です',
  });
  if (!visitRecordResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('クエリパラメータが不正です', visitRecordResult.fieldErrors),
      ),
    };
  }

  const patientResult = readStrictOptionalSearchParam(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('クエリパラメータが不正です', patientResult.fieldErrors),
      ),
    };
  }

  return {
    ok: true as const,
    visitRecordId: visitRecordResult.value,
    patientId: patientResult.value,
  };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '残薬情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const filters = parseResidualMedicationFilters(searchParams);
    if (!filters.ok) return filters.response;

    const { visitRecordId, patientId } = filters;
    const parsed = parseSearchParams(residualMedicationQuerySchema, searchParams);
    if (!parsed.ok) {
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors),
      );
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

      if (!visitRecord) return withSensitiveNoStore(success({ data: [] }));
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
        return withSensitiveNoStore(success({ data: [] }));
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
        return withSensitiveNoStore(success({ data: [] }));
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

    return withSensitiveNoStore(success({ data: records }));
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'residual_medications_get_unhandled_error',
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

const createResidualMedicationSchema = z.object({
  visit_record_id: z.string().min(1, '訪問記録IDは必須です'),
  medications: z
    .array(
      z.object({
        drug_name: z.string().min(1, '薬剤名は必須です'),
        drug_master_id: optionalTrimmedStringSchema,
        drug_code: optionalTrimmedStringSchema,
        prescribed_quantity: z.number().positive().optional(),
        prescribed_daily_dose: z.number().positive().optional(),
        remaining_quantity: z.number().min(0, '残数は0以上で入力してください'),
        is_prohibited_reduction: z.boolean().default(false),
      }),
    )
    .min(1, '薬剤情報は1件以上必要です'),
});

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '残薬情報の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
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
      const missingDrugMasterIds = await findMissingResidualMedicationDrugMasterIds(
        tx,
        medications,
      );
      if (missingDrugMasterIds.length > 0) {
        return {
          error: 'invalid_drug_master_id' as const,
        };
      }

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
              drug_master_id: med.drug_master_id ?? null,
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

    if ('error' in result && result.error === 'invalid_drug_master_id') {
      return validationError('入力値が不正です', {
        drug_master_id: ['存在する医薬品マスターを選択してください'],
      });
    }

    return success(result, 201);
  });
}

export async function POST(req: NextRequest, routeContext?: unknown) {
  void routeContext;
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'residual_medications_post_unhandled_error',
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
