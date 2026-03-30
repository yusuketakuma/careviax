import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  buildConferenceNotePdfMock,
  pdfResponseMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  buildConferenceNotePdfMock: vi.fn(),
  pdfResponseMock: vi.fn(),
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

import { GET } from './route';

describe('/api/conference-notes/[id]/pdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
      },
    });
    pdfResponseMock.mockReturnValue(
      new Response('pdf-bytes', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
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
