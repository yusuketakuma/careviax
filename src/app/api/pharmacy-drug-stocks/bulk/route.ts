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
  dry_run: z.boolean().optional(),
});

type BulkRow = z.infer<typeof bulkRowSchema> & {
  rowNumber: number;
};

type BulkOperation = {
  row: BulkRow;
  drug: {
    id: string;
    yj_code: string;
    drug_name: string;
    generic_name: string | null;
  };
  preferredGeneric: {
    id: string;
    yj_code: string;
    drug_name: string;
    generic_name: string | null;
  } | null;
};

type CurrentStock = {
  drug_master_id: string;
  is_stocked: boolean;
  reorder_point: number | null;
  preferred_generic_id: string | null;
  adoption_note: string | null;
};

type PreviewRowStatus = 'create' | 'update' | 'deactivate' | 'no_change' | 'unmatched' | 'invalid';

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

function buildPreviewRows({
  operations,
  currentStockByDrugId,
  unmatchedRows,
  invalidRows,
}: {
  operations: BulkOperation[];
  currentStockByDrugId: Map<string, CurrentStock>;
  unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }>;
  invalidRows: Array<{ rowNumber: number; reason: string }>;
}) {
  const rows: Array<{
    rowNumber: number;
    status: PreviewRowStatus;
    yj_code?: string;
    drug_name?: string;
    reason?: string;
    before?: {
      is_stocked: boolean;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      adoption_note: string | null;
    } | null;
    after?: {
      is_stocked: boolean;
      reorder_point: number | null;
      preferred_generic_id: string | null;
      adoption_note: string | null;
    } | null;
  }> = [];

  for (const operation of operations) {
    const current = currentStockByDrugId.get(operation.drug.id) ?? null;
    const after = {
      is_stocked: operation.row.is_stocked,
      reorder_point: operation.row.reorder_point ?? null,
      preferred_generic_id: operation.preferredGeneric?.id ?? null,
      adoption_note: operation.row.adoption_note ?? null,
    };
    const before = current
      ? {
          is_stocked: current.is_stocked,
          reorder_point: current.reorder_point,
          preferred_generic_id: current.preferred_generic_id,
          adoption_note: current.adoption_note,
        }
      : null;
    const changed =
      !before ||
      before.is_stocked !== after.is_stocked ||
      before.reorder_point !== after.reorder_point ||
      before.preferred_generic_id !== after.preferred_generic_id ||
      before.adoption_note !== after.adoption_note;
    const status: PreviewRowStatus = !before
      ? after.is_stocked
        ? 'create'
        : 'no_change'
      : !changed
        ? 'no_change'
        : before.is_stocked && !after.is_stocked
          ? 'deactivate'
          : 'update';

    rows.push({
      rowNumber: operation.row.rowNumber,
      status,
      yj_code: operation.drug.yj_code,
      drug_name: operation.drug.drug_name,
      before,
      after,
    });
  }

  for (const row of unmatchedRows) {
    rows.push({
      rowNumber: row.rowNumber,
      status: 'unmatched',
      yj_code: row.yj_code,
      drug_name: row.drug_name,
      reason: '医薬品マスターに一致しません',
      before: null,
      after: null,
    });
  }

  for (const row of invalidRows) {
    rows.push({
      rowNumber: row.rowNumber,
      status: 'invalid',
      reason: row.reason,
      before: null,
      after: null,
    });
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const summary = {
    totalRows: rows.length,
    processableRows: operations.length,
    createCount: rows.filter((row) => row.status === 'create').length,
    updateCount: rows.filter((row) => row.status === 'update').length,
    deactivateCount: rows.filter((row) => row.status === 'deactivate').length,
    noChangeCount: rows.filter((row) => row.status === 'no_change').length,
    unmatchedCount: unmatchedRows.length,
    invalidCount: invalidRows.length,
  };

  return { summary, rows };
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
            select: { id: true, yj_code: true, drug_name: true, generic_name: true },
          })
        : Promise.resolve([]),
      drugNames.length
        ? prisma.drugMaster.findMany({
            where: { drug_name: { in: drugNames } },
            select: { id: true, yj_code: true, drug_name: true, generic_name: true },
          })
        : Promise.resolve([]),
      preferredYjCodes.length
        ? prisma.drugMaster.findMany({
            where: { yj_code: { in: preferredYjCodes }, is_generic: true },
            select: { id: true, yj_code: true, drug_name: true, generic_name: true },
          })
        : Promise.resolve([]),
    ]);

    const drugByYj = new Map(matchedByYj.map((drug) => [drug.yj_code, drug]));
    const drugsByName = new Map<string, typeof matchedByName>();
    for (const drug of matchedByName) {
      const drugs = drugsByName.get(drug.drug_name) ?? [];
      drugs.push(drug);
      drugsByName.set(drug.drug_name, drugs);
    }
    const genericByYj = new Map(preferredGenerics.map((drug) => [drug.yj_code, drug]));
    const unmatchedRows: Array<{ rowNumber: number; yj_code?: string; drug_name?: string }> = [];
    const operations: BulkOperation[] = safeRows.flatMap((row) => {
      const nameMatches = row.yj_code ? [] : (drugsByName.get(row.drug_name ?? '') ?? []);
      if (!row.yj_code && nameMatches.length > 1) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          reason: '医薬品名に複数候補があります。YJコードを指定してください',
        });
        return [];
      }

      const drug = row.yj_code ? drugByYj.get(row.yj_code) : nameMatches[0];
      if (!drug) {
        unmatchedRows.push({
          rowNumber: row.rowNumber,
          yj_code: row.yj_code,
          drug_name: row.drug_name,
        });
        return [];
      }
      if (row.preferred_generic_yj_code && !genericByYj.has(row.preferred_generic_yj_code)) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          reason: '優先後発品YJコードが見つからないか、後発品ではありません',
        });
        return [];
      }
      const preferredGeneric = row.preferred_generic_yj_code
        ? (genericByYj.get(row.preferred_generic_yj_code) ?? null)
        : null;
      if (preferredGeneric?.id === drug.id) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          reason: '優先後発品に対象薬自身は指定できません',
        });
        return [];
      }
      if (
        preferredGeneric &&
        drug.generic_name &&
        preferredGeneric.generic_name &&
        drug.generic_name !== preferredGeneric.generic_name
      ) {
        invalidRows.push({
          rowNumber: row.rowNumber,
          reason: '優先後発品は同一一般名から選択してください',
        });
        return [];
      }
      return [
        {
          row,
          drug,
          preferredGeneric,
        },
      ];
    });

    const currentStocks =
      operations.length > 0
        ? await prisma.pharmacyDrugStock.findMany({
            where: {
              org_id: authCtx.orgId,
              site_id: site.id,
              drug_master_id: { in: [...new Set(operations.map((operation) => operation.drug.id))] },
            },
            select: {
              drug_master_id: true,
              is_stocked: true,
              reorder_point: true,
              preferred_generic_id: true,
              adoption_note: true,
            },
          })
        : [];
    const preview = buildPreviewRows({
      operations,
      currentStockByDrugId: new Map(currentStocks.map((stock) => [stock.drug_master_id, stock])),
      unmatchedRows,
      invalidRows,
    });

    if (parsed.data.dry_run) {
      return success({
        site,
        importedCount: 0,
        unmatchedRows,
        invalidRows,
        preview,
      });
    }

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
      preview,
    });
  },
  { permission: 'canAdmin' },
);
