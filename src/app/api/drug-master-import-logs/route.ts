import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const importSourceSchema = z.enum([
  'ssk',
  'mhlw_price',
  'mhlw_generic',
  'hot',
  'pmda',
  'manual_clinical',
]);
const importStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const GET = withAuthContext(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;
  const sourceParam = searchParams.get('source');
  const statusParam = searchParams.get('status');
  const source = sourceParam ? importSourceSchema.safeParse(sourceParam) : null;
  const status = statusParam ? importStatusSchema.safeParse(statusParam) : null;

  if (source && !source.success) {
    return validationError('薬剤マスタ取込ソースが不正です', {
      source: ['対応していない取込ソースです'],
    });
  }
  if (status && !status.success) {
    return validationError('薬剤マスタ取込ステータスが不正です', {
      status: ['対応していない取込ステータスです'],
    });
  }

  const where: Prisma.DrugMasterImportLogWhereInput = {};

  if (source) {
    where.source = source.data;
  }
  if (status) {
    where.status = status.data;
  }

  const logs = await prisma.drugMasterImportLog.findMany({
    where,
    orderBy: [{ imported_at: 'desc' }, { created_at: 'desc' }],
    take: limit,
    select: {
      id: true,
      source: true,
      imported_at: true,
      record_count: true,
      status: true,
      error_log: true,
      created_at: true,
      updated_at: true,
    },
  });

  return success({ data: logs });
});
