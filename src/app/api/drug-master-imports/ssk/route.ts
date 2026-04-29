import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, isAdmin } from '@/lib/auth/context';
import { forbidden, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { importSskDrugMaster } from '@/server/services/drug-master-import/ssk';
import {
  SSK_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';

const requestSchema = z.object({
  zipUrl: z
    .string()
    .url()
    .refine((url) => isAllowedImportSourceUrl(url, SSK_IMPORT_URL_POLICY), {
      message: importSourceUrlValidationMessage(),
    })
    .optional(),
  limit: z.number().int().positive().max(5000).optional(),
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

  const result = await importSskDrugMaster(prisma, parsed.data);

  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        entryName: result.entryName,
        zipUrl: result.zipUrl,
      },
    },
    201,
  );
});
