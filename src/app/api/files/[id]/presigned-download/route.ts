import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, success } from '@/lib/api/response';
import { createPresignedDownload, FileStorageError } from '@/server/services/file-storage';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  try {
    const data = await createPresignedDownload({
      orgId: ctx.orgId,
      fileId: id,
      accessContext: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });

    const shouldRedirect = new URL(req.url).searchParams.get('download') === '1';
    if (shouldRedirect) {
      return NextResponse.redirect(data.downloadUrl);
    }

    return success({ data });
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_DOWNLOAD_FAILED', 'ダウンロードURLの発行に失敗しました', 502);
  }
}
