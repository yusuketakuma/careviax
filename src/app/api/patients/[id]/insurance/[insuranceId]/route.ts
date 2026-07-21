import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { buildPatientInsuranceOverlapWhere } from '@/lib/patient/insurance-overlap';
import {
  incompatiblePatientInsuranceFieldClears,
  patientInsuranceUpdateSchema,
  validateEffectivePatientInsuranceUpdate,
} from '@/lib/validations/patient-insurance';

class PatientInsuranceOverlapError extends Error {
  constructor() {
    super('PATIENT_INSURANCE_OVERLAP');
  }
}

const patientInsuranceResponseSelect = {
  id: true,
  insurance_type: true,
  application_status: true,
  application_submitted_at: true,
  decision_at: true,
  public_program_code: true,
  previous_care_level: true,
  provisional_care_level: true,
  confirmed_care_level: true,
  insurer_number: true,
  symbol: true,
  number: true,
  branch_number: true,
  copay_ratio: true,
  valid_from: true,
  valid_until: true,
  is_active: true,
  notes: true,
  updated_at: true,
} as const;

type ExpectedUpdatedAtResult =
  | { kind: 'response'; response: Response }
  | { kind: 'value'; value: Date };

function readRequiredExpectedUpdatedAt(req: NextRequest): ExpectedUpdatedAtResult {
  const rawValue = new URL(req.url).searchParams.get('expected_updated_at');
  if (rawValue === null) {
    return {
      kind: 'response',
      response: validationError('保険情報の更新時刻が必要です', {
        expected_updated_at: ['更新前に取得したupdated_atを指定してください'],
      }),
    };
  }

  const parsed = z.string().datetime().safeParse(rawValue);
  if (!parsed.success) {
    return {
      kind: 'response',
      response: validationError('保険情報の更新時刻が不正です', {
        expected_updated_at: ['日時形式が不正です'],
      }),
    };
  }
  return { kind: 'value', value: new Date(parsed.data) };
}

async function authenticatedPUT(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
): Promise<Response> {
  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = patientInsuranceUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const expectedUpdatedAtResult = readRequiredExpectedUpdatedAt(req);
  if (expectedUpdatedAtResult.kind === 'response') return expectedUpdatedAtResult.response;
  const expectedUpdatedAt = expectedUpdatedAtResult.value;

  // Fold the patient-assignment access check into the resource query (single
  // round-trip). buildCareCaseAssignmentWhere returns null for owner/admin so
  // the relation filter is unset for privileged roles (bypass).
  const caseAssignmentWherePut = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const { valid_from, valid_until, application_submitted_at, decision_at, ...rest } = parsed.data;

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const writable = await requireWritablePatient(tx, ctx, id);
      if ('response' in writable) {
        return { kind: 'response' as const, response: writable.response };
      }

      const existing = await tx.patientInsurance.findFirst({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          ...(caseAssignmentWherePut
            ? { patient: { cases: { some: caseAssignmentWherePut } } }
            : {}),
        },
        select: {
          id: true,
          insurance_type: true,
          application_status: true,
          public_program_code: true,
          valid_from: true,
          valid_until: true,
          application_submitted_at: true,
          decision_at: true,
          previous_care_level: true,
          provisional_care_level: true,
          confirmed_care_level: true,
          is_active: true,
          updated_at: true,
        },
      });
      if (!existing) {
        return { kind: 'response' as const, response: notFound('保険情報が見つかりません') };
      }

      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return {
          kind: 'response' as const,
          response: staleInsuranceConflict(expectedUpdatedAt, existing.updated_at),
        };
      }

      const effectiveValidation = validateEffectivePatientInsuranceUpdate(existing, parsed.data);
      if (!effectiveValidation.success) {
        return {
          kind: 'response' as const,
          response: validationError(
            '入力値が不正です',
            effectiveValidation.error.flatten().fieldErrors,
          ),
        };
      }
      const effectiveInsurance = effectiveValidation.data;
      const effectiveInsuranceType = effectiveInsurance.insurance_type;

      if (effectiveInsurance.is_active !== false) {
        const overlappingInsurance = await tx.patientInsurance.findFirst({
          where: buildPatientInsuranceOverlapWhere({
            orgId: ctx.orgId,
            patientId: id,
            excludeInsuranceId: insuranceId,
            insuranceType: effectiveInsuranceType,
            publicProgramCode: effectiveInsurance.public_program_code,
            validFrom: effectiveInsurance.valid_from,
            validUntil: effectiveInsurance.valid_until,
          }),
          select: { id: true },
        });
        if (overlappingInsurance) {
          throw new PatientInsuranceOverlapError();
        }
      }

      const updateResult = await tx.patientInsurance.updateMany({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          updated_at: expectedUpdatedAt,
          ...(caseAssignmentWherePut
            ? { patient: { cases: { some: caseAssignmentWherePut } } }
            : {}),
        },
        data: {
          ...rest,
          ...incompatiblePatientInsuranceFieldClears(effectiveInsuranceType),
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

      const current = await tx.patientInsurance.findFirst({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          ...(caseAssignmentWherePut
            ? { patient: { cases: { some: caseAssignmentWherePut } } }
            : {}),
        },
        select: patientInsuranceResponseSelect,
      });
      if (!current) {
        return { kind: 'response' as const, response: notFound('保険情報が見つかりません') };
      }
      if (updateResult.count === 0) {
        return {
          kind: 'response' as const,
          response: staleInsuranceConflict(expectedUpdatedAt, current.updated_at),
        };
      }
      return { kind: 'updated' as const, updated: current };
    },
    { requestContext: ctx },
  ).catch((cause: unknown) => {
    if (cause instanceof PatientInsuranceOverlapError) return { kind: 'overlap' as const };
    throw cause;
  });

  if (result.kind === 'overlap') {
    return validationError('同じ期間に有効な保険情報が既に存在します', {
      valid_from: ['同一患者・同一保険種別の有効期間が重複しています'],
    });
  }
  if (result.kind === 'response') return result.response;
  return success({ data: result.updated });
}

export const PUT = withAuthContext(authenticatedPUT, {
  permission: 'canVisit',
  message: '患者保険情報の更新権限がありません',
});

function staleInsuranceConflict(expectedUpdatedAt: Date, currentUpdatedAt: Date | null) {
  return conflict('保険情報が他の操作で更新されています。再読み込みしてください', {
    conflict_type: 'stale_patient_insurance',
    expected_updated_at: expectedUpdatedAt.toISOString(),
    current_updated_at: currentUpdatedAt?.toISOString() ?? null,
  });
}

async function authenticatedDELETE(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string; insuranceId: string }> },
): Promise<Response> {
  const { id: rawId, insuranceId: rawInsuranceId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const insuranceId = normalizeRequiredRouteParam(rawInsuranceId);
  if (!insuranceId) return validationError('保険情報IDが不正です');

  const expectedUpdatedAtResult = readRequiredExpectedUpdatedAt(req);
  if (expectedUpdatedAtResult.kind === 'response') return expectedUpdatedAtResult.response;
  const expectedUpdatedAt = expectedUpdatedAtResult.value;

  const caseAssignmentWhereDelete = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const writable = await requireWritablePatient(tx, ctx, id);
      if ('response' in writable) {
        return { kind: 'response' as const, response: writable.response };
      }

      const existing = await tx.patientInsurance.findFirst({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          ...(caseAssignmentWhereDelete
            ? { patient: { cases: { some: caseAssignmentWhereDelete } } }
            : {}),
        },
        select: { id: true, updated_at: true },
      });
      if (!existing) {
        return { kind: 'response' as const, response: notFound('保険情報が見つかりません') };
      }

      if (existing.updated_at.toISOString() !== expectedUpdatedAt.toISOString()) {
        return {
          kind: 'response' as const,
          response: staleInsuranceConflict(expectedUpdatedAt, existing.updated_at),
        };
      }

      const deleteResult = await tx.patientInsurance.deleteMany({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          updated_at: expectedUpdatedAt,
          ...(caseAssignmentWhereDelete
            ? { patient: { cases: { some: caseAssignmentWhereDelete } } }
            : {}),
        },
      });
      if (deleteResult.count > 0) return { kind: 'deleted' as const, deleted: true };

      const current = await tx.patientInsurance.findFirst({
        where: {
          id: insuranceId,
          patient_id: id,
          org_id: ctx.orgId,
          ...(caseAssignmentWhereDelete
            ? { patient: { cases: { some: caseAssignmentWhereDelete } } }
            : {}),
        },
        select: { updated_at: true },
      });
      if (!current) {
        return { kind: 'response' as const, response: notFound('保険情報が見つかりません') };
      }
      return {
        kind: 'response' as const,
        response: staleInsuranceConflict(expectedUpdatedAt, current.updated_at),
      };
    },
    { requestContext: ctx },
  );

  if (result.kind === 'response') return result.response;
  return success({ data: { id: insuranceId, deleted: result.deleted } });
}

export const DELETE = withAuthContext(authenticatedDELETE, {
  permission: 'canVisit',
  message: '患者保険情報の削除権限がありません',
});
