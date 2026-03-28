import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  dispenseTaskFindFirstMock,
  membershipFindFirstMock,
  pharmacySiteFindFirstMock,
  drugMasterFindManyMock,
  pharmacyDrugStockFindManyMock,
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
  dispenseTaskFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  pharmacyDrugStockFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    dispenseTask: {
      findFirst: dispenseTaskFindFirstMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    drugMaster: {
      findMany: drugMasterFindManyMock,
    },
    pharmacyDrugStock: {
      findMany: pharmacyDrugStockFindManyMock,
    },
  },
}));

import { GET } from './route';

function createRequest() {
  return {} as NextRequest;
}

describe('/api/dispense-tasks/[id] GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipFindFirstMock.mockResolvedValue({
      site_id: null,
      user: {
        default_site_id: 'site_1',
      },
    });
    pharmacySiteFindFirstMock.mockResolvedValue({
      id: 'site_1',
      name: '本店',
    });
  });

  it('returns facility label and stocked generic guidance for generic-name prescriptions', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
      priority: 'normal',
      due_date: null,
      status: 'pending',
      results: [],
      audits: [],
      cycle: {
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'ready_to_dispense',
        inquiries: [],
        case_: {
          id: 'case_1',
          primary_pharmacist_id: 'pharmacist_1',
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            residences: [
              {
                building_id: 'facility_a',
                address: '東京都港区1-2-3',
                unit_name: '301',
              },
            ],
          },
        },
        prescription_intakes: [
          {
            id: 'intake_1',
            prescribed_date: '2026-03-28T00:00:00.000Z',
            prescriber_name: '在宅医',
            prescriber_institution: 'みなとクリニック',
            original_document_url: null,
            lines: [
              {
                id: 'line_1',
                line_number: 1,
                drug_name: 'アムロジピンベシル酸塩錠',
                drug_code: null,
                dosage_form: '錠剤',
                dose: '1回1錠',
                frequency: '1日1回',
                days: 14,
                quantity: 14,
                unit: '錠',
                is_generic: false,
                is_generic_name_prescription: true,
                packaging_instructions: null,
                notes: null,
              },
            ],
          },
        ],
      },
    });
    drugMasterFindManyMock.mockResolvedValue([]);
    pharmacyDrugStockFindManyMock.mockResolvedValue([
      {
        drug_master_id: 'drug_generic_1',
        preferred_generic_id: 'drug_generic_1',
        drug_master: {
          id: 'drug_generic_1',
          drug_name: 'アムロジピンOD錠5mg',
          yj_code: '222',
          generic_name: 'アムロジピンベシル酸塩錠',
          is_generic: true,
        },
        preferred_generic: {
          id: 'drug_generic_1',
          drug_name: 'アムロジピンOD錠5mg',
          yj_code: '222',
        },
      },
    ]);

    const response = await GET(createRequest(), {
      params: Promise.resolve({ id: 'task_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      facility_label: 'facility_a',
      site: {
        id: 'site_1',
        name: '本店',
      },
      stock_guidance: [
        expect.objectContaining({
          line_id: 'line_1',
          stock_status: 'preferred_generic',
          recommended_drug_name: 'アムロジピンOD錠5mg',
          recommended_drug_code: '222',
        }),
      ],
    });
  });
});
