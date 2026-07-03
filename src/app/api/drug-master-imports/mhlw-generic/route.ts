import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { readOptionalJsonObjectRequestBody } from '@/lib/api/request-body';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  importGenericNameMappings,
  importMhlwGenericFlags,
  previewGenericNameMappings,
  previewMhlwGenericFlags,
} from '@/server/services/drug-master-import/mhlw';
import {
  MHLW_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';
import { invalidateDrugMasterSearchCache } from '@/server/services/drug-master-search-cache';
import { projectDrugMasterImportLogMetadata } from '../import-log-response';

const requestSchema = z.object({
  mode: z.enum(['flags', 'mappings', 'all']).default('all'),
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

const ROUTE = '/api/drug-master-imports/mhlw-generic';

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '医薬品マスター取込は管理者のみ実行できます',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const payload = await readOptionalJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { dryRun, previewLimit, ...importOptions } = parsed.data;

  if (dryRun) {
    const previewResult = await runWithRequestAuthContext(ctx, async () => {
      const result = {
        flags: null as Awaited<ReturnType<typeof previewMhlwGenericFlags>> | null,
        mappings: null as Awaited<ReturnType<typeof previewGenericNameMappings>> | null,
      };

      if (importOptions.mode === 'flags' || importOptions.mode === 'all') {
        result.flags = await previewMhlwGenericFlags(prisma, {
          workbookUrl: importOptions.workbookUrl,
          previewLimit,
        });
      }

      if (importOptions.mode === 'mappings' || importOptions.mode === 'all') {
        result.mappings = await previewGenericNameMappings(prisma, {
          workbookUrl: importOptions.workbookUrl,
          previewLimit,
        });
      }

      return result;
    });

    return success({
      data: {
        dryRun: true,
        mode: importOptions.mode,
        flags: previewResult.flags,
        mappings: previewResult.mappings,
      },
    });
  }

  const result = await runWithRequestAuthContext(ctx, async () => {
    const importResult = {
      flags: null as Awaited<ReturnType<typeof importMhlwGenericFlags>> | null,
      mappings: null as Awaited<ReturnType<typeof importGenericNameMappings>> | null,
    };

    if (importOptions.mode === 'flags' || importOptions.mode === 'all') {
      importResult.flags = await importMhlwGenericFlags(prisma, {
        workbookUrl: importOptions.workbookUrl,
      });
    }

    if (importOptions.mode === 'mappings' || importOptions.mode === 'all') {
      importResult.mappings = await importGenericNameMappings(prisma, {
        workbookUrl: importOptions.workbookUrl,
      });
    }

    return importResult;
  });
  invalidateDrugMasterSearchCache();

  return success(
    {
      data: {
        mode: importOptions.mode,
        importedCount: (result.flags?.importedCount ?? 0) + (result.mappings?.importedCount ?? 0),
        flags: result.flags
          ? {
              logId: result.flags.log.id,
              status: result.flags.log.status,
              importedCount: result.flags.importedCount,
              workbookUrl: result.flags.workbookUrl,
              ...projectDrugMasterImportLogMetadata(result.flags.log),
            }
          : null,
        mappings: result.mappings
          ? {
              logId: result.mappings.log.id,
              status: result.mappings.log.status,
              importedCount: result.mappings.importedCount,
              workbookUrl: result.mappings.workbookUrl,
              ...projectDrugMasterImportLogMetadata(result.mappings.log),
            }
          : null,
      },
    },
    201,
  );
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'drug_master_imports_mhlw_generic_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
