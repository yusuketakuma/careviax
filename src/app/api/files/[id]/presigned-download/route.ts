import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, success, validationError } from '@/lib/api/response';
import { legacyFileApiDisabledResponse } from '@/lib/api/legacy-file-api-boundary';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  recordFileDownloadAudit,
  resolveFileDownloadAuditContext,
} from '@/server/services/file-download-audit';
import { createPresignedDownload, FileStorageError } from '@/server/services/file-storage';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const disabledResponse = legacyFileApiDisabledResponse();
  if (disabledResponse) return disabledResponse;

  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const fileId = normalizeRequiredRouteParam(id);
  if (!fileId) return validationError('ファイルIDが不正です');

  try {
    const data = await createPresignedDownload({
      orgId: ctx.orgId,
      fileId,
      accessContext: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });

    const shouldRedirect = new URL(req.url).searchParams.get('download')?.trim() === '1';
    try {
      const consentAttachmentContext = await resolveFileDownloadAuditContext(prisma, {
        orgId: ctx.orgId,
        fileId: data.id,
      });
      await recordFileDownloadAudit(prisma, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        fileId: data.id,
        purpose: data.purpose,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        expiresIn: data.expiresIn,
        surface: 'files_presigned_download',
        responseMode: shouldRedirect ? 'redirect' : 'json',
        consentAttachmentContext,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    } catch {
      return withSensitiveNoStore(
        error('FILE_DOWNLOAD_AUDIT_FAILED', 'ファイルダウンロード監査を記録できませんでした', 500),
      );
    }

    if (shouldRedirect) {
      const response = NextResponse.redirect(data.downloadUrl);
      response.headers.set('Cache-Control', 'private, no-store, max-age=0');
      return response;
    }

    const response = success({ data });
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_DOWNLOAD_FAILED', 'ダウンロードURLの発行に失敗しました', 502);
  }
}
