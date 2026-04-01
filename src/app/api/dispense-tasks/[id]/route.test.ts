import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  withAuthMock,
  dispenseTaskFindFirstMock,
  membershipFindFirstMock,
  pharmacySiteFindFirstMock,
  drugMasterFindManyMock,
  pharmacyDrugStockFindManyMock,
  generateDispensePrefillMock,
  dispenseTaskUpdateMock,
  withOrgContextMock,
  notifyWorkflowMutationMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    }
  ),
  dispenseTaskFindFirstMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  drugMasterFindManyMock: vi.fn(),
  pharmacyDrugStockFindManyMock: vi.fn(),
  generateDispensePrefillMock: vi.fn(),
  dispenseTaskUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  notifyWorkflowMutationMock: vi.fn(),
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

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/server/services/workflow-dashboard-cache', () => ({
  notifyWorkflowMutation: notifyWorkflowMutationMock,
}));

vi.mock('@/lib/dispensing/prefill-generator', () => ({
  generateDispensePrefill: generateDispensePrefillMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return {} as NextRequest;
}

describe('/api/dispense-tasks/[id]', () => {
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
    generateDispensePrefillMock.mockResolvedValue({
      lines: [],
      packagingGroups: [],
      medicationChanges: [],
      dateWarnings: [],
      sourceType: 'fax',
      isPrefillAvailable: false,
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        dispenseTask: {
          update: dispenseTaskUpdateMock,
        },
      })
    );
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

    const response = await GET(createGetRequest(), {
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
    expect(generateDispensePrefillMock).toHaveBeenCalledWith('cycle_1', 'org_1', 'site_1');
  });

  it('keeps packaging groups available for completed tasks during auditing', async () => {
    generateDispensePrefillMock.mockResolvedValue({
      lines: [],
      packagingGroups: [
        {
          lineId: 'line_1',
          groupId: 'group_1',
          groupLabel: '朝食後',
        },
      ],
      medicationChanges: [],
      dateWarnings: [],
      sourceType: 'fax',
      isPrefillAvailable: true,
    });
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      cycle_id: 'cycle_1',
      priority: 'normal',
      due_date: null,
      status: 'completed',
      results: [
        {
          id: 'result_1',
          line_id: 'line_1',
          actual_drug_name: 'アムロジピン錠5mg',
          actual_drug_code: '111',
          actual_quantity: 14,
          actual_unit: '錠',
          discrepancy_reason: null,
          carry_type: 'carry',
          special_notes: null,
          dispensed_at: '2026-04-01T09:00:00.000Z',
          line: {
            id: 'line_1',
            line_number: 1,
            drug_name: 'アムロジピン錠5mg',
            drug_code: '111',
            dosage_form: '錠剤',
            dose: '1回1錠',
            frequency: '朝食後',
            days: 14,
            quantity: 14,
            unit: '錠',
            is_generic: false,
            is_generic_name_prescription: false,
            packaging_instructions: '一包化',
            notes: null,
          },
        },
      ],
      audits: [],
      cycle: {
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'audit_pending',
        inquiries: [],
        case_: {
          id: 'case_1',
          primary_pharmacist_id: 'pharmacist_1',
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            residences: [],
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
                drug_name: 'アムロジピン錠5mg',
                drug_code: '111',
                dosage_form: '錠剤',
                dose: '1回1錠',
                frequency: '朝食後',
                days: 14,
                quantity: 14,
                unit: '錠',
                is_generic: false,
                is_generic_name_prescription: false,
                packaging_instructions: '一包化',
                notes: null,
              },
            ],
          },
        ],
      },
    });
    drugMasterFindManyMock.mockResolvedValue([]);
    pharmacyDrugStockFindManyMock.mockResolvedValue([]);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'task_1' }),
    });

    if (!response) throw new Error('response is required');
    await expect(response.json()).resolves.toMatchObject({
      prefill: {
        packagingGroups: [
          expect.objectContaining({
            lineId: 'line_1',
            groupId: 'group_1',
          }),
        ],
      },
    });
  });

  it('broadcasts a workflow refresh after updating a dispense task', async () => {
    dispenseTaskFindFirstMock.mockResolvedValue({
      id: 'task_1',
      status: 'pending',
      assigned_to: null,
    });
    dispenseTaskUpdateMock.mockResolvedValue({
      id: 'task_1',
      status: 'in_progress',
      assigned_to: 'user_1',
      cycle: {
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'dispensing',
        case_: {
          id: 'case_1',
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
          },
        },
      },
      results: [],
      audits: [],
    });

    const response = await PATCH(
      {
        json: async () => ({
          status: 'in_progress',
        }),
      } as NextRequest,
      {
        params: Promise.resolve({ id: 'task_1' }),
      }
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(dispenseTaskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task_1' },
        data: expect.objectContaining({
          status: 'in_progress',
          assigned_to: 'user_1',
        }),
      })
    );
    expect(notifyWorkflowMutationMock).toHaveBeenCalledWith({
      orgId: 'org_1',
      payload: {
        source: 'dispense_tasks_update',
        task_id: 'task_1',
        status: 'in_progress',
      },
    });
  });
});
