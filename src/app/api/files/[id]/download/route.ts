import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error } from '@/lib/api/response';
import { hasPermission } from '@/lib/auth/permissions';
import {
  createPresignedDownload,
  FileStorageError,
} from '@/server/services/file-storage';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;

  const { id } = await params;

  try {
    const data = await createPresignedDownload({
      orgId: authResult.ctx.orgId,
      fileId: id,
      permissions: {
        canVisit: hasPermission(authResult.ctx.role, 'canVisit'),
        canReport: hasPermission(authResult.ctx.role, 'canReport'),
      },
    });

    return NextResponse.redirect(data.downloadUrl);
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error(
      'EXTERNAL_FILE_DOWNLOAD_FAILED',
      'ダウンロードURLの発行に失敗しました',
      502,
    );
  }
}
