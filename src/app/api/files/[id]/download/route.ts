import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { error, validationError } from '@/lib/api/response';
import { legacyFileApiDisabledResponse } from '@/lib/api/legacy-file-api-boundary';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  recordFileDownloadAudit,
  resolveFileDownloadAuditContext,
} from '@/server/services/file-download-audit';
import {
  FileStorageError,
  openPreparedFileDownload,
  prepareFileDownload,
} from '@/server/services/file-storage';

const authenticatedGET = withAuthContext(async (_req, ctx, { params }) => {
  const { id } = await params;
  const fileId = normalizeRequiredRouteParam(id);
  if (!fileId) return withSensitiveNoStore(validationError('ファイルIDが不正です'));

  try {
    const data = await prepareFileDownload({
      orgId: ctx.orgId,
      fileId,
      accessContext: {
        userId: ctx.userId,
        role: ctx.role,
      },
    });

    try {
      const auditContext = await resolveFileDownloadAuditContext(prisma, {
        orgId: ctx.orgId,
        fileId: data.id,
      });
      await recordFileDownloadAudit(prisma, {
        orgId: ctx.orgId,
        actorId: ctx.userId,
        ...(ctx.actorPharmacyId ? { actorPharmacyId: ctx.actorPharmacyId } : {}),
        ...(ctx.actorSiteId ? { actorSiteId: ctx.actorSiteId } : {}),
        ...(auditContext?.patientId ? { patientId: auditContext.patientId } : {}),
        fileId: data.id,
        purpose: data.purpose,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        expiresIn: data.expiresIn,
        surface: 'files_download',
        responseMode: 'stream',
        ...(auditContext?.consentAttachmentContext
          ? { consentAttachmentContext: auditContext.consentAttachmentContext }
          : {}),
        ...(auditContext?.consentRecordDocumentContext
          ? { consentRecordDocumentContext: auditContext.consentRecordDocumentContext }
          : {}),
        ...(auditContext?.contractDocumentContext
          ? { contractDocumentContext: auditContext.contractDocumentContext }
          : {}),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    } catch {
      return withSensitiveNoStore(
        error('FILE_DOWNLOAD_AUDIT_FAILED', 'ファイルダウンロード監査を記録できませんでした', 500),
      );
    }

    const body = await openPreparedFileDownload(data);
    const response = new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': data.mimeType,
        'Content-Length': String(data.sizeBytes),
        'Content-Disposition': `${data.downloadDisposition}; filename="${data.fileName}"`,
        'Accept-Ranges': 'none',
        'X-Content-Type-Options': 'nosniff',
      },
    });
    return withSensitiveNoStore(response);
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return withSensitiveNoStore(error(cause.code, cause.message, cause.status));
    }

    return withSensitiveNoStore(
      error('EXTERNAL_FILE_DOWNLOAD_FAILED', 'ファイルダウンロードに失敗しました', 502),
    );
  }
});

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const disabledResponse = legacyFileApiDisabledResponse();
  if (disabledResponse) return withSensitiveNoStore(disabledResponse);

  return withSensitiveNoStore(await authenticatedGET(req, routeContext));
}
