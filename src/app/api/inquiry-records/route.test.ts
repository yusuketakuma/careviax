import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  inquiryRecordFindManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn((
    handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
  ) => {
    return (req: NextRequest) =>
      handler({
        ...req,
        orgId: 'org_1',
        userId: 'user_1',
      } as NextRequest & { orgId: string; userId: string });
  }),
  inquiryRecordFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    inquiryRecord: {
      findMany: inquiryRecordFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest(url: string) {
  return { url } as unknown as NextRequest;
}

describe('/api/inquiry-records GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inquiryRecordFindManyMock.mockResolvedValue([]);
  });

  it('filters by patient through the medication cycle relation when patient_id is provided', async () => {
    const response = await GET(
      createRequest('http://localhost/api/inquiry-records?patient_id=patient_1')
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(inquiryRecordFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          cycle: {
            patient_id: 'patient_1',
          },
        },
        orderBy: { inquired_at: 'desc' },
      })
    );
  });
});
