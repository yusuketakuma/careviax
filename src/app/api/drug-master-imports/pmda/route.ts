import { NextRequest } from 'next/server';
import { z } from 'zod';
import { forbidden, success, validationError } from '@/lib/api/response';
import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { importPmdaPackageInserts } from '@/server/services/drug-master-import/pmda';

const requestSchema = z.object({
  zipUrl: z.string().url().optional(),
  mode: z.enum(['full', 'delta']).default('full'),
});

export const POST = withAuthContext(async (req: NextRequest, authCtx) => {
  if (!isAdmin(authCtx.role)) {
    return forbidden('医薬品マスター取込は管理者のみ実行できます');
  }

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const result = await importPmdaPackageInserts(prisma, parsed.data);
  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        zipUrl: result.zipUrl,
        mode: result.mode,
      },
    },
    201
  );
});
