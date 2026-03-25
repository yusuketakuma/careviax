import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createCareReportSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  visit_record_id: z.string().optional(),
  report_type: z.enum([
    'physician_report',
    'care_manager_report',
    'facility_handoff',
    'nurse_share',
    'family_share',
    'internal_record',
  ]),
  content: z.record(z.unknown()).default({}).transform((v) => v as import('@prisma/client').Prisma.InputJsonValue),
  template_id: z.string().optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const patientId = searchParams.get('patient_id') ?? undefined;
  const status = searchParams.get('status') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(patientId ? { patient_id: patientId } : {}),
    ...(status
      ? {
          status: status as
            | 'draft'
            | 'sent'
            | 'failed'
            | 'confirmed'
            | 'response_waiting',
        }
      : {}),
  };

  const reports = await prisma.careReport.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
      report_type: true,
      status: true,
      content: true,
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
          status: true,
          sent_at: true,
        },
        orderBy: { created_at: 'desc' },
        take: 1,
      },
    },
  });

  const hasMore = reports.length > limit;
  const data = hasMore ? reports.slice(0, limit) : reports;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const report = await withOrgContext(req.orgId, async (tx) => {
    return tx.careReport.create({
      data: {
        org_id: req.orgId,
        created_by: req.userId,
        ...parsed.data,
      },
    });
  });

  return success({ data: report }, 201);
});
