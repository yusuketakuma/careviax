import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createTracingReportSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  issue_id: z.string().optional(),
  content: z.record(z.string(), z.unknown()).default({}),
  sent_to_physician: z.string().optional(),
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
            | 'received'
            | 'acknowledged',
        }
      : {}),
  };

  const reports = await prisma.tracingReport.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      issue_id: true,
      content: true,
      status: true,
      sent_to_physician: true,
      sent_at: true,
      acknowledged_at: true,
      pdf_url: true,
      created_at: true,
      updated_at: true,
    },
  });

  const hasMore = reports.length > limit;
  const data = hasMore ? reports.slice(0, limit) : reports;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canReport',
  message: 'トレーシングレポートの閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createTracingReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { patient_id, case_id, issue_id, content, sent_to_physician } = parsed.data;
  const report = await withOrgContext(req.orgId, async (tx) => {
    return tx.tracingReport.create({
      data: {
        org_id: req.orgId,
        patient_id,
        case_id,
        issue_id,
        content: content as import('@prisma/client').Prisma.InputJsonValue,
        sent_to_physician,
      },
    });
  });

  return success({ data: report }, 201);
}, {
  permission: 'canReport',
  message: 'トレーシングレポートの作成権限がありません',
});
