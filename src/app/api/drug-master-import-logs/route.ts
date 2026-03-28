import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const rawLimit = Number(searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 10;

  const logs = await prisma.drugMasterImportLog.findMany({
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
