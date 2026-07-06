import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { error, internalError, success, validationError } from '@/lib/api/response';
import { legacyFileApiDisabledResponse } from '@/lib/api/legacy-file-api-boundary';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { trimStringOrUndefined } from '@/lib/validations/string';
import { logger } from '@/lib/utils/logger';
import { completeUploadedFile, FileStorageError } from '@/server/services/file-storage';

type CompletedFileRecord = Awaited<ReturnType<typeof completeUploadedFile>>;

const completeUploadSchema = z.object({
  file_id: z.string().trim().uuid('file_id の形式が不正です'),
  etag: z.preprocess(trimStringOrUndefined, z.string().max(256).optional()),
});

function toPublicCompletedFile(data: CompletedFileRecord) {
  return {
    id: data.id,
    status: data.status,
    completedAt: data.completedAt,
  };
}

async function handlePOST(req: NextRequest) {
  const disabledResponse = legacyFileApiDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = completeUploadSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  try {
    const data = await completeUploadedFile({
      orgId: ctx.orgId,
      fileId: parsed.data.file_id,
      uploadedBy: ctx.userId,
      accessContext: {
        userId: ctx.userId,
        role: ctx.role,
      },
      etag: parsed.data.etag,
    });

    return success({ data: toPublicCompletedFile(data) });
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_COMPLETE_FAILED', 'ファイル状態の更新に失敗しました', 502);
  }
}

export async function POST(req: NextRequest) {
  try {
    return withSensitiveNoStore(await handlePOST(req));
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'files_complete_unhandled_error',
        route: '/api/files/complete',
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
}
