import { withAuthContext, requireAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { NextRequest } from 'next/server';
import { getPatientPrivacyFlags } from '@/lib/patient/privacy';

const patchSelfReportSchema = z.object({
  status: z.enum(['submitted', 'triaged', 'converted_to_task', 'resolved', 'dismissed']).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  content: z.string().trim().min(1).max(4000).optional(),
  requested_callback: z.boolean().optional(),
  preferred_contact_time: z.string().trim().max(200).nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '患者自己申告の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const reportRef = await prisma.patientSelfReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, patient_id: true },
  });
  if (!reportRef) return notFound('患者自己申告が見つかりません');

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
  if (!patient) return notFound('患者自己申告が見つかりません');

  const report = await prisma.patientSelfReport.findFirst({
    where: { id: reportRef.id, org_id: ctx.orgId },
  });
  if (!report) return notFound('患者自己申告が見つかりません');

  const privacy = getPatientPrivacyFlags(ctx.role);
  return success({
    data: {
      ...report,
      preferred_contact_time: privacy.sensitiveFieldsMasked ? null : report.preferred_contact_time,
    },
  });
}

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id } = await routeContext.params;
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = patchSelfReportSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.patientSelfReport.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, patient_id: true, triaged_at: true },
    });
    if (!existing) return notFound('患者自己申告が見つかりません');

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
    if (!patient) return notFound('患者自己申告が見つかりません');

    const shouldStampTriage =
      parsed.data.status !== undefined &&
      parsed.data.status !== 'submitted' &&
      existing.triaged_at === null;

    const updated = await withOrgContext(ctx.orgId, (tx) =>
      tx.patientSelfReport.update({
        where: { id },
        data: {
          ...parsed.data,
          ...(shouldStampTriage
            ? {
                triaged_by: ctx.userId,
                triaged_at: new Date(),
              }
            : {}),
        },
      }),
    );

    return success({ data: updated });
  },
  {
    permission: 'canReport',
    message: '患者自己申告の更新権限がありません',
  },
);
