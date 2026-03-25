import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth/config';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const sendCareReportSchema = z.object({
  channel: z.enum(['email', 'fax', 'phone', 'in_person', 'postal', 'ses']),
  recipient_name: z.string().min(1, '送付先氏名は必須です'),
  recipient_contact: z.string().min(1, '送付先連絡先は必須です'),
});

async function getAuthContext(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const orgId = req.headers.get('x-org-id');
  if (!orgId) return null;
  return { userId: session.user.id, orgId };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getAuthContext(req);
  if (!ctx) return forbidden('認証が必要です');

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = sendCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) return notFound('報告書が見つかりません');

  const result = await withOrgContext(ctx.orgId, async (tx) => {
    // DeliveryRecord を作成し、MVPではステータスを sent に設定
    const deliveryRecord = await tx.deliveryRecord.create({
      data: {
        org_id: ctx.orgId,
        report_id: id,
        channel: parsed.data.channel,
        recipient_name: parsed.data.recipient_name,
        recipient_contact: parsed.data.recipient_contact,
        status: 'sent',
        sent_at: new Date(),
      },
    });

    // 報告書のステータスも sent に更新
    const report = await tx.careReport.update({
      where: { id },
      data: { status: 'sent' },
    });

    return { report, deliveryRecord };
  });

  return success({ data: result });
}
