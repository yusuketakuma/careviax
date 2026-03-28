import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { error, success, validationError } from '@/lib/api/response';
import {
  completeUploadedFile,
  FileStorageError,
} from '@/server/services/file-storage';

const completeUploadSchema = z.object({
  file_id: z.string().uuid('file_id の形式が不正です'),
  etag: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = completeUploadSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  try {
    const data = await completeUploadedFile({
      orgId: ctx.orgId,
      fileId: parsed.data.file_id,
      uploadedBy: ctx.userId,
      etag: parsed.data.etag,
    });

    return success({ data });
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_COMPLETE_FAILED', 'ファイル状態の更新に失敗しました', 502);
  }
}
