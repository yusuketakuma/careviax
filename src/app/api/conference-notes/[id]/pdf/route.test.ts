import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  expectPhiExportSnapshotRedacted,
  expectSensitiveNoStore,
} from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  buildConferenceNotePdfMock,
  pdfResponseMock,
  recordDataExportAuditMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildConferenceNotePdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
  recordDataExportAuditMock: vi.fn(),
  prismaMock: {},
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildConferenceNotePdf: buildConferenceNotePdfMock,
}));

vi.mock('@/lib/api/pdf-response', () => ({
  pdfResponse: pdfResponseMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/server/services/export-audit', () => ({
  recordDataExportAudit: recordDataExportAuditMock,
}));

import { PdfNotFoundError } from '@/server/services/pdf-errors';
import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/conference-notes/note_1/pdf');
}

describe('/api/conference-notes/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    recordDataExportAuditMock.mockResolvedValue(undefined);
  });

  it('returns the rendered conference note pdf', async () => {
    const hostileFileName =
      'Taro Yamada 090-1234-5678 アムロジピン storageKey=s3 token=secret provider raw error.pdf';
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: hostileFileName,
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(buildConferenceNotePdfMock).toHaveBeenCalledWith('org_1', 'note_1', {
      userId: 'user_1',
      role: 'pharmacist',
    });
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), hostileFileName);
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(expect.any(Object), {
      orgId: 'org_1',
      actorId: 'user_1',
      targetType: 'conference_note',
      targetId: 'note_1',
      format: 'pdf',
      recordCount: 1,
      metadata: {
        surface: 'conference_note_pdf',
        output_profile: 'internal_pdf',
      },
      ipAddress: undefined,
      userAgent: undefined,
    });
    expectPhiExportSnapshotRedacted(JSON.stringify(recordDataExportAuditMock.mock.calls), [
      'Taro',
      'Yamada',
      'storageKey=s3',
    ]);
  });

  it('fails closed when the conference note PDF export audit cannot be recorded', async () => {
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'conference-note.pdf',
    });
    recordDataExportAuditMock.mockRejectedValueOnce(
      new Error('audit unavailable for 山田 太郎 provider raw error'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONFERENCE_NOTE_PDF_EXPORT_AUDIT_FAILED',
      message: 'カンファレンス記録 PDF 出力監査を記録できませんでした',
    });
    expect(recordDataExportAuditMock).toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
  });

  it('rejects blank conference note ids before rendering or auditing the export', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'カンファレンス記録IDが不正です',
    });
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the conference note is missing', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(new PdfNotFoundError('conferenceNote'));

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('does not treat raw not-found-like render errors as safe 404 messages', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(
      new Error('患者A 03-1111-2222 のカンファレンス記録が見つかりません: storage key raw_pdf_1'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('カンファレンス記録 PDF を生成できませんでした');
    expect(body).not.toContain('患者A');
    expect(body).not.toContain('03-1111-2222');
    expect(body).not.toContain('raw_pdf_1');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), { status: 403 }),
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(buildConferenceNotePdfMock).not.toHaveBeenCalled();
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });

  it('returns a no-store fixed error without leaking raw render failures', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(
      new Error('note_1 raw conference patient render failure'),
    );

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.text();
    expect(body).toContain('EXTERNAL_PDF_RENDER_FAILED');
    expect(body).toContain('カンファレンス記録 PDF を生成できませんでした');
    expect(body).not.toContain('note_1 raw conference patient render failure');
    expect(pdfResponseMock).not.toHaveBeenCalled();
    expect(recordDataExportAuditMock).not.toHaveBeenCalled();
  });
});
