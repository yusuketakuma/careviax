import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import {
  createPartnerVisitPhysicianReportDraft,
  PartnerVisitPhysicianReportDraftError,
} from '@/server/services/partner-visit-report-drafts';

const DRAFT_ERROR_MESSAGES = {
  PARTNER_VISIT_RECORD_NOT_FOUND: '協力訪問記録が見つかりません',
  PARTNER_VISIT_RECORD_NOT_CONFIRMED: '確認済みの協力訪問記録のみ医師向け報告書を作成できます',
  PARTNER_VISIT_SOURCE_INACTIVE:
    '有効な患者共有ケースと確認済み協力訪問のみ医師向け報告書を作成できます',
  PATIENT_IDENTITY_STALE: '対象患者情報が更新されています。再読み込みしてください',
  REPORT_DRAFT_CONFLICT: '報告書下書きが同時に作成されました。再読み込みしてください',
} as const;

const createReportDraftSchema = z.object({
  expected_patient_updated_at: z.string().datetime('患者版情報が不正です'),
});

const SAFE_WORKFLOW_DETAIL_KEYS = [
  'status',
  'share_case_status',
  'visit_request_status',
  'partnership_status',
  'partner_pharmacy_status',
  'owner_partner_pharmacy_status',
  'blocker',
] as const;

const SAFE_WORKFLOW_STATUS_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function sanitizeWorkflowDetails(details: Record<string, unknown> | undefined) {
  if (!details) return undefined;

  const safeDetails: Record<string, string> = {};
  for (const key of SAFE_WORKFLOW_DETAIL_KEYS) {
    const value = details[key];
    if (typeof value === 'string' && SAFE_WORKFLOW_STATUS_PATTERN.test(value)) {
      safeDetails[key] = value;
    }
  }

  return Object.keys(safeDetails).length > 0 ? safeDetails : undefined;
}

function draftErrorResponse(error: PartnerVisitPhysicianReportDraftError) {
  switch (error.code) {
    case 'PARTNER_VISIT_RECORD_NOT_FOUND':
      return notFound(DRAFT_ERROR_MESSAGES.PARTNER_VISIT_RECORD_NOT_FOUND);
    case 'PARTNER_VISIT_RECORD_NOT_CONFIRMED':
    case 'PARTNER_VISIT_SOURCE_INACTIVE':
    case 'PATIENT_IDENTITY_STALE':
    case 'REPORT_DRAFT_CONFLICT':
      return conflict(DRAFT_ERROR_MESSAGES[error.code], sanitizeWorkflowDetails(error.details));
  }
}

const authenticatedPOST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) {
      return withSensitiveNoStore(validationError('協力訪問記録IDが不正です'));
    }
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    const parsed = createReportDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    try {
      const result = await withOrgContext(
        ctx.orgId,
        (tx) =>
          createPartnerVisitPhysicianReportDraft(tx, ctx, {
            partnerVisitRecordId: id,
            expectedPatientUpdatedAt: parsed.data.expected_patient_updated_at,
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return withSensitiveNoStore(
        success(
          {
            data: {
              message: result.reused
                ? '既存の医師向け報告書ドラフトを返しました'
                : '医師向け報告書ドラフトを作成しました',
              reused_existing_draft: result.reused,
              report: result.report,
            },
          },
          result.reused ? 200 : 201,
        ),
      );
    } catch (error) {
      if (error instanceof PartnerVisitPhysicianReportDraftError) {
        return withSensitiveNoStore(draftErrorResponse(error));
      }
      throw error;
    }
  },
  {
    permission: 'canAuthorReport',
    message: '医師向け報告書の作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};
