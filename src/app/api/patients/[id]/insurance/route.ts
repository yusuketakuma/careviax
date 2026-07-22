import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { notFound, success, validationError } from '@/lib/api/response';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { classifyPatientInsurances } from '@/lib/patient/insurance-summary';
import { buildPatientInsuranceOverlapWhere } from '@/lib/patient/insurance-overlap';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import { recordPhiReadAuditForRequest } from '@/lib/audit/phi-read-audit';
import { patientInsuranceCreateSchema } from '@/lib/validations/patient-insurance';

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

async function authenticatedGET(
  _req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  // valid_from / valid_until(@db.Date)は UTC 深夜で保存されるため UTC 深夜の今日で比較する
  const today = utcDateFromLocalKey(localDateKey());
  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: { id: true },
      });
      if (!patient) return null;

      const insurances = await tx.patientInsurance.findMany({
        where: { patient_id: patient.id, org_id: ctx.orgId },
        orderBy: [{ is_active: 'desc' }, { valid_from: 'desc' }, { created_at: 'desc' }],
        select: patientInsuranceResponseSelect,
      });
      return { patientId: patient.id, insurances };
    },
    { requestContext: ctx },
  );
  if (!result) return notFound('患者が見つかりません');

  const { current, upcoming, history } = classifyPatientInsurances(result.insurances, today);
  const response = success({ data: { current, upcoming, history } });

  recordPhiReadAuditForRequest(ctx, {
    patientId: result.patientId,
    targetType: 'patient',
    targetId: result.patientId,
    view: 'patient_insurance',
  });

  return response;
}

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canViewDashboard',
  message: '患者保険情報の閲覧権限がありません',
});

async function authenticatedPOST(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = patientInsuranceCreateSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { valid_from, valid_until, application_submitted_at, decision_at, ...rest } = parsed.data;

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const writable = await requireWritablePatient(tx, ctx, id);
      if ('response' in writable) {
        return { kind: 'response' as const, response: writable.response };
      }

      if (rest.is_active !== false) {
        const overlappingInsurance = await tx.patientInsurance.findFirst({
          where: buildPatientInsuranceOverlapWhere({
            orgId: ctx.orgId,
            patientId: id,
            insuranceType: rest.insurance_type,
            publicProgramCode: rest.public_program_code,
            validFrom: valid_from,
            validUntil: valid_until,
          }),
          select: { id: true },
        });
        if (overlappingInsurance) {
          throw new PatientInsuranceOverlapError();
        }
      }

      const created = await tx.patientInsurance.create({
        data: {
          org_id: ctx.orgId,
          patient_id: id,
          ...rest,
          valid_from: valid_from ? new Date(valid_from) : null,
          valid_until: valid_until ? new Date(valid_until) : null,
          application_submitted_at: application_submitted_at
            ? new Date(application_submitted_at)
            : null,
          decision_at: decision_at ? new Date(decision_at) : null,
        },
        select: patientInsuranceResponseSelect,
      });
      return { kind: 'created' as const, created };
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
  return success({ data: result.created });
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canVisit',
  message: '患者保険情報の登録権限がありません',
});
