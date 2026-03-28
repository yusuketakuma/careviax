import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  visitRecordFindFirstMock,
  visitRecordUpdateMock,
  auditLogFindFirstMock,
  userFindManyMock,
  withOrgContextMock,
  getStoredFileRecordMock,
  toVisitRecordAttachmentMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  visitRecordFindFirstMock: vi.fn(),
  visitRecordUpdateMock: vi.fn(),
  auditLogFindFirstMock: vi.fn(),
  userFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  getStoredFileRecordMock: vi.fn(),
  toVisitRecordAttachmentMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    visitRecord: {
      findFirst: visitRecordFindFirstMock,
    },
    auditLog: {
      findFirst: auditLogFindFirstMock,
    },
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  getStoredFileRecord: getStoredFileRecordMock,
  toVisitRecordAttachment: toVisitRecordAttachmentMock,
}));

import { GET, PATCH } from './route';

function createRequest(body?: unknown) {
  return {
    headers: {
      get: (key: string) => ({ 'x-org-id': 'org_1' }[key] ?? null),
    },
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe('/api/visit-records/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    auditLogFindFirstMock.mockResolvedValue({ actor_id: 'user_1' });
    userFindManyMock.mockResolvedValue([{ id: 'user_1', name: '薬剤師A' }]);
    toVisitRecordAttachmentMock.mockImplementation((record) => ({
      file_id: record.id,
      file_name: record.originalName,
      mime_type: record.mimeType,
      size_bytes: record.sizeBytes,
      uploaded_at: record.completedAt ?? null,
      kind: record.mimeType.startsWith('image/') ? 'photo' : 'attachment',
    }));
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        visitRecord: {
          findFirst: vi.fn().mockResolvedValue({ id: 'visit_1', version: 1 }),
          update: visitRecordUpdateMock,
        },
      })
    );
  });

  it('returns visit record attachments as a normalized list', async () => {
    visitRecordFindFirstMock.mockResolvedValue({
      id: 'visit_1',
      org_id: 'org_1',
      schedule_id: 'schedule_1',
      patient_id: 'patient_1',
      pharmacist_id: 'user_1',
      visit_date: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      outcome_status: 'completed',
      soap_subjective: null,
      soap_objective: null,
      soap_assessment: null,
      soap_plan: null,
      receipt_person_name: null,
      receipt_person_relation: null,
      receipt_at: null,
      next_visit_suggestion_date: null,
      cancellation_reason: null,
      postpone_reason: null,
      revisit_reason: null,
      version: 1,
      created_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      updated_at: new Date('2026-03-28T00:00:00.000Z').toISOString(),
      attachments: [
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_name: 'visit-photo.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          uploaded_at: '2026-03-28T00:00:00.000Z',
          kind: 'photo',
        },
      ],
      schedule: null,
    });

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'visit_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: 'visit_1',
      attachments: [
        {
          file_id: '11111111-1111-4111-8111-111111111111',
          file_name: 'visit-photo.png',
          mime_type: 'image/png',
          size_bytes: 1024,
          kind: 'photo',
        },
      ],
    });
  });

  it('stores validated attachment metadata on PATCH', async () => {
    getStoredFileRecordMock.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orgId: 'org_1',
      purpose: 'visit-photo',
      storageKey: 'visit-photos/org_1/visit_1/file-1-photo.png',
      originalName: 'visit-photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'uploaded',
      visitRecordId: 'visit_1',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      completedAt: '2026-03-28T00:00:00.000Z',
      downloadDisposition: 'inline',
    });
    visitRecordUpdateMock.mockResolvedValue({
      id: 'visit_1',
      version: 2,
      attachments: [],
    });

    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(visitRecordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'visit_1' },
        data: expect.objectContaining({
          attachments: [
            expect.objectContaining({
              file_id: '11111111-1111-4111-8111-111111111111',
              file_name: 'visit-photo.png',
              mime_type: 'image/png',
            }),
          ],
          version: { increment: 1 },
        }),
      })
    );
  });

  it('rejects attachments uploaded for another visit record', async () => {
    getStoredFileRecordMock.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      orgId: 'org_1',
      purpose: 'visit-photo',
      storageKey: 'visit-photos/org_1/visit_other/file-1-photo.png',
      originalName: 'visit-photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      status: 'uploaded',
      visitRecordId: 'visit_other',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      completedAt: '2026-03-28T00:00:00.000Z',
      downloadDisposition: 'inline',
    });

    const response = await PATCH(
      createRequest({
        version: 1,
        attachments: [{ file_id: '11111111-1111-4111-8111-111111111111' }],
      }),
      {
        params: Promise.resolve({ id: 'visit_1' }),
      }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '添付ファイルの訪問記録IDが一致しません',
    });
    expect(visitRecordUpdateMock).not.toHaveBeenCalled();
  });
});
