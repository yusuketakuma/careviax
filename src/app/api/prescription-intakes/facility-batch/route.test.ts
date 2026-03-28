import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, withOrgContextMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(
    (
      handler: (req: NextRequest & { orgId: string; userId: string }) => Promise<Response>
    ) => {
      return (req: NextRequest) =>
        handler({
          ...req,
          orgId: 'org_1',
          userId: 'user_1',
        } as NextRequest & { orgId: string; userId: string });
    }
  ),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: withAuthMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest;
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
        prescribed_date: '2026-03-28',
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
      .mockResolvedValueOnce({ id: 'cycle_1' })
      .mockResolvedValueOnce({ id: 'cycle_2' });
    const intakeCreateMock = vi
      .fn()
      .mockResolvedValueOnce({ id: 'intake_1', lines: [{ id: 'line_1' }, { id: 'line_2' }] })
      .mockResolvedValueOnce({ id: 'intake_2', lines: [{ id: 'line_3' }] });

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
        },
        medicationCycle: {
          create: cycleCreateMock,
        },
        prescriptionIntake: {
          create: intakeCreateMock,
        },
      })
    );

    const response = await POST(
      createRequest({
        source_type: 'facility_batch',
        prescribed_date: '2026-03-28',
        prescriber_name: '田中 一郎',
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
  });
});
