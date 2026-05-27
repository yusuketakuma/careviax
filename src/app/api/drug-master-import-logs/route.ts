import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import type { ImportSource, ImportStatus, Prisma } from '@prisma/client';

const IMPORT_SOURCES: ImportSource[] = ['ssk', 'mhlw_price', 'mhlw_generic', 'hot', 'pmda', 'manual_clinical'];
const IMPORT_STATUSES: ImportStatus[] = ['pending', 'running', 'completed', 'failed'];

export const GET = withAuthContext(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;
  const source = searchParams.get('source');
  const status = searchParams.get('status');
  const where: Prisma.DrugMasterImportLogWhereInput = {};

  if (source && IMPORT_SOURCES.includes(source as ImportSource)) {
    where.source = source as ImportSource;
  }
  if (status && IMPORT_STATUSES.includes(status as ImportStatus)) {
    where.status = status as ImportStatus;
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
