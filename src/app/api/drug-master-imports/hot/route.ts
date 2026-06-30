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
import { importHotMaster, previewHotMaster } from '@/server/services/drug-master-import/hot';
import {
  HOT_IMPORT_URL_POLICY,
  importSourceUrlValidationMessage,
  isAllowedImportSourceUrl,
} from '@/server/services/drug-master-import/shared';
import { projectDrugMasterImportLogMetadata } from '../import-log-response';

const requestSchema = z.object({
  fileUrl: z
    .string()
    .url()
    .refine((url) => isAllowedImportSourceUrl(url, HOT_IMPORT_URL_POLICY), {
      message: importSourceUrlValidationMessage(),
    })
    .optional(),
  dryRun: z.boolean().optional(),
  previewLimit: z.number().int().min(0).max(100).optional(),
});

const ROUTE = '/api/drug-master-imports/hot';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'EvalError',
  'URIError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return 'Error';
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

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
    const preview = await runWithRequestAuthContext(ctx, () =>
      previewHotMaster(prisma, { ...importOptions, previewLimit }),
    );
    return success({ data: preview });
  }

  const result = await runWithRequestAuthContext(ctx, () => importHotMaster(prisma, importOptions));
  return success(
    {
      data: {
        logId: result.log.id,
        status: result.log.status,
        importedCount: result.importedCount,
        packageImportedCount: result.packageImportedCount,
        fileUrl: result.fileUrl,
        ...projectDrugMasterImportLogMetadata(result.log),
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
      logger.error('drug_master_imports_hot_post_unhandled_error', undefined, {
        event: 'drug_master_imports_hot_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
