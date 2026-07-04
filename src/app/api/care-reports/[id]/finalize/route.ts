import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  conflict,
  forbiddenResponse,
  internalError,
  notFound,
  success,
  validationError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { allocateDisplayId } from '@/lib/db/display-id';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { canAccessCareReportSource } from '@/server/services/care-report-access';

const sensitiveResponse = withSensitiveNoStore;

const finalizeCareReportSchema = z.object({
  expected_updated_at: z.string().datetime('版情報が不正です'),
  pharmacist_credential_id: z.string().trim().min(1).optional(),
});

const DELIVERY_METADATA_CONTENT_KEYS = new Set([
  'report_delivery_targets',
  'delivery_records',
  'delivery_status',
  'send_request_id',
  'send_request_ids',
  'delivery_ack_state',
  'delivery_proof',
  'delivery_retry',
]);

function stableJsonStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
      .join(',')}}`;
  }
  return 'null';
}

export function buildFinalizedCareReportContentSnapshot(content: unknown) {
  const object = readJsonObject(content);
  if (!object) return {};
  return Object.fromEntries(
    Object.entries(object).filter(([key]) => !DELIVERY_METADATA_CONTENT_KEYS.has(key)),
  );
}

export function computeFinalizedCareReportContentHash(content: unknown) {
  return createHash('sha256')
    .update(stableJsonStringify(buildFinalizedCareReportContentSnapshot(content)))
    .digest('hex');
}

function isCredentialActive(credential: { expiry_date: Date | null }, now: Date) {
  return credential.expiry_date == null || credential.expiry_date.getTime() >= now.getTime();
}

async function authenticatedPOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAuthorReport',
    message: '報告書の確定権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return sensitiveResponse(validationError('報告書IDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return sensitiveResponse(validationError('リクエストボディが不正です'));

  const parsed = finalizeCareReportSchema.safeParse(payload);
  if (!parsed.success) {
    return sensitiveResponse(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const report = await tx.careReport.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          visit_record_id: true,
          status: true,
          content: true,
          updated_at: true,
          finalized_at: true,
          locked_at: true,
          voided_at: true,
          report_revision: true,
          pdf_hash: true,
        },
      });
      if (!report) return { error: 'not_found' as const };
      if (
        !(await canAccessCareReportSource(tx, ctx.orgId, ctx, {
          patientId: report.patient_id,
          caseId: report.case_id,
          visitRecordId: report.visit_record_id,
        }))
      ) {
        return { error: 'forbidden' as const };
      }
      if (report.status !== 'draft') return { error: 'not_draft' as const };
      if (report.finalized_at != null || report.locked_at != null || report.voided_at != null) {
        return { error: 'already_finalized' as const };
      }

      const credentialWhere = {
        org_id: ctx.orgId,
        user_id: ctx.userId,
        ...(parsed.data.pharmacist_credential_id
          ? { id: parsed.data.pharmacist_credential_id }
          : {}),
      };
      const credentials = await tx.pharmacistCredential.findMany({
        where: credentialWhere,
        select: {
          id: true,
          certification_type: true,
          certification_number: true,
          expiry_date: true,
        },
        orderBy: { created_at: 'desc' },
        take: parsed.data.pharmacist_credential_id ? 1 : 2,
      });
      const activeCredentials = credentials.filter((credential) =>
        isCredentialActive(credential, new Date()),
      );
      if (activeCredentials.length === 0) return { error: 'credential_required' as const };
      if (!parsed.data.pharmacist_credential_id && activeCredentials.length > 1) {
        return { error: 'credential_ambiguous' as const };
      }
      const credential = activeCredentials[0];
      if (!credential) return { error: 'credential_required' as const };

      const now = new Date();
      const contentSnapshot = buildFinalizedCareReportContentSnapshot(report.content);
      const contentHash = computeFinalizedCareReportContentHash(report.content);
      const revisionDisplayId = await allocateDisplayId(tx, 'CareReportRevision', ctx.orgId);

      const claim = await tx.careReport.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          status: 'draft',
          updated_at: expectedUpdatedAt,
          finalized_at: null,
          locked_at: null,
          voided_at: null,
        },
        data: {
          finalized_at: now,
          finalized_by: ctx.userId,
          locked_at: now,
          locked_by: ctx.userId,
          content_hash: contentHash,
          finalized_pharmacist_credential_id: credential.id,
          finalized_credential_type: credential.certification_type,
          finalized_credential_number: credential.certification_number,
          finalized_credential_role_snapshot: ctx.role,
          finalized_credential_checked_at: now,
        },
      });
      if (claim.count !== 1) return { error: 'state_changed' as const };

      await tx.careReportRevision.create({
        data: {
          org_id: ctx.orgId,
          display_id: revisionDisplayId,
          report_id: id,
          revision_no: report.report_revision,
          content_snapshot: toPrismaJsonInput(contentSnapshot),
          content_hash: contentHash,
          pdf_hash: report.pdf_hash,
          created_by: ctx.userId,
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'care_report_finalized',
        targetType: 'care_report',
        targetId: id,
        patientId: report.patient_id,
        changes: {
          revision_no: report.report_revision,
          content_hash: contentHash,
          credential_id: credential.id,
          credential_type: credential.certification_type,
          role_snapshot: ctx.role,
          finalized_at: now.toISOString(),
          locked_at: now.toISOString(),
        },
      });

      const updated = await tx.careReport.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          finalized_at: true,
          finalized_by: true,
          locked_at: true,
          locked_by: true,
          report_revision: true,
          content_hash: true,
          updated_at: true,
          finalized_pharmacist_credential_id: true,
          finalized_credential_type: true,
          finalized_credential_role_snapshot: true,
          finalized_credential_checked_at: true,
        },
      });
      if (!updated) return { error: 'state_changed' as const };
      return { report: updated, revision: { display_id: revisionDisplayId } };
    },
    { requestContext: ctx },
  );

  if ('error' in result) {
    switch (result.error) {
      case 'not_found':
        return sensitiveResponse(notFound('報告書が見つかりません'));
      case 'forbidden':
        return sensitiveResponse(await forbiddenResponse('この報告書を確定する権限がありません'));
      case 'not_draft':
        return sensitiveResponse(conflict('下書き以外の報告書は確定できません'));
      case 'already_finalized':
        return sensitiveResponse(conflict('確定済みまたは無効化済みの報告書です'));
      case 'credential_required':
        return sensitiveResponse(conflict('有効な薬剤師資格が必要です'));
      case 'credential_ambiguous':
        return sensitiveResponse(conflict('確定に使用する薬剤師資格を指定してください'));
      case 'state_changed':
        return sensitiveResponse(conflict('報告書が同時に更新されました。再読み込みしてください'));
    }
  }

  return sensitiveResponse(
    success({
      data: {
        ...result.report,
        revision: result.revision,
      },
    }),
  );
}

export async function POST(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return sensitiveResponse(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return sensitiveResponse(internalError());
  }
}
