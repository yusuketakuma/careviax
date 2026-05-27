import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const exportQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  purpose: z.enum(['operations', 'audit', 'posting', 'pharmacist_review']).default('operations'),
});

function safeCsvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

function formatDate(value: Date | null | undefined): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function formatSafetyFlags(drug: {
  is_narcotic?: boolean | null;
  is_psychotropic?: boolean | null;
  is_high_risk?: boolean | null;
  is_lasa_risk?: boolean | null;
}): string {
  return [
    drug.is_narcotic ? '麻薬' : null,
    drug.is_psychotropic ? '向精神薬' : null,
    drug.is_high_risk ? 'ハイリスク' : null,
    drug.is_lasa_risk ? 'LASA' : null,
  ]
    .filter(Boolean)
    .join(' / ');
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
        follow_up_status: true,
        follow_up_reason: true,
        follow_up_due_date: true,
        updated_at: true,
        drug_master: {
          select: {
            yj_code: true,
            receipt_code: true,
            drug_name: true,
            generic_name: true,
            drug_price: true,
            unit: true,
            dosage_form: true,
            manufacturer: true,
            is_narcotic: true,
            is_psychotropic: true,
            is_high_risk: true,
            is_lasa_risk: true,
            transitional_expiry_date: true,
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
          purpose: parsed.data.purpose,
          row_count: stocks.length,
        },
        ip_address: authCtx.ipAddress,
        user_agent: authCtx.userAgent,
      },
    });

    const exportRows = {
      operations: {
        header: [
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
        ],
        rows: stocks.map((stock) => [
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
          formatDate(stock.last_reviewed_at),
          stock.adoption_note,
        ]),
      },
      audit: {
        header: [
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
          '採用メモ',
          '最終レビュー日',
          'フォローアップ状態',
          'フォローアップ理由',
          'フォローアップ期限',
          '更新日',
        ],
        rows: stocks.map((stock) => [
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
          stock.adoption_note,
          formatDate(stock.last_reviewed_at),
          stock.follow_up_status,
          stock.follow_up_reason,
          formatDate(stock.follow_up_due_date),
          formatDate(stock.updated_at),
        ]),
      },
      posting: {
        header: ['医薬品名', '一般名', '剤形', '単位', 'メーカー', '備考'],
        rows: stocks.map((stock) => [
          stock.drug_master.drug_name,
          stock.drug_master.generic_name,
          stock.drug_master.dosage_form,
          stock.drug_master.unit,
          stock.drug_master.manufacturer,
          stock.adoption_note,
        ]),
      },
      pharmacist_review: {
        header: [
          'YJコード',
          '医薬品名',
          '一般名',
          '薬価',
          '単位',
          '発注点',
          '優先後発品名',
          '最終レビュー日',
          'フォローアップ状態',
          '経過措置期限',
          '安全属性',
          'メモ',
        ],
        rows: stocks.map((stock) => [
          stock.drug_master.yj_code,
          stock.drug_master.drug_name,
          stock.drug_master.generic_name,
          stock.drug_master.drug_price,
          stock.drug_master.unit,
          stock.reorder_point,
          stock.preferred_generic?.drug_name,
          formatDate(stock.last_reviewed_at),
          stock.follow_up_status,
          formatDate(stock.drug_master.transitional_expiry_date),
          formatSafetyFlags(stock.drug_master),
          stock.adoption_note,
        ]),
      },
    }[parsed.data.purpose];

    const header = exportRows.header;
    const rows = exportRows.rows;
    const csv = [header, ...rows].map((row) => row.map(safeCsvCell).join(',')).join('\n');
    const fileName = `formulary-${parsed.data.purpose}-${site.id}-${new Date().toISOString().slice(0, 10)}.csv`;

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
