import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { error, notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { formatDateKey, formatNullableDateKey } from '@/lib/date-key';
import { quotedCsvCell as safeCsvCell } from '@/lib/csv/safe-csv';
import { recordDataExportAudit } from '@/server/services/export-audit';

const exportQuerySchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  purpose: z.enum(['operations', 'audit', 'posting', 'pharmacist_review']).default('operations'),
});

function formatDate(value: Date | null | undefined): string | null {
  return formatNullableDateKey(value);
}

function formatCsvValue(value: unknown): string | null {
  return value == null ? null : String(value);
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

function buildExportFilename(purpose: z.infer<typeof exportQuerySchema>['purpose']) {
  return encodeURIComponent(`formulary-${purpose}-${formatDateKey(new Date())}.csv`);
}

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(exportQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return withSensitiveNoStore(
        validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const readFailureResponse = () =>
      withSensitiveNoStore(
        error(
          'PHARMACY_DRUG_STOCK_EXPORT_FAILED',
          '採用薬CSVのエクスポートを準備できませんでした',
          500,
        ),
      );

    let site;
    try {
      site = await prisma.pharmacySite.findFirst({
        where: { id: parsed.data.site_id, org_id: authCtx.orgId },
        select: { id: true, name: true },
      });
    } catch {
      return readFailureResponse();
    }
    if (!site) return withSensitiveNoStore(notFound('対象の薬局拠点が見つかりません'));

    let stocks;
    try {
      stocks = await prisma.pharmacyDrugStock.findMany({
        where: {
          org_id: authCtx.orgId,
          site_id: site.id,
          is_stocked: true,
        },
        orderBy: [
          { drug_master: { drug_name_kana: 'asc' } },
          { drug_master: { drug_name: 'asc' } },
        ],
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
    } catch {
      return readFailureResponse();
    }

    try {
      await recordDataExportAudit(prisma, {
        orgId: authCtx.orgId,
        actorId: authCtx.userId,
        actorSiteId: authCtx.actorSiteId,
        targetType: 'pharmacy_drug_stock',
        targetId: site.id,
        format: 'csv',
        recordCount: stocks.length,
        filters: {
          purpose: parsed.data.purpose,
        },
        metadata: {
          source: 'pharmacy_drug_stocks_export',
        },
        ipAddress: authCtx.ipAddress,
        userAgent: authCtx.userAgent,
      });
    } catch {
      return withSensitiveNoStore(
        error(
          'PHARMACY_DRUG_STOCK_EXPORT_AUDIT_FAILED',
          '採用薬CSVのエクスポート監査を記録できませんでした',
          500,
        ),
      );
    }

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
          '安全属性',
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
          formatCsvValue(stock.drug_master.drug_price),
          stock.drug_master.unit,
          stock.drug_master.manufacturer,
          formatSafetyFlags(stock.drug_master),
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
          '安全属性',
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
          formatCsvValue(stock.drug_master.drug_price),
          stock.drug_master.unit,
          stock.drug_master.manufacturer,
          formatSafetyFlags(stock.drug_master),
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
        header: ['医薬品名', '一般名', '剤形', '単位', 'メーカー'],
        rows: stocks.map((stock) => [
          stock.drug_master.drug_name,
          stock.drug_master.generic_name,
          stock.drug_master.dosage_form,
          stock.drug_master.unit,
          stock.drug_master.manufacturer,
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
          formatCsvValue(stock.drug_master.drug_price),
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
    const fileName = buildExportFilename(parsed.data.purpose);

    return withSensitiveNoStore(
      new NextResponse(`\uFEFF${csv}`, {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
        },
      }),
    );
  },
  { permission: 'canAdmin' },
);
