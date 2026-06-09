import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, validationError } from '@/lib/api/response';
import { legacyFileApiDisabledResponse } from '@/lib/api/legacy-file-api-boundary';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { createPresignedDownload, FileStorageError } from '@/server/services/file-storage';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabledResponse = legacyFileApiDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { id } = await params;
  const fileId = normalizeRequiredRouteParam(id);
  if (!fileId) return validationError('ファイルIDが不正です');

  try {
    const data = await createPresignedDownload({
      orgId: authResult.ctx.orgId,
      fileId,
      accessContext: {
        userId: authResult.ctx.userId,
        role: authResult.ctx.role,
      },
    });

    const response = NextResponse.redirect(data.downloadUrl);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_DOWNLOAD_FAILED', 'ダウンロードURLの発行に失敗しました', 502);
  }
}
