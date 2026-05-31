import { beforeEach, describe, expect, it, vi } from 'vitest';
import { format } from 'date-fns';
import { NextRequest } from 'next/server';

const TODAY = format(new Date(), 'yyyy-MM-dd');

const {
  withAuthMock,
  withOrgContextMock,
  prescriptionIntakeFindFirstMock,
  medicationProfileFindManyMock,
  medicationProfileCreateMock,
  medicationProfileUpdateMock,
  medicationProfileUpdateManyMock,
} = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
    ) => {
      return (req: NextRequest) =>
        handler(Object.assign(req, {
          orgId: 'org_1',
          userId: 'user_1',
        }));
    }
  ),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn().mockResolvedValue(null),
  medicationProfileFindManyMock: vi.fn().mockResolvedValue([]),
  medicationProfileCreateMock: vi.fn().mockResolvedValue({}),
  medicationProfileUpdateMock: vi.fn().mockResolvedValue({}),
  medicationProfileUpdateManyMock: vi.fn().mockResolvedValue({ count: 0 }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
    medicationProfile: {
      findMany: medicationProfileFindManyMock,
      create: medicationProfileCreateMock,
      update: medicationProfileUpdateMock,
      updateMany: medicationProfileUpdateManyMock,
    },
  },
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/prescription-intakes/facility-batch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/prescription-intakes/facility-batch POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects mixed-facility bulk intake requests', async () => {
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'case_1',
              patient_id: 'patient_1',
              patient: {
                id: 'patient_1',
                name: '山田 花子',
                residences: [{ building_id: 'facility_a', address: '東京都A区1-1-1' }],
              },
            },
            {
              id: 'case_2',
              patient_id: 'patient_2',
              patient: {
                id: 'patient_2',
                name: '佐藤 次郎',
                residences: [{ building_id: 'facility_b', address: '東京都B区2-2-2' }],
              },
            },
          ]),
        },
        medicationCycle: {
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: vi.fn(),
        },
      })
    );

    const response = await POST(
      createRequest({
        source_type: 'facility_batch',
        prescribed_date: TODAY,
        entries: [
          {
            case_id: 'case_1',
            patient_id: 'patient_1',
            lines: [
              {
                line_number: 1,
                drug_name: 'アムロジピン錠5mg',
                drug_code: '2149001',
                dose: '1錠',
                frequency: '1日1回朝食後',
                days: 14,
              },
            ],
          },
          {
            case_id: 'case_2',
            patient_id: 'patient_2',
            lines: [
              {
                line_number: 1,
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '1149019',
                dose: '1錠',
                frequency: '疼痛時',
                days: 7,
              },
            ],
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '施設まとめ処方は同一施設の患者のみ一括登録できます',
      details: {
        facilities: ['facility_a', 'facility_b'],
      },
    });
  });

  it('creates one medication cycle and intake per patient in a facility batch', async () => {
    const cycleCreateMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        case_id: 'case_2',
        overall_status: 'intake_received',
        version: 1,
      });
    const cycleFindFirstMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'structuring',
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        overall_status: 'ready_to_dispense',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'cycle_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        overall_status: 'intake_received',
        version: 1,
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        overall_status: 'structuring',
        version: 2,
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        overall_status: 'ready_to_dispense',
        version: 3,
      })
      .mockResolvedValueOnce({
        id: 'cycle_2',
        patient_id: 'patient_2',
        case_id: 'case_2',
      });
    const cycleUpdateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const intakeCreateMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 'intake_1' })
      .mockResolvedValueOnce({ id: 'intake_2' });
    const dispenseTaskCreateMock = vi.fn().mockResolvedValue({ id: 'task_1' });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        careCase: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'case_1',
              patient_id: 'patient_1',
              patient: {
                id: 'patient_1',
                name: '山田 花子',
                residences: [{ building_id: 'facility_a', address: '東京都A区1-1-1' }],
              },
            },
            {
              id: 'case_2',
              patient_id: 'patient_2',
              patient: {
                id: 'patient_2',
                name: '佐藤 次郎',
                residences: [{ building_id: 'facility_a', address: '東京都A区1-1-1' }],
              },
            },
          ]),
          findFirst: vi.fn().mockImplementation(async ({ where }) => ({
            id: where.id,
            patient_id: where.patient_id,
            primary_pharmacist_id: where.id === 'case_1' ? 'pharmacist_1' : 'pharmacist_2',
          })),
        },
        medicationCycle: {
          create: cycleCreateMock,
          findFirst: cycleFindFirstMock,
          updateMany: cycleUpdateManyMock,
        },
        cycleTransitionLog: {
          create: vi.fn().mockResolvedValue({}),
        },
        workflowException: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(),
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
        inquiryRecord: {
          count: vi.fn().mockResolvedValue(0),
        },
        dispenseTask: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: dispenseTaskCreateMock,
        },
      })
    );

    const response = await POST(
      createRequest({
        source_type: 'facility_batch',
        prescribed_date: TODAY,
        prescriber_name: '田中 一郎',
        prescription_category: 'emergency',
        emergency_category: 'other_exacerbation',
        entries: [
          {
            case_id: 'case_1',
            patient_id: 'patient_1',
            lines: [
              {
                line_number: 1,
                drug_name: 'アムロジピン錠5mg',
                drug_code: '2149001',
                dose: '1錠',
                frequency: '1日1回朝食後',
                days: 14,
              },
              {
                line_number: 2,
                drug_name: 'マグミット錠330mg',
                drug_code: '2344004',
                dose: '2錠',
                frequency: '1日2回朝夕食後',
                days: 14,
              },
            ],
          },
          {
            case_id: 'case_2',
            patient_id: 'patient_2',
            lines: [
              {
                line_number: 1,
                drug_name: 'ロキソプロフェン錠60mg',
                drug_code: '1149019',
                dose: '1錠',
                frequency: '疼痛時',
                days: 7,
              },
            ],
          },
        ],
      })
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      facility_label: 'facility_a',
      patient_count: 2,
      entries: [
        {
          cycle_id: 'cycle_1',
          intake_id: 'intake_1',
          case_id: 'case_1',
          patient_id: 'patient_1',
          patient_name: '山田 花子',
          line_count: 2,
        },
        {
          cycle_id: 'cycle_2',
          intake_id: 'intake_2',
          case_id: 'case_2',
          patient_id: 'patient_2',
          patient_name: '佐藤 次郎',
          line_count: 1,
        },
      ],
    });
    expect(cycleCreateMock).toHaveBeenCalledTimes(2);
    expect(intakeCreateMock).toHaveBeenCalledTimes(2);
    expect(dispenseTaskCreateMock).toHaveBeenCalledTimes(2);
    expect(intakeCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          prescription_category: 'emergency',
          emergency_category: 'other_exacerbation',
        }),
      }),
    );
  });
});
