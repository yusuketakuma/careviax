import { NextRequest } from 'next/server';
import { z } from 'zod';
import { success, validationError } from '@/lib/api/response';
import { withAuthContext } from '@/lib/auth/context';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import {
  importMhlwPriceList,
  previewMhlwPriceList,
} from '@/server/services/drug-master-import/mhlw';
import {
  MHLW_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';
import { invalidateDrugMasterSearchCache } from '@/server/services/drug-master-search-cache';
import { invalidateDrugMasterDetailCache } from '@/server/services/drug-master-detail-cache';
import { projectDrugMasterImportLogMetadata } from '../import-log-response';

const requestSchema = z.object({
  workbookUrl: z
    .string()
    .url()
    .refine((url) => isAllowedImportSourceUrl(url, MHLW_IMPORT_URL_POLICY), {
      message: importSourceUrlValidationMessage(),
    })
    .optional(),
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
    const preview = await previewMhlwPriceList(prisma, { ...importOptions, previewLimit });
    return success({ data: preview });
  }

  const result = await importMhlwPriceList(prisma, importOptions);
  invalidateDrugMasterSearchCache();
  invalidateDrugMasterDetailCache();
  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        workbookUrl: result.workbookUrl,
        workbookUrls: result.workbookUrls,
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
