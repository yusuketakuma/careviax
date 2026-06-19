import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseSearchParams } from '@/lib/api/validation';
import { quotedCsvRow } from '@/lib/csv/safe-csv';
import { prisma } from '@/lib/db/client';

const templateQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です').optional(),
});

const TEMPLATE_HEADER = ['YJコード', '医薬品名', '採用', '発注点', '優先後発品YJコード', 'メモ'];

function buildTemplateFilename(siteId: string | undefined) {
  const filename = siteId ? `formulary-template-${siteId}.csv` : 'formulary-template.csv';
  return encodeURIComponent(filename);
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(templateQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const siteId = parsed.data.site_id;
    if (siteId) {
      const site = await prisma.pharmacySite.findFirst({
        where: { id: siteId, org_id: authCtx.orgId },
        select: { id: true },
      });
      if (!site) return withSensitiveNoStore(notFound('対象の薬局拠点が見つかりません'));
    }

    await createAuditLogEntry(prisma, authCtx, {
      action: 'pharmacy_drug_stock_template_downloaded',
      targetType: siteId ? 'PharmacySite' : 'PharmacyDrugStock',
      targetId: siteId ?? 'template',
      changes: {
        site_id: siteId ?? null,
        headers: TEMPLATE_HEADER,
      },
    });

    const csv = quotedCsvRow(TEMPLATE_HEADER);
    const encodedFileName = buildTemplateFilename(siteId);

    return withSensitiveNoStore(
      new NextResponse(`\uFEFF${csv}\n`, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
        },
      }),
    );
  },
  { permission: 'canAdmin' },
);
