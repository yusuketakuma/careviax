import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { drugMasterFindUniqueMock } = vi.hoisted(() => ({
  drugMasterFindUniqueMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMaster: {
      findUnique: drugMasterFindUniqueMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/drug-masters/drug_1');
}

describe('/api/drug-masters/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterFindUniqueMock.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'アセトアミノフェン',
      package_inserts: [],
      interactions_as_a: [],
      interactions_as_b: [],
    });
  });

  it('returns the drug master detail with related safety data', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '  drug_1  ' }),
    }))!;

    expect(response.status).toBe(200);
    expect(drugMasterFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'drug_1' },
      include: expect.any(Object),
    });
  });

  it('rejects blank drug master ids before querying safety data', async () => {
    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品IDが不正です',
    });
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
  });
});
