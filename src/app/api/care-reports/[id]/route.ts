import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import {
  conflict,
  forbiddenResponse,
  internalError,
  success,
  validationError,
  notFound,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { toPrismaJsonInput } from '@/lib/db/json';
import { formatNullableDateKey } from '@/lib/date-key';
import { z } from 'zod';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { findLatestPrescriberInstitutionSuggestion } from '@/lib/prescriptions/prescriber-institutions';
import {
  findExternalProfessionalSuggestions,
  getChannelStatsByName,
  getRecommendedChannels,
} from '@/lib/contact-profiles';
import { buildCareTeamContactChannelReadiness } from '@/lib/patient/care-team-contact';
import { inferCareReportTargetRole } from '@/lib/reports/care-report-target-role';
import { resolveDocumentDeliveryRule } from '@/lib/reports/document-delivery-rules';
import { canAccessCareReportSource } from '@/server/services/care-report-access';
import { buildCareReportActionPermissions } from '@/server/services/care-report-output-policy';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import type { CareReportActionPermissions } from '@/types/care-report-permissions';

const sensitiveResponse = withSensitiveNoStore;

function toDateOnlyString(value: Date | null | undefined) {
  return formatNullableDateKey(value);
}

const SERVER_MANAGED_CONTENT_KEYS = [
  'billing_context',
  'source_provenance',
  'report_delivery_targets',
  'warnings',
] as const;

function mergeEditableReportContent(args: {
  existingContent: unknown;
  incomingContent: Record<string, unknown>;
}) {
  if (typeof args.existingContent !== 'object' || args.existingContent === null) {
    return args.incomingContent;
  }
  if (Array.isArray(args.existingContent)) return args.incomingContent;

  const merged: Record<string, unknown> = { ...args.incomingContent };
  const existing = args.existingContent as Record<string, unknown>;
  for (const key of SERVER_MANAGED_CONTENT_KEYS) {
    if (key in existing) {
      merged[key] = existing[key];
    }
  }
  return merged;
}

const updateCareReportSchema = z.object({
  expected_updated_at: z.string().datetime('版情報が不正です'),
  report_type: z
    .enum([
      'physician_report',
      'care_manager_report',
      'facility_handoff',
      'nurse_share',
      'family_share',
      'internal_record',
    ])
    .optional(),
  status: z.enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting']).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  template_id: z.string().optional(),
});

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '報告書の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return sensitiveResponse(validationError('報告書IDが不正です'));

  const permissions: CareReportActionPermissions = buildCareReportActionPermissions(ctx.role);
  const canLoadEditableContent = permissions.can_edit || permissions.can_send;
  const canLoadDeliverySupport = permissions.can_send;

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const report = await tx.careReport.findFirst({
        where: { id, org_id: ctx.orgId },
        select: {
          id: true,
          patient_id: true,
          case_id: true,
          visit_record_id: true,
          report_type: true,
          status: true,
          content: canLoadEditableContent,
          template_id: true,
          pdf_url: true,
          created_by: true,
          created_at: true,
          updated_at: true,
          delivery_records: {
            select: {
              id: true,
              channel: true,
              recipient_name: true,
              recipient_contact: true,
              status: true,
              sent_at: true,
              created_at: true,
            },
            orderBy: { created_at: 'desc' },
          },
          case_: {
            select: { required_visit_support: true },
          },
        },
      });

      if (!report) return sensitiveResponse(notFound('報告書が見つかりません'));
      if (
        !(await canAccessCareReportSource(tx, ctx.orgId, ctx, {
          patientId: report.patient_id,
          caseId: report.case_id,
          visitRecordId: report.visit_record_id,
        }))
      ) {
        return sensitiveResponse(await forbiddenResponse('この報告書を閲覧する権限がありません'));
      }

      // case_id がある場合は intake baseline context を付加してUIでの表示に利用する
      const intakeBaselineContext = getHomeVisitIntake(
        report.case_?.required_visit_support ?? null,
      );
      const canLoadPatientContext = permissions.can_view_patient;

      const [patientSummary, visitSummary] = await Promise.all([
        canLoadPatientContext
          ? tx.patient.findFirst({
              where: { id: report.patient_id, org_id: ctx.orgId },
              select: {
                id: true,
                name: true,
                name_kana: true,
                birth_date: true,
              },
            })
          : Promise.resolve(null),
        canLoadPatientContext && report.visit_record_id
          ? tx.visitRecord.findFirst({
              where: {
                id: report.visit_record_id,
                org_id: ctx.orgId,
                patient_id: report.patient_id,
              },
              select: {
                id: true,
                visit_date: true,
              },
            })
          : Promise.resolve(null),
      ]);
      const prescriberInstitutionSuggestion = canLoadDeliverySupport
        ? await findLatestPrescriberInstitutionSuggestion(tx, ctx.orgId, {
            caseId: report.case_id,
            patientId: report.patient_id,
          })
        : null;
      const externalProfessionalSuggestions = canLoadDeliverySupport
        ? await findExternalProfessionalSuggestions(tx, ctx.orgId, {
            caseId: report.case_id,
            patientId: report.patient_id,
          })
        : [];
      const prescriberInstitutionStats =
        prescriberInstitutionSuggestion != null
          ? await getChannelStatsByName(tx, ctx.orgId, [prescriberInstitutionSuggestion.name])
          : new Map();
      const deliveryRuleSuggestion = canLoadDeliverySupport
        ? await resolveDocumentDeliveryRule({
            db: tx,
            orgId: ctx.orgId,
            documentType: 'care_report',
            targetRole: inferCareReportTargetRole(report.report_type),
          })
        : null;

      const reportData = Object.fromEntries(
        Object.entries(report).filter(
          ([key]) => key !== 'case_' && key !== 'org_id' && key !== 'content',
        ),
      );
      const reportResponseData = {
        ...reportData,
        ...(canLoadEditableContent ? { content: report.content } : {}),
        pdf_url: permissions.can_send ? report.pdf_url : null,
      };

      return sensitiveResponse(
        success({
          data: {
            ...reportResponseData,
            delivery_records: (report.delivery_records ?? []).map((record) => ({
              ...record,
              recipient_contact: canLoadDeliverySupport ? record.recipient_contact : null,
            })),
            patient_summary: patientSummary
              ? {
                  id: patientSummary.id,
                  name: patientSummary.name,
                  name_kana: patientSummary.name_kana,
                  birth_date: toDateOnlyString(patientSummary.birth_date),
                }
              : null,
            visit_summary: visitSummary
              ? {
                  id: visitSummary.id,
                  visit_date: visitSummary.visit_date.toISOString(),
                }
              : null,
            intake_baseline_context: intakeBaselineContext,
            permissions,
            delivery_rule_suggestion: deliveryRuleSuggestion,
            external_professional_suggestions: externalProfessionalSuggestions.map((item) => ({
              ...item,
              last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
            })),
            prescriber_institution_suggestion: prescriberInstitutionSuggestion
              ? {
                  ...prescriberInstitutionSuggestion,
                  recommended_channels: getRecommendedChannels({
                    phone: prescriberInstitutionSuggestion.phone,
                    fax: prescriberInstitutionSuggestion.fax,
                    address: prescriberInstitutionSuggestion.address,
                    stats: prescriberInstitutionStats.get(prescriberInstitutionSuggestion.name),
                  }),
                  contact_reliability: buildCareTeamContactChannelReadiness({
                    role: 'physician',
                    phone: prescriberInstitutionSuggestion.phone,
                    fax: prescriberInstitutionSuggestion.fax,
                  }),
                  prescribed_date: prescriberInstitutionSuggestion.prescribed_date.toISOString(),
                }
              : null,
          },
        }),
      );
    },
    { requestContext: ctx },
  );
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return sensitiveResponse(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return sensitiveResponse(internalError());
  }
}

async function authenticatedPATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAuthorReport',
    message: '報告書の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return sensitiveResponse(validationError('報告書IDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return sensitiveResponse(validationError('リクエストボディが不正です'));

  const parsed = updateCareReportSchema.safeParse(payload);
  if (!parsed.success) {
    return sensitiveResponse(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const { content, expected_updated_at: expectedUpdatedAtRaw, ...updateData } = parsed.data;
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      status: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
      content: true,
      updated_at: true,
    },
  });
  if (!existing) return sensitiveResponse(notFound('報告書が見つかりません'));
  if (updateData.report_type) {
    return sensitiveResponse(conflict('報告書種別は生成元と本文構造に紐づくため変更できません'));
  }
  if (
    !(await canAccessCareReportSource(prisma, ctx.orgId, ctx, {
      patientId: existing.patient_id,
      caseId: existing.case_id,
      visitRecordId: existing.visit_record_id,
    }))
  ) {
    return sensitiveResponse(await forbiddenResponse('この報告書を更新する権限がありません'));
  }

  // p1_04: 薬剤師確認(draft → confirmed)のみステータス遷移を許可する。
  // confirmed は薬学的判断のトレースなので AuditLog に記録する。
  // 送信系ステータス(sent/failed/response_waiting)は送信APIの責務。
  const isDraftConfirmTransition = updateData.status === 'confirmed' && existing.status === 'draft';
  if (updateData.status && updateData.status !== 'draft' && !isDraftConfirmTransition) {
    return sensitiveResponse(conflict('報告書の送信状態は送信APIからのみ更新できます'));
  }

  if (
    existing.status !== 'draft' &&
    (content !== undefined || updateData.template_id !== undefined)
  ) {
    return sensitiveResponse(
      conflict('薬剤師確認後または送付後の報告書本文はこのAPIから変更できません'),
    );
  }

  if (existing.status !== 'draft' && updateData.status === 'draft') {
    return sensitiveResponse(conflict('送信済みの報告書を下書きへ戻すことはできません'));
  }

  const report = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const claim = await tx.careReport.updateMany({
        where: {
          id,
          org_id: ctx.orgId,
          updated_at: expectedUpdatedAt,
        },
        data: {
          ...updateData,
          ...(content !== undefined
            ? {
                content: toPrismaJsonInput(
                  mergeEditableReportContent({
                    existingContent: existing.content,
                    incomingContent: content,
                  }),
                ),
              }
            : {}),
        },
      });
      if (claim.count !== 1) {
        return { error: 'state_changed' as const };
      }

      const updated = await tx.careReport.findFirst({
        where: { id, org_id: ctx.orgId },
      });
      if (!updated) {
        return { error: 'state_changed' as const };
      }

      if (isDraftConfirmTransition) {
        await createAuditLogEntry(tx, ctx, {
          action: 'care_report_confirmed',
          targetType: 'care_report',
          targetId: id,
          changes: { from: 'draft', to: 'confirmed' },
        });
      }

      return updated;
    },
    { requestContext: ctx },
  );
  if ('error' in report) {
    return sensitiveResponse(conflict('報告書が同時に更新されました。再読み込みしてください'));
  }

  return sensitiveResponse(success({ data: report }));
}

export async function PATCH(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return sensitiveResponse(await authenticatedPATCH(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return sensitiveResponse(internalError());
  }
}
