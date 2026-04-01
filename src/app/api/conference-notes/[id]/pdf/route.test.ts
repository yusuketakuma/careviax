import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

import { GET } from './route';

describe('/api/conference-notes/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
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
    buildConferenceNotePdfMock.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      fileName: 'conference-note.pdf',
    });

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(pdfResponseMock).toHaveBeenCalledWith(expect.any(Buffer), 'conference-note.pdf');
    expect(recordDataExportAuditMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ targetType: 'conference_note', format: 'pdf', targetId: 'note_1' }),
    );
  });

  it('returns 404 when the conference note is missing', async () => {
    buildConferenceNotePdfMock.mockRejectedValue(
      new Error('カンファレンス記録が見つかりません'),
    );

    const response = (await GET({} as NextRequest, {
      params: Promise.resolve({ id: 'note_1' }),
    }))!;

    expect(response.status).toBe(404);
  });
});
