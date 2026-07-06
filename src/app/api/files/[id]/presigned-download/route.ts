import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, validationError } from '@/lib/api/response';
import { legacyFileApiDisabledResponse } from '@/lib/api/legacy-file-api-boundary';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { encodePathSegment } from '@/lib/http/path-segment';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabledResponse = legacyFileApiDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { id } = await params;
  const fileId = normalizeRequiredRouteParam(id);
  if (!fileId) return withSensitiveNoStore(validationError('ファイルIDが不正です'));

  const shouldRedirect = new URL(req.url).searchParams.get('download')?.trim() === '1';
  if (shouldRedirect) {
    const response = NextResponse.redirect(
      new URL(`/api/files/${encodePathSegment(fileId)}/download`, req.url),
    );
    return withSensitiveNoStore(response);
  }

  return withSensitiveNoStore(
    error(
      'FILE_PRESIGNED_DOWNLOAD_JSON_DISABLED',
      '署名付きダウンロードURLのJSON発行は無効です。同一オリジンのダウンロードURLを使用してください',
      410,
    ),
  );
}
