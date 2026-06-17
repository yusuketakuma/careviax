import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { z } from 'zod';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { dateKeySchema } from '@/lib/validations/date-key';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

const dateStringSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const publicProgramCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, '公費制度コードが不正です');

const careLevelSchema = z
  .enum([
    'support_1',
    'support_2',
    'care_1',
    'care_2',
    'care_3',
    'care_4',
    'care_5',
    'applying',
    'not_applied',
    'not_eligible',
  ])
  .optional()
  .nullable();

class PatientInsuranceOverlapError extends Error {
  constructor() {
    super('PATIENT_INSURANCE_OVERLAP');
  }
}

function buildOverlapWhere(args: {
  orgId: string;
  patientId: string;
  insuranceId?: string;
  insuranceType: 'medical' | 'care' | 'public_subsidy';
  publicProgramCode?: string | null;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
}) {
  const validFrom = args.validFrom ? new Date(args.validFrom) : null;
  const validUntil = args.validUntil ? new Date(args.validUntil) : null;

  return {
    org_id: args.orgId,
    patient_id: args.patientId,
    insurance_type: args.insuranceType,
    is_active: true,
    ...(args.insuranceId ? { id: { not: args.insuranceId } } : {}),
    ...(args.insuranceType === 'public_subsidy' && args.publicProgramCode
      ? { public_program_code: args.publicProgramCode }
      : {}),
    AND: [
      { OR: [{ valid_from: null }, ...(validUntil ? [{ valid_from: { lte: validUntil } }] : [])] },
      { OR: [{ valid_until: null }, ...(validFrom ? [{ valid_until: { gte: validFrom } }] : [])] },
    ],
  };
}

const updateInsuranceSchema = z
  .object({
    insurance_type: z.enum(['medical', 'care', 'public_subsidy']).optional(),
    application_status: z
      .enum(['confirmed', 'applying', 'change_pending', 'not_applicable'])
      .optional(),
    insurer_number: z.string().max(8).optional().nullable(),
    public_program_code: publicProgramCodeSchema.optional().nullable(),
    symbol: z.string().max(100).optional().nullable(),
    number: z.string().max(20).optional().nullable(),
    branch_number: z.string().max(2).optional().nullable(),
    copay_ratio: z.number().int().min(0).max(100).optional().nullable(),
    valid_from: dateStringSchema.optional().nullable(),
    valid_until: dateStringSchema.optional().nullable(),
    application_submitted_at: dateStringSchema.optional().nullable(),
    decision_at: dateStringSchema.optional().nullable(),
    previous_care_level: careLevelSchema,
    provisional_care_level: careLevelSchema,
    confirmed_care_level: careLevelSchema,
    is_active: z.boolean().optional(),
    notes: z.string().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.valid_from && value.valid_until && value.valid_from > value.valid_until) {
      ctx.addIssue({
        code: 'custom',
        path: ['valid_until'],
        message: '有効期限は有効開始日以降の日付を指定してください',
      });
    }
    if (
      value.application_submitted_at &&
      value.decision_at &&
      value.application_submitted_at > value.decision_at
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['decision_at'],
        message: '決定日は申請日以降の日付を指定してください',
      });
    }
    if (
      value.insurance_type &&
      value.insurance_type !== 'public_subsidy' &&
      value.public_program_code
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['public_program_code'],
        message: '公費制度コードは公費保険でのみ指定できます',
      });
    }
    if (
      value.insurance_type &&
      value.insurance_type !== 'care' &&
      (value.previous_care_level || value.provisional_care_level || value.confirmed_care_level)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_care_level'],
        message: '介護度情報は介護保険でのみ指定できます',
      });
    }
    if (value.insurance_type === 'medical' && value.application_status === 'change_pending') {
      ctx.addIssue({
        code: 'custom',
        path: ['application_status'],
        message: '区分変更中は介護保険または公費保険で指定してください',
      });
    }
  });

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateInsuranceSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  // Fold the patient-assignment access check into the resource query (single
  // round-trip). buildCareCaseAssignmentWhere returns null for owner/admin so
  // the relation filter is unset for privileged roles (bypass).
  const caseAssignmentWherePut = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const existing = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patient_id: id,
      org_id: ctx.orgId,
      ...(caseAssignmentWherePut ? { patient: { cases: { some: caseAssignmentWherePut } } } : {}),
    },
    select: {
      id: true,
      insurance_type: true,
      public_program_code: true,
      valid_from: true,
      valid_until: true,
      is_active: true,
    },
  });
  if (!existing) return notFound('保険情報が見つかりません');

  const effectiveInsuranceType = parsed.data.insurance_type ?? existing.insurance_type;
  if (effectiveInsuranceType !== 'public_subsidy' && parsed.data.public_program_code) {
    return validationError('入力値が不正です', {
      public_program_code: ['公費制度コードは公費保険でのみ指定できます'],
    });
  }
  if (
    effectiveInsuranceType !== 'care' &&
    (parsed.data.previous_care_level ||
      parsed.data.provisional_care_level ||
      parsed.data.confirmed_care_level)
  ) {
    return validationError('入力値が不正です', {
      previous_care_level: ['介護度情報は介護保険でのみ指定できます'],
    });
  }
  if (effectiveInsuranceType === 'medical' && parsed.data.application_status === 'change_pending') {
    return validationError('入力値が不正です', {
      application_status: ['区分変更中は介護保険または公費保険で指定してください'],
    });
  }

  const { valid_from, valid_until, application_submitted_at, decision_at, ...rest } = parsed.data;

  let updated;
  try {
    updated = await withOrgContext(ctx.orgId, async (tx) => {
      const nextIsActive = parsed.data.is_active ?? existing.is_active;
      if (nextIsActive) {
        const overlappingInsurance = await tx.patientInsurance.findFirst({
          where: buildOverlapWhere({
            orgId: ctx.orgId,
            patientId: id,
            insuranceId,
            insuranceType: effectiveInsuranceType,
            publicProgramCode: parsed.data.public_program_code ?? existing.public_program_code,
            validFrom: valid_from !== undefined ? valid_from : existing.valid_from,
            validUntil: valid_until !== undefined ? valid_until : existing.valid_until,
          }),
          select: { id: true },
        });
        if (overlappingInsurance) {
          throw new PatientInsuranceOverlapError();
        }
      }

      return tx.patientInsurance.update({
        where: { id: insuranceId },
        data: {
          ...rest,
          ...(valid_from !== undefined
            ? { valid_from: valid_from ? new Date(valid_from) : null }
            : {}),
          ...(valid_until !== undefined
            ? { valid_until: valid_until ? new Date(valid_until) : null }
            : {}),
          ...(application_submitted_at !== undefined
            ? {
                application_submitted_at: application_submitted_at
                  ? new Date(application_submitted_at)
                  : null,
              }
            : {}),
          ...(decision_at !== undefined
            ? { decision_at: decision_at ? new Date(decision_at) : null }
            : {}),
        },
      });
    });
  } catch (cause) {
    if (cause instanceof PatientInsuranceOverlapError) {
      return validationError('同じ期間に有効な保険情報が既に存在します', {
        valid_from: ['同一患者・同一保険種別の有効期間が重複しています'],
      });
    }
    throw cause;
  }

  return success({ data: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者保険情報の削除権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  const caseAssignmentWhereDelete = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const existing = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patient_id: id,
      org_id: ctx.orgId,
      ...(caseAssignmentWhereDelete
        ? { patient: { cases: { some: caseAssignmentWhereDelete } } }
        : {}),
    },
    select: { id: true },
  });
  if (!existing) return notFound('保険情報が見つかりません');

  await withOrgContext(ctx.orgId, (tx) =>
    tx.patientInsurance.delete({
      where: { id: insuranceId },
    }),
  );

  return success({ id: insuranceId, deleted: true });
}
