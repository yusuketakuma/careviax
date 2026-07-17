import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import {
  importSskDrugMaster,
  previewSskDrugMasterImport,
} from '@/server/services/drug-master-import/ssk';
import {
  SSK_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';
import { invalidateDrugMasterSearchCache } from '@/server/services/drug-master-search-cache';
import { invalidateDrugMasterDetailCache } from '@/server/services/drug-master-detail-cache';
import { projectDrugMasterImportLogMetadata } from '../import-log-response';

const requestSchema = z.object({
  zipUrl: z
    .string()
    .url()
    .refine((url) => isAllowedImportSourceUrl(url, SSK_IMPORT_URL_POLICY), {
      message: importSourceUrlValidationMessage(),
    })
    .optional(),
  limit: z.number().int().positive().max(5000).optional(),
  dryRun: z.boolean().optional(),
  previewLimit: z.number().int().min(0).max(100).optional(),
});

async function authenticatedPOST(req: NextRequest) {
  const payload = await readOptionalJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { dryRun, previewLimit, ...importOptions } = parsed.data;

  if (dryRun) {
    const preview = await previewSskDrugMasterImport(prisma, { ...importOptions, previewLimit });
    return success({ data: preview });
  }

  const result = await importSskDrugMaster(prisma, importOptions);
  invalidateDrugMasterSearchCache();
  invalidateDrugMasterDetailCache();

  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        entryName: result.entryName,
        zipUrl: result.zipUrl,
        ...projectDrugMasterImportLogMetadata(result.log),
      },
    },
    201,
  );
}

export const POST = withAuthContext(authenticatedPOST, {
  permission: 'canAdmin',
  message: '医薬品マスター取込は管理者のみ実行できます',
});
