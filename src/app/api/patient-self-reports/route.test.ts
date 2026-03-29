import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  patientSelfReportFindManyMock,
  patientFindManyMock,
  patientSelfReportCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  patientSelfReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  patientSelfReportCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' });
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patientSelfReport: {
      findMany: patientSelfReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { GET, POST } from './route';

describe('/api/patient-self-reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientSelfReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        patient_id: 'patient_1',
        reported_by_name: '家族A',
        relation: 'child',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '夕食後を飲み忘れ',
        requested_callback: true,
        preferred_contact_time: '18時以降',
        status: 'triaged',
        triaged_by: 'user_1',
        triaged_at: new Date('2026-03-28T00:00:00.000Z'),
        created_at: new Date('2026-03-28T00:00:00.000Z'),
        updated_at: new Date('2026-03-28T00:00:00.000Z'),
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      {
        id: 'patient_1',
        name: '患者A',
        name_kana: 'カンジャエー',
      },
    ]);
    patientSelfReportCreateMock.mockResolvedValue({
      id: 'report_2',
      patient_id: 'patient_1',
      reported_by_name: '家族B',
      relation: 'spouse',
      category: 'adherence',
      subject: '飲み忘れ',
      content: '朝食後を飲み忘れ',
      requested_callback: false,
      preferred_contact_time: null,
      status: 'triaged',
      triaged_by: 'user_1',
      triaged_at: new Date('2026-03-29T00:00:00.000Z'),
      created_at: new Date('2026-03-29T00:00:00.000Z'),
      updated_at: new Date('2026-03-29T00:00:00.000Z'),
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientSelfReport: {
          create: patientSelfReportCreateMock,
        },
      }),
    );
  });

  it('lists self reports with patient display names', async () => {
    const response = (await GET({
      url: 'http://localhost/api/patient-self-reports?patient_id=patient_1&status=triaged',
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'report_1',
          patient_name: '患者A',
          patient_name_kana: 'カンジャエー',
        }),
      ],
    });
  });

  it('creates a triaged self report', async () => {
    const response = (await POST({
      json: async () => ({
        patient_id: 'patient_1',
        reported_by_name: '家族B',
        relation: 'spouse',
        category: 'adherence',
        subject: '飲み忘れ',
        content: '朝食後を飲み忘れ',
      }),
    } as NextRequest, { params: Promise.resolve({}) }))!;

    expect(response.status).toBe(201);
    expect(patientSelfReportCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        reported_by_name: '家族B',
        triaged_by: 'user_1',
        status: 'triaged',
      }),
    });
  });
});
