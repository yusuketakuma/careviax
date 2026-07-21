import { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { success, notFound, registeredError, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import {
  createQualificationCheckAdapter,
  QualificationCheckAdapterError,
  type QualificationCheckResult,
} from '@/server/adapters/qualification-check';
import { japanDateKey } from '@/lib/utils/date-boundary';
import { enqueueQualificationCheckedWebhook } from '@/server/services/outbound-webhook-queue';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { resolvePatientInsurance } from '@/server/services/patient-insurance';
import { requireWritablePatient } from '@/server/services/patient-write-guard';

const QUALIFICATION_CHECK_ERROR_MESSAGES = {
  NOT_IMPLEMENTED: 'オンライン資格確認はまだ有効化されていません',
  INVALID_REQUEST: '資格確認リクエストが不正です',
  INVALID_CONFIGURATION: 'オンライン資格確認の設定に問題があります',
  UNAUTHORIZED: 'オンライン資格確認サービスへの認証に失敗しました',
  UPSTREAM_FAILURE: 'オンライン資格確認サービスの呼び出しに失敗しました',
} as const;

type ScopedQualificationPatient =
  | { response: Response }
  | {
      patient: {
        id: string;
        name: string;
        name_kana: string | null;
        medical_insurance_number: string | null;
        care_insurance_number: string | null;
      };
      insuranceNumber: string | null;
    };

type QualificationIdentityMatch = 'matched' | 'mismatch' | 'unknown';

function normalizeIdentityName(value: string | null | undefined) {
  return value?.normalize('NFKC').replace(/\s+/g, '').trim().toLowerCase();
}

function resolveIdentityMatch(
  result: QualificationCheckResult,
  patient: Extract<ScopedQualificationPatient, { patient: unknown }>['patient'],
): QualificationIdentityMatch {
  const providerName = normalizeIdentityName(result.patientName);
  if (!providerName) return 'unknown';

  const localNames = [patient.name, patient.name_kana]
    .map((value) => normalizeIdentityName(value))
    .filter((value): value is string => Boolean(value));

  if (localNames.length === 0) return 'unknown';
  return localNames.includes(providerName) ? 'matched' : 'mismatch';
}

function clientQualificationCheckResult(
  result: QualificationCheckResult | null,
  patient: Extract<ScopedQualificationPatient, { patient: unknown }>['patient'],
) {
  if (!result) return null;

  const identityMatch = resolveIdentityMatch(result, patient);
  const identityWarnings =
    identityMatch === 'matched'
      ? []
      : [
          identityMatch === 'mismatch'
            ? '資格確認結果の氏名が患者情報と一致しません'
            : '資格確認結果の氏名を患者情報と照合できません',
        ];

  return {
    valid: identityMatch === 'matched' ? result.valid : false,
    identityMatch,
    payerName: result.payerName,
    payerType: result.payerType,
    copayRatio: result.copayRatio,
    coverage: result.coverage,
    warnings: [...identityWarnings, ...result.warnings],
  };
}

function qualificationCheckAdapterErrorResponse(cause: QualificationCheckAdapterError): Response {
  switch (cause.code) {
    case 'NOT_IMPLEMENTED':
      return registeredError('OQC_NOT_ENABLED', QUALIFICATION_CHECK_ERROR_MESSAGES.NOT_IMPLEMENTED);
    case 'UNAUTHORIZED':
      return registeredError('OQC_UNAUTHORIZED', QUALIFICATION_CHECK_ERROR_MESSAGES.UNAUTHORIZED);
    case 'INVALID_REQUEST':
    case 'INVALID_CONFIGURATION':
    case 'UPSTREAM_FAILURE':
      return registeredError(
        'OQC_UPSTREAM_FAILURE',
        QUALIFICATION_CHECK_ERROR_MESSAGES[cause.code],
      );
  }
}

async function authenticatedPOST(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const scopedPatient = await withOrgContext<ScopedQualificationPatient>(
    ctx.orgId,
    async (tx) => {
      const writable = await requireWritablePatient(tx, ctx, id);
      if ('response' in writable) return { response: writable.response };

      const patient = await tx.patient.findFirst({
        where: applyPatientAssignmentWhere(
          { id, org_id: ctx.orgId },
          { userId: ctx.userId, role: ctx.role },
        ),
        select: {
          id: true,
          name: true,
          name_kana: true,
          medical_insurance_number: true,
          care_insurance_number: true,
        },
      });
      if (!patient) return { response: notFound('患者が見つかりません') };

      const activeMedicalInsurance = await resolvePatientInsurance(tx, {
        orgId: ctx.orgId,
        patientId: patient.id,
        type: 'medical',
      });

      return {
        patient,
        insuranceNumber: activeMedicalInsurance?.number ?? patient.medical_insurance_number,
      };
    },
    { requestContext: ctx },
  );

  if ('response' in scopedPatient) return scopedPatient.response;
  const { patient, insuranceNumber } = scopedPatient;

  try {
    const adapter = createQualificationCheckAdapter({
      provider: (process.env.OQC_PROVIDER as 'stub' | 'mhlw') ?? 'stub',
      baseUrl: process.env.OQC_BASE_URL,
      clientId: process.env.OQC_CLIENT_ID,
      clientSecret: process.env.OQC_CLIENT_SECRET,
      accessToken: process.env.OQC_ACCESS_TOKEN,
    });

    const result = await adapter.checkInsurance({
      insuranceNumber: insuranceNumber ?? undefined,
      // 資格確認の基準日は JST 業務日。runtime-local format だと UTC prod の JST 早朝で前日になる。
      asOfDate: japanDateKey(),
    });

    const checkedAt = new Date();
    await withOrgContext(
      ctx.orgId,
      (tx) =>
        enqueueQualificationCheckedWebhook(tx, {
          orgId: ctx.orgId,
          patientId: patient.id,
          checkedAt,
          insuranceNumberPresent: Boolean(insuranceNumber),
          identityMatch: result ? resolveIdentityMatch(result, patient) : 'unknown',
        }),
      { requestContext: ctx },
    );

    return success({
      data: clientQualificationCheckResult(result, patient),
      meta: { capabilities: adapter.getCapabilities() },
    });
  } catch (cause) {
    if (cause instanceof QualificationCheckAdapterError) {
      return qualificationCheckAdapterErrorResponse(cause);
    }
    throw cause;
  }
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canVisit',
  message: '資格確認の実行権限がありません',
});
