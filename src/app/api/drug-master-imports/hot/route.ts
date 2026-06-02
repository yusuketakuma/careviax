import { NextRequest } from 'next/server';
import { z } from 'zod';
import { forbidden, success, validationError } from '@/lib/api/response';
import { isAdmin, withAuthContext } from '@/lib/auth/context';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { importHotMaster } from '@/server/services/drug-master-import/hot';
import {
  HOT_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';

const requestSchema = z.object({
  fileUrl: z
    .string()
    .url()
    .refine((url) => isAllowedImportSourceUrl(url, HOT_IMPORT_URL_POLICY), {
      message: importSourceUrlValidationMessage(),
    })
    .optional(),
});

export const POST = withAuthContext(async (req: NextRequest, authCtx) => {
  if (!isAdmin(authCtx.role)) {
    return forbidden('医薬品マスター取込は管理者のみ実行できます');
  }

  const payload = await readOptionalJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = requestSchema.safeParse(payload);
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
    201,
  );
});
