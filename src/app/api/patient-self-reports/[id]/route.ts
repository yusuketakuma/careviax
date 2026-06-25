import { withAuthContext, requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { getPatientPrivacyFlags } from '@/lib/patient/privacy';
import {
  patientSelfReportResponseSelect,
  serializePatientSelfReport,
} from '@/lib/patient/self-report-response';
import { selfReportStatusSchema } from '@/lib/validations/self-report';

const patchSelfReportSchema = z.object({
  updated_at: z.string().datetime('updated_at の日時形式が不正です'),
  status: selfReportStatusSchema.optional(),
  category: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(4000).optional(),
  requested_callback: z.boolean().optional(),
  preferred_contact_time: z.string().trim().max(200).nullable().optional(),
});

const SELF_REPORT_CONFLICT_MESSAGE =
  '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。';

class PatientSelfReportConflictError extends Error {}

const sensitiveResponse = withSensitiveNoStore;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '患者自己申告の閲覧権限がありません',
  });
  if ('response' in authResult) return sensitiveResponse(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return sensitiveResponse(validationError('患者自己申告IDが不正です'));

  const reportRef = await prisma.patientSelfReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, patient_id: true },
  });
  if (!reportRef) return sensitiveResponse(notFound('患者自己申告が見つかりません'));

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      {
        id: reportRef.patient_id,
        org_id: ctx.orgId,
      },
      ctx,
    ),
    select: { id: true },
  });
  if (!patient) return sensitiveResponse(notFound('患者自己申告が見つかりません'));

  const report = await prisma.patientSelfReport.findFirst({
    where: { id: reportRef.id, org_id: ctx.orgId },
    select: patientSelfReportResponseSelect,
  });
  if (!report) return sensitiveResponse(notFound('患者自己申告が見つかりません'));

  const privacy = getPatientPrivacyFlags(ctx.role);
  return sensitiveResponse(
    success({
      data: serializePatientSelfReport(report, privacy),
    }),
  );
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return sensitiveResponse(validationError('患者自己申告IDが不正です'));

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return sensitiveResponse(validationError('リクエストボディが不正です'));

    const parsed = patchSelfReportSchema.safeParse(payload);
    if (!parsed.success) {
      return sensitiveResponse(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }
    const { updated_at: expectedUpdatedAtRaw, ...patchData } = parsed.data;
    if (Object.keys(patchData).length === 0) {
      return sensitiveResponse(
        validationError('更新する項目を指定してください', {
          body: ['更新する項目を指定してください'],
        }),
      );
    }
    const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);

    const existing = await prisma.patientSelfReport.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, triaged_at: true, updated_at: true },
    });
    if (!existing) return sensitiveResponse(notFound('患者自己申告が見つかりません'));

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        {
          id: existing.patient_id,
          org_id: ctx.orgId,
        },
        ctx,
      ),
      select: { id: true },
    });
    if (!patient) return sensitiveResponse(notFound('患者自己申告が見つかりません'));

    const updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const freshReport = await tx.patientSelfReport.findFirst({
          where: { id, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
          select: {
            id: true,
            patient_id: true,
            status: true,
            requested_callback: true,
            triaged_at: true,
            updated_at: true,
          },
        });
        if (!freshReport) throw new PatientSelfReportConflictError();

        const freshPatient = await tx.patient.findFirst({
          where: applyPatientAssignmentWhere(
            {
              id: freshReport.patient_id,
              org_id: ctx.orgId,
            },
            ctx,
          ),
          select: { id: true },
        });
        if (!freshPatient) throw new PatientSelfReportConflictError();

        const shouldStampTriage =
          patchData.status !== undefined &&
          patchData.status !== 'submitted' &&
          freshReport.triaged_at === null;

        const updateResult = await tx.patientSelfReport.updateMany({
          where: { id, org_id: ctx.orgId, updated_at: expectedUpdatedAt },
          data: {
            ...patchData,
            ...(shouldStampTriage
              ? {
                  triaged_by: ctx.userId,
                  triaged_at: new Date(),
                }
              : {}),
          },
        });
        if (updateResult.count !== 1) throw new PatientSelfReportConflictError();

        const updatedReport = await tx.patientSelfReport.findUnique({
          where: { id },
          select: patientSelfReportResponseSelect,
        });
        if (!updatedReport) throw new PatientSelfReportConflictError();

        await createAuditLogEntry(tx, ctx, {
          action: 'patient_self_report_updated',
          targetType: 'patient_self_report',
          targetId: id,
          changes: {
            patient_id: freshReport.patient_id,
            changed_fields: Object.keys(patchData).sort(),
            status_before: freshReport.status,
            status_after: updatedReport.status,
            requested_callback_before: freshReport.requested_callback,
            requested_callback_after: updatedReport.requested_callback,
            triage_stamped: shouldStampTriage,
          },
        });

        return updatedReport;
      },
      { requestContext: ctx },
    ).catch((error) => {
      if (error instanceof PatientSelfReportConflictError) {
        return { error: 'conflict' as const };
      }
      throw error;
    });

    if ('error' in updated) return sensitiveResponse(conflict(SELF_REPORT_CONFLICT_MESSAGE));

    const privacy = getPatientPrivacyFlags(ctx.role);
    return sensitiveResponse(success({ data: serializePatientSelfReport(updated, privacy) }));
  },
  {
    permission: 'canReport',
    message: '患者自己申告の更新権限がありません',
  },
);
