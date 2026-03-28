import { NextRequest } from 'next/server';
import { z } from 'zod';
import { forbidden, success, validationError } from '@/lib/api/response';
import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { importHotMaster } from '@/server/services/drug-master-import/hot';

const requestSchema = z.object({
  fileUrl: z.string().url().optional(),
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

  const result = await importHotMaster(prisma, parsed.data);
  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        fileUrl: result.fileUrl,
      },
    },
    201
  );
});
