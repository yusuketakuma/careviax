import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { drugMasterFindManyMock } = vi.hoisted(() => ({
  drugMasterFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    drugMaster: {
      findMany: drugMasterFindManyMock,
    },
  },
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/drug-masters/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/drug-masters/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drugMasterFindManyMock.mockResolvedValue([
      {
        yj_code: '1111111A',
        drug_name: 'アセトアミノフェン',
        dosage_form: '錠剤',
        drug_price: 10,
        unit: '錠',
        is_generic: true,
        is_narcotic: false,
        is_psychotropic: false,
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: 'acetAMINOPHEN',
        lasa_group_key: 'acetaminophen_anticoagulant',
        max_administration_days: 30,
        therapeutic_category: '解熱鎮痛薬',
      },
    ]);
  });

  it('returns drug master records keyed by yj code', async () => {
    const response = (await POST(
      createRequest({
        yj_codes: ['1111111A'],
      }),
      { params: Promise.resolve({}) },
    ))!;

    expect(response.status).toBe(200);
    expect(drugMasterFindManyMock).toHaveBeenCalledWith({
      where: { yj_code: { in: ['1111111A'] } },
      select: expect.any(Object),
    });
    expect(drugMasterFindManyMock.mock.calls[0]?.[0].select).toEqual(
      expect.objectContaining({
        is_high_risk: true,
        is_lasa_risk: true,
        tall_man_name: true,
        lasa_group_key: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      '1111111A': expect.objectContaining({
        drug_name: 'アセトアミノフェン',
        tall_man_name: 'acetAMINOPHEN',
      }),
    });
  });
});
