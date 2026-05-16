import { withAuthContext } from '@/lib/auth/context';
import { parsePaginationParams } from '@/lib/api/pagination';
import { notFound, success, validationError } from '@/lib/api/response';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createSelfReportSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  reported_by_name: z.string().trim().min(1, '報告者氏名は必須です'),
  relation: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1, 'カテゴリは必須です').max(100),
  subject: z.string().trim().min(1, '件名は必須です').max(200),
  content: z.string().trim().min(1, '内容は必須です').max(4000),
  requested_callback: z.boolean().default(false),
  preferred_contact_time: z.string().trim().max(200).optional(),
});

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const patientId = searchParams.get('patient_id') ?? undefined;
    const status = searchParams.get('status') ?? undefined;

    const accessiblePatients = await prisma.patient.findMany({
      where: applyPatientAssignmentWhere(
        {
          org_id: ctx.orgId,
          ...(patientId ? { id: patientId } : {}),
        },
        ctx,
      ),
      select: {
        id: true,
        name: true,
        name_kana: true,
      },
    });
    const patientMap = new Map(accessiblePatients.map((patient) => [patient.id, patient]));
    const accessiblePatientIds = accessiblePatients.map((patient) => patient.id);

    if (accessiblePatientIds.length === 0) {
      return success({ data: [], hasMore: false, nextCursor: undefined });
    }

    const reports = await prisma.patientSelfReport.findMany({
      where: {
        org_id: ctx.orgId,
        patient_id: patientId ?? { in: accessiblePatientIds },
        ...(status
          ? {
              status: status as
                | 'submitted'
                | 'triaged'
                | 'converted_to_task'
                | 'resolved'
                | 'dismissed',
            }
          : {}),
      },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        patient_id: true,
        reported_by_name: true,
        relation: true,
        category: true,
        subject: true,
        content: true,
        requested_callback: true,
        preferred_contact_time: true,
        status: true,
        triaged_by: true,
        triaged_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = reports.length > limit;
    const data = (hasMore ? reports.slice(0, limit) : reports).map((report) => ({
      ...report,
      patient_name: patientMap.get(report.patient_id)?.name ?? null,
      patient_name_kana: patientMap.get(report.patient_id)?.name_kana ?? null,
    }));
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canReport',
    message: '患者自己申告の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createSelfReportSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        {
          id: parsed.data.patient_id,
          org_id: ctx.orgId,
        },
        ctx,
      ),
      select: { id: true },
    });
    if (!patient) return notFound('患者が見つかりません');

    const created = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.patientSelfReport.create({
        data: {
          org_id: ctx.orgId,
          patient_id: parsed.data.patient_id,
          reported_by_name: parsed.data.reported_by_name,
          relation: parsed.data.relation ?? null,
          category: parsed.data.category,
          subject: parsed.data.subject,
          content: parsed.data.content,
          requested_callback: parsed.data.requested_callback,
          preferred_contact_time: parsed.data.preferred_contact_time ?? null,
          triaged_by: ctx.userId,
          triaged_at: new Date(),
          status: 'triaged',
        },
      });
    });

    return success({ data: created }, 201);
  },
  {
    permission: 'canReport',
    message: '患者自己申告の登録権限がありません',
  },
);
