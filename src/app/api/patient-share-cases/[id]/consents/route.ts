import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { CONSENT_DOCUMENT_MIME_TYPES } from '@/server/services/consent-record-documents';
import { resolvePatientShareCaseTransition } from '@/server/services/pharmacy-partnerships';

const consentMethodSchema = z.enum(['paper_scan', 'digital']);
const consentDateSchema = dateKeySchema('同意日が不正です（YYYY-MM-DD）');

const createPatientShareConsentSchema = z
  .object({
    consent_date: consentDateSchema,
    consent_person: z.string().trim().min(1, '同意者は必須です').max(120),
    consent_method: consentMethodSchema,
    scope: z.record(z.string(), z.unknown()).default({}),
    consent_record_id: z.string().trim().min(1).max(128).optional(),
    file_asset_id: z.string().trim().min(1).max(128).optional(),
    valid_until: consentDateSchema.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.valid_until && value.valid_until < value.consent_date) {
      ctx.addIssue({
        code: 'custom',
        path: ['valid_until'],
        message: '有効期限は同意日以降を指定してください',
      });
    }
  });

type SafePatientShareConsentRow = {
  id: string;
  share_case_id: string;
  consent_record_id: string | null;
  consent_date: Date;
  consent_method: string;
  scope: unknown;
  file_asset_id: string | null;
  valid_until: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

function toSafePatientShareConsent(row: SafePatientShareConsentRow) {
  const scope = readJsonObject(row.scope);
  return {
    id: row.id,
    share_case_id: row.share_case_id,
    consent_record_id: row.consent_record_id,
    consent_date: row.consent_date,
    consent_method: row.consent_method,
    scope_keys: Object.keys(scope ?? {}).sort(),
    has_file_asset: Boolean(row.file_asset_id),
    valid_until: row.valid_until,
    revoked_at: row.revoked_at,
    revoked_by: row.revoked_by,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const GET = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('患者共有ケースIDが不正です'));

    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const rows = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, base_patient_id: true },
      });
      if (!shareCase) return null;

      const consentRows = await tx.patientShareConsent.findMany({
        where: { org_id: ctx.orgId, share_case_id: id },
        select: {
          id: true,
          share_case_id: true,
          consent_record_id: true,
          consent_date: true,
          consent_method: true,
          scope: true,
          file_asset_id: true,
          valid_until: true,
          revoked_at: true,
          revoked_by: true,
          created_by: true,
          created_at: true,
          updated_at: true,
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });
      const pageRows = consentRows.slice(0, limit);

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_consents_viewed',
        targetType: 'PatientShareConsent',
        targetId: id,
        patientId: shareCase.base_patient_id,
        changes: {
          target_screen: 'patient_share_case_consents',
          viewer_role: ctx.role,
          share_case_id: id,
          viewed_count: pageRows.length,
          consent_ids: pageRows.map((row) => row.id),
          consent_record_count: pageRows.filter((row) => row.consent_record_id).length,
          file_asset_count: pageRows.filter((row) => row.file_asset_id).length,
          revoked_count: pageRows.filter((row) => row.revoked_at).length,
          has_cursor: Boolean(cursor),
          has_more: consentRows.length > limit,
          limit,
        },
      });

      return consentRows;
    });

    if (!rows) return withSensitiveNoStore(notFound('患者共有ケースが見つかりません'));
    const page = buildCursorPage(rows, limit, (row) => row.id);
    return withSensitiveNoStore(
      success({
        ...page,
        data: page.data.map(toSafePatientShareConsent),
      }),
    );
  },
  {
    permission: 'canVisit',
    message: '患者共有同意の閲覧権限がありません',
  },
);

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return withSensitiveNoStore(validationError('患者共有ケースIDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createPatientShareConsentSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const shareCase = await tx.patientShareCase.findFirst({
        where: { id, org_id: ctx.orgId },
        select: { id: true, status: true, base_patient_id: true },
      });

      if (!shareCase) return { response: notFound('患者共有ケースが見つかりません') };
      const shareCaseTransition = resolvePatientShareCaseTransition({
        currentStatus: shareCase.status,
        action: 'register_consent',
      });
      if (!shareCaseTransition.allowed) {
        return {
          response: conflict('終了・撤回・辞退済みの患者共有ケースには同意を追加できません'),
        };
      }

      if (parsed.data.consent_record_id) {
        const consentRecord = await tx.consentRecord.findFirst({
          where: {
            id: parsed.data.consent_record_id,
            org_id: ctx.orgId,
            patient_id: shareCase.base_patient_id,
            revoked_date: null,
            is_active: true,
          },
          select: { id: true },
        });
        if (!consentRecord) {
          return {
            response: validationError('入力値が不正です', {
              consent_record_id: ['患者共有ケースに紐づく有効な同意記録ではありません'],
            }),
          };
        }
      }

      if (parsed.data.file_asset_id) {
        const fileAsset = await tx.fileAsset.findFirst({
          where: {
            id: parsed.data.file_asset_id,
            org_id: ctx.orgId,
            purpose: 'consent-document',
            status: 'uploaded',
            mime_type: { in: CONSENT_DOCUMENT_MIME_TYPES },
            patient_id: shareCase.base_patient_id,
          },
          select: { id: true },
        });
        if (!fileAsset) {
          return {
            response: validationError('入力値が不正です', {
              file_asset_id: ['利用可能な添付ファイルではありません'],
            }),
          };
        }
      }

      const consent = await tx.patientShareConsent.create({
        data: {
          org_id: ctx.orgId,
          share_case_id: id,
          consent_record_id: parsed.data.consent_record_id,
          consent_date: utcDateFromLocalKey(parsed.data.consent_date),
          consent_person: parsed.data.consent_person,
          consent_method: parsed.data.consent_method,
          scope: toPrismaJsonInput(parsed.data.scope),
          file_asset_id: parsed.data.file_asset_id,
          valid_until: parsed.data.valid_until
            ? utcDateFromLocalKey(parsed.data.valid_until)
            : null,
          created_by: ctx.userId,
        },
      });

      const nextShareCaseStatus = shareCaseTransition.nextStatus;
      if (nextShareCaseStatus !== shareCase.status) {
        await tx.patientShareCase.update({
          where: { id_org_id: { id, org_id: ctx.orgId } },
          data: {
            status: nextShareCaseStatus,
            updated_by: ctx.userId,
          },
          select: { id: true },
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'patient_share_consent_registered',
        targetType: 'PatientShareConsent',
        targetId: consent.id,
        patientId: shareCase.base_patient_id,
        changes: {
          share_case_id: id,
          share_case_status_before: shareCase.status,
          share_case_status_after: nextShareCaseStatus,
          consent_date: parsed.data.consent_date,
          consent_method: parsed.data.consent_method,
          scope_keys: Object.keys(parsed.data.scope).sort(),
          has_consent_record: Boolean(parsed.data.consent_record_id),
          has_file_asset: Boolean(parsed.data.file_asset_id),
          consent_person_length: parsed.data.consent_person.length,
          valid_until: parsed.data.valid_until ?? null,
        },
      });

      return { consent };
    });

    if ('response' in result) {
      return withSensitiveNoStore(result.response ?? validationError('入力値が不正です'));
    }
    return withSensitiveNoStore(success(toSafePatientShareConsent(result.consent), 201));
  },
  {
    permission: 'canManagePatientSharing',
    message: '患者共有同意の登録権限がありません',
  },
);
