import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  withOrgContextMock,
  qrScanDraftFindFirstMock,
  qrScanDraftUpdateMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (
        req: NextRequest & { orgId: string; userId: string },
        ctx: { params: Promise<{ id: string }> }
      ) => Promise<Response>
    ) => {
      return (req: NextRequest, ctx: { params: Promise<{ id: string }> }) =>
        handler(
          {
            ...req,
            orgId: 'org_1',
            userId: 'user_1',
          } as NextRequest & { orgId: string; userId: string },
          ctx
        );
    }
  ),
  withOrgContextMock: vi.fn(),
  qrScanDraftFindFirstMock: vi.fn(),
  qrScanDraftUpdateMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, DELETE } from './route';

const DRAFT_PARAMS = { params: Promise.resolve({ id: 'draft_1' }) };

function createRequest() {
  return {} as unknown as NextRequest;
}

describe('/api/qr-scan-drafts/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      })
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
      })
    );

    const response = await GET(createRequest(), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
  });

  it('queries with the correct org_id scope', async () => {
    const findFirstSpy = vi.fn().mockResolvedValue({ id: 'draft_1', org_id: 'org_1', status: 'pending' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        qrScanDraft: {
          findFirst: findFirstSpy,
        },
      })
    );

    await GET(createRequest(), DRAFT_PARAMS);

    expect(findFirstSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'draft_1', org_id: 'org_1' }),
      })
    );
  });
});

describe('/api/qr-scan-drafts/[id] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          update: vi.fn().mockResolvedValue(updatedDraft),
        },
      });
    });

    const response = await DELETE(createRequest(), DRAFT_PARAMS);

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
      })
    );

    const response = await DELETE(createRequest(), DRAFT_PARAMS);

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
  });

  it('updates with discarded status targeting correct draft id', async () => {
    const updateSpy = vi.fn().mockResolvedValue({ id: 'draft_1', status: 'discarded' });
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
        qrScanDraft: { update: updateSpy },
      });
    });

    await DELETE(createRequest(), DRAFT_PARAMS);

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft_1' },
        data: { status: 'discarded' },
      })
    );
  });
});
