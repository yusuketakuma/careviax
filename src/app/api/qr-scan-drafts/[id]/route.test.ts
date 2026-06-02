import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type AuthenticatedTestRequest = NextRequest & { orgId: string; userId: string };

const { withAuthMock, withOrgContextMock, careCaseFindManyMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: AuthenticatedTestRequest,
        ctx: { params: Promise<{ id: string }> },
      ) => Promise<Response>,
    ) => {
      return (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handler(
          Object.assign(req, {
            orgId: 'org_1',
            userId: 'user_1',
          }),
          ctx,
        );
    },
  ),
  withOrgContextMock: vi.fn(),
  careCaseFindManyMock: vi.fn().mockResolvedValue([{ patient_id: 'patient_1' }]),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careCase: {
      findMany: careCaseFindManyMock,
    },
  },
}));

import { GET, DELETE } from './route';

const DRAFT_PARAMS = { params: Promise.resolve({ id: 'draft_1' }) };

function createRequest(method: 'DELETE' | 'GET' = 'GET') {
  return new NextRequest('http://localhost/api/qr-scan-drafts/draft_1', { method });
}

describe('/api/qr-scan-drafts/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects blank route IDs before assignment lookup or draft lookup', async () => {
    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: ' \t\n ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRスキャン下書きIDが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns 200 with the draft when found', async () => {
    const mockDraft = {
      id: 'draft_1',
      org_id: 'org_1',
      status: 'pending',
      parsed_data: { patientName: '山田 太郎' },
    };

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue(mockDraft),
        },
      }),
    );

    const response = await GET(createRequest(), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'draft_1', status: 'pending' });
  });

  it('returns 404 when draft is not found', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );

    const response = await GET(createRequest(), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
  });

  it('queries with the correct org_id scope', async () => {
    const findFirstSpy = vi
      .fn()
      .mockResolvedValue({ id: 'draft_1', org_id: 'org_1', status: 'pending' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: findFirstSpy,
        },
      }),
    );

    await GET(createRequest(), DRAFT_PARAMS);

    expect(findFirstSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'draft_1', org_id: 'org_1' }),
        include: expect.objectContaining({
          jahis_supplemental_records: expect.objectContaining({
            select: expect.objectContaining({
              record_type: true,
              record_label: true,
              summary: true,
              payload: true,
            }),
          }),
        }),
      }),
    );
  });
});

describe('/api/qr-scan-drafts/[id] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects blank route IDs before assignment lookup or discard side effects', async () => {
    const response = await DELETE(createRequest('DELETE'), {
      params: Promise.resolve({ id: ' \t\n ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRスキャン下書きIDが不正です',
    });
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('sets status to discarded and returns 200', async () => {
    const updatedDraft = { id: 'draft_1', status: 'discarded' };
    let callCount = 0;

    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      callCount += 1;
      if (callCount === 1) {
        return callback({
          qrScanDraft: {
            findFirst: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'pending' }),
          },
        });
      }
      return callback({
        qrScanDraft: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn().mockResolvedValue(updatedDraft),
        },
        jahisSupplementalRecord: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      });
    });

    const response = await DELETE(createRequest('DELETE'), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'draft_1', status: 'discarded' });
  });

  it('returns 404 when draft does not exist', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      }),
    );

    const response = await DELETE(createRequest('DELETE'), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
  });

  it('rejects already processed drafts before discard side effects', async () => {
    const updateManySpy = vi.fn();
    const deleteSupplementalSpy = vi.fn();

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'confirmed' }),
          updateMany: updateManySpy,
        },
        jahisSupplementalRecord: { deleteMany: deleteSupplementalSpy },
      }),
    );

    const response = await DELETE(createRequest('DELETE'), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'このQRスキャン下書きはすでに処理済みです',
    });
    expect(updateManySpy).not.toHaveBeenCalled();
    expect(deleteSupplementalSpy).not.toHaveBeenCalled();
  });

  it('does not delete supplemental records when pending discard claim is lost', async () => {
    const updateManySpy = vi.fn().mockResolvedValue({ count: 0 });
    const updateSpy = vi.fn();
    const deleteSupplementalSpy = vi.fn();
    let callCount = 0;

    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      callCount += 1;
      if (callCount === 1) {
        return callback({
          qrScanDraft: {
            findFirst: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'pending' }),
          },
        });
      }
      return callback({
        qrScanDraft: {
          updateMany: updateManySpy,
          update: updateSpy,
        },
        jahisSupplementalRecord: { deleteMany: deleteSupplementalSpy },
      });
    });

    const response = await DELETE(createRequest('DELETE'), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'このQRスキャン下書きはすでに処理済みです',
    });
    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'draft_1',
          org_id: 'org_1',
          status: 'pending',
        }),
        data: { status: 'discarded' },
      }),
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSupplementalSpy).not.toHaveBeenCalled();
  });

  it('updates with discarded status targeting correct draft id', async () => {
    const updateManySpy = vi.fn().mockResolvedValue({ count: 1 });
    const updateSpy = vi.fn().mockResolvedValue({ id: 'draft_1', status: 'discarded' });
    const deleteSupplementalSpy = vi.fn().mockResolvedValue({ count: 1 });
    let callCount = 0;

    withOrgContextMock.mockImplementation(async (_orgId, callback) => {
      callCount += 1;
      if (callCount === 1) {
        return callback({
          qrScanDraft: {
            findFirst: vi.fn().mockResolvedValue({ id: 'draft_1', status: 'pending' }),
          },
        });
      }
      return callback({
        qrScanDraft: { updateMany: updateManySpy, update: updateSpy },
        jahisSupplementalRecord: { deleteMany: deleteSupplementalSpy },
      });
    });

    await DELETE(createRequest('DELETE'), DRAFT_PARAMS);

    expect(updateManySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'draft_1',
          org_id: 'org_1',
          status: 'pending',
        }),
        data: { status: 'discarded' },
      }),
    );
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft_1' },
        data: { status: 'discarded' },
      }),
    );
    expect(deleteSupplementalSpy).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        qr_draft_id: 'draft_1',
        prescription_intake_id: null,
      },
    });
  });
});
