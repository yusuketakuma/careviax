import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { error, validationError } from '@/lib/api/response';
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

    try {
      const auditContext = await resolveFileDownloadAuditContext(prisma, {
        orgId: authResult.ctx.orgId,
        fileId: data.id,
      });
      await recordFileDownloadAudit(prisma, {
        orgId: authResult.ctx.orgId,
        actorId: authResult.ctx.userId,
        ...(authResult.ctx.actorPharmacyId
          ? { actorPharmacyId: authResult.ctx.actorPharmacyId }
          : {}),
        ...(authResult.ctx.actorSiteId ? { actorSiteId: authResult.ctx.actorSiteId } : {}),
        ...(auditContext?.patientId ? { patientId: auditContext.patientId } : {}),
        fileId: data.id,
        purpose: data.purpose,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        expiresIn: data.expiresIn,
        surface: 'files_download',
        responseMode: 'redirect',
        ...(auditContext?.consentAttachmentContext
          ? { consentAttachmentContext: auditContext.consentAttachmentContext }
          : {}),
        ...(auditContext?.consentRecordDocumentContext
          ? { consentRecordDocumentContext: auditContext.consentRecordDocumentContext }
          : {}),
        ipAddress: authResult.ctx.ipAddress,
        userAgent: authResult.ctx.userAgent,
      });
    } catch {
      return withSensitiveNoStore(
        error('FILE_DOWNLOAD_AUDIT_FAILED', 'ファイルダウンロード監査を記録できませんでした', 500),
      );
    }

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
