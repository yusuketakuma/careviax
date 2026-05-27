import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const exportQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
});

function safeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const neutralized = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(exportQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const stocks = await prisma.pharmacyDrugStock.findMany({
      where: {
        org_id: authCtx.orgId,
        site_id: site.id,
        is_stocked: true,
      },
      orderBy: [{ drug_master: { drug_name_kana: 'asc' } }, { drug_master: { drug_name: 'asc' } }],
      select: {
        is_stocked: true,
        reorder_point: true,
        adoption_note: true,
        last_reviewed_at: true,
        drug_master: {
          select: {
            yj_code: true,
            receipt_code: true,
            drug_name: true,
            generic_name: true,
            drug_price: true,
            unit: true,
            manufacturer: true,
          },
        },
        preferred_generic: {
          select: {
            yj_code: true,
            drug_name: true,
          },
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        org_id: authCtx.orgId,
        actor_id: authCtx.userId,
        action: 'pharmacy_drug_stock_exported',
        target_type: 'PharmacySite',
        target_id: site.id,
        changes: {
          site_id: site.id,
          row_count: stocks.length,
        },
        ip_address: authCtx.ipAddress,
        user_agent: authCtx.userAgent,
      },
    });

    const header = [
      'YJコード',
      'レセ電コード',
      '医薬品名',
      '一般名',
      '薬価',
      '単位',
      'メーカー',
      '採用',
      '発注点',
      '優先後発品YJコード',
      '優先後発品名',
      '最終レビュー日',
      'メモ',
    ];
    const rows = stocks.map((stock) => [
      stock.drug_master.yj_code,
      stock.drug_master.receipt_code,
      stock.drug_master.drug_name,
      stock.drug_master.generic_name,
      stock.drug_master.drug_price,
      stock.drug_master.unit,
      stock.drug_master.manufacturer,
      stock.is_stocked ? '採用' : '未採用',
      stock.reorder_point,
      stock.preferred_generic?.yj_code,
      stock.preferred_generic?.drug_name,
      stock.last_reviewed_at?.toISOString().slice(0, 10),
      stock.adoption_note,
    ]);
    const csv = [header, ...rows].map((row) => row.map(safeCsvCell).join(',')).join('\n');
    const fileName = `formulary-${site.id}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${fileName}"`,
      },
    });
  },
  { permission: 'canAdmin' },
);
