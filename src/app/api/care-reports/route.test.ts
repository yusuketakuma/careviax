import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { withAuthMock, careReportFindManyMock, patientFindManyMock } = vi.hoisted(() => ({
  withAuthMock: vi.fn(),
  careReportFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (
    handler: (
      req: NextRequest & { orgId: string; userId: string; role?: string }
    ) => Promise<Response>
  ) => {
    withAuthMock.mockImplementation(handler);
    return handler;
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    careReport: {
      findMany: careReportFindManyMock,
    },
    patient: {
      findMany: patientFindManyMock,
    },
  },
}));

import { GET } from './route';

describe('/api/care-reports GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    careReportFindManyMock.mockResolvedValue([
      {
        id: 'report_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        visit_record_id: 'visit_1',
        report_type: 'physician_report',
        status: 'response_waiting',
        content: {
          summary: '服薬状況は安定。夜間の眠気について経過観察。',
        },
        template_id: null,
        pdf_url: null,
        created_by: 'user_1',
        created_at: new Date('2026-03-28T09:00:00.000Z'),
        updated_at: new Date('2026-03-28T09:15:00.000Z'),
        delivery_records: [
          {
            id: 'delivery_1',
            channel: 'fax',
            recipient_name: '在宅主治医',
            status: 'response_waiting',
            sent_at: new Date('2026-03-28T11:00:00.000Z'),
            created_at: new Date('2026-03-28T10:30:00.000Z'),
          },
          {
            id: 'delivery_2',
            channel: 'fax',
            recipient_name: '在宅主治医',
            status: 'failed',
            sent_at: null,
            created_at: new Date('2026-03-28T10:00:00.000Z'),
          },
        ],
      },
    ]);
    patientFindManyMock.mockResolvedValue([
      { id: 'patient_1', name: '山田 太郎', name_kana: 'ヤマダ タロウ' },
    ]);
  });

  it('supports extended report search filters and enriches delivery summary', async () => {
    const response = await GET({
      orgId: 'org_1',
      userId: 'user_1',
      role: 'pharmacist',
      url: 'http://localhost/api/care-reports?q=山田&report_type=physician_report&delivery_status=response_waiting&recipient=主治医&date_from=2026-03-01&date_to=2026-03-31',
      headers: { get: () => null },
    } as unknown as NextRequest & { orgId: string; userId: string; role?: string });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(careReportFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          report_type: 'physician_report',
          delivery_records: {
            some: expect.objectContaining({
              status: 'response_waiting',
              recipient_name: { contains: '主治医', mode: 'insensitive' },
            }),
          },
        }),
      }),
    );

    const payload = (await response.json()) as {
      data: Array<{
        patient_name: string;
        latest_delivery_status: string | null;
        failed_delivery_count: number;
        pending_delivery_count: number;
      }>;
      deliverySummary: {
        pending_delivery_count: number;
        failed_delivery_count: number;
        by_status: Record<string, number>;
      };
    };

    expect(payload.data[0]).toMatchObject({
      patient_name: '山田 太郎',
      latest_delivery_status: 'response_waiting',
      failed_delivery_count: 1,
      pending_delivery_count: 1,
    });
    expect(payload.deliverySummary).toMatchObject({
      pending_delivery_count: 1,
      failed_delivery_count: 1,
      by_status: { response_waiting: 1 },
    });
  });
});
