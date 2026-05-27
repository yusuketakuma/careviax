import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const bulkRowSchema = z.object({
  yj_code: z.string().trim().optional(),
  drug_name: z.string().trim().optional(),
  is_stocked: z.boolean().default(true),
  reorder_point: z.coerce.number().int().min(0).nullable().optional(),
  preferred_generic_yj_code: z.string().trim().optional(),
  adoption_note: z.string().trim().max(500).nullable().optional(),
});

const bulkImportSchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  rows: z.array(bulkRowSchema).max(1000).optional(),
  csv: z.string().max(200_000).optional(),
});

type BulkRow = z.infer<typeof bulkRowSchema> & {
  rowNumber: number;
};

const HEADER_ALIASES: Record<string, keyof z.infer<typeof bulkRowSchema>> = {
  yj_code: 'yj_code',
  yj: 'yj_code',
  'YJコード': 'yj_code',
  drug_name: 'drug_name',
  name: 'drug_name',
  医薬品名: 'drug_name',
  is_stocked: 'is_stocked',
  採用: 'is_stocked',
  reorder_point: 'reorder_point',
  発注点: 'reorder_point',
  preferred_generic_yj_code: 'preferred_generic_yj_code',
  優先後発品YJコード: 'preferred_generic_yj_code',
  adoption_note: 'adoption_note',
  メモ: 'adoption_note',
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['false', '0', 'no', '解除', '未採用'].includes(normalized)) return false;
  return true;
}

function parseCsv(csv: string): BulkRow[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => HEADER_ALIASES[header] ?? header);
  return lines.slice(1).map((line, index) => {
    const values = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((header, columnIndex) => [header, values[columnIndex] ?? '']));
    return {
      rowNumber: index + 2,
      yj_code: String(raw.yj_code ?? '').trim(),
      drug_name: String(raw.drug_name ?? '').trim(),
      is_stocked: parseBoolean(raw.is_stocked),
      reorder_point:
        raw.reorder_point == null || raw.reorder_point === ''
          ? null
          : Number.parseInt(String(raw.reorder_point), 10),
      preferred_generic_yj_code: String(raw.preferred_generic_yj_code ?? '').trim(),
      adoption_note: String(raw.adoption_note ?? '').trim() || null,
    };
  });
}

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = bulkImportSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const site = await prisma.pharmacySite.findFirst({
      where: { id: parsed.data.site_id, org_id: authCtx.orgId },
      select: { id: true, name: true },
    });
    if (!site) return notFound('対象の薬局拠点が見つかりません');

    const rows = [
      ...(parsed.data.rows ?? []).map((row, index) => ({
        ...row,
        is_stocked: parseBoolean(row.is_stocked),
        rowNumber: index + 1,
      })),
      ...(parsed.data.csv ? parseCsv(parsed.data.csv) : []),
    ].slice(0, 1000);

    if (rows.length === 0) {
      return validationError('登録する採用薬データがありません');
    }

    const safeRows: BulkRow[] = [];
    const invalidRows: Array<{ rowNumber: number; reason: string }> = [];
    for (const row of rows) {
      const rowParsed = bulkRowSchema.safeParse(row);
      if (!rowParsed.success || (!row.yj_code && !row.drug_name)) {
        invalidRows.push({ rowNumber: row.rowNumber, reason: 'YJコードまたは医薬品名が必要です' });
        continue;
      }
      safeRows.push({ ...rowParsed.data, rowNumber: row.rowNumber });
    }

    const yjCodes = [...new Set(safeRows.map((row) => row.yj_code).filter(Boolean))] as string[];
    const preferredYjCodes = [
      ...new Set(safeRows.map((row) => row.preferred_generic_yj_code).filter(Boolean)),
    ] as string[];
    const drugNames = [
      ...new Set(
        safeRows
          .filter((row) => !row.yj_code && row.drug_name)
          .map((row) => row.drug_name as string),
      ),
    ];

    const [matchedByYj, matchedByName, preferredGenerics] = await Promise.all([
      yjCodes.length
        ? prisma.drugMaster.findMany({
            where: { yj_code: { in: yjCodes } },
            select: { id: true, yj_code: true, drug_name: true },
          })
        : Promise.resolve([]),
      drugNames.length
        ? prisma.drugMaster.findMany({
            where: { drug_name: { in: drugNames } },
            select: { id: true, yj_code: true, drug_name: true },
          })
        : Promise.resolve([]),
      preferredYjCodes.length
        ? prisma.drugMaster.findMany({
            where: { yj_code: { in: preferredYjCodes }, is_generic: true },
            select: { id: true, yj_code: true, drug_name: true },
          })
        : Promise.resolve([]),
    ]);

    const drugByYj = new Map(matchedByYj.map((drug) => [drug.yj_code, drug]));
    const drugByName = new Map(matchedByName.map((drug) => [drug.drug_name, drug]));
    const genericByYj = new Map(preferredGenerics.map((drug) => [drug.yj_code, drug]));
    const unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }> = [];
    const operations = safeRows.flatMap((row) => {
      const drug = row.yj_code ? drugByYj.get(row.yj_code) : drugByName.get(row.drug_name ?? '');
      if (!drug) {
        unmatchedRows.push({
          rowNumber: row.rowNumber,
          yj_code: row.yj_code,
          drug_name: row.drug_name,
        });
        return [];
      }
      return [
        {
          row,
          drug,
          preferredGeneric: row.preferred_generic_yj_code
            ? (genericByYj.get(row.preferred_generic_yj_code) ?? null)
            : null,
        },
      ];
    });

    const imported = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const operation of operations) {
        const stock = await tx.pharmacyDrugStock.upsert({
          where: {
            site_id_drug_master_id: {
              site_id: site.id,
              drug_master_id: operation.drug.id,
            },
          },
          create: {
            org_id: authCtx.orgId,
            site_id: site.id,
            drug_master_id: operation.drug.id,
            is_stocked: operation.row.is_stocked,
            reorder_point: operation.row.reorder_point ?? null,
            preferred_generic_id: operation.preferredGeneric?.id ?? null,
            adoption_source: 'csv',
            adoption_note: operation.row.adoption_note ?? null,
          },
          update: {
            is_stocked: operation.row.is_stocked,
            reorder_point: operation.row.reorder_point ?? null,
            preferred_generic_id: operation.preferredGeneric?.id ?? null,
            adoption_source: 'csv',
            adoption_note: operation.row.adoption_note ?? null,
          },
          select: { id: true },
        });
        count += 1;

        await tx.auditLog.create({
          data: {
            org_id: authCtx.orgId,
            actor_id: authCtx.userId,
            action: 'pharmacy_drug_stock_bulk_imported',
            target_type: 'PharmacyDrugStock',
            target_id: stock.id,
            changes: {
              site_id: site.id,
              drug_master_id: operation.drug.id,
              yj_code: operation.drug.yj_code,
              is_stocked: operation.row.is_stocked,
              reorder_point: operation.row.reorder_point ?? null,
              preferred_generic_yj_code: operation.row.preferred_generic_yj_code ?? null,
            },
            ip_address: authCtx.ipAddress,
            user_agent: authCtx.userAgent,
          },
        });
      }
      return count;
    });

    return success({
      site,
      importedCount: imported,
      unmatchedRows,
      invalidRows,
    });
  },
  { permission: 'canAdmin' },
);
