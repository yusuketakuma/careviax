import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const templateQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です').optional(),
});

const TEMPLATE_HEADER = [
  'YJコード',
  '医薬品名',
  '採用',
  '発注点',
  '優先後発品YJコード',
  'メモ',
];

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(templateQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const siteId = parsed.data.site_id;
    if (siteId) {
      const site = await prisma.pharmacySite.findFirst({
        where: { id: siteId, org_id: authCtx.orgId },
        select: { id: true },
      });
      if (!site) return notFound('対象の薬局拠点が見つかりません');
    }

    await prisma.auditLog.create({
      data: {
        org_id: authCtx.orgId,
        actor_id: authCtx.userId,
        action: 'pharmacy_drug_stock_template_downloaded',
        target_type: siteId ? 'PharmacySite' : 'PharmacyDrugStock',
        target_id: siteId ?? 'template',
        changes: {
          site_id: siteId ?? null,
          headers: TEMPLATE_HEADER,
        },
        ip_address: authCtx.ipAddress,
        user_agent: authCtx.userAgent,
      },
    });

    const csv = TEMPLATE_HEADER.map(csvCell).join(',');
    const fileName = siteId ? `formulary-template-${siteId}.csv` : 'formulary-template.csv';

    return new NextResponse(`\uFEFF${csv}\n`, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  },
  { permission: 'canAdmin' },
);
