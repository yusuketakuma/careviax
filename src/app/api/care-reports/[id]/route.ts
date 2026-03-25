import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const updateCareReportSchema = z.object({
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
  status: z
    .enum(['draft', 'sent', 'failed', 'confirmed', 'response_waiting'])
    .optional(),
  content: z.record(z.unknown()).transform((v) => v as import('@prisma/client').Prisma.InputJsonValue).optional(),
  template_id: z.string().optional(),
});

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const report = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      delivery_records: {
        orderBy: { created_at: 'desc' },
      },
    },
  });

  if (!report) return notFound('報告書が見つかりません');

  return success({ data: report });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!existing) return notFound('報告書が見つかりません');

  const report = await withOrgContext(ctx.orgId, async (tx) => {
    return tx.careReport.update({
      where: { id },
      data: parsed.data,
    });
  });

  return success({ data: report });
}
