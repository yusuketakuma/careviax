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

  it('does not truncate interactions before prioritizing contraindications', async () => {
    drugMasterFindUniqueMock.mockResolvedValue({
      id: 'drug_1',
      drug_name: 'アセトアミノフェン',
      package_inserts: [],
      interactions_as_a: [
        {
          id: 'interaction_caution',
          severity: 'caution',
          drug_b: { id: 'drug_b', drug_name: '注意薬', yj_code: '111111111111' },
        },
        {
          id: 'interaction_contraindicated',
          severity: 'contraindicated',
          drug_b: { id: 'drug_c', drug_name: '禁忌薬', yj_code: '222222222222' },
        },
        {
          id: 'interaction_minor',
          severity: 'minor',
          drug_b: { id: 'drug_d', drug_name: '参考薬', yj_code: '333333333333' },
        },
      ],
      interactions_as_b: [
        {
          id: 'interaction_b_minor',
          severity: 'minor',
          drug_a: { id: 'drug_e', drug_name: '参考薬B', yj_code: '444444444444' },
        },
        {
          id: 'interaction_b_contraindicated',
          severity: 'contraindicated',
          drug_a: { id: 'drug_f', drug_name: '禁忌薬B', yj_code: '555555555555' },
        },
      ],
    });

    const response = (await GET(createRequest(), {
      params: Promise.resolve({ id: 'drug_1' }),
    }))!;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(drugMasterFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          interactions_as_a: {
            include: {
              drug_b: { select: { id: true, drug_name: true, yj_code: true } },
            },
          },
          interactions_as_b: {
            include: {
              drug_a: { select: { id: true, drug_name: true, yj_code: true } },
            },
          },
        }),
      }),
    );
    expect(body.interactions_as_a.map((interaction: { id: string }) => interaction.id)).toEqual([
      'interaction_contraindicated',
      'interaction_caution',
      'interaction_minor',
    ]);
    expect(body.interactions_as_b.map((interaction: { id: string }) => interaction.id)).toEqual([
      'interaction_b_contraindicated',
      'interaction_b_minor',
    ]);
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
